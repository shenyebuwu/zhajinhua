"use strict";

const authView = document.querySelector("#authView");
const lobbyView = document.querySelector("#lobbyView");
const gameView = document.querySelector("#gameView");
const adminView = document.querySelector("#adminView");
const authForm = document.querySelector("#authForm");
const loginTab = document.querySelector("#loginTab");
const registerTab = document.querySelector("#registerTab");
const usernameInput = document.querySelector("#usernameInput");
const displayNameLabel = document.querySelector("#displayNameLabel");
const displayNameInput = document.querySelector("#displayNameInput");
const authPasswordInput = document.querySelector("#authPasswordInput");
const authSubmit = document.querySelector("#authSubmit");
const accountTitle = document.querySelector("#accountTitle");
const adminBtn = document.querySelector("#adminBtn");
const logoutBtn = document.querySelector("#logoutBtn");
const createRoomForm = document.querySelector("#createRoomForm");
const joinRoomForm = document.querySelector("#joinRoomForm");
const createRoomInput = document.querySelector("#createRoomInput");
const createPasswordInput = document.querySelector("#createPasswordInput");
const createPlayerLimitInput = document.querySelector("#createPlayerLimitInput");
const createAnteInput = document.querySelector("#createAnteInput");
const createChipsInput = document.querySelector("#createChipsInput");
const createRaiseInput = document.querySelector("#createRaiseInput");
const joinRoomInput = document.querySelector("#joinRoomInput");
const joinPasswordInput = document.querySelector("#joinPasswordInput");
const copyRoomBtn = document.querySelector("#copyRoomBtn");
const statusTitle = document.querySelector("#statusTitle");
const potValue = document.querySelector("#potValue");
const stakeValue = document.querySelector("#stakeValue");
const turnValue = document.querySelector("#turnValue");
const tableEl = document.querySelector("#table");
const playersEl = document.querySelector("#players");
const myCards = document.querySelector("#myCards");
const myRank = document.querySelector("#myRank");
const controls = document.querySelector("#controls");
const logList = document.querySelector("#logList");
const playerTemplate = document.querySelector("#playerTemplate");
const backLobbyBtn = document.querySelector("#backLobbyBtn");
const adminRooms = document.querySelector("#adminRooms");
const adminUsers = document.querySelector("#adminUsers");

const inviteRoom = new URL(location.href).searchParams.get("room") || "";
let authMode = "login";
let token = localStorage.getItem("zjh.token") || "";
let currentUser = null;
let state = null;
let events = null;

joinRoomInput.value = inviteRoom;

loginTab.addEventListener("click", () => setAuthMode("login"));
registerTab.addEventListener("click", () => setAuthMode("register"));
authForm.addEventListener("submit", submitAuth);
createRoomForm.addEventListener("submit", createRoom);
joinRoomForm.addEventListener("submit", joinRoom);
logoutBtn.addEventListener("click", logout);
adminBtn.addEventListener("click", showAdmin);
backLobbyBtn.addEventListener("click", showLobby);
copyRoomBtn.addEventListener("click", copyInvite);

boot();

async function boot() {
  if (!token) {
    showAuth();
    return;
  }
  try {
    const result = await apiGet("/api/me");
    currentUser = result.user;
    showLobby();
  } catch {
    token = "";
    localStorage.removeItem("zjh.token");
    showAuth();
  }
}

function setAuthMode(mode) {
  authMode = mode;
  loginTab.classList.toggle("active", mode === "login");
  registerTab.classList.toggle("active", mode === "register");
  displayNameLabel.classList.toggle("hidden", mode !== "register");
  authSubmit.textContent = mode === "login" ? "登录" : "注册";
  authPasswordInput.autocomplete = mode === "login" ? "current-password" : "new-password";
}

async function submitAuth(event) {
  event.preventDefault();
  try {
    const result = await api(`/api/auth/${authMode}`, {
      username: usernameInput.value,
      password: authPasswordInput.value,
      displayName: displayNameInput.value
    }, false);
    token = result.token;
    currentUser = result.user;
    localStorage.setItem("zjh.token", token);
    showLobby();
  } catch (error) {
    toast(error.message);
  }
}

async function createRoom(event) {
  event.preventDefault();
  try {
    const result = await api("/api/room/create", {
      room: createRoomInput.value,
      password: createPasswordInput.value,
      playerLimit: createPlayerLimitInput.value,
      ante: createAnteInput.value,
      startingChips: createChipsInput.value,
      maxRaiseMultiplier: createRaiseInput.value
    });
    enterRoom(result.state);
  } catch (error) {
    toast(error.message);
  }
}

async function joinRoom(event) {
  event.preventDefault();
  try {
    const result = await api("/api/room/join", {
      room: joinRoomInput.value,
      password: joinPasswordInput.value
    });
    enterRoom(result.state);
  } catch (error) {
    toast(error.message);
  }
}

function enterRoom(nextState) {
  state = nextState;
  showGame();
  openEvents();
  render();
}

function openEvents() {
  if (events) events.close();
  events = new EventSource(`/events?room=${encodeURIComponent(state.id)}&token=${encodeURIComponent(token)}`);
  events.addEventListener("state", (event) => {
    state = JSON.parse(event.data);
    render();
  });
  events.addEventListener("expired", (event) => {
    const data = JSON.parse(event.data || "{}");
    toast(data.reason || "房间已关闭");
    leaveRoom();
  });
  events.onerror = () => {
    turnValue.textContent = "重连中";
  };
}

async function act(action, extra = {}) {
  if (!state) return;
  try {
    const result = await api("/api/action", { room: state.id, action, ...extra });
    state = result.state;
    render();
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
  tableEl.classList.toggle("many-players", state.players.length > 8);
  tableEl.classList.toggle("full-table", state.players.length > 12);
  tableEl.classList.toggle("crowded-table", state.players.length > 14);
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
    node.querySelector(".mini-cards").replaceChildren(...player.hand.map(cardEl));
    playersEl.appendChild(node);
  });
}

function getPositions(count) {
  if (count <= 1) return [{ left: "50%", top: "72%", transform: "translate(-50%, -50%)" }];
  const positions = [];
  for (let index = 0; index < count; index += 1) {
    const angle = Math.PI / 2 + (index / count) * Math.PI * 2;
    positions.push({
      left: `${50 + Math.cos(angle) * 43}%`,
      top: `${50 + Math.sin(angle) * 40}%`,
      transform: "translate(-50%, -50%)"
    });
  }
  return positions;
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
    addButton("离开", "secondary", leaveRoom);
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
  for (const item of state.log.slice(0, 8)) {
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

function showAuth() {
  switchView(authView);
}

function showLobby() {
  accountTitle.textContent = `${currentUser.displayName} (${currentUser.username})`;
  adminBtn.classList.toggle("hidden", currentUser.role !== "admin");
  switchView(lobbyView);
  if (inviteRoom) joinRoomInput.value = inviteRoom;
}

function showGame() {
  switchView(gameView);
}

async function showAdmin() {
  switchView(adminView);
  await loadAdmin();
}

function switchView(view) {
  for (const node of [authView, lobbyView, gameView, adminView]) node.classList.add("hidden");
  view.classList.remove("hidden");
}

function leaveRoom() {
  if (events) events.close();
  events = null;
  state = null;
  showLobby();
}

function logout() {
  if (events) events.close();
  localStorage.removeItem("zjh.token");
  token = "";
  currentUser = null;
  state = null;
  showAuth();
}

async function copyInvite() {
  if (!state) return;
  const url = `${location.origin}?room=${state.id}`;
  try {
    await navigator.clipboard.writeText(url);
    toast("已复制邀请链接");
  } catch {
    toast(`房间号：${state.id}`);
  }
}

async function loadAdmin() {
  try {
    const data = await apiGet("/api/admin/summary");
    adminRooms.innerHTML = "";
    for (const room of data.rooms) {
      adminRooms.append(adminItem(`${room.id} · ${room.phase} · ${room.players}/${room.maxPlayers}`, "删除", () => adminDeleteRoom(room.id)));
    }
    if (!data.rooms.length) adminRooms.textContent = "暂无房间";
    adminUsers.innerHTML = "";
    for (const user of data.users) {
      const label = `${user.displayName} · ${user.username} · ${user.role}${user.disabled ? " · 已禁用" : ""}`;
      adminUsers.append(adminItem(label, user.disabled ? "启用" : "禁用", () => adminToggleUser(user.id)));
    }
  } catch (error) {
    toast(error.message);
  }
}

function adminItem(label, action, handler) {
  const item = document.createElement("div");
  item.className = "admin-item";
  const span = document.createElement("span");
  span.textContent = label;
  const button = document.createElement("button");
  button.className = "secondary";
  button.type = "button";
  button.textContent = action;
  button.addEventListener("click", handler);
  item.append(span, button);
  return item;
}

async function adminDeleteRoom(room) {
  await api("/api/admin/room/delete", { room });
  await loadAdmin();
}

async function adminToggleUser(userId) {
  await api("/api/admin/user/toggle", { userId });
  await loadAdmin();
}

async function apiGet(path) {
  const response = await fetch(path, { headers: authHeaders() });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.error) throw new Error(result.error || "请求失败");
  return result;
}

async function api(path, data, withAuth = true) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(withAuth ? authHeaders() : {}) },
    body: JSON.stringify(data)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.error) throw new Error(result.error || "请求失败");
  return result;
}

function authHeaders() {
  return token ? { authorization: `Bearer ${token}` } : {};
}

function toast(message) {
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2400);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
