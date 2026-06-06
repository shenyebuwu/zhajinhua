"use strict";

const assert = require("assert");
const { createGameServer, compareHands, evaluateHand } = require("../server");

const server = createGameServer();

function card(suit, rank) {
  return { suit, rank };
}

async function post(base, path, body) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const json = await response.json();
  if (!response.ok || json.error) {
    throw new Error(json.error || `HTTP ${response.status}`);
  }
  return json;
}

async function main() {
  assert.strictEqual(
    evaluateHand([card("S", 14), card("H", 14), card("D", 14)]).label,
    "豹子"
  );
  assert.strictEqual(
    compareHands(
      [card("S", 14), card("H", 14), card("D", 14)],
      [card("S", 12), card("S", 13), card("S", 14)]
    ),
    1
  );
  assert.strictEqual(
    evaluateHand([card("S", 14), card("H", 2), card("D", 3)]).label,
    "顺子"
  );

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const home = await fetch(`${base}/`);
  assert.strictEqual(home.status, 200);
  assert.ok((home.headers.get("content-type") || "").includes("text/html"));
  assert.ok((await home.text()).includes("局域网炸金花"));

  const css = await fetch(`${base}/styles.css`);
  assert.strictEqual(css.status, 200);
  assert.ok((css.headers.get("content-type") || "").includes("text/css"));

  const alice = await post(base, "/api/join", { name: "阿明", room: "TEST", password: "secret" });
  await assert.rejects(
    () => post(base, "/api/join", { name: "路人", room: "TEST", password: "wrong" }),
    /房间密码不正确/
  );
  const bob = await post(base, "/api/join", { name: "小李", room: "TEST", password: "secret" });
  assert.strictEqual(alice.roomId, "TEST");
  assert.strictEqual(bob.state.players.length, 2);

  const started = await post(base, "/api/action", {
    room: "TEST",
    playerId: alice.playerId,
    action: "start"
  });
  assert.strictEqual(started.state.phase, "playing");
  assert.strictEqual(started.state.players.filter((p) => p.inHand).length, 2);

  const turnPlayerId = started.state.turnPlayerId;
  const afterCall = await post(base, "/api/action", {
    room: "TEST",
    playerId: turnPlayerId,
    action: "call"
  });
  assert.strictEqual(afterCall.state.phase, "playing");
  assert.ok(afterCall.state.pot >= 30);

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
