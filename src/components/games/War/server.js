// server.js — War (cards) PvP server with matchmaking, countdown, stakes, payouts-ready hooks

const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const cors = require('cors');
const { WarGame } = require('./WarGame'); // new class below

/* ---------- Server ---------- */
const PORT = process.env.PORT || 3001;
const app = express();

// tighten this as needed for your hosts
app.use(cors());

app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

/* ---------- Helpers ---------- */
const isOpen = (ws) => ws && ws.readyState === WebSocket.OPEN;
const send = (ws, payload) => { if (isOpen(ws)) { try { ws.send(JSON.stringify(payload)); } catch {} } };
const broadcast = (players, payload) => players.forEach(ws => send(ws, payload));

/* ---------- Matchmaking ---------- */
const waiting = new Set();
const rooms = new Map(); // id -> { id, players:[a,b], game, meta, countdownTimer, countdownValue }

function addToWaiting(ws) { if (isOpen(ws)) waiting.add(ws); }
function takePair() {
  for (const ws of [...waiting]) if (!isOpen(ws)) waiting.delete(ws);
  const arr = [...waiting];
  if (arr.length < 2) return null;
  const a = arr[0], b = arr.find(x => x !== a);
  if (!b) return null;
  waiting.delete(a); waiting.delete(b);
  return [a, b];
}

/* ---------- Room lifecycle ---------- */
let nextRoomId = 1;

function createRoom(a, b, metaA, metaB) {
  const id = nextRoomId++;
  const players = [a, b];

  const game = new WarGame(); // shuffles decks for both players
  const meta = {
    usernames: { 'Player 1': metaA.username || 'Player 1', 'Player 2': metaB.username || 'Player 2' },
    avatars:   { 'Player 1': metaA.avatar || 'rocket',      'Player 2': metaB.avatar || 'alien' },
    stakes:    { 'Player 1': Number(metaA.stake || 0),      'Player 2': Number(metaB.stake || 0) },
  };

  rooms.set(id, { id, players, game, meta, countdownTimer: null, countdownValue: null });

  // attach room id + role for each socket
  a.__roomId = id; a.__role = 'Player 1';
  b.__roomId = id; b.__role = 'Player 2';

  // paired (per-socket "you") + initial stakes
  send(a, { type: 'paired', you: 1, ...meta });
  send(b, { type: 'paired', you: 2, ...meta });

  // short countdown
  startCountdown(id);
}

function startCountdown(id) {
  const room = rooms.get(id);
  if (!room) return;
  room.countdownValue = 5;

  const tick = () => {
    const r = rooms.get(id);
    if (!r) return;
    if (!r.players.every(isOpen)) { cancelAndNotify(id); return; }

    if (r.countdownValue > 0) {
      broadcast(r.players, { type: 'countdown', value: r.countdownValue });
      r.countdownValue -= 1;
    } else {
      clearInterval(r.countdownTimer);
      r.countdownTimer = null;
      r.countdownValue = null;

      // start!
      const startPayload = {
        type: 'startGame',
        usernames: r.meta.usernames,
        avatars: r.meta.avatars,
        stakes: r.meta.stakes,
        scores: r.game.getScores(),
        currentRound: r.game.round,
      };
      // role numbers
      send(r.players[0], { ...startPayload, playerNumber: 1 });
      send(r.players[1], { ...startPayload, playerNumber: 2 });

      // immediately let both draw button be active
      broadcast(r.players, { type: 'turn', canDeal: true });
    }
  };

  room.countdownTimer = setInterval(tick, 1000);
  tick(); // first emit
}

function cancelAndNotify(id) {
  const room = rooms.get(id);
  if (!room) return;
  if (room.countdownTimer) clearInterval(room.countdownTimer);
  room.countdownTimer = null;
  room.countdownValue = null;
  broadcast(room.players, { type: 'opponentLeft' });
  destroyRoom(id);
}

function destroyRoom(id) {
  const room = rooms.get(id);
  if (!room) return;
  for (const ws of room.players) {
    if (ws) { delete ws.__roomId; delete ws.__role; }
  }
  rooms.delete(id);
}

/* ---------- Socket flow ---------- */
wss.on('connection', (ws) => {
  ws.__roomId = null; ws.__role = null; ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw.toString()); } catch { return; }

    switch (data.type) {
      case 'joinGame': {
        // meta sent from client
        const username = (data.username || '').toString().slice(0, 40);
        const avatar   = (data.avatar || 'rocket').toString().slice(0, 24);
        const stake    = Math.max(0, Number(data.stake || 0));

        // if already in a room, ignore
        if (ws.__roomId) return;

        ws.__meta = { username, avatar, stake };
        addToWaiting(ws);
        send(ws, { type: 'queued' });

        const pair = takePair();
        if (pair) {
          const [a, b] = pair;
          createRoom(a, b, a.__meta || {}, b.__meta || {});
        }
        break;
      }

      case 'deal': {
        const id = ws.__roomId;
        const room = id && rooms.get(id);
        if (!room) return;
        if (!room.players.every(isOpen)) { cancelAndNotify(id); return; }

        // Only run a round once per request burst; server is authoritative.
        const result = room.game.playRound(); // draws + compares
        // result: { p1Card, p2Card, roundWinner, scores, round, warDepth }
        broadcast(room.players, { type: 'round', ...result });

        if (result.matchWinner) {
          // final winner
          broadcast(room.players, { type: 'gameOver', winner: result.matchWinner, scores: result.scores });

          // leave payout to client wallet (each client pays/credits themselves)
          // Room can be destroyed after a short delay so users can tap Rematch.
          setTimeout(() => destroyRoom(id), 2000);
        } else {
          // enable another deal
          broadcast(room.players, { type: 'turn', canDeal: true });
        }
        break;
      }

      case 'rematchVote': {
        const id = ws.__roomId;
        const room = id && rooms.get(id);
        if (!room) return;
        room.rematchVotes = room.rematchVotes || new Set();
        room.rematchVotes.add(ws.__role);
        broadcast(room.players, { type: 'rematchUpdate', count: room.rematchVotes.size });
        if (room.rematchVotes.size >= 2) {
          room.game = new WarGame();
          room.rematchVotes.clear();
          broadcast(room.players, { type: 'rematchStart', scores: room.game.getScores(), currentRound: room.game.round });
          broadcast(room.players, { type: 'turn', canDeal: true });
        }
        break;
      }

      case 'leaveGame': {
        const id = ws.__roomId;
        if (id && rooms.get(id)) cancelAndNotify(id);
        waiting.delete(ws);
        break;
      }

      default: break;
    }
  });

  ws.on('close', () => {
    if (ws.__roomId && rooms.get(ws.__roomId)) cancelAndNotify(ws.__roomId);
    waiting.delete(ws);
  });

  ws.on('error', () => {
    if (ws.__roomId && rooms.get(ws.__roomId)) cancelAndNotify(ws.__roomId);
    waiting.delete(ws);
  });
});

/* ---------- Heartbeat ---------- */
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { try { ws.terminate(); } catch {} continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, 15000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`War WS server on http://0.0.0.0:${PORT}`);
});
