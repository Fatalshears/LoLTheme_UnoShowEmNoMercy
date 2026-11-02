// Chơi Tới Bến — LAN server. One table per server, server-authoritative.
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const E = require('../shared/engine.js');
const Bot = require('../shared/bot.js');
const Pace = require('../shared/pace.js');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.join(__dirname, '..');
const SNAPSHOT = path.join(ROOT, 'data', 'snapshot.json');
const BOT_DELAY_MS = 900;
const GRACE_MS = 30000;      // disconnected player gets this long before auto-play
const TURN_MS = Number(process.env.TURN_MS) || Pace.TURN_MS; // every human decision has a 45s timer, then auto-play
const MAX_SEATS = 8;
const BOT_NAMES = ['Teemo', 'Yasuo', 'Lux', 'Jinx', 'Garen', 'Ahri', 'Draven', 'Zed', 'Annie', 'Thresh'];

const app = express();
app.use(express.static(path.join(ROOT, 'public')));
app.use('/shared', express.static(path.join(ROOT, 'shared')));
app.use('/assets/cards', express.static(path.join(ROOT, 'assets', 'cards'), { maxAge: '7d' }));
app.use('/assets/fx', express.static(path.join(ROOT, 'assets', 'fx'), { maxAge: '7d' }));
app.use('/assets/emotes', express.static(path.join(ROOT, 'assets', 'emotes'), { maxAge: '7d' }));
app.get('/vendor/lottie.min.js', (req, res) =>
  res.sendFile(require.resolve('lottie-web/build/player/lottie.min.js')));
app.get('/api/emotes', (req, res) => {
  const dir = path.join(ROOT, 'assets', 'emotes');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  res.json(files.filter(f => /\.(webm|tgs|webp|png|gif)$/i.test(f)).sort());
});

const server = http.createServer(app);
const io = new Server(server);

// ---- table state ----
// players: { token, name, bot, socketId, connected, auto, lastSeen }
const table = {
  status: 'lobby',          // lobby | playing | roundEnd
  players: [],
  hostToken: null,
  game: null,               // engine state while playing / roundEnd
  seatTokens: [],           // seat index -> player token for the current round
  scores: {},               // token -> total points
  round: 0,
  emoteCooldown: {},
  animUntil: 0,             // clients are animating the last events until this time
  turn: null                // { key, deadline } for the decision currently awaited
};

const sockets = new Map();  // socket.id -> token
const findPlayer = token => table.players.find(p => p.token === token);
const seatOf = token => table.seatTokens.indexOf(token);
const newToken = () => crypto.randomUUID();

function saveSnapshot() {
  try {
    fs.mkdirSync(path.dirname(SNAPSHOT), { recursive: true });
    const g = table.game && { ...table.game, rng: undefined, events: [] };
    const data = { ...table, game: g, players: table.players.map(p => ({ ...p, socketId: null, connected: p.bot })) };
    fs.writeFileSync(SNAPSHOT, JSON.stringify(data));
  } catch (e) { console.error('snapshot failed', e.message); }
}

function loadSnapshot() {
  try {
    if (!fs.existsSync(SNAPSHOT)) return;
    const data = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    Object.assign(table, data);
    if (table.game) {
      let seed = Date.now() >>> 0;
      table.game.rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    }
    const now = Date.now();
    for (const p of table.players) if (!p.bot) p.lastSeen = now; // grace period restarts after a server restart
    table.turn = null; table.animUntil = 0;
    console.log(`Đã khôi phục bàn chơi từ snapshot (${table.status}).`);
  } catch (e) { console.error('Không đọc được snapshot:', e.message); }
}

function ensureHost() {
  const host = findPlayer(table.hostToken);
  if (host && !host.bot && host.connected) return;
  const next = table.players.find(p => !p.bot && p.connected);
  if (next) table.hostToken = next.token;
}

// ---- broadcasting ----

function publicPlayers() {
  return table.players.map(p => ({
    name: p.name, bot: p.bot, connected: p.connected, auto: p.auto,
    host: p.token === table.hostToken, seat: seatOf(p.token), score: table.scores[p.token] || 0,
    id: p.token.slice(0, 8)
  }));
}

// Start a fresh timer whenever the awaited decision changes (new turn or another player must act).
function updateTurn() {
  if (table.status !== 'playing' || !table.game) { table.turn = null; return; }
  const seat = E.actor(table.game);
  const key = `${table.game.turnId}:${seat}:${table.game.phase === 'stack' ? 's' : table.game.phase === 'roulette' ? 'r' : 'p'}`;
  if (table.turn && table.turn.key === key) return;
  table.turn = { key, seat, deadline: Math.max(Date.now(), table.animUntil) + TURN_MS };
}

// Remaining time shown to clients; only humans who are not on auto-play get a visible timer.
function turnInfo() {
  if (table.status !== 'playing' || !table.turn) return null;
  const p = findPlayer(table.seatTokens[table.turn.seat]);
  if (!p || p.bot || p.auto) return null;
  return { seat: table.turn.seat, leftMs: Math.max(0, table.turn.deadline - Date.now()), totalMs: TURN_MS };
}

function broadcast(events = []) {
  const timer = turnInfo();
  for (const [sid, token] of sockets) {
    const s = io.sockets.sockets.get(sid);
    if (!s) continue;
    const me = findPlayer(token);
    const seat = token ? seatOf(token) : -1;
    s.emit('state', {
      status: table.status, round: table.round,
      me: me ? { id: token.slice(0, 8), name: me.name, seat, host: token === table.hostToken } : null,
      players: publicPlayers(),
      view: table.game ? E.viewFor(table.game, seat >= 0 ? seat : null) : null,
      timer, events: E.eventsFor(events, seat >= 0 ? seat : null)
    });
  }
}

// ---- game flow ----

function startRound() {
  const seated = table.players.slice(0, MAX_SEATS);
  if (seated.length < 2) throw new Error('Cần ít nhất 2 người chơi');
  table.round++;
  // rotate who starts each round
  const shift = (table.round - 1) % seated.length;
  const order = seated.slice(shift).concat(seated.slice(0, shift));
  table.seatTokens = order.map(p => p.token);
  table.game = E.newRound(order.map(p => ({ name: p.name })));
  table.status = 'playing';
  const events = [{ type: 'roundStart' }];
  table.animUntil = Date.now() + Pace.totalMs(events);
  table.turn = null; updateTurn();
  broadcast(events);
  afterChange();
}

function applyAction(seat, action) {
  const events = E.act(table.game, seat, action);
  if (table.game.phase === 'over') {
    table.status = 'roundEnd';
    const winnerToken = table.seatTokens[table.game.winner];
    table.scores[winnerToken] = (table.scores[winnerToken] || 0) + table.game.points;
  }
  table.animUntil = Math.max(Date.now(), table.animUntil) + Pace.totalMs(events);
  updateTurn();
  broadcast(events);
  afterChange();
}

let autoTimer = null;
function afterChange() {
  saveSnapshot();
  clearTimeout(autoTimer);
  if (table.status !== 'playing') return;
  const seat = E.actor(table.game);
  if (seat == null) return;
  const p = findPlayer(table.seatTokens[seat]);
  if (!p) return;
  updateTurn();
  const now = Date.now();
  const animLeft = Math.max(0, table.animUntil - now);
  const timeLeft = table.turn.deadline - now;
  let delay;
  if (p.bot || p.auto) delay = Math.max(BOT_DELAY_MS, animLeft + 500);
  else if (timeLeft <= 0) delay = Math.max(BOT_DELAY_MS, animLeft + 300);   // timed out: finish the turn for them
  else if (!p.connected) delay = Math.max(BOT_DELAY_MS, Math.min(timeLeft, GRACE_MS - (now - (p.lastSeen || 0))));
  else delay = timeLeft;
  const turnId = table.game.turnId, phase = table.game.phase;
  autoTimer = setTimeout(() => {
    if (table.status !== 'playing' || table.game.turnId !== turnId || table.game.phase !== phase) { afterChange(); return; }
    if (E.actor(table.game) !== seat) { afterChange(); return; }
    try { applyAction(seat, Bot.decide(table.game, seat)); }
    catch (e) { console.error('auto-play error', e); }
  }, delay);
}

// ---- sockets ----

io.on('connection', socket => {
  const fail = (msg) => socket.emit('toast', { type: 'error', text: msg });
  const me = () => findPlayer(sockets.get(socket.id));
  const isHost = () => sockets.get(socket.id) === table.hostToken;
  sockets.set(socket.id, null);

  socket.on('hello', ({ token, name } = {}) => {
    let p = token && findPlayer(token);
    if (p && !p.bot) {
      p.connected = true; p.socketId = socket.id; p.lastSeen = Date.now();
      if (name && table.status === 'lobby') p.name = String(name).slice(0, 16);
    } else if (table.status === 'lobby' && table.players.length < MAX_SEATS && name) {
      p = { token: newToken(), name: String(name).slice(0, 16) || 'Người chơi', bot: false,
        socketId: socket.id, connected: true, auto: false, lastSeen: Date.now() };
      table.players.push(p);
    } else {
      p = null; // spectator
    }
    sockets.set(socket.id, p ? p.token : null);
    socket.emit('welcome', { token: p ? p.token : null, spectator: !p });
    ensureHost();
    broadcast();
    afterChange();
  });

  socket.on('claimSeat', ({ id } = {}) => {
    // Reclaim a disconnected seat from another browser (host must approve by being the one who asks, or seat is offline)
    const p = table.players.find(x => !x.bot && x.token.startsWith(String(id)) && !x.connected);
    if (!p) return fail('Không lấy lại được ghế này');
    p.connected = true; p.socketId = socket.id; p.lastSeen = Date.now();
    sockets.set(socket.id, p.token);
    socket.emit('welcome', { token: p.token, spectator: false });
    ensureHost(); broadcast(); afterChange();
  });

  socket.on('addBot', () => {
    if (!isHost() || table.status !== 'lobby') return;
    if (table.players.length >= MAX_SEATS) return fail('Bàn đã đủ 8 ghế');
    const used = new Set(table.players.map(p => p.name));
    const name = BOT_NAMES.find(n => !used.has(n)) || `Bot ${table.players.length + 1}`;
    table.players.push({ token: newToken(), name, bot: true, connected: true, auto: true });
    broadcast(); saveSnapshot();
  });

  socket.on('kick', ({ id } = {}) => {
    if (!isHost() || table.status !== 'lobby') return;
    const i = table.players.findIndex(p => p.token.startsWith(String(id)) && p.token !== table.hostToken);
    if (i >= 0) table.players.splice(i, 1);
    broadcast(); saveSnapshot();
  });

  socket.on('toggleAuto', ({ id } = {}) => {
    if (!isHost()) return;
    const p = table.players.find(x => x.token.startsWith(String(id)) && !x.bot);
    if (p) { p.auto = !p.auto; broadcast(); afterChange(); }
  });

  socket.on('start', () => {
    if (!isHost() || table.status === 'playing') return;
    try { startRound(); } catch (e) { fail(e.message); }
  });

  socket.on('backToLobby', () => {
    if (!isHost() || table.status !== 'roundEnd') return;
    table.status = 'lobby'; table.game = null; table.seatTokens = [];
    broadcast(); saveSnapshot();
  });

  socket.on('resetScores', () => {
    if (!isHost() || table.status === 'playing') return;
    table.scores = {}; table.round = 0; broadcast(); saveSnapshot();
  });

  socket.on('act', (action = {}) => {
    const p = me();
    if (!p || table.status !== 'playing') return;
    const seat = seatOf(p.token);
    if (seat < 0) return;
    p.lastSeen = Date.now();
    try { applyAction(seat, action); }
    catch (e) { fail(e.message); }
  });

  // Test hook, only with TOIBEN_DEBUG=1: move matching cards from the draw pile into your hand.
  if (process.env.TOIBEN_DEBUG === '1') socket.on('debugGive', ({ cards = [] } = {}) => {
    const p = me(); const seat = p ? seatOf(p.token) : -1;
    if (seat < 0 || !table.game) return;
    for (const want of cards) {
      const i = table.game.drawPile.findIndex(c => c.color === want.color && c.kind === want.kind && (want.value == null || c.value === want.value));
      if (i >= 0) table.game.seats[seat].hand.push(table.game.drawPile.splice(i, 1)[0]);
    }
    broadcast();
  });

  socket.on('emote', ({ name } = {}) => {
    const p = me();
    if (!p || typeof name !== 'string' || !/^[\w.-]+$/.test(name)) return;
    const now = Date.now();
    if ((table.emoteCooldown[p.token] || 0) > now) return;
    table.emoteCooldown[p.token] = now + 1500;
    io.emit('emote', { id: p.token.slice(0, 8), seat: seatOf(p.token), name });
  });

  socket.on('disconnect', () => {
    const p = me();
    sockets.delete(socket.id);
    if (p && p.socketId === socket.id) {
      p.connected = false; p.lastSeen = Date.now();
      if (table.status === 'lobby') {
        // keep seat a short while so a refresh doesn't drop you
        setTimeout(() => {
          if (!p.connected && table.status === 'lobby') {
            table.players = table.players.filter(x => x !== p);
            ensureHost(); broadcast(); saveSnapshot();
          }
        }, 15000);
      }
      ensureHost(); broadcast(); afterChange();
    }
  });
});

loadSnapshot();
server.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log('\n  CHƠI TỚI BẾN đang chạy!');
  console.log(`  Máy này:      http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  Trong mạng LAN: http://${ip}:${PORT}`);
  console.log('  Nhấn Ctrl+C để tắt.\n');
});
