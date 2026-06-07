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
const lobbyMenu = document.querySelector("#lobbyMenu");
const lobbyPanels = [...document.querySelectorAll(".lobby-panel")];
const lobbyOpenButtons = [...document.querySelectorAll("[data-lobby-target]")];
const lobbyBackButtons = [...document.querySelectorAll("[data-lobby-back]")];
const profileForm = document.querySelector("#profileForm");
const profileDisplayNameInput = document.querySelector("#profileDisplayNameInput");
const profileCurrentPasswordInput = document.querySelector("#profileCurrentPasswordInput");
const profileNewPasswordInput = document.querySelector("#profileNewPasswordInput");
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
const voiceBtn = document.querySelector("#voiceBtn");
const qrBtn = document.querySelector("#qrBtn");
const qrPanel = document.querySelector("#qrPanel");
const qrImage = document.querySelector("#qrImage");
const closeQrBtn = document.querySelector("#closeQrBtn");
const voicePanel = document.querySelector("#voicePanel");
const remoteAudioRoot = document.querySelector("#remoteAudioRoot");
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
const adminLogs = document.querySelector("#adminLogs");

const inviteRoom = new URL(location.href).searchParams.get("room") || "";
let authMode = "login";
let token = localStorage.getItem("zjh.token") || "";
let currentUser = null;
let state = null;
let events = null;
let voiceEnabled = false;
let localStream = null;
const voicePeers = new Map();
const remoteAudios = new Map();
const voiceMuted = new Set();
const voiceVolumes = new Map();
const rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
let timerInterval = null;

joinRoomInput.value = inviteRoom;

loginTab.addEventListener("click", () => setAuthMode("login"));
registerTab.addEventListener("click", () => setAuthMode("register"));
authForm.addEventListener("submit", submitAuth);
lobbyOpenButtons.forEach((button) => button.addEventListener("click", () => showLobbyPanel(button.dataset.lobbyTarget)));
lobbyBackButtons.forEach((button) => button.addEventListener("click", showLobbyMenu));
profileForm.addEventListener("submit", saveProfile);
createRoomForm.addEventListener("submit", createRoom);
joinRoomForm.addEventListener("submit", joinRoom);
logoutBtn.addEventListener("click", logout);
adminBtn.addEventListener("click", showAdmin);
backLobbyBtn.addEventListener("click", showLobby);
copyRoomBtn.addEventListener("click", copyInvite);
voiceBtn.addEventListener("click", toggleVoice);
qrBtn.addEventListener("click", showQr);
closeQrBtn.addEventListener("click", () => qrPanel.classList.add("hidden"));

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

async function saveProfile(event) {
  event.preventDefault();
  try {
    const result = await api("/api/profile", {
      displayName: profileDisplayNameInput.value,
      currentPassword: profileCurrentPasswordInput.value,
      newPassword: profileNewPasswordInput.value
    });
    currentUser = result.user;
    profileCurrentPasswordInput.value = "";
    profileNewPasswordInput.value = "";
    renderAccount();
    toast("资料已保存");
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
  events.addEventListener("kicked", (event) => {
    const data = JSON.parse(event.data || "{}");
    toast(data.reason || "你已被移出房间");
    leaveRoom();
  });
  events.addEventListener("session-replaced", (event) => {
    const data = JSON.parse(event.data || "{}");
    toast(data.reason || "账号已在其他设备登录");
    logout();
  });
  events.onerror = () => {
    turnValue.textContent = "重连中";
  };
  events.addEventListener("voice", (event) => {
    handleVoiceSignal(JSON.parse(event.data)).catch((error) => toast(error.message));
  });
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
  renderResult();
  renderVoicePanel();
  updateVoiceButton();
  updateTimerText();
  syncVoicePeers().catch(() => {});
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
    const talking = voiceEnabled && (player.id === currentUser.id || voicePeers.has(player.id)) ? " · 麦" : "";
    node.querySelector(".player-name").textContent = `${player.name}${player.isHost ? " · 房主" : ""}${talking}`;
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
  const online = player.online ? "" : " · 离线";
  if (state.phase === "lobby") return `${player.ready ? "已准备" : "未准备"}${online}`;
  if (!player.inHand) return "旁观";
  if (player.folded) return `弃牌${online}`;
  if (player.seen) return `已看${online}`;
  return `闷牌${online}`;
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
    if (me.isHost && state.phase === "lobby") renderHostControls(me);
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
  const extend = addButton(`延时 ${state.turnExtensionSeconds || 30}s`, "secondary", () => act("extend"));
  extend.disabled = !myTurn || !state.canExtendTurn;

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

function renderHostControls(me) {
  const others = state.players.filter((player) => player.id !== me.id);
  if (!others.length) return;
  const wrap = document.createElement("div");
  wrap.className = "host-controls";
  const select = document.createElement("select");
  select.innerHTML = others.map((player) => `<option value="${player.id}">${escapeHtml(player.name)}</option>`).join("");
  const kick = document.createElement("button");
  kick.type = "button";
  kick.className = "danger";
  kick.textContent = "踢人";
  kick.addEventListener("click", () => act("kick", { targetId: select.value }));
  const transfer = document.createElement("button");
  transfer.type = "button";
  transfer.className = "secondary";
  transfer.textContent = "转让房主";
  transfer.addEventListener("click", () => act("transferHost", { targetId: select.value }));
  wrap.append(select, kick, transfer);
  controls.append(wrap);
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

function renderResult() {
  let result = document.querySelector("#resultPanel");
  if (!result) {
    result = document.createElement("section");
    result.id = "resultPanel";
    result.className = "result-panel hidden";
    document.querySelector(".mobile-details").before(result);
  }
  if (!state.lastResult) {
    result.classList.add("hidden");
    result.innerHTML = "";
    return;
  }
  const chips = state.lastResult.chipSummary || [];
  const bonuses = state.lastResult.happyBonuses || [];
  result.classList.remove("hidden");
  result.innerHTML = `
    <h3>本局结算</h3>
    <p>${escapeHtml(state.lastResult.winnerName)} 赢得奖池 ${state.lastResult.pot}</p>
    <div class="settle-list">
      ${chips.map((item) => `<span>${escapeHtml(item.name)}：${item.chips} 筹码${item.folded ? " · 弃牌" : ""}</span>`).join("")}
      ${bonuses.map((item) => `<span>${escapeHtml(item.name)} ${item.label}有喜：每人 ${item.bonus}，共得 ${item.total}</span>`).join("")}
    </div>
  `;
}

function updateTimerText() {
  if (timerInterval) clearInterval(timerInterval);
  const tick = () => {
    if (!state || state.phase !== "playing" || !state.turnDeadlineAt) return;
    const left = Math.max(0, Math.ceil((state.turnDeadlineAt - Date.now()) / 1000));
    const turnPlayer = state.players.find((p) => p.id === state.turnPlayerId);
    turnValue.textContent = `${turnPlayer ? turnPlayer.name : "等待"} · ${left}s`;
  };
  tick();
  timerInterval = setInterval(tick, 1000);
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
  renderAccount();
  switchView(lobbyView);
  if (inviteRoom) {
    joinRoomInput.value = inviteRoom;
    showLobbyPanel("joinPanel");
  } else {
    showLobbyMenu();
  }
}

function showLobbyMenu() {
  lobbyMenu.classList.remove("hidden");
  for (const panel of lobbyPanels) panel.classList.add("hidden");
}

function showLobbyPanel(id) {
  lobbyMenu.classList.add("hidden");
  for (const panel of lobbyPanels) panel.classList.toggle("hidden", panel.id !== id);
}

function renderAccount() {
  accountTitle.textContent = `${currentUser.displayName} (${currentUser.username})`;
  profileDisplayNameInput.value = currentUser.displayName;
  adminBtn.classList.toggle("hidden", currentUser.role !== "admin");
}

function showGame() {
  switchView(gameView);
  updateVoiceButton();
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
  stopVoice();
  qrPanel.classList.add("hidden");
  state = null;
  showLobby();
}

function logout() {
  if (events) events.close();
  stopVoice();
  localStorage.removeItem("zjh.token");
  token = "";
  currentUser = null;
  state = null;
  showAuth();
}

async function copyInvite() {
  if (!state) return;
  const url = inviteUrl();
  try {
    await navigator.clipboard.writeText(url);
    toast("已复制邀请链接");
  } catch {
    toast(`房间号：${state.id}`);
  }
}

function inviteUrl() {
  return `${location.origin}?room=${state.id}`;
}

function showQr() {
  if (!state) return;
  qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(inviteUrl())}`;
  qrPanel.classList.remove("hidden");
}

async function toggleVoice() {
  if (voiceEnabled) {
    stopVoice();
    toast("已关闭麦克风");
    return;
  }
  await startVoice();
}

async function startVoice() {
  if (!state) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    if (!window.isSecureContext) {
      toast("开麦需要 HTTPS，localhost 调试除外");
    } else {
      toast("当前浏览器不支持麦克风");
    }
    return;
  }
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false
    });
    voiceEnabled = true;
    updateVoiceButton();
    await syncVoicePeers(true);
    toast("已开麦");
  } catch (error) {
    voiceEnabled = false;
    localStream = null;
    updateVoiceButton();
    toast(error.name === "NotAllowedError" ? "麦克风权限被拒绝" : "无法开启麦克风");
  }
}

function stopVoice() {
  voiceEnabled = false;
  if (localStream) {
    for (const track of localStream.getTracks()) track.stop();
  }
  localStream = null;
  for (const peer of voicePeers.values()) peer.close();
  voicePeers.clear();
  for (const audio of remoteAudios.values()) audio.remove();
  remoteAudios.clear();
  voiceMuted.clear();
  updateVoiceButton();
  renderVoicePanel();
}

function updateVoiceButton() {
  if (!voiceBtn) return;
  voiceBtn.textContent = voiceEnabled ? "关麦" : "开麦";
  voiceBtn.classList.toggle("voice-on", voiceEnabled);
}

async function syncVoicePeers(forceOffer = false) {
  if (!voiceEnabled || !state || !currentUser) return;
  const activeIds = new Set(state.players.map((player) => player.id).filter((id) => id !== currentUser.id));
  for (const peerId of [...voicePeers.keys()]) {
    if (!activeIds.has(peerId)) closePeer(peerId);
  }
  for (const peerId of activeIds) {
    const peer = getOrCreatePeer(peerId);
    if ((forceOffer || currentUser.id < peerId) && peer.signalingState === "stable" && !peer.__offered) {
      peer.__offered = true;
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await sendVoiceSignal(peerId, { type: "offer", description: peer.localDescription });
    }
  }
}

function getOrCreatePeer(peerId) {
  const existing = voicePeers.get(peerId);
  if (existing) return existing;

  const peer = new RTCPeerConnection(rtcConfig);
  peer.__offered = false;
  if (localStream) {
    for (const track of localStream.getTracks()) peer.addTrack(track, localStream);
  }
  peer.onicecandidate = (event) => {
    if (event.candidate) sendVoiceSignal(peerId, { type: "candidate", candidate: event.candidate }).catch(() => {});
  };
  peer.ontrack = (event) => {
    let audio = remoteAudios.get(peerId);
    if (!audio) {
      audio = document.createElement("audio");
      audio.autoplay = true;
      audio.playsInline = true;
      audio.volume = voiceVolumes.get(peerId) ?? 1;
      audio.muted = voiceMuted.has(peerId);
      remoteAudioRoot.append(audio);
      remoteAudios.set(peerId, audio);
    }
    audio.srcObject = event.streams[0];
  };
  peer.onconnectionstatechange = () => {
    if (["closed", "failed", "disconnected"].includes(peer.connectionState)) closePeer(peerId);
  };
  voicePeers.set(peerId, peer);
  renderVoicePanel();
  return peer;
}

function closePeer(peerId) {
  const peer = voicePeers.get(peerId);
  if (peer) peer.close();
  voicePeers.delete(peerId);
  const audio = remoteAudios.get(peerId);
  if (audio) audio.remove();
  remoteAudios.delete(peerId);
  renderVoicePanel();
}

function renderVoicePanel() {
  if (!voiceEnabled || !state) {
    voicePanel.classList.add("hidden");
    voicePanel.innerHTML = "";
    return;
  }
  const peers = state.players.filter((player) => player.id !== currentUser.id);
  voicePanel.classList.toggle("hidden", peers.length === 0);
  voicePanel.innerHTML = peers.map((player) => {
    const muted = voiceMuted.has(player.id);
    const volume = Math.round((voiceVolumes.get(player.id) ?? 1) * 100);
    return `
      <div class="voice-row">
        <span>${escapeHtml(player.name)}${voicePeers.has(player.id) ? " · 已连接" : " · 连接中"}</span>
        <button type="button" class="secondary" data-voice-mute="${player.id}">${muted ? "取消静音" : "静音"}</button>
        <input type="range" min="0" max="100" value="${volume}" data-voice-volume="${player.id}">
      </div>
    `;
  }).join("");
  voicePanel.querySelectorAll("[data-voice-mute]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.voiceMute;
      if (voiceMuted.has(id)) voiceMuted.delete(id);
      else voiceMuted.add(id);
      const audio = remoteAudios.get(id);
      if (audio) audio.muted = voiceMuted.has(id);
      renderVoicePanel();
    });
  });
  voicePanel.querySelectorAll("[data-voice-volume]").forEach((input) => {
    input.addEventListener("input", () => {
      const id = input.dataset.voiceVolume;
      const volume = Number(input.value) / 100;
      voiceVolumes.set(id, volume);
      const audio = remoteAudios.get(id);
      if (audio) audio.volume = volume;
    });
  });
}

async function handleVoiceSignal(message) {
  if (!voiceEnabled || !state || !currentUser || message.to !== currentUser.id) return;
  const peer = getOrCreatePeer(message.from);
  const signal = message.signal || {};
  if (signal.type === "offer") {
    await peer.setRemoteDescription(signal.description);
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    await sendVoiceSignal(message.from, { type: "answer", description: peer.localDescription });
  } else if (signal.type === "answer") {
    if (peer.signalingState !== "stable") await peer.setRemoteDescription(signal.description);
  } else if (signal.type === "candidate" && signal.candidate) {
    await peer.addIceCandidate(signal.candidate);
  }
}

async function sendVoiceSignal(to, signal) {
  if (!state) return;
  await api("/api/voice/signal", { room: state.id, to, signal });
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
    adminLogs.innerHTML = "";
    for (const item of (data.logs || []).slice(0, 30)) {
      const row = document.createElement("div");
      row.className = "admin-item";
      const at = new Date(item.at).toLocaleString();
      row.innerHTML = `<span>${escapeHtml(at)} · ${escapeHtml(item.actorName)} · ${escapeHtml(item.action)} · ${escapeHtml(item.detail || "")}</span>`;
      adminLogs.append(row);
    }
    if (!adminLogs.children.length) adminLogs.textContent = "暂无日志";
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
