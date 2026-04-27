/**
 * NİŞANCI - Oyun İstemcisi (game.js)
 */

// ─── Sabitler ───────────────────────────────────────────────
const PLAYER_RADIUS = 16;
const BULLET_RADIUS = 5;
const PLAYER_SPEED  = 200;
const CAMERA_LERP   = 0.12;
const MAP_W = 1200, MAP_H = 800;

// ─── Durum ──────────────────────────────────────────────────
let ws, myId, myTeam;
let players = {}, bullets = [], walls = [];
let keys = {};
let mouseX = 0, mouseY = 0;
let camX = 0, camY = 0;
let alive = true;
let kills = 0, deaths = 0;
let lastShot = 0;
const SHOOT_COOLDOWN = 200;
let scoreT = 0, scoreCT = 0;
let scoreboardOpen = false;
let respawnCountdown = 3;
let respawnInterval = null;
let selectedTeam = null;
let availableMaps = [];
let currentMapName = '';
let voteTimerInterval = null;
let tsTimerInterval   = null;
let zones = [];
let WIN_KILLS = 25;
let chatOpen = false;
let isAdmin = false;

// ─── Canvas ─────────────────────────────────────────────────
const canvas = document.getElementById('game-canvas');
const ctx    = canvas.getContext('2d');

function resizeCanvas() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ─── Parçacık animasyonu (giriş ekranı) ─────────────────────
function spawnParticles() {
  const container = document.getElementById('particles');
  if (!container) return;
  for (let i = 0; i < 60; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.left     = Math.random() * 100 + '%';
    p.style.animationDuration  = (6 + Math.random() * 10) + 's';
    p.style.animationDelay     = (Math.random() * 10) + 's';
    p.style.opacity  = Math.random() * 0.6 + 0.2;
    container.appendChild(p);
  }
}
spawnParticles();

// ─── Ses Efektleri (Web Audio API) ──────────────────────────
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playShootSound() {
  const osc  = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(300, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(60, audioCtx.currentTime + 0.08);
  gain.gain.setValueAtTime(0.18, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
  osc.start(audioCtx.currentTime);
  osc.stop(audioCtx.currentTime + 0.1);
}

function playHitSound() {
  const osc  = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.type = 'square';
  osc.frequency.setValueAtTime(800, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(200, audioCtx.currentTime + 0.12);
  gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
  osc.start(audioCtx.currentTime);
  osc.stop(audioCtx.currentTime + 0.15);
}

function playDeathSound() {
  const osc  = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.type = 'sine';
  osc.frequency.setValueAtTime(220, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(55, audioCtx.currentTime + 0.5);
  gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
  osc.start(audioCtx.currentTime);
  osc.stop(audioCtx.currentTime + 0.5);
}

// ─── Giriş Ekranı ───────────────────────────────────────────
const loginScreen = document.getElementById('login-screen');
const gameScreen  = document.getElementById('game-screen');
const joinBtn     = document.getElementById('join-btn');
const playerNameInput = document.getElementById('player-name');

joinBtn.addEventListener('click', startGame);
playerNameInput.addEventListener('keydown', e => { if (e.key === 'Enter') startGame(); });

function startGame() {
  const name = playerNameInput.value.trim() || 'Oyuncu';
  audioCtx.resume();
  connectWebSocket(name);
}

function selectTeam(team) {
  selectedTeam = team;
  document.getElementById('btn-team-t').classList.toggle('selected', team === 'T');
  document.getElementById('btn-team-ct').classList.toggle('selected', team === 'CT');
}

let gameStarted = false;
function showGame() {
  loginScreen.style.display = 'none';
  gameScreen.style.display  = 'flex';
  gameScreen.style.opacity  = '1';
  gameScreen.classList.add('active');
  canvas.focus();
}

// ─── WebSocket Bağlantısı ────────────────────────────────────
function connectWebSocket(playerName) {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const host = window.location.host; // Hem site adını hem portu otomatik alır
  ws = new WebSocket(`${protocol}://${host}`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'join', name: playerName, team: selectedTeam }));
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleMessage(msg);
  };

  ws.onclose = () => {
    setStatus('Sunucu bağlantısı kesildi. Sayfa yenileniyor...');
    setTimeout(() => location.reload(), 2000);
  };

  ws.onerror = () => {
    setStatus('Sunucuya bağlanılamadı!');
  };
}

// ─── Chat Girişi ─────────────────────────────────────────────
const chatInputWrap = document.getElementById('chat-input-wrap');
const chatInput     = document.getElementById('chat-input');
const chatMessages  = document.getElementById('chat-messages');

function openChat() {
  if (chatOpen) return;
  chatOpen = true;
  chatInputWrap.classList.add('active');
  chatInput.focus();
}

function closeChat() {
  chatOpen = false;
  chatInputWrap.classList.remove('active');
  chatInput.value = '';
  canvas.focus();
}

function sendChatMessage() {
  const text = chatInput.value.trim();
  if (text) {
    ws.send(JSON.stringify({ type: 'chat', text }));
  }
  closeChat();
}

function addChatMessage(msg) {
  const div = document.createElement('div');
  div.className = 'chat-msg';
  if (msg.system) {
    div.classList.add('system');
    div.textContent = `[SİSTEM] ${msg.text}`;
  } else {
    div.classList.add(msg.team === 'T' ? 't' : 'ct');
    div.innerHTML = `<span class="name">${msg.name}:</span> ${msg.text}`;
  }
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  setTimeout(() => div.style.opacity = '0.7', 5000);
  if (chatMessages.children.length > 30) chatMessages.removeChild(chatMessages.firstChild);
}

// ─── Admin Panel (OP) ────────────────────────────────────────
const adminPanel = document.getElementById('admin-panel');
const adminPlayerList = document.getElementById('admin-player-list');
const adminMapSelect  = document.getElementById('admin-map-select');

function openAdminPanel() {
  isAdmin = true;
  adminPanel.classList.add('active');
  updateAdminPlayerList();
  
  // Harita listesini doldur
  adminMapSelect.innerHTML = availableMaps.map(m => `<option value="${m}">${m}</option>`).join('');
}

function closeAdminPanel() {
  adminPanel.classList.remove('active');
}

function updateAdminPlayerList() {
  if (!isAdmin) return;
  adminPlayerList.innerHTML = '';
  for (const id in players) {
    const p = players[id];
    const item = document.createElement('div');
    item.className = 'admin-player-item';
    item.innerHTML = `
      <div class="admin-player-info">
        <span class="pname">${p.name} ${id === myId ? '(Siz)' : ''}</span>
        <span class="pteam">${p.team}</span>
      </div>
      <div class="admin-btn-group">
        <button class="admin-btn team" onclick="adminAction('player_team', '${id}')">Takım</button>
        <button class="admin-btn change" onclick="adminRename('${id}')">Ad</button>
        <button class="admin-btn msg" onclick="adminFakeMsg('${id}')">Mesaj</button>
      </div>
    `;
    adminPlayerList.appendChild(item);
  }
}

function adminAction(action, targetId, extra = {}) {
  ws.send(JSON.stringify({ type: 'admin_action', action, targetId, ...extra }));
}

function adminChangeMap() {
  const map = adminMapSelect.value;
  adminAction('change_map', null, { map });
}

function adminSetKillLimit() {
  const limit = document.getElementById('admin-kill-limit').value;
  adminAction('set_kill_limit', null, { limit });
}

function adminRename(tid) {
  const name = prompt("Yeni isim:");
  if (name) adminAction('player_name', tid, { newName: name });
}

function adminFakeMsg(tid) {
  const text = prompt("Oyuncu adına yazılacak mesaj:");
  if (text) adminAction('player_msg', tid, { text });
}

window.closeAdminPanel = closeAdminPanel;
window.adminChangeMap = adminChangeMap;
window.adminSetKillLimit = adminSetKillLimit;
window.adminAction = adminAction;
window.adminRename = adminRename;
window.adminFakeMsg = adminFakeMsg;

function toggleControls() {
  const overlay = document.getElementById('controls-overlay');
  if (overlay) overlay.classList.toggle('hidden');
}

function updateWeaponHUD() {
  const me = players[myId];
  if (!me) return;

  const ammoEl    = document.getElementById('hud-ammo');
  const reserveEl = document.getElementById('hud-reserve');
  const iconEl    = document.getElementById('weapon-icon');
  const reloadEl  = document.getElementById('reload-text');
  const key1      = document.getElementById('key-1');
  const key2      = document.getElementById('key-2');

  ammoEl.textContent    = me.ammo;
  reserveEl.textContent = me.reserve;
  iconEl.textContent    = me.weapon === 'gun' ? '🔫' : '🔪';
  
  if (me.reloading) reloadEl.classList.remove('hidden');
  else reloadEl.classList.add('hidden');

  if (me.weapon === 'gun') {
    key1.classList.add('active');
    key2.classList.remove('active');
  } else {
    key1.classList.remove('active');
    key2.classList.add('active');
  }
}


function handleMessage(msg) {
  switch (msg.type) {
    case 'chat':
      addChatMessage(msg);
      break;

    case 'op_authorized':
      openAdminPanel();
      break;

    case 'kill_limit_update':
      WIN_KILLS = msg.limit;
      updateKillBars({ T: scoreT, CT: scoreCT });
      break;

    case 'welcome':
      myId   = msg.id;
      myTeam = msg.team;
      walls  = msg.walls;
      zones  = msg.zones  || [];
      players = msg.players;
      availableMaps   = msg.maps || [];
      currentMapName  = msg.mapName || '';
      showGame();
      updateHUD();
      updateKillBars(msg.gameKills || {T:0, CT:0});
      updateMapLabel();
      setStatus(`${myTeam === 'T' ? '🔴 Terörist' : '🔵 Karşı-Terörist'} takımına katıldın`);
      setTimeout(() => setStatus(''), 3000);
      break;

    case 'state':
      // Oyuncuları ve mermileri güncelle
      players = msg.players;
      bullets = msg.bullets || [];
      if (msg.gameKills) {
        scoreT = msg.gameKills.T;
        scoreCT = msg.gameKills.CT;
        updateKillBars(msg.gameKills);
      }
      updateScoreboard();
      updateAdminPlayerList();
      updateWeaponHUD();
      break;

    case 'player_joined':
      players[msg.id] = msg;
      addKillFeed(`${msg.name} oyuna katıldı`, '#f39c12');
      updatePlayerCount();
      break;

    case 'player_left':
      if (players[msg.id]) {
        addKillFeed(`${players[msg.id].name} ayrıldı`, '#6b7280');
        delete players[msg.id];
      }
      updatePlayerCount();
      break;

    case 'player_died':
      if (msg.id === myId) {
        alive = false;
        deaths++;
        playDeathSound();
        showRespawnScreen();
        updateHUD();
      }
      if (msg.gameKills) updateKillBars(msg.gameKills);
      addKillFeed(`💀 ${msg.killerName} → ${msg.victimName}`, '#e74c3c');
      break;

    case 'player_respawn':
      if (msg.id === myId) {
        alive = true;
        if (players[myId]) {
          players[myId].x = msg.x;
          players[myId].y = msg.y;
          players[myId].health = 100;
        }
        hideRespawnScreen();
        updateHUD();
      }
      break;

    case 'hit':
      if (players[myId]) players[myId].health = msg.health;
      playHitSound();
      showDamageFlash();
      updateHUD();
      break;

    case 'kill_feed':
      kills++;
      updateHUD();
      addKillFeed(`🏆 Sen öldürdün: ${msg.victim}`, '#2ecc71');
      break;

    case 'game_over':
      hideRespawnScreen();
      showVoteScreen(msg);
      break;

    case 'team_select_phase':
      hideVoteScreen();
      showTeamSelectScreen(msg);
      break;

    case 'new_round':
      walls  = msg.walls;
      zones  = msg.zones  || [];
      players = msg.players;
      currentMapName = msg.mapName || '';
      alive  = true;
      if (msg.players[myId]) myTeam = msg.players[myId].team;
      showGame();
      updateKillBars(msg.gameKills || {T:0,CT:0});
      updateMapLabel();
      hideVoteScreen();
      hideTeamSelectScreen();
      hideRespawnScreen();
      updateHUD();
      addKillFeed(`🗺️ Yeni tur: ${currentMapName}`, '#f39c12');
      break;

    case 'vote_update':
      updateVoteCounts(msg.votes, msg.total, msg.players);
      break;

    case 'maps_updated':
      availableMaps = msg.maps || [];
      break;
  }
}


function updateMapLabel() {
  const el = document.getElementById('map-name-label');
  if (el) el.textContent = currentMapName ? `🗺️ ${currentMapName}` : '';
}

// ─── Oylama Ekranı ───────────────────────────────────────────
function showVoteScreen(msg) {
  const overlay = document.getElementById('vote-overlay');
  overlay.classList.remove('hidden');

  // Kazanan banner
  const banner = document.getElementById('vote-winner-banner');
  const isT    = msg.winner === 'T';
  banner.textContent  = isT ? '🔴 TERÖRİSTLER KAZANDI!' : '🔵 KARŞI-TERÖRİSTLER KAZANDI!';
  banner.className    = 'winner-banner ' + (isT ? 't-win' : 'ct-win');

  // Harita butonları
  const list = document.getElementById('vote-map-list');
  list.innerHTML = '';
  const maps = msg.maps || availableMaps;
  maps.forEach(m => {
    const btn = document.createElement('button');
    btn.className = 'vote-map-btn';
    btn.id = 'vote-btn-' + m;
    btn.innerHTML = `🗺️ ${m}<span class="vote-count" id="vc-${m}">0 oy</span>`;
    btn.onclick = () => castVote(m);
    list.appendChild(btn);
  });

  // Geri sayım
  let remaining = msg.duration || 20;
  document.getElementById('vote-timer-text').textContent = remaining + ' saniye';
  document.getElementById('vote-timer-bar').style.width = '100%';
  clearInterval(voteTimerInterval);
  voteTimerInterval = setInterval(() => {
    remaining--;
    const el = document.getElementById('vote-timer-text');
    const bar = document.getElementById('vote-timer-bar');
    if (el)  el.textContent  = remaining + ' saniye';
    if (bar) bar.style.width = Math.max(0, (remaining / (msg.duration || 20)) * 100) + '%';
    if (remaining <= 0) clearInterval(voteTimerInterval);
  }, 1000);
}

function hideVoteScreen() {
  document.getElementById('vote-overlay').classList.add('hidden');
  clearInterval(voteTimerInterval);
}

function castVote(mapName) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'vote', map: mapName }));
  // Tüm butonların selected durumunu sıfırla
  document.querySelectorAll('.vote-map-btn').forEach(b => b.classList.remove('voted'));
  const btn = document.getElementById('vote-btn-' + mapName);
  if (btn) btn.classList.add('voted');
}

function updateVoteCounts(votes, total, playerCount) {
  for (const [m, count] of Object.entries(votes || {})) {
    const el = document.getElementById('vc-' + m);
    if (el) el.textContent = count + ' oy';
  }
  const statusEl = document.getElementById('vote-status');
  if (statusEl) statusEl.textContent = `${total || 0} / ${playerCount || 0} oyuncu oy kullandı`;
}

// ─── Kill Barlar ─────────────────────────────────────────────
function updateKillBars(gk) {
  const t  = gk.T  || 0;
  const ct = gk.CT || 0;
  scoreT = t; scoreCT = ct;
  document.getElementById('score-t').textContent  = t;
  document.getElementById('score-ct').textContent = ct;
  const bt = document.getElementById('kill-bar-t');
  const bc = document.getElementById('kill-bar-ct');
  const goalText = document.getElementById('kill-goal-text');
  if (bt) bt.style.width = Math.min(100, (t  / WIN_KILLS) * 100) + '%';
  if (bc) bc.style.width = Math.min(100, (ct / WIN_KILLS) * 100) + '%';
  if (goalText) goalText.textContent = `${WIN_KILLS} KILL HEDEFİ`;
}

function updateMapLabel() {
  const el = document.getElementById('map-name-label');
  if (el) el.textContent = currentMapName ? `🗺️ ${currentMapName}` : '';
}

// ─── Oylama Ekranı ───────────────────────────────────────────
function showVoteScreen(msg) {
  const overlay = document.getElementById('vote-overlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');

  const banner = document.getElementById('vote-winner-banner');
  const isT = msg.winner === 'T';
  banner.textContent = isT ? '🔴 TERÖRİSTLER KAZANDI!' : '🔵 KARŞI-TERÖRİSTLER KAZANDI!';
  banner.className   = 'winner-banner ' + (isT ? 't-win' : 'ct-win');

  const list = document.getElementById('vote-map-list');
  list.innerHTML = '';
  const maps = msg.maps || availableMaps;
  maps.forEach(m => {
    const btn = document.createElement('button');
    btn.className = 'vote-map-btn';
    btn.id = 'vote-btn-' + m;
    btn.innerHTML = `🗺️ ${m}<span class="vote-count" id="vc-${m}">0 oy</span>`;
    btn.onclick = () => castVote(m);
    list.appendChild(btn);
  });

  let remaining = msg.duration || 20;
  const timerText = document.getElementById('vote-timer-text');
  const timerBar  = document.getElementById('vote-timer-bar');
  if (timerText) timerText.textContent = remaining + ' saniye';
  if (timerBar)  timerBar.style.width = '100%';
  clearInterval(voteTimerInterval);
  voteTimerInterval = setInterval(() => {
    remaining--;
    if (timerText) timerText.textContent = remaining + ' saniye';
    if (timerBar)  timerBar.style.width = Math.max(0, (remaining / (msg.duration || 20)) * 100) + '%';
    if (remaining <= 0) clearInterval(voteTimerInterval);
  }, 1000);
}

function hideVoteScreen() {
  const el = document.getElementById('vote-overlay');
  if (el) el.classList.add('hidden');
  clearInterval(voteTimerInterval);
}

function castVote(mapName) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'vote', map: mapName }));
  document.querySelectorAll('.vote-map-btn').forEach(b => b.classList.remove('voted'));
  const btn = document.getElementById('vote-btn-' + mapName);
  if (btn) btn.classList.add('voted');
}

// ─── Takım Seçim Ekranı (turlar arası) ───────────────────────
function showTeamSelectScreen(msg) {
  const overlay = document.getElementById('team-select-overlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');

  const mapLabel = document.getElementById('ts-map-name');
  if (mapLabel) mapLabel.textContent = '🗺️ ' + (msg.mapName || '');

  // Haritayı arka plan canvas'ına çiz
  const tsCanvas = document.getElementById('ts-canvas');
  if (tsCanvas) {
    tsCanvas.width  = window.innerWidth;
    tsCanvas.height = window.innerHeight;
    drawMapPreview(tsCanvas, msg.walls || [], msg.spawns || {T:[],CT:[]});
  }

  // Geri sayım
  let remaining = msg.duration || 10;
  const timerText = document.getElementById('ts-timer-text');
  const timerBar  = document.getElementById('ts-timer-bar');
  if (timerText) timerText.textContent = remaining + ' saniye';
  if (timerBar)  timerBar.style.width = '100%';

  // Butonları sıfırla
  document.querySelectorAll('.ts-btn').forEach(b => b.classList.remove('selected'));
  const statusEl = document.getElementById('ts-status');
  if (statusEl) statusEl.textContent = '';

  clearInterval(tsTimerInterval);
  tsTimerInterval = setInterval(() => {
    remaining--;
    if (timerText) timerText.textContent = remaining + ' saniye';
    if (timerBar)  timerBar.style.width = Math.max(0, (remaining / (msg.duration || 10)) * 100) + '%';
    if (remaining <= 0) clearInterval(tsTimerInterval);
  }, 1000);
}

function hideTeamSelectScreen() {
  const el = document.getElementById('team-select-overlay');
  if (el) el.classList.add('hidden');
  clearInterval(tsTimerInterval);
}

function sendTeamSelect(team) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'team_select', team }));
  document.querySelectorAll('.ts-btn').forEach(b => b.classList.remove('selected'));
  const btn = document.getElementById(team === 'T' ? 'ts-btn-t' : 'ts-btn-ct');
  if (btn) btn.classList.add('selected');
  const statusEl = document.getElementById('ts-status');
  if (statusEl) statusEl.textContent = team === 'T' ? '🔴 Terörist seçildi!' : '🔵 Karşı-Terörist seçildi!';
}

function drawMapPreview(cvs, mapWalls, spawns) {
  const ctx2 = cvs.getContext('2d');
  const W = cvs.width, H = cvs.height;
  const MW = 1200, MH = 800;
  const scale = Math.min(W / MW, H / MH) * 0.9;
  const offX  = (W - MW * scale) / 2;
  const offY  = (H - MH * scale) / 2;

  ctx2.clearRect(0, 0, W, H);
  ctx2.fillStyle = '#050608';
  ctx2.fillRect(0, 0, W, H);

  ctx2.save();
  ctx2.translate(offX, offY);
  ctx2.scale(scale, scale);

  // Zemin
  ctx2.fillStyle = '#111318';
  ctx2.fillRect(0, 0, MW, MH);

  // Izgara
  ctx2.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx2.lineWidth = 1 / scale;
  for (let x = 0; x <= MW; x += 40) { ctx2.beginPath(); ctx2.moveTo(x,0); ctx2.lineTo(x,MH); ctx2.stroke(); }
  for (let y = 0; y <= MH; y += 40) { ctx2.beginPath(); ctx2.moveTo(0,y); ctx2.lineTo(MW,y); ctx2.stroke(); }

  // Harita sınırı
  ctx2.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx2.lineWidth = 2 / scale;
  ctx2.strokeRect(0, 0, MW, MH);

  // Duvarlar
  for (const w of mapWalls) {
    ctx2.fillStyle = '#2a3245';
    ctx2.fillRect(w.x, w.y, w.w, w.h);
    ctx2.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx2.lineWidth = 1 / scale;
    ctx2.strokeRect(w.x, w.y, w.w, w.h);
    ctx2.fillStyle = 'rgba(255,255,255,0.05)';
    ctx2.fillRect(w.x, w.y, w.w, Math.min(4, w.h));
  }

  // Spawn noktaları
  for (const sp of (spawns.T || [])) {
    ctx2.beginPath(); ctx2.arc(sp.x, sp.y, 20, 0, Math.PI*2);
    ctx2.fillStyle = 'rgba(231,76,60,0.5)'; ctx2.fill();
    ctx2.strokeStyle = '#e74c3c'; ctx2.lineWidth = 2/scale; ctx2.stroke();
  }
  for (const sp of (spawns.CT || [])) {
    ctx2.beginPath(); ctx2.arc(sp.x, sp.y, 20, 0, Math.PI*2);
    ctx2.fillStyle = 'rgba(52,152,219,0.5)'; ctx2.fill();
    ctx2.strokeStyle = '#3498db'; ctx2.lineWidth = 2/scale; ctx2.stroke();
  }

  ctx2.restore();
}


// ─── HUD Güncelleme ──────────────────────────────────────────
function updateHUD() {
  const me = players[myId];
  if (!me) return;

  document.getElementById('hud-name').textContent = me.name || 'Oyuncu';
  document.getElementById('stat-kills').textContent  = me.kills  || kills;
  document.getElementById('stat-deaths').textContent = me.deaths || deaths;

  const hp = Math.max(0, me.health || 0);
  document.getElementById('health-text').textContent = hp;
  const bar = document.getElementById('health-bar');
  bar.style.width = hp + '%';
  bar.style.background = hp > 50
    ? `linear-gradient(90deg, #e74c3c ${100-hp}%, #2ecc71 100%)`
    : `linear-gradient(90deg, #e74c3c, #f39c12)`;

  const teamBadge = document.getElementById('team-badge');
  if (myTeam) {
    teamBadge.textContent = myTeam;
    teamBadge.className   = `team-badge ${myTeam}`;
  }
}

function updatePlayerCount() {
  document.getElementById('player-count').textContent =
    `👤 ${Object.keys(players).length}`;
}

function updateScoreboard() {
  if (!scoreboardOpen) return;
  const tbodies = { T: document.getElementById('sb-t'), CT: document.getElementById('sb-ct') };
  tbodies.T.innerHTML  = '';
  tbodies.CT.innerHTML = '';
  for (const id in players) {
    const p   = players[id];
    const kd  = p.deaths > 0 ? (p.kills / p.deaths).toFixed(2) : p.kills.toFixed(2);
    const row = `<tr${id===myId?' style="color:#f39c12"':''}><td>${p.name}${id===myId?' ★':''}</td><td>${p.kills||0}</td><td>${p.deaths||0}</td><td>${kd}</td></tr>`;
    if (tbodies[p.team]) tbodies[p.team].innerHTML += row;
  }
}

function setStatus(msg) {
  document.getElementById('status-msg').textContent = msg;
}

// ─── Kill Feed ───────────────────────────────────────────────
function addKillFeed(text, color = '#e8eaf0') {
  const feed = document.getElementById('kill-feed');
  const el   = document.createElement('div');
  el.className = 'kill-entry';
  el.innerHTML = `<span style="color:${color}">${text}</span>`;
  feed.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity 0.5s';
    el.style.opacity    = '0';
    setTimeout(() => el.remove(), 500);
  }, 4000);
  // Max 6 entry
  while (feed.children.length > 6) feed.removeChild(feed.firstChild);
}

// ─── Respawn Ekranı ──────────────────────────────────────────
function showRespawnScreen() {
  document.getElementById('respawn-overlay').classList.remove('hidden');
  respawnCountdown = 3;
  document.getElementById('respawn-timer').textContent =
    `${respawnCountdown} saniye içinde yeniden doğacaksın...`;
  clearInterval(respawnInterval);
  respawnInterval = setInterval(() => {
    respawnCountdown--;
    const el = document.getElementById('respawn-timer');
    if (respawnCountdown <= 0) {
      el.textContent = 'Yeniden doğuluyor...';
      clearInterval(respawnInterval);
    } else {
      el.textContent = `${respawnCountdown} saniye içinde yeniden doğacaksın...`;
    }
  }, 1000);
}

function hideRespawnScreen() {
  document.getElementById('respawn-overlay').classList.add('hidden');
  clearInterval(respawnInterval);
}

// ─── Hasar Flaşı ────────────────────────────────────────────
function showDamageFlash() {
  const el = document.getElementById('damage-flash');
  el.classList.remove('hidden');
  el.style.animation = 'none';
  el.offsetHeight; // reflow
  el.style.animation = '';
  setTimeout(() => el.classList.add('hidden'), 300);
}

// ─── Girdi ──────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (chatOpen) {
    if (e.key === 'Enter') {
      sendChatMessage();
      e.preventDefault();
    }
    if (e.key === 'Escape') {
      closeChat();
      e.preventDefault();
    }
    return; // Chat açıkken diğer tuşlar işlemesin
  }

  // Chat açma (T tuşu)
  if (e.key.toLowerCase() === 't') {
    openChat();
    e.preventDefault();
    return;
  }

  // Silah Değiştirme ve Reload
  if (e.key === '1') {
    ws.send(JSON.stringify({ type: 'switch_weapon', weapon: 'gun' }));
  }
  if (e.key === '2') {
    ws.send(JSON.stringify({ type: 'switch_weapon', weapon: 'knife' }));
  }
  if (e.key.toLowerCase() === 'r') {
    ws.send(JSON.stringify({ type: 'reload' }));
  }

  // Kontrol Paneli (")
  if (e.key === '"') {
    toggleControls();
  }

  keys[e.key.toLowerCase()] = true;

  if (e.key === 'Tab') {
    e.preventDefault();
    scoreboardOpen = true;
    document.getElementById('scoreboard').classList.remove('hidden');
    updateScoreboard();
  }
});

document.addEventListener('keyup', (e) => {
  keys[e.key.toLowerCase()] = false;
  if (e.key === 'Tab') {
    scoreboardOpen = false;
    document.getElementById('scoreboard').classList.add('hidden');
  }
});

document.addEventListener('mousemove', (e) => {
  mouseX = e.clientX;
  mouseY = e.clientY;
  // Crosshair takibi
  const ch = document.getElementById('crosshair');
  ch.style.left = mouseX + 'px';
  ch.style.top  = mouseY + 'px';
});

document.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (!ws || !myId || !alive) return;
  
  const me = players[myId];
  if (!me || me.reloading) return;

  const now = Date.now();
  if (now - lastShot < SHOOT_COOLDOWN) return;
  
  if (me.weapon === 'gun' && me.ammo <= 0) {
    // Mermi yoksa ateş etme, bıçağa geçiş uyarısı veya otomatik geçiş
    return;
  }

  lastShot = now;

  // Oyuncunun ekrandaki gerçek konumuna göre açı hesapla
  const screenPX = me.x - camX;
  const screenPY = me.y - camY;
  const angle = Math.atan2(mouseY - screenPY, mouseX - screenPX);

  ws.send(JSON.stringify({ type: 'shoot', angle }));
  
  if (me.weapon === 'gun') {
    playShootSound();
  } else {
    // Bıçak savurma sesi (Shoot sesini biraz değiştirerek kullanalım veya aynısı)
    playShootSound(); 
  }

  // Crosshair geri tepme efekti
  const ch = document.getElementById('crosshair');
  ch.style.transform = 'translate(-50%,-50%) scale(1.4)';
  setTimeout(() => ch.style.transform = 'translate(-50%,-50%) scale(1)', 80);
});

// ─── Hareket Gönderimi ───────────────────────────────────────
let lastMoveTime = performance.now();

function sendMove() {
  if (!ws || !myId || !alive) return;
  const me = players[myId];
  if (!me) return;

  const now = performance.now();
  const dt  = (now - lastMoveTime) / 1000;
  lastMoveTime = now;

  let dx = 0, dy = 0;
  if (keys['w'] || keys['arrowup'])    dy -= PLAYER_SPEED * dt;
  if (keys['s'] || keys['arrowdown'])  dy += PLAYER_SPEED * dt;
  if (keys['a'] || keys['arrowleft'])  dx -= PLAYER_SPEED * dt;
  if (keys['d'] || keys['arrowright']) dx += PLAYER_SPEED * dt;

  // Diyagonal normalleştirme
  if (dx !== 0 && dy !== 0) {
    dx *= 0.7071;
    dy *= 0.7071;
  }

  // Lokal tahmin (sunucu onayı beklemeden)
  const newX = me.x + dx;
  const newY = me.y + dy;
  if (!collidesWithWalls(newX, me.y) && !collidesWithZone(newX, me.y)) me.x = newX;
  if (!collidesWithWalls(me.x, newY) && !collidesWithZone(me.x, newY)) me.y = newY;
  me.x = Math.max(PLAYER_RADIUS + 20, Math.min(MAP_W - PLAYER_RADIUS - 20, me.x));
  me.y = Math.max(PLAYER_RADIUS + 20, Math.min(MAP_H - PLAYER_RADIUS - 20, me.y));

  // Oyuncunun ekrandaki gerçek konumuna göre açı hesapla
  const screenPX = me.x - camX;
  const screenPY = me.y - camY;
  const angle = Math.atan2(mouseY - screenPY, mouseX - screenPX);
  me.angle = angle;

  if (dx !== 0 || dy !== 0) {
    ws.send(JSON.stringify({ type: 'move', dx, dy, angle }));
  } else {
    ws.send(JSON.stringify({ type: 'move', dx: 0, dy: 0, angle }));
  }
}

// ─── Çarpışma (istemci tarafı) ───────────────────────────────
function collidesWithWalls(cx, cy) {
  for (const w of walls) {
    const nearX = Math.max(w.x, Math.min(cx, w.x + w.w));
    const nearY = Math.max(w.y, Math.min(cy, w.y + w.h));
    const dx = cx - nearX, dy = cy - nearY;
    if (dx*dx + dy*dy < PLAYER_RADIUS * PLAYER_RADIUS) return true;
  }
  return false;
}

function collidesWithZone(cx, cy) {
  if (!myTeam) return false;
  for (const z of zones) {
    if (z.restrict !== myTeam) continue;
    const nearX = Math.max(z.x, Math.min(cx, z.x + z.w));
    const nearY = Math.max(z.y, Math.min(cy, z.y + z.h));
    const dx = cx - nearX, dy = cy - nearY;
    if (dx*dx + dy*dy < PLAYER_RADIUS * PLAYER_RADIUS) return true;
  }
  return false;
}

// ─── RENDER ──────────────────────────────────────────────────
function render() {
  const me = players[myId];
  const W  = canvas.width;
  const H  = canvas.height;
  const HUD_H = 64;

  // Oyuncuyu HUD altındaki görünür alanın TAM ORTASINA kilitle — clamp yok
  if (me) {
    camX = me.x - W / 2;
    camY = me.y - HUD_H / 2 - H / 2;
  }

  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(-camX, -camY);

  // ── Zemin ──
  drawFloor();

  // ── Kısıtlı Bölgeler ──
  drawZones();

  // ── Duvarlar ──
  drawWalls();

  // ── Mermiler ──
  drawBullets();

  // ── Oyuncular ──
  drawPlayers();

  ctx.restore();

  // ── Minimap (kamera dışı) ──
  drawMinimap(W, H);
}

function drawFloor() {
  const W = canvas.width, H = canvas.height;

  // Tüm görünür alanı (dünya koordinatlarında) koyu renkle doldur
  ctx.fillStyle = '#0a0c10';
  ctx.fillRect(camX, camY, W, H);

  // Harita zemini
  ctx.fillStyle = '#111318';
  ctx.fillRect(0, 0, MAP_W, MAP_H);

  // Izgara
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth   = 1;
  const GRID = 40;
  for (let x = 0; x <= MAP_W; x += GRID) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, MAP_H); ctx.stroke();
  }
  for (let y = 0; y <= MAP_H; y += GRID) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(MAP_W, y); ctx.stroke();
  }

  // Takım bölgeleri
  ctx.fillStyle = 'rgba(231,76,60,0.05)';
  ctx.fillRect(20, 20, 320, 320);
  ctx.fillStyle = 'rgba(52,152,219,0.05)';
  ctx.fillRect(MAP_W - 340, 20, 320, 320);
}

// ─── Kısıtlı Bölgeler ────────────────────────────────────────
function drawZones() {
  if (!zones.length) return;
  const now = Date.now();

  for (const z of zones) {
    // Pembe yarı-saydam dolgu (T ve CT için farklı ton)
    const isMyZone = z.restrict === myTeam;
    const alpha = isMyZone
      ? 0.18 + 0.06 * Math.sin(now / 400)   // kendi yasak bölgen daha belirgin + nabız
      : 0.10;

    ctx.fillStyle = `rgba(255,80,180,${alpha})`;
    ctx.fillRect(z.x, z.y, z.w, z.h);

    // Çizgili desen (tarama)
    ctx.save();
    ctx.beginPath();
    ctx.rect(z.x, z.y, z.w, z.h);
    ctx.clip();
    ctx.strokeStyle = `rgba(255,80,180,${isMyZone ? 0.25 : 0.12})`;
    ctx.lineWidth = 1.5;
    for (let i = -Math.max(z.w, z.h); i < Math.max(z.w, z.h) * 2; i += 14) {
      ctx.beginPath();
      ctx.moveTo(z.x + i, z.y);
      ctx.lineTo(z.x + i + z.h, z.y + z.h);
      ctx.stroke();
    }
    ctx.restore();

    // Kenarlık
    ctx.strokeStyle = isMyZone
      ? `rgba(255,80,180,${0.7 + 0.3 * Math.sin(now / 300)})`
      : 'rgba(255,80,180,0.5)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(z.x, z.y, z.w, z.h);
    ctx.setLineDash([]);

    // Etiket
    const label = z.restrict + ' GİREMEZ';
    ctx.font = 'bold 13px Rajdhani,sans-serif';
    const tw = ctx.measureText(label).width;
    const lx = z.x + z.w / 2 - tw / 2;
    const ly = z.y + z.h / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(lx - 4, ly - 14, tw + 8, 18);
    ctx.fillStyle = isMyZone ? '#ff50b4' : 'rgba(255,150,200,0.8)';
    ctx.fillText(label, lx, ly);
  }
}

function drawWalls() {
  for (const w of walls) {
    // Duvar gölgesi
    ctx.shadowColor  = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur   = 12;
    ctx.fillStyle    = '#1e2330';
    ctx.fillRect(w.x, w.y, w.w, w.h);
    ctx.shadowBlur   = 0;

    // Kenar şeridi
    ctx.strokeStyle  = 'rgba(255,255,255,0.12)';
    ctx.lineWidth    = 1;
    ctx.strokeRect(w.x + 0.5, w.y + 0.5, w.w - 1, w.h - 1);

    // Üst vurgu
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fillRect(w.x + 1, w.y + 1, w.w - 2, 4);
  }
}

function drawBullets() {
  for (const b of bullets) {
    ctx.save();
    ctx.shadowColor = '#f39c12';
    ctx.shadowBlur  = 8;
    ctx.fillStyle   = '#ffd700';
    ctx.beginPath();
    ctx.arc(b.x, b.y, BULLET_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // İz
    ctx.strokeStyle = 'rgba(255,215,0,0.3)';
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - Math.cos(b.angle) * 14, b.y - Math.sin(b.angle) * 14);
    ctx.stroke();
  }
}

function drawPlayers() {
  for (const id in players) {
    const p = players[id];
    if (!p.alive) continue;

    const isMe = id === myId;
    const teamColor = p.team === 'T' ? '#e74c3c' : '#3498db';

    ctx.save();
    ctx.translate(p.x, p.y);

    // Gölge
    ctx.shadowColor = teamColor;
    ctx.shadowBlur  = isMe ? 20 : 10;

    // Vücut
    const bodyGrad = ctx.createRadialGradient(-4, -4, 2, 0, 0, PLAYER_RADIUS);
    bodyGrad.addColorStop(0, p.team === 'T' ? '#ff6b5e' : '#5dade2');
    bodyGrad.addColorStop(1, teamColor);
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.arc(0, 0, PLAYER_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    // Kenarlık
    ctx.strokeStyle = isMe ? '#ffffff' : 'rgba(255,255,255,0.4)';
    ctx.lineWidth   = isMe ? 2 : 1;
    ctx.stroke();

    // Silah çizgisi (nişan)
    ctx.rotate(p.angle);
    if (p.weapon === 'gun') {
      ctx.fillStyle   = '#c0c0c0';
      ctx.strokeStyle = '#808080';
      ctx.lineWidth   = 1;
      ctx.fillRect(PLAYER_RADIUS - 4, -4, 18, 8);
      ctx.strokeRect(PLAYER_RADIUS - 4, -4, 18, 8);
    } else {
      // Bıçak görünümü
      ctx.fillStyle   = '#e0e0e0';
      ctx.strokeStyle = '#999';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(PLAYER_RADIUS - 2, -2);
      ctx.lineTo(PLAYER_RADIUS + 12, -1);
      ctx.lineTo(PLAYER_RADIUS - 2, 2);
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();

    // İsim etiketi
    ctx.shadowBlur = 0;
    ctx.fillStyle  = isMe ? '#f39c12' : (p.team === 'T' ? '#ff8c7f' : '#7dc5f0');
    ctx.font       = `bold 12px Rajdhani, sans-serif`;
    ctx.textAlign  = 'center';
    ctx.fillText(p.name, p.x, p.y - PLAYER_RADIUS - 8);

    // Can çubuğu (üstte)
    const barW = 36, barH = 4;
    const bx   = p.x - barW / 2;
    const by   = p.y - PLAYER_RADIUS - 4;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(bx, by, barW, barH);
    const hpRatio = (p.health || 0) / 100;
    const hpColor = hpRatio > 0.5 ? '#2ecc71' : hpRatio > 0.25 ? '#f39c12' : '#e74c3c';
    ctx.fillStyle = hpColor;
    ctx.fillRect(bx, by, barW * hpRatio, barH);
  }
}

// ─── Minimap ─────────────────────────────────────────────────
function drawMinimap(W, H) {
  const SCALE = 0.14;
  const mW = MAP_W * SCALE, mH = MAP_H * SCALE;
  const mx = 14, my = 80; // Sol Üst (HUD'un altı)

  ctx.save();
  // Arka plan
  ctx.fillStyle = 'rgba(8,10,16,0.85)';
  roundRect(ctx, mx - 2, my - 2, mW + 4, mH + 4, 6);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Duvarlar
  ctx.fillStyle = '#2a3045';
  for (const w of walls) {
    ctx.fillRect(mx + w.x * SCALE, my + w.y * SCALE, w.w * SCALE, w.h * SCALE);
  }

  // Oyuncular
  for (const id in players) {
    const p = players[id];
    if (!p.alive) continue;
    ctx.fillStyle = id === myId ? '#f39c12' : (p.team === 'T' ? '#e74c3c' : '#3498db');
    ctx.beginPath();
    ctx.arc(mx + p.x * SCALE, my + p.y * SCALE, id === myId ? 4 : 3, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ─── Ana Döngü ───────────────────────────────────────────────
let lastFrame = performance.now();

function gameLoop(now) {
  requestAnimationFrame(gameLoop);
  sendMove();
  render();
}

requestAnimationFrame(gameLoop);
