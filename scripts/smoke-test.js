"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "zjh-test-"));
process.env.ROOM_IDLE_MINUTES = "30";

const { createGameServer, compareHands, evaluateHand } = require("../server");

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

  const created = await post(base, "/api/room/create", {
    room: "TEST",
    password: "secret",
    playerLimit: 3,
    ante: 20,
    startingChips: 800,
    maxRaiseMultiplier: 10
  }, alice.token);
  assert.strictEqual(created.roomId, "TEST");
  assert.strictEqual(created.state.maxPlayers, 3);
  assert.strictEqual(created.state.ante, 20);

  await assert.rejects(
    () => post(base, "/api/room/join", { room: "TEST", password: "wrong" }, bob.token),
    /房间密码不正确/
  );

  const joined = await post(base, "/api/room/join", { room: "TEST", password: "secret" }, bob.token);
  assert.strictEqual(joined.state.players.length, 2);

  const rejoin = await post(base, "/api/room/join", { room: "TEST", password: "secret" }, bob.token);
  assert.strictEqual(rejoin.state.players.length, 2);

  const updatedBob = await post(base, "/api/profile", {
    displayName: "小李二",
    currentPassword: "pass1234",
    newPassword: "newpass123"
  }, bob.token);
  assert.strictEqual(updatedBob.user.displayName, "小李二");
  const bobLogin = await post(base, "/api/auth/login", { username: "bob", password: "newpass123" });
  assert.strictEqual(bobLogin.user.displayName, "小李二");
  const renamedRoom = await get(base, "/api/state?room=TEST", bob.token);
  assert.strictEqual(renamedRoom.players.find((player) => player.id === bob.user.id).name, "小李二");

  const started = await post(base, "/api/action", { room: "TEST", action: "start" }, alice.token);
  assert.strictEqual(started.state.phase, "playing");
  const aliceView = started.state.players.find((player) => player.id === started.state.viewerId);
  assert.deepStrictEqual(aliceView.hand, ["背面", "背面", "背面"]);
  assert.strictEqual(aliceView.rank, null);

  const stateForAlice = await get(base, "/api/state?room=TEST", alice.token);
  const turnToken = stateForAlice.turnPlayerId === alice.user.id ? alice.token : bob.token;
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
  await post(base, "/api/room/join", { room: "FOLD", password: "" }, bob.token);
  const foldStarted = await post(base, "/api/action", { room: "FOLD", action: "start" }, alice.token);
  const foldToken = foldStarted.state.turnPlayerId === alice.user.id ? alice.token : bob.token;
  const folded = await post(base, "/api/action", { room: "FOLD", action: "fold" }, foldToken);
  assert.strictEqual(folded.state.phase, "roundEnd");
  const foldedPlayer = folded.state.players.find((player) => player.folded);
  assert.deepStrictEqual(foldedPlayer.hand, ["背面", "背面", "背面"]);
  assert.strictEqual(foldedPlayer.rank, null);

  await post(base, "/api/room/create", {
    room: "CMP",
    playerLimit: 2,
    ante: 10,
    startingChips: 500
  }, alice.token);
  await post(base, "/api/room/join", { room: "CMP" }, bob.token);
  const cmpStarted = await post(base, "/api/action", { room: "CMP", action: "start" }, alice.token);
  const cmpToken = cmpStarted.state.turnPlayerId === alice.user.id ? alice.token : bob.token;
  const cmpActorId = cmpStarted.state.turnPlayerId;
  const cmpTarget = cmpStarted.state.players.find((player) => player.id !== cmpActorId);
  await post(base, "/api/action", { room: "CMP", action: "see" }, cmpToken);
  const compared = await post(base, "/api/action", { room: "CMP", action: "compare", targetId: cmpTarget.id }, cmpToken);
  const revealedPlayers = compared.state.players.filter((player) => player.revealed);
  assert.strictEqual(revealedPlayers.length, 2);
  assert.ok(revealedPlayers.every((player) => player.hand.every((item) => item !== "背面")));

  const admin = await get(base, "/api/admin/summary", alice.token);
  assert.strictEqual(admin.rooms.length, 3);
  assert.strictEqual(admin.users.length, 2);

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
