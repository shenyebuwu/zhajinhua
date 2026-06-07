"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "zjh-test-"));
process.env.ROOM_IDLE_MINUTES = "30";
process.env.TURN_TIMEOUT_SECONDS = "15";
process.env.AUTO_NEXT_DELAY_SECONDS = "0";

const { createGameServer, compareHands, evaluateHand, __test } = require("../server");

const server = createGameServer();

function card(suit, rank) {
  return { suit, rank };
}

async function post(base, pathName, body, token = "") {
  const response = await fetch(`${base}${pathName}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  });
  const json = await response.json();
  if (!response.ok || json.error) throw new Error(json.error || `HTTP ${response.status}`);
  return json;
}

async function get(base, pathName, token = "") {
  const response = await fetch(`${base}${pathName}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {}
  });
  const json = await response.json();
  if (!response.ok || json.error) throw new Error(json.error || `HTTP ${response.status}`);
  return json;
}

async function main() {
  assert.strictEqual(evaluateHand([card("S", 14), card("H", 14), card("D", 14)]).label, "豹子");
  assert.strictEqual(
    compareHands([card("S", 14), card("H", 14), card("D", 14)], [card("S", 12), card("S", 13), card("S", 14)]),
    1
  );
  assert.strictEqual(
    compareHands([card("S", 2), card("H", 3), card("D", 5)], [card("S", 14), card("H", 14), card("D", 14)]),
    1
  );
  assert.strictEqual(evaluateHand([card("S", 12), card("S", 13), card("S", 14)]).label, "顺金");
  assert.strictEqual(evaluateHand([card("S", 14), card("H", 2), card("D", 3)]).label, "顺子");

  const happyRoom = {
    ante: 10,
    happyBonuses: [],
    lastActiveAt: Date.now(),
    log: [],
    players: [
      {
        id: "a",
        name: "豹子",
        chips: 1000,
        inHand: true,
        folded: false,
        happyPaid: false,
        blindActionCount: 0,
        hand: [card("S", 9), card("H", 9), card("D", 9)]
      },
      { id: "b", name: "对手", chips: 1000, inHand: true, folded: false, hand: [card("S", 2), card("H", 7), card("D", 12)] }
    ]
  };
  __test.settleHappyBonusForPlayer(happyRoom, happyRoom.players[0]);
  assert.strictEqual(happyRoom.happyBonuses.length, 0);
  happyRoom.players[0].blindActionCount = 1;
  __test.settleHappyBonusForPlayer(happyRoom, happyRoom.players[0]);
  assert.strictEqual(happyRoom.happyBonuses.length, 1);
  assert.strictEqual(happyRoom.players[0].chips, 1200);
  assert.strictEqual(happyRoom.players[1].chips, 800);

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const home = await fetch(`${base}/`);
  assert.strictEqual(home.status, 200);
  assert.ok((await home.text()).includes("炸金花"));

  const alice = await post(base, "/api/auth/register", {
    username: "alice",
    password: "pass1234",
    displayName: "阿明"
  });
  assert.strictEqual(alice.user.role, "admin");

  const bob = await post(base, "/api/auth/register", {
    username: "bob",
    password: "pass1234",
    displayName: "小李"
  });
  let bobToken = bob.token;

  const defaultRoom = await post(base, "/api/room/create", { room: "DFLT" }, alice.token);
  assert.strictEqual(defaultRoom.state.ante, 1);
  assert.strictEqual(defaultRoom.state.startingChips, 100);
  assert.strictEqual(defaultRoom.state.blindMaxStakeMultiplier, 10);
  assert.strictEqual(defaultRoom.state.seenMaxStakeMultiplier, 20);

  const created = await post(base, "/api/room/create", {
    room: "TEST",
    password: "secret",
    playerLimit: 3,
    ante: 20,
    startingChips: 800,
    blindMaxStakeMultiplier: 10,
    seenMaxStakeMultiplier: 20
  }, alice.token);
  assert.strictEqual(created.roomId, "TEST");
  assert.strictEqual(created.state.maxPlayers, 3);
  assert.strictEqual(created.state.ante, 20);
  assert.strictEqual(created.state.blindMaxStakeMultiplier, 10);
  assert.strictEqual(created.state.seenMaxStakeMultiplier, 20);

  await assert.rejects(
    () => post(base, "/api/room/join", { room: "TEST", password: "wrong" }, bob.token),
    /房间密码不正确/
  );

  const joined = await post(base, "/api/room/join", { room: "TEST", password: "secret" }, bob.token);
  assert.strictEqual(joined.state.players.length, 2);
  await post(base, "/api/voice/signal", {
    room: "TEST",
    to: bob.user.id,
    signal: { type: "candidate", candidate: { candidate: "test", sdpMid: "0", sdpMLineIndex: 0 } }
  }, alice.token);

  const rejoin = await post(base, "/api/room/join", { room: "TEST", password: "secret" }, bobToken);
  assert.strictEqual(rejoin.state.players.length, 2);
  assert.strictEqual(rejoin.state.turnTimeoutSeconds, 15);

  const carol = await post(base, "/api/auth/register", {
    username: "carol",
    password: "pass1234",
    displayName: "小王"
  });
  await post(base, "/api/room/join", { room: "TEST", password: "secret" }, carol.token);
  const transferred = await post(base, "/api/action", { room: "TEST", action: "transferHost", targetId: bob.user.id }, alice.token);
  assert.strictEqual(transferred.state.hostId, bob.user.id);
  const kicked = await post(base, "/api/action", { room: "TEST", action: "kick", targetId: carol.user.id }, bobToken);
  assert.strictEqual(kicked.state.players.some((player) => player.id === carol.user.id), false);

  const updatedBob = await post(base, "/api/profile", {
    displayName: "小李二",
    currentPassword: "pass1234",
    newPassword: "newpass123"
  }, bobToken);
  assert.strictEqual(updatedBob.user.displayName, "小李二");
  const bobLogin = await post(base, "/api/auth/login", { username: "bob", password: "newpass123" });
  bobToken = bobLogin.token;
  assert.strictEqual(bobLogin.user.displayName, "小李二");
  const renamedRoom = await get(base, "/api/state?room=TEST", bobToken);
  assert.strictEqual(renamedRoom.players.find((player) => player.id === bob.user.id).name, "小李二");

  const started = await post(base, "/api/action", { room: "TEST", action: "start" }, bobToken);
  assert.strictEqual(started.state.phase, "playing");
  const aliceView = started.state.players.find((player) => player.id === started.state.viewerId);
  assert.deepStrictEqual(aliceView.hand, ["背面", "背面", "背面"]);
  assert.strictEqual(aliceView.rank, null);

  const stateForAlice = await get(base, "/api/state?room=TEST", alice.token);
  const turnToken = stateForAlice.turnPlayerId === alice.user.id ? alice.token : bobToken;
  const extended = await post(base, "/api/action", { room: "TEST", action: "extend" }, turnToken);
  assert.strictEqual(extended.state.canExtendTurn, false);
  const seen = await post(base, "/api/action", { room: "TEST", action: "see" }, turnToken);
  const seenPlayer = seen.state.players.find((player) => player.id === seen.state.viewerId);
  assert.notDeepStrictEqual(seenPlayer.hand, ["背面", "背面", "背面"]);
  assert.ok(seenPlayer.rank);

  await post(base, "/api/room/create", {
    room: "FOLD",
    password: "",
    playerLimit: 2,
    ante: 10,
    startingChips: 500
  }, alice.token);
  await post(base, "/api/room/join", { room: "FOLD", password: "" }, bobToken);
  const foldStarted = await post(base, "/api/action", { room: "FOLD", action: "start" }, alice.token);
  const foldToken = foldStarted.state.turnPlayerId === alice.user.id ? alice.token : bobToken;
  const folded = await post(base, "/api/action", { room: "FOLD", action: "fold" }, foldToken);
  assert.strictEqual(folded.state.phase, "roundEnd");
  const foldedPlayer = folded.state.players.find((player) => player.folded);
  assert.deepStrictEqual(foldedPlayer.hand, ["背面", "背面", "背面"]);
  assert.strictEqual(foldedPlayer.rank, null);

  await post(base, "/api/room/join", { room: "DFLT" }, bobToken);
  const capStarted = await post(base, "/api/action", { room: "DFLT", action: "start" }, alice.token);
  const capToken = capStarted.state.turnPlayerId === alice.user.id ? alice.token : bobToken;
  const otherCapToken = capStarted.state.turnPlayerId === alice.user.id ? bobToken : alice.token;
  await assert.rejects(
    () => post(base, "/api/action", { room: "DFLT", action: "raise", stake: 11 }, capToken),
    /闷牌单注最高为底注的 10 倍/
  );
  await post(base, "/api/action", { room: "DFLT", action: "see" }, capToken);
  await assert.rejects(
    () => post(base, "/api/action", { room: "DFLT", action: "raise", stake: 21 }, capToken),
    /看牌单注最高为底注的 20 倍/
  );
  await post(base, "/api/action", { room: "DFLT", action: "raise", stake: 20 }, capToken);
  await assert.rejects(
    () => post(base, "/api/action", { room: "DFLT", action: "call" }, otherCapToken),
    /闷牌单注最高为底注的 10 倍/
  );

  await post(base, "/api/room/create", {
    room: "CMP",
    playerLimit: 2,
    ante: 10,
    startingChips: 500
  }, alice.token);
  await post(base, "/api/room/join", { room: "CMP" }, bobToken);
  const cmpStarted = await post(base, "/api/action", { room: "CMP", action: "start" }, alice.token);
  const cmpToken = cmpStarted.state.turnPlayerId === alice.user.id ? alice.token : bobToken;
  const cmpActorId = cmpStarted.state.turnPlayerId;
  const cmpTarget = cmpStarted.state.players.find((player) => player.id !== cmpActorId);
  await post(base, "/api/action", { room: "CMP", action: "see" }, cmpToken);
  const compared = await post(base, "/api/action", { room: "CMP", action: "compare", targetId: cmpTarget.id }, cmpToken);
  const revealedPlayers = compared.state.players.filter((player) => player.revealed);
  assert.strictEqual(revealedPlayers.length, 2);
  assert.ok(revealedPlayers.every((player) => player.hand.every((item) => item !== "背面")));
  await new Promise((resolve) => setTimeout(resolve, 20));
  const autoNext = await get(base, "/api/state?room=CMP", alice.token);
  assert.strictEqual(autoNext.roundNo, 2);
  assert.strictEqual(autoNext.phase, "playing");

  const admin = await get(base, "/api/admin/summary", alice.token);
  assert.strictEqual(admin.rooms.length, 4);
  assert.ok(admin.logs.length >= 3);
  assert.strictEqual(admin.users.length, 3);

  console.log("smoke test passed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    server.close();
  });
