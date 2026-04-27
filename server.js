/**
 * NIŞANCI — server.js v2
 * Dinamik harita, takım seçimi, 25 kill kazanma, oy sistemi
 */
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const EDITOR_PASSWORD = 'sex';
let WIN_KILLS = 25;
const VOTE_DURATION = 20000;
const MAPS_DIR = path.join(__dirname, 'maps');
if (!fs.existsSync(MAPS_DIR)) fs.mkdirSync(MAPS_DIR, { recursive: true });

// ── Varsayılan harita ────────────────────────────────────────
const DEFAULT_WALLS = [
  { x: 0, y: 0, w: 1200, h: 20 }, { x: 0, y: 780, w: 1200, h: 20 }, { x: 0, y: 0, w: 20, h: 800 }, { x: 1180, y: 0, w: 20, h: 800 },
  { x: 100, y: 100, w: 20, h: 200 }, { x: 100, y: 100, w: 200, h: 20 }, { x: 200, y: 200, w: 150, h: 20 }, { x: 200, y: 200, w: 20, h: 150 },
  { x: 450, y: 150, w: 20, h: 200 }, { x: 450, y: 150, w: 150, h: 20 }, { x: 600, y: 150, w: 20, h: 100 }, { x: 450, y: 350, w: 150, h: 20 },
  { x: 520, y: 330, w: 160, h: 140 },
  { x: 80, y: 380, w: 200, h: 20 }, { x: 80, y: 500, w: 200, h: 20 },
  { x: 920, y: 380, w: 200, h: 20 }, { x: 920, y: 500, w: 200, h: 20 },
  { x: 900, y: 100, w: 200, h: 20 }, { x: 1080, y: 100, w: 20, h: 200 }, { x: 830, y: 200, w: 150, h: 20 }, { x: 980, y: 200, w: 20, h: 150 },
  { x: 200, y: 620, w: 20, h: 160 }, { x: 200, y: 620, w: 200, h: 20 }, { x: 780, y: 620, w: 200, h: 20 }, { x: 980, y: 620, w: 20, h: 160 },
  { x: 350, y: 480, w: 20, h: 150 }, { x: 350, y: 630, w: 150, h: 20 }, { x: 700, y: 480, w: 20, h: 150 }, { x: 700, y: 630, w: 150, h: 20 },
];
const DEFAULT_SPAWNS = {
  T: [{ x: 150, y: 150 }, { x: 150, y: 200 }, { x: 200, y: 150 }],
  CT: [{ x: 1000, y: 150 }, { x: 1050, y: 200 }, { x: 1000, y: 200 }],
};

// ── Harita yönetimi ──────────────────────────────────────────
let availableMaps = [];
let currentWalls = DEFAULT_WALLS;
let currentSpawns = DEFAULT_SPAWNS;
let currentZones = [];            // Kısıtlı bölgeler [{x,y,w,h,restrict:'T'|'CT'}]
let currentMapName = 'varsayilan';

function loadMaps() {
  try {
    const files = fs.readdirSync(MAPS_DIR).filter(f => f.endsWith('.json'));
    availableMaps = files.map(f => f.replace('.json', ''));
    console.log(`[MAP] ${availableMaps.length} harita: ${availableMaps.join(', ') || '(yok)'}`);
  } catch { availableMaps = []; }
}

function loadActiveMap(name) {
  const file = path.join(MAPS_DIR, name + '.json');
  if (!fs.existsSync(file)) return false;
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    currentWalls = d.walls || DEFAULT_WALLS;
    currentSpawns = d.spawns || DEFAULT_SPAWNS;
    currentZones = d.zones || [];
    currentMapName = name;
    console.log(`[MAP] Aktif: ${name}`);
    return true;
  } catch { return false; }
}

loadMaps();
if (availableMaps.length) loadActiveMap(availableMaps[0]);

// maps/ klasörünü izle — yeni harita eklenince otomatik algıla
fs.watch(MAPS_DIR, (ev, filename) => {
  if (filename && filename.endsWith('.json')) {
    loadMaps();
    broadcastAll({ type: 'maps_updated', maps: availableMaps });
    console.log(`[MAP] Klasör güncellendi: ${filename}`);
  }
});

// ── Oyun durumu ────────────────────────────────────────────
let gameKills = { T: 0, CT: 0 };
let gamePhase = 'playing'; // 'playing' | 'voting' | 'team_selecting'
let votes = {};
let votingTimer = null;
let teamSelections = {}; // playerId → 'T' | 'CT'
let teamSelectTimer = null;
let forfeitVotes = new Set(); // set of playerIds
let ffActive = false;

function startVoting(winnerTeam) {
  gamePhase = 'voting';
  votes = {};
  clearTimeout(votingTimer);
  const mapList = availableMaps.length ? availableMaps : [currentMapName];
  broadcastAll({ type: 'game_over', winner: winnerTeam, gameKills: { ...gameKills }, maps: mapList, duration: VOTE_DURATION / 1000 });
  votingTimer = setTimeout(finishVoting, VOTE_DURATION);
}

function finishVoting() {
  clearTimeout(votingTimer);
  const candidates = availableMaps.length ? availableMaps : [currentMapName];
  const counts = {};
  candidates.forEach(m => counts[m] = 0);
  Object.values(votes).forEach(v => { if (counts[v] !== undefined) counts[v]++; });
  let best = candidates[Math.floor(Math.random() * candidates.length)], bestVal = -1;
  for (const [m, c] of Object.entries(counts)) if (c > bestVal) { bestVal = c; best = m; }
  startTeamSelectPhase(best); // Oylama bitince takım seçim fazına geç
}

function startTeamSelectPhase(mapName) {
  gamePhase = 'team_selecting';
  teamSelections = {};
  clearTimeout(teamSelectTimer);

  // Önizleme için harita verisini yükle (henüz aktif yapmadan)
  const file = path.join(MAPS_DIR, mapName + '.json');
  let previewWalls = DEFAULT_WALLS, previewSpawns = DEFAULT_SPAWNS, previewZones = [];
  if (fs.existsSync(file)) {
    try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); previewWalls = d.walls || DEFAULT_WALLS; previewSpawns = d.spawns || DEFAULT_SPAWNS; previewZones = d.zones || []; } catch { }
  }

  broadcastAll({ type: 'team_select_phase', mapName, walls: previewWalls, spawns: previewSpawns, zones: previewZones, duration: 10 });

  teamSelectTimer = setTimeout(() => {
    applyTeamSelections();
    startNewRound(mapName);
  }, 10000);
}

function applyTeamSelections() {
  let tC = 0, ctC = 0;
  // Önce kendi seçenler
  for (const id in players) {
    const chosen = teamSelections[id];
    if (chosen) { players[id].team = chosen; chosen === 'T' ? tC++ : ctC++; }
  }
  // Kalanlar otomatik atanır
  for (const id in players) {
    if (!teamSelections[id]) {
      const t = tC <= ctC ? 'T' : 'CT';
      players[id].team = t; t === 'T' ? tC++ : ctC++;
    }
  }
}

function startNewRound(mapName) {
  if (!loadActiveMap(mapName)) { currentWalls = DEFAULT_WALLS; currentSpawns = DEFAULT_SPAWNS; currentZones = []; currentMapName = 'varsayilan'; }
  gameKills = { T: 0, CT: 0 };
  gamePhase = 'playing';
  votes = {};
  bullets = [];
  for (const id in players) {
    const p = players[id], sp = getSpawnPoint(p.team);
    p.x = sp.x; p.y = sp.y; p.health = MAX_HEALTH; p.alive = true; 
    p.kills = 0; p.deaths = 0;
    p.ammo = 10; p.reserve = 30; p.weapon = 'gun'; p.reloading = false;
  }
  broadcastAll({ type: 'new_round', mapName: currentMapName, walls: currentWalls, spawns: currentSpawns, zones: currentZones, players: publicState(), gameKills });
}

// ── HTTP yardımcıları ────────────────────────────────────────
function jsonRes(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = ''; req.on('data', d => b += d);
    req.on('end', () => { try { resolve(JSON.parse(b)); } catch { reject(new Error('JSON hatalı')); } });
    req.on('error', reject);
  });
}
function checkAuth(req) { return req.headers['x-editor-password'] === EDITOR_PASSWORD; }

// ── HTTP Sunucusu ────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, x-editor-password', 'Access-Control-Allow-Methods': 'GET, POST, DELETE' });
    return res.end();
  }

  // Public: harita listesi
  if (req.method === 'GET' && url === '/maps')
    return jsonRes(res, 200, { maps: availableMaps, current: currentMapName });

  // Editör API
  if (req.method === 'GET' && url === '/editor/maps') {
    if (!checkAuth(req)) return jsonRes(res, 401, { error: 'Yetkisiz' });
    return jsonRes(res, 200, { maps: fs.readdirSync(MAPS_DIR).filter(f => f.endsWith('.json')).map(f => f.replace('.json', '')) });
  }
  if (req.method === 'GET' && url.startsWith('/editor/load/')) {
    if (!checkAuth(req)) return jsonRes(res, 401, { error: 'Yetkisiz' });
    const name = path.basename(url.slice(13)).replace(/[^a-zA-Z0-9_-]/g, '');
    const file = path.join(MAPS_DIR, name + '.json');
    if (!fs.existsSync(file)) return jsonRes(res, 404, { error: 'Bulunamadı' });
    return jsonRes(res, 200, JSON.parse(fs.readFileSync(file, 'utf8')));
  }
  if (req.method === 'POST' && url === '/editor/save') {
    if (!checkAuth(req)) return jsonRes(res, 401, { error: 'Yetkisiz' });
    try {
      const data = await readBody(req);
      if (!data.name) return jsonRes(res, 400, { error: 'Ad gerekli' });
      const safe = data.name.replace(/[^a-zA-Z0-9_-]/g, '_');
      fs.writeFileSync(path.join(MAPS_DIR, safe + '.json'), JSON.stringify(data, null, 2), 'utf8');
      return jsonRes(res, 200, { ok: true, name: safe });
    } catch (e) { return jsonRes(res, 500, { error: e.message }); }
  }
  if (req.method === 'DELETE' && url.startsWith('/editor/delete/')) {
    if (!checkAuth(req)) return jsonRes(res, 401, { error: 'Yetkisiz' });
    const name = path.basename(url.slice(15)).replace(/[^a-zA-Z0-9_-]/g, '');
    const file = path.join(MAPS_DIR, name + '.json');
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return jsonRes(res, 200, { ok: true });
  }

  // Statik dosyalar
  const filePath = path.join(__dirname, url === '/' ? 'index.html' : url);
  const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json' };
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Bulunamadı'); }
    else { res.writeHead(200, { 'Content-Type': (mime[path.extname(filePath)] || 'text/plain') + '; charset=utf-8' }); res.end(data); }
  });
});

// ── WebSocket ────────────────────────────────────────────────
const wss = new WebSocket.Server({ server });
const PLAYER_SPEED = 200, BULLET_SPEED = 600, BULLET_DAMAGE = 25;
const PLAYER_RADIUS = 16, BULLET_RADIUS = 5, MAX_HEALTH = 100, RESPAWN_DELAY = 3000, TICK_RATE = 60;
let players = {}, bullets = [], playerIdCounter = 0;

function circleAABB(cx, cy, cr, rx, ry, rw, rh) {
  const nx = Math.max(rx, Math.min(cx, rx + rw)), ny = Math.max(ry, Math.min(cy, ry + rh));
  return (cx - nx) ** 2 + (cy - ny) ** 2 < cr * cr;
}
function hitsWall(x, y, r) { return currentWalls.some(w => circleAABB(x, y, r, w.x, w.y, w.w, w.h)); }
function bulletWall(bx, by) { return currentWalls.some(w => bx >= w.x && bx <= w.x + w.w && by >= w.y && by <= w.y + w.h); }
function hitsZone(x, y, r, team) {
  return currentZones.some(z => z.restrict === team && circleAABB(x, y, r, z.x, z.y, z.w, z.h));
}
function getSpawnPoint(team) {
  const arr = (currentSpawns[team] || []).length ? currentSpawns[team] : DEFAULT_SPAWNS[team];
  return arr[Math.floor(Math.random() * arr.length)];
}
function mkPlayer(id, name, team) {
  const s = getSpawnPoint(team);
  return { 
    id, name, team, x: s.x, y: s.y, angle: 0, 
    health: MAX_HEALTH, alive: true, kills: 0, deaths: 0, 
    ammo: 10, reserve: 30, weapon: 'gun', reloading: false,
    ws: null 
  };
}
function broadcast(data, ex = null) {
  const m = JSON.stringify(data);
  for (const id in players) { if (id === ex) continue; const p = players[id]; if (p.ws?.readyState === WebSocket.OPEN) p.ws.send(m); }
}
function broadcastAll(data) { broadcast(data, null); }
function publicState() {
  const s = {};
  for (const id in players) { 
    const p = players[id]; 
    s[id] = { 
      id: p.id, name: p.name, team: p.team, x: p.x, y: p.y, angle: p.angle, 
      health: p.health, alive: p.alive, kills: p.kills, deaths: p.deaths,
      weapon: p.weapon, ammo: p.ammo, reserve: p.reserve, reloading: p.reloading
    }; 
  }
  return s;
}

// ── Oyun döngüsü ─────────────────────────────────────────────
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now(), dt = (now - lastTick) / 1000; lastTick = now;
  if (gamePhase !== 'playing') return;

  bullets = bullets.filter(b => {
    b.x += Math.cos(b.angle) * BULLET_SPEED * dt; b.y += Math.sin(b.angle) * BULLET_SPEED * dt; b.life -= dt;
    if (b.life <= 0 || bulletWall(b.x, b.y)) return false;
    for (const id in players) {
      const p = players[id];
      if (!p.alive || id === b.ownerId || p.team === b.ownerTeam) continue;
      if (Math.hypot(p.x - b.x, p.y - b.y) < PLAYER_RADIUS + BULLET_RADIUS) {
        p.health -= BULLET_DAMAGE;
        if (p.health <= 0) {
          p.alive = false;
          p.health = 0;
          p.deaths++;
          p.ammo = 10;
          p.reserve = 30;
          p.weapon = 'gun';
          p.reloading = false;
          const sh = players[b.ownerId];
          if (sh) {
            sh.kills++;
            gameKills[sh.team] = (gameKills[sh.team] || 0) + 1;
            if (sh.ws?.readyState === WebSocket.OPEN) sh.ws.send(JSON.stringify({ type: 'kill_feed', killer: sh.name, victim: p.name }));
          }
          broadcastAll({ type: 'player_died', id: p.id, killer: b.ownerId, killerName: sh?.name || '?', victimName: p.name, gameKills: { ...gameKills } });
          if ((gameKills[sh?.team] || 0) >= WIN_KILLS) { startVoting(sh.team); }
          else {
            setTimeout(() => { if (players[p.id] && gamePhase === 'playing') { const s = getSpawnPoint(p.team); p.x = s.x; p.y = s.y; p.health = MAX_HEALTH; p.alive = true; broadcastAll({ type: 'player_respawn', id: p.id, x: p.x, y: p.y }); } }, RESPAWN_DELAY);
          }
        } else {
          if (p.ws?.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify({ type: 'hit', health: p.health }));
        }
        return false;
      }
    }
    return true;
  });

  if (Object.keys(players).length > 0)
    broadcastAll({ type: 'state', players: publicState(), bullets: bullets.map(b => ({ x: b.x, y: b.y, angle: b.angle })), gameKills: { ...gameKills } });
}, 1000 / TICK_RATE);

// ── Bağlantılar ──────────────────────────────────────────────
wss.on('connection', ws => {
  const id = String(++playerIdCounter);

  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'join') {
      let team = (msg.team === 'T' || msg.team === 'CT') ? msg.team : null;
      let tC = 0, ctC = 0;
      for (const pid in players) { if (players[pid].team === 'T') tC++; else ctC++; }
      if (!team) team = tC <= ctC ? 'T' : 'CT';
      else if (team === 'T' && tC - ctC >= 3) team = 'CT';
      else if (team === 'CT' && ctC - tC >= 3) team = 'T';

      const p = mkPlayer(id, msg.name || `Oyuncu${id}`, team);
      p.ws = ws; players[id] = p;
      ws.send(JSON.stringify({
        type: 'welcome', id, team, x: p.x, y: p.y,
        walls: currentWalls, spawns: currentSpawns, zones: currentZones,
        players: publicState(), gameKills: { ...gameKills },
        mapName: currentMapName, maps: availableMaps, gamePhase
      }));
      broadcast({ type: 'player_joined', id, name: p.name, team, x: p.x, y: p.y }, id);
      console.log(`[+] ${p.name} (${team})`);
    }

    else if (msg.type === 'move') {
      const p = players[id]; if (!p || !p.alive || gamePhase !== 'playing') return;
      const nx = p.x + msg.dx, ny = p.y + msg.dy;
      if (!hitsWall(nx, p.y, PLAYER_RADIUS) && !hitsZone(nx, p.y, PLAYER_RADIUS, p.team)) p.x = nx;
      if (!hitsWall(p.x, ny, PLAYER_RADIUS) && !hitsZone(p.x, ny, PLAYER_RADIUS, p.team)) p.y = ny;
      p.x = Math.max(PLAYER_RADIUS + 20, Math.min(1200 - PLAYER_RADIUS - 20, p.x));
      p.y = Math.max(PLAYER_RADIUS + 20, Math.min(800 - PLAYER_RADIUS - 20, p.y));
      p.angle = msg.angle;
    }

    else if (msg.type === 'shoot') {
      const p = players[id]; if (!p || !p.alive || gamePhase !== 'playing' || p.reloading) return;
      
      if (p.weapon === 'gun') {
        if (p.ammo > 0) {
          p.ammo--;
          bullets.push({ 
            x: p.x + Math.cos(msg.angle) * (PLAYER_RADIUS + 6), 
            y: p.y + Math.sin(msg.angle) * (PLAYER_RADIUS + 6), 
            angle: msg.angle, ownerId: id, ownerTeam: p.team, life: 2.0 
          });
          // Mermi bitti mi kontrol et
          if (p.ammo === 0) {
            if (p.reserve > 0) {
               // Reload başlat (Opsiyonel: otomatik reload veya bıçağa geçiş)
               // Burada kullanıcı bıçağa geçmek zorunda kalsın dediği için bıçağa zorluyoruz:
               // p.weapon = 'knife'; // Kullanıcı "mermimiz bittiğinde elimize bıçak gelsin" dedi
            } else {
               p.weapon = 'knife';
            }
          }
        } else {
          p.weapon = 'knife';
        }
      } else if (p.weapon === 'knife') {
        // Bıçak saldırısı (Kısa mesafe mermi gibi düşünelim veya direkt alan kontrolü)
        bullets.push({ 
          x: p.x + Math.cos(msg.angle) * (PLAYER_RADIUS + 2), 
          y: p.y + Math.sin(msg.angle) * (PLAYER_RADIUS + 2), 
          angle: msg.angle, ownerId: id, ownerTeam: p.team, life: 0.05, isKnife: true 
        });
      }
    }

    else if (msg.type === 'switch_weapon') {
      const p = players[id]; if (!p || !p.alive) return;
      if (msg.weapon === 'gun') {
        if (p.ammo > 0 || p.reserve > 0) p.weapon = 'gun';
        else p.weapon = 'knife';
      } else {
        p.weapon = 'knife';
      }
    }

    else if (msg.type === 'reload') {
      const p = players[id]; if (!p || !p.alive || p.reloading || p.weapon !== 'gun') return;
      if (p.ammo < 10 && p.reserve > 0) {
        p.reloading = true;
        broadcastAll({ type: 'player_reloading', id });
        setTimeout(() => {
          if (players[id]) {
            const needed = 10 - p.ammo;
            const take = Math.min(needed, p.reserve);
            p.ammo += take;
            p.reserve -= take;
            p.reloading = false;
          }
        }, 1500);
      }
    }

    else if (msg.type === 'vote') {
      if (gamePhase === 'voting' && availableMaps.includes(msg.map)) {
        votes[id] = msg.map;
        const counts = {};
        availableMaps.forEach(m => counts[m] = 0);
        Object.values(votes).forEach(v => { if (counts[v] !== undefined) counts[v]++; });
        broadcastAll({ type: 'vote_update', votes: counts, total: Object.keys(votes).length, players: Object.keys(players).length });
      }
    }

    else if (msg.type === 'team_select') {
      if (gamePhase === 'team_selecting') {
        const t = msg.team === 'T' || msg.team === 'CT' ? msg.team : null;
        if (t) teamSelections[id] = t;
      }
    }

    else if (msg.type === 'chat') {
      const p = players[id]; if (!p) return;
      const text = (msg.text || '').trim(); if (!text) return;

      // Komut Kontrolü
      if (text.startsWith('/')) {
        handleCommand(id, text);
        return;
      }

      // Normal Mesaj
      broadcastAll({ type: 'chat', id, name: p.name, team: p.team, text });
    }

    else if (msg.type === 'admin_action') {
      // Bu mesaj sadece /op yetkisi olanlardan (istemci tarafında kontrol edilir) veya şifre ile gelmeli
      handleAdminAction(msg);
    }
  });

ws.on('close', () => {
  const p = players[id];
  if (p) { console.log(`[-] ${p.name}`); broadcastAll({ type: 'player_left', id }); delete players[id]; }
});
ws.on('error', () => delete players[id]);
});

function handleCommand(playerId, text) {
  const p = players[playerId]; if (!p) return;
  const cmd = text.slice(1).split(' ')[0].toLowerCase();

  if (cmd === 'help') {
    p.ws.send(JSON.stringify({ type: 'chat', system: true, text: 'Komutlar: /help, /ff' }));
  }
  else if (cmd === 'ff') {
    if (gamePhase !== 'playing') return;
    forfeitVotes.add(playerId);
    const count = forfeitVotes.size;
    const total = Object.keys(players).length;
    const req = Math.ceil(total * 0.6);

    broadcastAll({ type: 'chat', system: true, text: `${p.name} teslim olma oylaması başlattı (${count}/${req})` });

    if (count >= req) {
      broadcastAll({ type: 'chat', system: true, text: 'Teslim olma kabul edildi. Tur sonlanıyor...' });
      forfeitVotes.clear();
      startVoting(p.team === 'T' ? 'CT' : 'T'); // Karşı takım kazanır
    }
  }
  else if (cmd === 'op') {
    // /op gizli komuttur, help'te gözükmez. Panel açma sinyali gönderir.
    p.ws.send(JSON.stringify({ type: 'op_authorized' }));
  }
}

function handleAdminAction(msg) {
  const action = msg.action;

  if (action === 'change_map') {
    const map = msg.map;
    if (availableMaps.includes(map)) {
      broadcastAll({ type: 'chat', system: true, text: `Admin haritayı değiştiriyor: ${map}` });
      startNewRound(map);
    }
  }
  else if (action === 'set_kill_limit') {
    const limit = parseInt(msg.limit);
    if (!isNaN(limit) && limit > 0) {
      WIN_KILLS = limit;
      broadcastAll({ type: 'chat', system: true, text: `Maç bitiş sınırı admin tarafından ${limit} olarak güncellendi.` });
      broadcastAll({ type: 'kill_limit_update', limit });
    }
  }
  else if (action === 'player_team') {
    const target = players[msg.targetId];
    if (target) {
      target.team = target.team === 'T' ? 'CT' : 'T';
      const sp = getSpawnPoint(target.team);
      target.x = sp.x; target.y = sp.y;
      broadcastAll({ type: 'chat', system: true, text: `${target.name} takımı admin tarafından değiştirildi.` });
      broadcastAll({ type: 'state', players: publicState(), bullets: [], gameKills });
    }
  }
  else if (action === 'player_name') {
    const target = players[msg.targetId];
    if (target && msg.newName) {
      const old = target.name;
      target.name = msg.newName;
      broadcastAll({ type: 'chat', system: true, text: `${old} artık ${target.name} olarak biliniyor.` });
      broadcastAll({ type: 'state', players: publicState(), bullets: [], gameKills });
    }
  }
  else if (action === 'player_msg') {
    const target = players[msg.targetId];
    if (target && msg.text) {
      broadcastAll({ type: 'chat', id: target.id, name: target.name, team: target.team, text: msg.text });
    }
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🎮 Sunucu başlatıldı → Port: ${PORT}`);
});
