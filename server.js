"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const ROOM_TTL_MS = 1000 * 60 * 60 * 8;
const STARTING_CHIPS = Number(process.env.STARTING_CHIPS || 1000);
const ANTE = Number(process.env.ANTE || 10);
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS || 17);
const MIN_PLAYERS = 2;
const JOIN_WINDOW_MS = 1000 * 60 * 10;
const MAX_FAILED_JOINS = Number(process.env.MAX_FAILED_JOINS || 20);

const rooms = new Map();
const failedJoins = new Map();

const suits = ["S", "H", "D", "C"];
const ranks = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const rankName = {
  11: "J",
  12: "Q",
  13: "K",
  14: "A"
};
const suitName = {
  S: "♠",
  H: "♥",
  D: "♦",
  C: "♣"
};

function newId(bytes = 8) {
  return crypto.randomBytes(bytes).toString("hex");
}

function roomId() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "";
  for (let i = 0; i < 6; i += 1) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return id;
}

function sanitizeRoom(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

function sanitizeName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ").slice(0, 16);
  return name || `玩家${Math.floor(Math.random() * 90) + 10}`;
}

function sanitizePassword(value) {
  return String(value || "").trim().slice(0, 64);
}

function sanitizePlayerLimit(value) {
  const limit = Number(value || MAX_PLAYERS);
  if (!Number.isFinite(limit)) return MAX_PLAYERS;
  return Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.floor(limit)));
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString("hex");
}

function createRoom(requestedId, password = "", playerLimit = MAX_PLAYERS) {
  let id = sanitizeRoom(requestedId);
  while (!id || rooms.has(id)) {
    id = roomId();
  }

  const cleanPassword = sanitizePassword(password);
  const cleanPlayerLimit = sanitizePlayerLimit(playerLimit);
  const passwordSalt = cleanPassword ? newId(8) : null;
  const room = {
    id,
    playerLimit: cleanPlayerLimit,
    passwordSalt,
    passwordHash: cleanPassword ? hashPassword(cleanPassword, passwordSalt) : null,
    phase: "lobby",
    hostId: null,
    players: [],
    deck: [],
    pot: 0,
    currentStake: ANTE,
    minStake: ANTE,
    dealerIndex: -1,
    turnIndex: 0,
    turnCount: 0,
    roundNo: 0,
    winnerId: null,
    lastResult: null,
    log: [],
    clients: new Set(),
    updatedAt: Date.now()
  };
  rooms.set(id, room);
  return room;
}

function getRoom(id) {
  const key = sanitizeRoom(id);
  return key ? rooms.get(key) : null;
}

function appendLog(room, text) {
  room.log.unshift({ id: newId(4), at: Date.now(), text });
  room.log = room.log.slice(0, 40);
  room.updatedAt = Date.now();
}

function activePlayers(room) {
  return room.players.filter((p) => !p.folded && p.inHand && p.chips >= 0);
}

function alivePlayers(room) {
  return room.players.filter((p) => p.chips > 0);
}

function nextActiveIndex(room, fromIndex) {
  if (!room.players.length) return -1;
  for (let offset = 1; offset <= room.players.length; offset += 1) {
    const index = (fromIndex + offset + room.players.length) % room.players.length;
    const player = room.players[index];
    if (player && player.inHand && !player.folded) return index;
  }
  return -1;
}

function currentPlayer(room) {
  if (room.phase !== "playing") return null;
  return room.players[room.turnIndex] || null;
}

function cardLabel(card) {
  return `${suitName[card.suit]}${rankName[card.rank] || card.rank}`;
}

function createDeck() {
  const deck = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ suit, rank });
    }
  }
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function evaluateHand(hand) {
  const sorted = [...hand].sort((a, b) => b.rank - a.rank);
  const values = sorted.map((c) => c.rank);
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);

  const unique = [...new Set(values)].sort((a, b) => b - a);
  const isFlush = hand.every((card) => card.suit === hand[0].suit);
  let isStraight = unique.length === 3 && unique[0] - unique[2] === 2;
  let straightHigh = unique[0];
  if (unique.join(",") === "14,3,2") {
    isStraight = true;
    straightHigh = 3;
  }

  const byCount = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  let type = 1;
  let label = "单张";
  let tiebreakers = values;

  if (byCount[0][1] === 3) {
    type = 6;
    label = "豹子";
    tiebreakers = [byCount[0][0]];
  } else if (isStraight && isFlush) {
    type = 5;
    label = "同花顺";
    tiebreakers = [straightHigh];
  } else if (isFlush) {
    type = 4;
    label = "同花";
    tiebreakers = values;
  } else if (isStraight) {
    type = 3;
    label = "顺子";
    tiebreakers = [straightHigh];
  } else if (byCount[0][1] === 2) {
    type = 2;
    label = "对子";
    const pair = byCount[0][0];
    const kicker = byCount.find((entry) => entry[1] === 1)[0];
    tiebreakers = [pair, kicker];
  }

  return { type, label, tiebreakers, cards: hand.map(cardLabel) };
}

function compareHands(a, b) {
  const left = evaluateHand(a);
  const right = evaluateHand(b);
  if (left.type !== right.type) return left.type > right.type ? 1 : -1;
  const length = Math.max(left.tiebreakers.length, right.tiebreakers.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (left.tiebreakers[i] || 0) - (right.tiebreakers[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function pay(room, player, amount) {
  const realAmount = Math.max(0, Math.min(player.chips, amount));
  player.chips -= realAmount;
  player.betThisHand += realAmount;
  room.pot += realAmount;
  return realAmount;
}

function startHand(room) {
  const entrants = alivePlayers(room);
  if (entrants.length < MIN_PLAYERS) {
    throw new Error("至少需要 2 位有筹码的玩家才能开局");
  }

  room.phase = "playing";
  room.deck = createDeck();
  room.pot = 0;
  room.currentStake = ANTE;
  room.minStake = ANTE;
  room.turnCount = 0;
  room.roundNo += 1;
  room.winnerId = null;
  room.lastResult = null;
  room.dealerIndex = (room.dealerIndex + 1) % room.players.length;

  for (const player of room.players) {
    player.ready = false;
    player.hand = [];
    player.folded = true;
    player.seen = false;
    player.inHand = player.chips > 0;
    player.betThisHand = 0;
    if (player.inHand) {
      player.folded = false;
      player.hand = [room.deck.pop(), room.deck.pop(), room.deck.pop()];
      const antePaid = pay(room, player, ANTE);
      if (antePaid < ANTE && player.chips === 0) {
        appendLog(room, `${player.name} 全下底注 ${antePaid}`);
      }
    }
  }

  room.turnIndex = nextActiveIndex(room, room.dealerIndex);
  appendLog(room, `第 ${room.roundNo} 局开始，底注 ${ANTE}`);
  appendLog(room, `轮到 ${room.players[room.turnIndex].name}`);
}

function settleIfNeeded(room, reason = "") {
  const active = activePlayers(room);
  if (room.phase !== "playing" || active.length > 1) return false;
  if (active.length === 1) {
    const winner = active[0];
    winner.chips += room.pot;
    room.phase = "roundEnd";
    room.winnerId = winner.id;
    room.lastResult = {
      reason: reason || "其他玩家弃牌",
      winnerId: winner.id,
      winnerName: winner.name,
      pot: room.pot,
      hands: room.players.filter((p) => p.inHand).map((p) => ({
        id: p.id,
        name: p.name,
        folded: p.folded,
        hand: p.hand.map(cardLabel),
        rank: evaluateHand(p.hand)
      }))
    };
    appendLog(room, `${winner.name} 赢得 ${room.pot} 筹码`);
    room.pot = 0;
    return true;
  }
  return false;
}

function advanceTurn(room) {
  if (settleIfNeeded(room)) return;
  room.turnCount += 1;
  room.turnIndex = nextActiveIndex(room, room.turnIndex);
  const player = currentPlayer(room);
  if (player) appendLog(room, `轮到 ${player.name}`);
}

function requireTurn(room, playerId) {
  if (room.phase !== "playing") throw new Error("当前不在牌局中");
  const player = currentPlayer(room);
  if (!player || player.id !== playerId) throw new Error("还没轮到你");
  return player;
}

function verifyRoomPassword(room, password) {
  if (!room.passwordHash) return true;
  const cleanPassword = sanitizePassword(password);
  if (!cleanPassword) return false;
  const candidate = hashPassword(cleanPassword, room.passwordSalt);
  return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(room.passwordHash, "hex"));
}

function rateLimitKey(room, req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = forwarded || req.socket.remoteAddress || "unknown";
  return `${room.id}:${ip}`;
}

function assertCanTryJoin(room, req) {
  const key = rateLimitKey(room, req);
  const entry = failedJoins.get(key);
  if (entry && Date.now() - entry.firstAt < JOIN_WINDOW_MS && entry.count >= MAX_FAILED_JOINS) {
    throw new Error("尝试次数过多，请稍后再试");
  }
}

function recordFailedJoin(room, req) {
  const key = rateLimitKey(room, req);
  const now = Date.now();
  const entry = failedJoins.get(key);
  if (!entry || now - entry.firstAt >= JOIN_WINDOW_MS) {
    failedJoins.set(key, { count: 1, firstAt: now });
    return;
  }
  entry.count += 1;
}

function clearFailedJoin(room, req) {
  failedJoins.delete(rateLimitKey(room, req));
}

function joinRoom(room, name, playerId, password, req) {
  const normalizedName = sanitizeName(name);
  let player = playerId ? room.players.find((p) => p.id === playerId) : null;
  if (player) {
    player.name = normalizedName;
    player.online = true;
    room.updatedAt = Date.now();
    return player;
  }

  assertCanTryJoin(room, req);
  if (!verifyRoomPassword(room, password)) {
    recordFailedJoin(room, req);
    throw new Error("房间密码不正确");
  }
  clearFailedJoin(room, req);

  if (room.players.length >= room.playerLimit) {
    throw new Error(`房间最多 ${room.playerLimit} 人`);
  }
  if (room.phase === "playing") {
    throw new Error("牌局进行中，等本局结束后再加入");
  }

  player = {
    id: newId(),
    name: normalizedName,
    chips: STARTING_CHIPS,
    ready: false,
    hand: [],
    folded: true,
    seen: false,
    inHand: false,
    betThisHand: 0,
    online: true,
    joinedAt: Date.now()
  };
  room.players.push(player);
  if (!room.hostId) room.hostId = player.id;
  appendLog(room, `${player.name} 加入房间`);
  return player;
}

function publicPlayer(player, viewerId, room) {
  const showHand = room.phase === "roundEnd" || player.id === viewerId;
  const rank = showHand && player.hand.length ? evaluateHand(player.hand) : null;
  return {
    id: player.id,
    name: player.name,
    chips: player.chips,
    ready: player.ready,
    folded: player.folded,
    seen: player.seen,
    inHand: player.inHand,
    betThisHand: player.betThisHand,
    online: player.online,
    isHost: player.id === room.hostId,
    hand: showHand ? player.hand.map(cardLabel) : player.hand.map(() => "背面"),
    rank
  };
}

function snapshot(room, viewerId) {
  const viewer = room.players.find((p) => p.id === viewerId) || null;
  const turn = currentPlayer(room);
  return {
    id: room.id,
    phase: room.phase,
    pot: room.pot,
    ante: ANTE,
    minStake: room.minStake,
    currentStake: room.currentStake,
    turnPlayerId: turn ? turn.id : null,
    turnCount: room.turnCount,
    roundNo: room.roundNo,
    winnerId: room.winnerId,
    lastResult: room.lastResult,
    maxPlayers: room.playerLimit,
    deployMaxPlayers: MAX_PLAYERS,
    startingChips: STARTING_CHIPS,
    hasPassword: Boolean(room.passwordHash),
    players: room.players.map((p) => publicPlayer(p, viewerId, room)),
    viewerId: viewer ? viewer.id : null,
    hostId: room.hostId,
    canStart: room.phase !== "playing" && alivePlayers(room).length >= MIN_PLAYERS,
    log: room.log
  };
}

function sendEvent(client, room) {
  client.res.write(`event: state\ndata: ${JSON.stringify(snapshot(room, client.playerId))}\n\n`);
}

function broadcast(room) {
  room.updatedAt = Date.now();
  for (const client of room.clients) {
    sendEvent(client, room);
  }
}

async function parseJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1024 * 64) throw new Error("请求太大");
  }
  return body ? JSON.parse(body) : {};
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store"
  });
  res.end(body);
}

function errorJson(res, error, status = 400) {
  json(res, status, { error: error.message || String(error) });
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png"
  }[ext] || "application/octet-stream";
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  const safePath = path.normalize(relative).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "content-type": mimeType(filePath),
      "cache-control": "no-cache"
    });
    res.end(data);
  });
}

function handleAction(room, playerId, action, payload) {
  const actor = room.players.find((p) => p.id === playerId);
  if (!actor) throw new Error("玩家不存在");

  if (action === "ready") {
    if (room.phase === "playing") throw new Error("牌局进行中不能准备");
    actor.ready = !actor.ready;
    appendLog(room, `${actor.name}${actor.ready ? "已准备" : "取消准备"}`);
    return;
  }

  if (action === "start") {
    if (room.phase === "playing") throw new Error("已经在牌局中");
    if (playerId !== room.hostId) throw new Error("只有房主可以开局");
    startHand(room);
    return;
  }

  if (action === "next") {
    if (room.phase !== "roundEnd") throw new Error("本局还没有结束");
    if (playerId !== room.hostId) throw new Error("只有房主可以开下一局");
    startHand(room);
    return;
  }

  const player = requireTurn(room, playerId);

  if (action === "see") {
    player.seen = true;
    appendLog(room, `${player.name} 看牌`);
    return;
  }

  if (action === "fold") {
    player.folded = true;
    appendLog(room, `${player.name} 弃牌`);
    advanceTurn(room);
    return;
  }

  if (action === "call") {
    const cost = room.currentStake * (player.seen ? 2 : 1);
    const paid = pay(room, player, cost);
    appendLog(room, `${player.name}${player.seen ? "明跟" : "闷跟"} ${paid}`);
    advanceTurn(room);
    return;
  }

  if (action === "raise") {
    const stake = Number(payload.stake);
    if (!Number.isFinite(stake) || stake <= room.currentStake || stake % ANTE !== 0) {
      throw new Error(`加注需高于当前注且为 ${ANTE} 的倍数`);
    }
    if (stake > ANTE * 20) throw new Error("单注最高为底注的 20 倍");
    room.currentStake = stake;
    const cost = room.currentStake * (player.seen ? 2 : 1);
    const paid = pay(room, player, cost);
    appendLog(room, `${player.name} 加注到 ${stake}，支付 ${paid}`);
    advanceTurn(room);
    return;
  }

  if (action === "compare") {
    if (!player.seen) throw new Error("看牌后才能比牌");
    const target = room.players.find((p) => p.id === payload.targetId);
    if (!target || !target.inHand || target.folded || target.id === player.id) {
      throw new Error("请选择仍在牌局中的对手");
    }
    const paid = pay(room, player, room.currentStake * 2);
    const result = compareHands(player.hand, target.hand);
    const loser = result >= 0 ? target : player;
    loser.folded = true;
    appendLog(room, `${player.name} 支付 ${paid} 与 ${target.name} 比牌，${loser.name} 出局`);
    if (!settleIfNeeded(room, "比牌结束")) advanceTurn(room);
    return;
  }

  throw new Error("未知操作");
}

async function handleApi(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "POST" && url.pathname === "/api/join") {
      const body = await parseJson(req);
      const requestedRoom = sanitizeRoom(body.room);
      const room = getRoom(requestedRoom) || createRoom(requestedRoom, body.password, body.playerLimit);
      const player = joinRoom(room, body.name, body.playerId, body.password, req);
      broadcast(room);
      json(res, 200, { roomId: room.id, playerId: player.id, state: snapshot(room, player.id) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      const room = getRoom(url.searchParams.get("room"));
      if (!room) throw new Error("房间不存在");
      json(res, 200, snapshot(room, url.searchParams.get("player")));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/action") {
      const body = await parseJson(req);
      const room = getRoom(body.room);
      if (!room) throw new Error("房间不存在");
      handleAction(room, body.playerId, body.action, body);
      broadcast(room);
      json(res, 200, { ok: true, state: snapshot(room, body.playerId) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/events") {
      const room = getRoom(url.searchParams.get("room"));
      if (!room) {
        res.writeHead(404);
        res.end("room not found");
        return;
      }
      const playerId = url.searchParams.get("player");
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no"
      });
      const client = { id: newId(4), playerId, res };
      room.clients.add(client);
      sendEvent(client, room);
      const timer = setInterval(() => {
        res.write(": ping\n\n");
      }, 25000);
      req.on("close", () => {
        clearInterval(timer);
        room.clients.delete(client);
      });
      return;
    }

    serveStatic(req, res);
  } catch (error) {
    errorJson(res, error);
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms.entries()) {
    if (room.clients.size === 0 && now - room.updatedAt > ROOM_TTL_MS) {
      rooms.delete(id);
    }
  }
  for (const [key, entry] of failedJoins.entries()) {
    if (now - entry.firstAt > JOIN_WINDOW_MS) failedJoins.delete(key);
  }
}, 1000 * 60 * 15).unref();

function createGameServer() {
  return http.createServer((req, res) => {
    handleApi(req, res);
  });
}

if (require.main === module) {
  const server = createGameServer();
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`炸金花已启动：http://0.0.0.0:${PORT}`);
  });
}

module.exports = {
  createGameServer,
  evaluateHand,
  compareHands
};
