"use strict";

const joinView = document.querySelector("#joinView");
const gameView = document.querySelector("#gameView");
const joinForm = document.querySelector("#joinForm");
const nameInput = document.querySelector("#nameInput");
const roomInput = document.querySelector("#roomInput");
const copyRoomBtn = document.querySelector("#copyRoomBtn");
const statusTitle = document.querySelector("#statusTitle");
const potValue = document.querySelector("#potValue");
const stakeValue = document.querySelector("#stakeValue");
const turnValue = document.querySelector("#turnValue");
const playersEl = document.querySelector("#players");
const myCards = document.querySelector("#myCards");
const myRank = document.querySelector("#myRank");
const controls = document.querySelector("#controls");
const logList = document.querySelector("#logList");
const playerTemplate = document.querySelector("#playerTemplate");

let state = null;
const inviteRoom = new URL(location.href).searchParams.get("room");
let session = loadSession();
let events = null;

nameInput.value = localStorage.getItem("zjh.name") || "";
roomInput.value = inviteRoom || localStorage.getItem("zjh.room") || "";

if (session.roomId && session.playerId && session.name) {
  roomInput.value = inviteRoom || session.roomId;
  nameInput.value = session.name;
}

joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await joinRoom();
});

copyRoomBtn.addEventListener("click", async () => {
  if (!state) return;
  const url = `${location.origin}?room=${state.id}`;
  try {
    await navigator.clipboard.writeText(url);
    toast("已复制邀请链接");
  } catch {
    toast(`房间号：${state.id}`);
  }
});

if (inviteRoom && inviteRoom !== session.roomId) {
  session = { name: session.name || localStorage.getItem("zjh.name") || "", roomId: inviteRoom };
}

if (session.roomId && session.playerId) {
  reconnect();
}

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem("zjh.session") || "{}");
  } catch {
    return {};
  }
}

function saveSession(next) {
  session = next;
  localStorage.setItem("zjh.session", JSON.stringify(session));
  localStorage.setItem("zjh.name", session.name || "");
  localStorage.setItem("zjh.room", session.roomId || "");
}

async function api(path, data) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.error) throw new Error(result.error || "请求失败");
  return result;
}

async function joinRoom() {
  const name = nameInput.value.trim();
  if (!name) {
    toast("先填一个昵称");
    return;
  }
  try {
    const result = await api("/api/join", {
      name,
      room: roomInput.value.trim(),
      playerId: session.playerId
    });
    saveSession({ name, roomId: result.roomId, playerId: result.playerId });
    setState(result.state);
    openEvents();
  } catch (error) {
    toast(error.message);
  }
}

async function reconnect() {
  try {
    const result = await api("/api/join", {
      name: session.name,
      room: session.roomId,
      playerId: session.playerId
    });
    saveSession({ ...session, roomId: result.roomId, playerId: result.playerId });
    setState(result.state);
    openEvents();
  } catch {
    localStorage.removeItem("zjh.session");
  }
}

function openEvents() {
  if (events) events.close();
  events = new EventSource(`/events?room=${encodeURIComponent(session.roomId)}&player=${encodeURIComponent(session.playerId)}`);
  events.addEventListener("state", (event) => setState(JSON.parse(event.data)));
  events.onerror = () => {
    turnValue.textContent = "重连中";
  };
}

function setState(next) {
  state = next;
  joinView.classList.add("hidden");
  gameView.classList.remove("hidden");
  render();
}

async function act(action, extra = {}) {
  if (!state || !session.playerId) return;
  try {
    const result = await api("/api/action", {
      room: state.id,
      playerId: session.playerId,
      action,
      ...extra
    });
    setState(result.state);
  } catch (error) {
    toast(error.message);
  }
}

function render() {
  copyRoomBtn.textContent = state.id;
  potValue.textContent = state.pot;
  stakeValue.textContent = `当前注 ${state.currentStake}`;

  const turnPlayer = state.players.find((p) => p.id === state.turnPlayerId);
  turnValue.textContent = turnPlayer ? turnPlayer.name : "等待";

  if (state.phase === "lobby") {
    statusTitle.textContent = `${state.players.length}/${state.maxPlayers} 人，等待开局`;
  } else if (state.phase === "playing") {
    statusTitle.textContent = `第 ${state.roundNo} 局进行中`;
  } else {
    statusTitle.textContent = state.lastResult ? `${state.lastResult.winnerName} 赢了` : "本局结束";
  }

  renderPlayers();
  renderHand();
  renderControls();
  renderLog();
}

function renderPlayers() {
  playersEl.innerHTML = "";
  const positions = getPositions(state.players.length);
  state.players.forEach((player, index) => {
    const node = playerTemplate.content.firstElementChild.cloneNode(true);
    const position = positions[index];
    node.style.left = position.left;
    node.style.top = position.top;
    node.style.transform = position.transform || "";
    node.classList.toggle("is-turn", player.id === state.turnPlayerId);
    node.classList.toggle("is-folded", player.folded && state.phase === "playing");

    node.querySelector(".player-name").textContent = `${player.name}${player.isHost ? " · 房主" : ""}`;
    node.querySelector(".player-state").textContent = playerState(player);
    node.querySelector(".chips").textContent = `筹码 ${player.chips}`;
    node.querySelector(".bet").textContent = player.betThisHand ? `已下 ${player.betThisHand}` : "";

    const cards = node.querySelector(".mini-cards");
    cards.replaceChildren(...player.hand.map(cardEl));
    playersEl.appendChild(node);
  });
}

function getPositions(count) {
  const map = {
    1: [{ left: "50%", top: "72%", transform: "translate(-50%, -50%)" }],
    2: [
      { left: "50%", top: "76%", transform: "translate(-50%, -50%)" },
      { left: "50%", top: "7%", transform: "translate(-50%, 0)" }
    ],
    3: [
      { left: "50%", top: "76%", transform: "translate(-50%, -50%)" },
      { left: "4%", top: "18%" },
      { left: "calc(96% - min(175px, 42vw))", top: "18%" }
    ],
    4: [
      { left: "50%", top: "76%", transform: "translate(-50%, -50%)" },
      { left: "4%", top: "36%" },
      { left: "50%", top: "7%", transform: "translate(-50%, 0)" },
      { left: "calc(96% - min(175px, 42vw))", top: "36%" }
    ],
    5: [
      { left: "50%", top: "78%", transform: "translate(-50%, -50%)" },
      { left: "3%", top: "44%" },
      { left: "8%", top: "10%" },
      { left: "calc(92% - min(175px, 42vw))", top: "10%" },
      { left: "calc(97% - min(175px, 42vw))", top: "44%" }
    ],
    6: [
      { left: "50%", top: "78%", transform: "translate(-50%, -50%)" },
      { left: "3%", top: "48%" },
      { left: "7%", top: "12%" },
      { left: "50%", top: "6%", transform: "translate(-50%, 0)" },
      { left: "calc(93% - min(175px, 42vw))", top: "12%" },
      { left: "calc(97% - min(175px, 42vw))", top: "48%" }
    ]
  };
  return map[count] || map[6];
}

function playerState(player) {
  if (state.phase === "lobby") return player.ready ? "已准备" : "未准备";
  if (!player.inHand) return "旁观";
  if (player.folded) return "弃牌";
  if (player.seen) return "已看";
  return "闷牌";
}

function renderHand() {
  const me = state.players.find((p) => p.id === state.viewerId);
  myCards.innerHTML = "";
  if (!me || !me.hand.length) {
    myCards.append(cardEl("背面"), cardEl("背面"), cardEl("背面"));
    myRank.textContent = state.phase === "lobby" ? "未开局" : "旁观";
    return;
  }
  myCards.replaceChildren(...me.hand.map(cardEl));
  myRank.textContent = me.rank ? me.rank.label : me.seen ? "已看牌" : "未看牌";
}

function renderControls() {
  controls.innerHTML = "";
  const me = state.players.find((p) => p.id === state.viewerId);
  if (!me) return;

  if (state.phase !== "playing") {
    addButton(me.ready ? "取消准备" : "准备", "secondary", () => act("ready"));
    const start = addButton(state.phase === "roundEnd" ? "下一局" : "开局", "primary", () => act(state.phase === "roundEnd" ? "next" : "start"));
    start.disabled = !me.isHost || !state.canStart;
    addButton("换房间", "secondary", leaveRoom);
    return;
  }

  const myTurn = state.turnPlayerId === me.id;
  const callCost = state.currentStake * (me.seen ? 2 : 1);
  const compareTargets = state.players.filter((p) => p.id !== me.id && p.inHand && !p.folded);

  const see = addButton(me.seen ? "已看牌" : "看牌", "secondary", () => act("see"));
  see.disabled = me.seen || !me.inHand || me.folded;

  const call = addButton(`${me.seen ? "明跟" : "闷跟"} ${callCost}`, "primary", () => act("call"));
  call.disabled = !myTurn;

  const raise = addButton(`加到 ${state.currentStake + state.ante}`, "secondary", () => act("raise", { stake: state.currentStake + state.ante }));
  raise.disabled = !myTurn;

  const doubleRaise = addButton(`加到 ${state.currentStake + state.ante * 3}`, "secondary", () => act("raise", { stake: state.currentStake + state.ante * 3 }));
  doubleRaise.disabled = !myTurn;

  const fold = addButton("弃牌", "danger", () => act("fold"));
  fold.disabled = !myTurn;

  const compareWrap = document.createElement("div");
  compareWrap.className = "compare-select";
  const select = document.createElement("select");
  select.innerHTML = compareTargets.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
  const compare = document.createElement("button");
  compare.className = "secondary";
  compare.textContent = "比牌";
  compare.disabled = !myTurn || !me.seen || compareTargets.length === 0;
  compare.addEventListener("click", () => act("compare", { targetId: select.value }));
  compareWrap.append(select, compare);
  controls.append(compareWrap);
}

function addButton(text, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  button.addEventListener("click", handler);
  controls.append(button);
  return button;
}

function renderLog() {
  logList.innerHTML = "";
  for (const item of state.log.slice(0, 12)) {
    const li = document.createElement("li");
    li.textContent = item.text;
    logList.appendChild(li);
  }
}

function cardEl(card) {
  const el = document.createElement("span");
  el.className = "card";
  if (card === "背面") {
    el.classList.add("back");
    el.textContent = "牌";
    return el;
  }
  el.textContent = card;
  if (card.includes("♥") || card.includes("♦")) el.classList.add("red");
  return el;
}

function leaveRoom() {
  if (events) events.close();
  localStorage.removeItem("zjh.session");
  session = {};
  state = null;
  gameView.classList.add("hidden");
  joinView.classList.remove("hidden");
}

function toast(message) {
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  Object.assign(node.style, {
    position: "fixed",
    left: "50%",
    bottom: "22px",
    transform: "translateX(-50%)",
    padding: "10px 14px",
    borderRadius: "8px",
    background: "rgba(0,0,0,.82)",
    color: "white",
    zIndex: 20,
    maxWidth: "min(360px, calc(100vw - 30px))"
  });
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2200);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
