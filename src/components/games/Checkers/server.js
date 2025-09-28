// Checkers WS server — mirrors Connect Four matchmaking + stakes
const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

/* ======= Basic Checkers engine (simplified) ======= */
class CheckersGame {
  constructor(size=8) {
    this.size=size;
    this.board = Array.from({length:size},()=>Array(size).fill(null));
    for (let r=0;r<3;r++) for (let c=0;c<size;c++) if((r+c)%2===1) this.board[r][c] = { owner:'Player 2', king:false };
    for (let r=size-3;r<size;r++) for (let c=0;c<size;c++) if((r+c)%2===1) this.board[r][c] = { owner:'Player 1', king:false };
    this.currentPlayer='Player 1';
    this.winner=null;
  }
  cloneBoard(){ return this.board.map(row=>row.slice()); }
  stepDirsForPiece(pc){
    if(!pc) return [];
    if(pc.king) return [[1,-1],[1,1],[-1,-1],[-1,1]];
    const dir = pc.owner==='Player 1' ? -1 : 1;
    return [[dir,-1],[dir,1]];
  }
  validMoves(r,c){
    const me=this.board[r][c]; if(!me) return [];
    const out=[]; const steps=this.stepDirsForPiece(me);
    for(const [dr,dc] of steps){ const rr=r+dr, cc=c+dc; if(rr>=0&&rr<this.size&&cc>=0&&cc<this.size&&this.board[rr][cc]==null) out.push({r2:rr,c2:cc}); }
    for(const [dr,dc] of steps){ const mr=r+dr, mc=c+dc, rr=r+2*dr, cc=c+2*dc; if(rr>=0&&rr<this.size&&cc>=0&&cc<this.size&&this.board[mr]?.[mc] && this.board[mr][mc].owner!==me.owner && this.board[rr][cc]==null) out.push({r2:rr,c2:cc, cap:{r:mr,c:mc}}); }
    // forced capture: if captures exist, filter out non-captures
    const caps = out.filter(m=>m.cap);
    return caps.length? caps : out;
  }
  anyMovesFor(player){
    for(let r=0;r<this.size;r++) for(let c=0;c<this.size;c++){
      const pc=this.board[r][c];
      if(pc && pc.owner===player){ if(this.validMoves(r,c).length) return true; }
    }
    return false;
  }
  makeMove(r,c,r2,c2){
    if(this.winner) return null;
    if(!this.board[r]?.[c]) return null; if(this.board[r][c].owner!==this.currentPlayer) return null;
    const moves = this.validMoves(r,c); const mv = moves.find(m=>m.r2===r2&&m.c2===c2); if(!mv) return null;
    const b=this.board;
    b[r2][c2]=b[r][c]; b[r][c]=null; if(mv.cap){ b[mv.cap.r][mv.cap.c]=null; }
    // promotion to king
    if (b[r2][c2].owner==='Player 1' && r2===0) { b[r2][c2]={...b[r2][c2], king:true}; }
    if (b[r2][c2].owner==='Player 2' && r2===this.size-1) { b[r2][c2]={...b[r2][c2], king:true}; }
    // multi-jump chaining: if this was a capture, see if further captures exist from new position
    if (mv.cap){
      const more = this.validMoves(r2,c2).filter(m=>m.cap);
      if (more.length===0){
        const opp = this.currentPlayer==='Player 1'?'Player 2':'Player 1';
        if(!b.flat().some(x=>x&&x.owner===opp) || !this.anyMovesFor(opp)) this.winner=this.currentPlayer;
        this.currentPlayer = opp;
      } else {
        // force same player to continue; do not toggle currentPlayer
        // UI/clients will send subsequent makeMove from r2,c2
      }
    } else {
      const opp = this.currentPlayer==='Player 1'?'Player 2':'Player 1';
      if(!b.flat().some(x=>x&&x.owner===opp) || !this.anyMovesFor(opp)) this.winner=this.currentPlayer;
      this.currentPlayer = opp;
    }
    return { r, c, r2, c2 };
  }
}

/* ---------- Helpers: color / avatar ---------- */
function normalizeColor(c) { if (typeof c !== 'string') return null; const s=c.trim(); return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)?s:null; }
function pickAlternateColor(taken){ const p=['#ef4444','#3b82f6','#22c55e','#eab308','#a855f7','#f97316','#111827','#6b7280']; const t=(taken||'').toLowerCase(); return p.find(x=>x.toLowerCase()!==t)||'#3b82f6'; }
const AVATAR_IDS=new Set(['rocket','dragon','brain','fox','lion','panda','penguin','alien']);
function normalizeAvatar(a){ if(typeof a!=='string') return null; const id=a.trim().toLowerCase(); return AVATAR_IDS.has(id)?id:null; }

/* ---------- Server setup ---------- */
const PORT = Number(process.env.CHECKERS_PORT) || 3011;
const app = express(); app.use(cors()); app.use(express.json());
app.get('/', (_req,res)=>res.send('Checkers WS server running'));
app.get('/health', (_req,res)=>res.json({ok:true,ts:Date.now()}));
// Diagnostics: list rooms
app.get('/rooms', (_req,res)=>{
  try{
    const list = [...rooms.values()].map(r=>({ id:r.id, usernames:r.usernames, paused:!!r.paused, players:[ !!r.players?.[0] && isOpen(r.players[0]), !!r.players?.[1] && isOpen(r.players[1]) ], countdown: r.countdownValue }));
    res.json({ ok:true, list });
  }catch(e){ res.status(500).json({ ok:false, error: String(e.message||e) }); }
});

let wss = null;
let standaloneServer = null;

// Simple file logger for diagnostics
const LOG_DIR = path.join(__dirname, '../../../..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'checkers.log');
function logLine(msg){
  try{
    if(!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    fs.appendFileSync(LOG_FILE, line);
  }catch{}
}

let nextRoomId=1; const waiting=new Set(); const rooms=new Map(); const state=new WeakMap();
const isOpen = ws => ws && ws.readyState === WebSocket.OPEN;
const send=(ws,p)=>{ if(!isOpen(ws)) return; try{ ws.send(JSON.stringify(p)); }catch{} };
const broadcast=(room,p)=>{ for(const ws of room.players) send(ws,p); };
function addToWaiting(ws){ if(!isOpen(ws)) return false; waiting.add(ws); return true; }
function takePair(){ for(const ws of [...waiting]) if(!isOpen(ws)) waiting.delete(ws); const live=[...waiting]; if(live.length<2) return null; const a=live[0],b=live.find(x=>x!==a); if(!b) return null; waiting.delete(a); waiting.delete(b); return [a,b]; }

function stakesFor(room){ const[a,b]=room.players; const sa=state.get(a)?.stake; const sb=state.get(b)?.stake; return { 'Player 1': (typeof sa==='number'?sa:'—'),'Player 2': (typeof sb==='number'?sb:'—') }; }

function startCountdown(roomId){
  const room=rooms.get(roomId); if(!room) return; room.countdownValue=5;
  const payload={ usernames:room.usernames, colors:room.colors, avatars:room.avatars, stakes:stakesFor(room), type:'paired' };
  const [a,b]=room.players;
  send(a,{...payload,you:1, token: room.tokens?.[1]});
  send(b,{...payload,you:2, token: room.tokens?.[2]});
  sendCountdown(room);
  room.countdownTimer=setInterval(()=>{
    const r=rooms.get(roomId); if(!r) return; if(!r.players.every(isOpen)){ cancelCountdown(roomId,true); return; }
    r.countdownValue-=1; if(r.countdownValue>0){ sendCountdown(r); return; }
    clearInterval(r.countdownTimer); r.countdownTimer=null; r.countdownValue=null;
    const start={ type:'startGame', currentPlayer:r.game.currentPlayer, board: r.game.board, usernames:r.usernames, colors:r.colors, avatars:r.avatars, stakes:stakesFor(r), gameId: r.id };
    const[sa,sb]=r.players;
    send(sa,{...start,playerNumber:1, token: r.tokens?.[1]});
    send(sb,{...start,playerNumber:2, token: r.tokens?.[2]});
    saveRooms();
  },1000);
}
function sendCountdown(room){ if(room.countdownValue==null) return; broadcast(room,{ type:'countdown', value:room.countdownValue }); }
function cancelCountdown(roomId, notify){ const room=rooms.get(roomId); if(!room) return; if(room.countdownTimer){ clearInterval(room.countdownTimer); room.countdownTimer=null; } room.countdownValue=null; if(notify){ for(const ws of room.players) if(isOpen(ws)) send(ws,{type:'opponentLeft'}); } destroyRoom(roomId); }

// Persistence: save rooms so paused games survive restarts
const SAVE_FILE = process.env.CHECKERS_SAVE_FILE || path.join(__dirname, 'rooms.save.json');
function serializeRoom(room){
  try{
    return {
      id: room.id,
      board: room.game.board,
      currentPlayer: room.game.currentPlayer,
      winner: room.game.winner||null,
      usernames: room.usernames,
      userIds: room.userIds || null,
      colors: room.colors,
      avatars: room.avatars,
      tokens: room.tokens,
      paused: !!room.paused,
      lastActivity: room.lastActivity || Date.now()
    };
  }catch{ return null; }
}
function saveRooms(){
  try{
    const payload = { nextRoomId, rooms: [...rooms.values()].map(serializeRoom).filter(Boolean) };
    fs.writeFileSync(SAVE_FILE, JSON.stringify(payload));
  }catch{}
}
function restoreRooms(){
  try{
    if(!fs.existsSync(SAVE_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(SAVE_FILE,'utf8'));
    nextRoomId = Math.max(1, Number(raw.nextRoomId)||1);
    const list = Array.isArray(raw.rooms) ? raw.rooms : [];
    for(const s of list){
      try{
        const game = new CheckersGame();
        // Restore board/currentPlayer/winner
        if(Array.isArray(s.board) && s.board.length===game.size){ game.board = s.board; }
        if(s.currentPlayer==='Player 1' || s.currentPlayer==='Player 2') game.currentPlayer = s.currentPlayer;
        if(s.winner==='Player 1' || s.winner==='Player 2') game.winner = s.winner;
        const room = {
          id: Number(s.id)||nextRoomId++,
          game,
          players: [null, null],
          usernames: s.usernames || { 'Player 1':'Player 1', 'Player 2':'Player 2' },
          userIds: (s.userIds && (typeof s.userIds['Player 1'] !== 'undefined' || typeof s.userIds['Player 2'] !== 'undefined')) ? s.userIds : { 'Player 1': null, 'Player 2': null },
          colors: s.colors || { 'Player 1':'#ef4444', 'Player 2':'#3b82f6' },
          avatars: s.avatars || { 'Player 1':'rocket', 'Player 2':'alien' },
          tokens: (s.tokens && s.tokens[1] && s.tokens[2]) ? s.tokens : { 1: uuidv4(), 2: uuidv4() },
          rematchVotes: new Set(),
          countdownTimer: null,
          countdownValue: null,
          paused: !!s.paused,
          lastActivity: Number(s.lastActivity)||Date.now()
        };
        rooms.set(room.id, room);
      }catch{}
    }
  }catch{}
}
restoreRooms();

function broadcastPresence(room){
  try{
    if(!room) return;
    const present = { 'Player 1': isOpen(room.players[0]), 'Player 2': isOpen(room.players[1]) };
    broadcast(room, { type:'presence', present });
  }catch{}
}

function createRoom(a,b){
  if(!isOpen(a)||!isOpen(b)||a===b) return;
  const id=nextRoomId++; const game=new CheckersGame();
  const stA=state.get(a)||{}; const stB=state.get(b)||{};
  const nameA=(stA.username||'Player 1').toString().slice(0,40)||'Player 1';
  const nameB=(stB.username||'Player 2').toString().slice(0,40)||'Player 2';
  const usernames={ 'Player 1':nameA,'Player 2':nameB};
  let colA=normalizeColor(stA.desiredColor)||'#ef4444';
  let colB=normalizeColor(stB.desiredColor)||'#3b82f6';
  if(colB.toLowerCase()===colA.toLowerCase()) colB=pickAlternateColor(colA);
  const colors={ 'Player 1':colA,'Player 2':colB };
  const avA=normalizeAvatar(stA.avatar)||'rocket';
  const avB=normalizeAvatar(stB.avatar)||'alien';
  const avatars={ 'Player 1':avA,'Player 2':avB };
  const userIds={ 'Player 1': Number.isFinite(stA.userId)?stA.userId:null, 'Player 2': Number.isFinite(stB.userId)?stB.userId:null };
  const tokens = { 1: uuidv4(), 2: uuidv4() };
  rooms.set(id,{ id, game, players:[a,b], usernames, userIds, colors, avatars, tokens, rematchVotes:new Set(), countdownTimer:null, countdownValue:null, paused:false, lastActivity: Date.now() });
  state.set(a,{...stA,roomId:id,playerNumber:1,alive:true}); state.set(b,{...stB,roomId: id,playerNumber:2,alive:true});
  saveRooms();
  startCountdown(id);
}
function destroyRoom(id){ const room=rooms.get(id); if(!room) return; if(room.countdownTimer){ clearInterval(room.countdownTimer); room.countdownTimer=null; } for(const ws of room.players){ const st=state.get(ws); if(st){ delete st.roomId; delete st.playerNumber; } } rooms.delete(id); saveRooms(); }
function disconnect(ws){
  waiting.delete(ws);
  const st=state.get(ws);
  if(st?.roomId){
    const room=rooms.get(st.roomId);
    if(room){
      if(room.countdownValue!=null){ cancelCountdown(room.id,true); state.delete(ws); return; }
      room.paused=true; room.lastActivity=Date.now();
      // Detach this socket from the room so presence reflects correctly
      if(st.playerNumber===1 || st.playerNumber===2){ room.players[st.playerNumber-1] = null; }
      const side = st.playerNumber===1 ? 'Player 1' : 'Player 2';
      broadcast(room,{ type:'playerLeft', side });
      broadcastPresence(room);
      saveRooms();
    }
  }
  state.delete(ws);
}
setInterval(()=>{ if(!wss) return; for(const ws of wss.clients){ const st=state.get(ws)||{}; if(st.alive===false){ try{ws.terminate();}catch{} disconnect(ws); continue; } st.alive=true; state.set(ws,st); try{ws.ping();}catch{} } for(const ws of [...waiting]) if(!isOpen(ws)) waiting.delete(ws); },30000);

function attachHandlers(){
if(!wss) return;
wss.on('connection',(ws)=>{
  try{ console.log('[ws] client connected'); logLine('[ws] client connected'); }catch{}
  state.set(ws,{alive:true});
  ws.on('pong',()=>{ const st=state.get(ws); if(st) st.alive=true; });

  ws.on('message',(raw)=>{
    let data; try{ data=JSON.parse(raw.toString()); }catch{ return; }
    const st = state.get(ws) || {};

    switch(data.type){
      case 'quickChat':{
        const st1 = state.get(ws) || {};
        if(!st1.roomId) break;
        const now = Date.now();
        st1._lastChatTs = st1._lastChatTs || 0;
        if(now - st1._lastChatTs < 700){ break; }
        st1._lastChatTs = now; state.set(ws, st1);
        const room = rooms.get(st1.roomId); if(!room) break;
        const side = st1.playerNumber===1?'Player 1':'Player 2';
        const name = (room.usernames && room.usernames[side]) || side;
        const textRaw = (data.text||'').toString();
        const text = textRaw.slice(0, 80);
        broadcast(room, { type:'quickChat', from: side, username: name, text, ts: now });
        break;
      }
      case 'joinSavedGame':{
        const id = Number(data.gameId)||0; const token = (data.token||'').toString();
        const room = rooms.get(id); if(!room){ send(ws,{ type:'savedDenied' }); break; }
        // Remove from any matchmaking
        waiting.delete(ws);
        let slot=null; if(token===room.tokens?.[1]) slot=1; else if(token===room.tokens?.[2]) slot=2;
        // If token slots points to an already-occupied live socket, deny so client can fall back to claim
        if (slot) {
          const existing = room.players[slot-1];
          if (existing && existing!==ws && isOpen(existing)) { send(ws,{ type:'savedDenied' }); break; }
        }
        if(!slot){
          const uid = Number(data.userId);
          if(Number.isFinite(uid) && room.userIds){
            if(room.userIds['Player 1'] === uid && room.userIds['Player 2'] !== uid) slot=1;
            else if(room.userIds['Player 2'] === uid && room.userIds['Player 1'] !== uid) slot=2;
            else if(room.userIds['Player 1'] === uid && room.userIds['Player 2'] === uid){
              const p1=room.players[0], p2=room.players[1];
              if(!isOpen(p1)) slot=1; else if(!isOpen(p2)) slot=2;
            }
          }
        }
        if(!slot){
          const name = (data.username || state.get(ws)?.username || '').toString().slice(0,40);
          if(name){ const u=room.usernames||{}; const m1=u['Player 1']===name; const m2=u['Player 2']===name; if(m1 && !m2) slot=1; else if(!m1 && m2) slot=2; else if(m1 && m2){ const p1=room.players[0], p2=room.players[1]; if(!isOpen(p1)) slot=1; else if(!isOpen(p2)) slot=2; }
          }
        }
        if(!slot){ if(data.allowAny===true){ const p1=room.players[0], p2=room.players[1]; if(!isOpen(p1)) slot=1; else if(!isOpen(p2)) slot=2; } }
        if(!slot){ send(ws,{ type:'savedDenied' }); break; }
        // Final guard: do not replace a live occupant
        const existing = room.players[slot-1];
        if (existing && existing!==ws && isOpen(existing)) { send(ws,{ type:'savedDenied' }); break; }
        room.players[slot-1]=ws; const sideKey = (slot===1)?'Player 1':'Player 2';
        if(!room.userIds) room.userIds={'Player 1':null,'Player 2':null};
        const uid1=Number(data.userId); if(Number.isFinite(uid1)) room.userIds[sideKey]=uid1;
        if(typeof data.username==='string' && data.username){ if(!room.usernames) room.usernames={'Player 1':'Player 1','Player 2':'Player 2'}; room.usernames[sideKey]=data.username.toString().slice(0,40); }
        room.paused=true; room.lastActivity=Date.now(); state.set(ws,{ ...(state.get(ws)||{}), roomId: room.id, playerNumber: slot, alive:true });
        send(ws,{ type:'savedQueued', you: slot, usernames: room.usernames, colors: room.colors, avatars: room.avatars, gameId: room.id, token: room.tokens?.[slot] });
        broadcastPresence(room); saveRooms();
        if(room.players.every(isOpen)){
          if(!room.countdownTimer && room.countdownValue==null){ startCountdown(room.id); }
        } else {
          setTimeout(()=>{
            const rr = rooms.get(room.id);
            if(rr && rr.players && rr.players.every(isOpen) && !rr.countdownTimer && rr.countdownValue==null){ startCountdown(rr.id); }
          }, 350);
        }
        break;
      }
      case 'resumeGame':{
        const id = Number(data.gameId)||0; const token = (data.token||'').toString();
        const room = rooms.get(id); if(!room) { send(ws,{type:'resumeDenied'}); break; }
        let slot=null; if(token===room.tokens?.[1]) slot=1; else if(token===room.tokens?.[2]) slot=2; if(!slot){ send(ws,{type:'resumeDenied'}); break; }
        room.players[slot-1]=ws; room.paused=false; room.lastActivity=Date.now(); state.set(ws,{ ...st, roomId: room.id, playerNumber: slot, alive:true });
        const start={ type:'startGame', currentPlayer: room.game.currentPlayer, board: room.game.board, usernames: room.usernames, colors: room.colors, avatars: room.avatars, stakes: stakesFor(room), gameId: room.id };
        send(ws,{...start, playerNumber: slot, token: room.tokens?.[slot]});
        const opp = room.players[(slot===1)?1:0]; if(isOpen(opp)) send(opp,{ type:'playerBack', side: slot===1?'Player 1':'Player 2' });
        broadcastPresence(room); saveRooms();
        break;
      }
      case 'listMySavedGames':{
        // Throttle a bit to reduce spam while the client is reconnecting
        try{ const st1=state.get(ws)||{}; const now=Date.now(); if(st1._lastListTs && (now-st1._lastListTs)<800) break; st1._lastListTs=now; state.set(ws,st1); }catch{}
        const name = (data.username || state.get(ws)?.username || '').toString().slice(0,40);
        const uid = Number(data.userId);
        const out=[];
        for(const room of rooms.values()){
          let you=null; if(Number.isFinite(uid) && room.userIds){ if(room.userIds['Player 1']===uid) you=1; else if(room.userIds['Player 2']===uid) you=2; }
          if(!you && name){ const u=room.usernames||{}; if(u['Player 1']===name) you=1; else if(u['Player 2']===name) you=2; }
          if(you){ out.push({ gameId: room.id, you, usernames: room.usernames, paused: !!room.paused }); }
        }
        send(ws,{ type:'mySavedGames', list: out });
        break;
      }
      case 'finishSavedGame':{
        const id = Number(data.gameId)||0; const room = rooms.get(id);
        if(!room){ send(ws,{ type:'savedRemoved', gameId: id, ok:false }); break; }
        const uid = Number(data.userId); const name=(data.username || state.get(ws)?.username || '').toString().slice(0,40);
        let authorized=false; if(Number.isFinite(uid) && room.userIds){ if(room.userIds['Player 1']===uid || room.userIds['Player 2']===uid) authorized=true; }
        if(!authorized && name){ const u=room.usernames||{}; if(u['Player 1']===name || u['Player 2']===name) authorized=true; }
        if(!authorized){ send(ws,{ type:'savedDenied' }); break; }
        destroyRoom(id); send(ws,{ type:'savedRemoved', gameId: id, ok:true });
        break;
      }
      case 'claimSavedGame':{
        let id = Number(data.gameId)||0; let room = rooms.get(id);
        waiting.delete(ws);
        const uid = Number(data.userId);
        const nameRaw = (state.get(ws)?.username || data.username || '').toString();
        const name = nameRaw.slice(0,40);
        if(!Number.isFinite(uid) && !name){ send(ws,{ type:'savedDenied' }); break; }
        if(!room){
          const other = (data.otherUsername || '').toString().slice(0,40);
          const candidates = [];
          for(const r of rooms.values()){
            const u=r.usernames||{}; const ids=r.userIds||{};
            const hasYou = Number.isFinite(uid) ? (ids['Player 1']===uid || ids['Player 2']===uid) : (u['Player 1']===name || u['Player 2']===name);
            const hasOther = other ? (u['Player 1']===other || u['Player 2']===other) : true;
            if(hasYou && hasOther) candidates.push(r);
          }
          if(candidates.length){ candidates.sort((a,b)=> (Number(b.lastActivity||0)-Number(a.lastActivity||0)) || (Number(b.id)-Number(a.id)) ); room = candidates.find(r=>r.paused) || candidates[0]; id = room?.id||0; }
        }
        if(!room){ send(ws,{ type:'savedDenied' }); break; }
        const u=room.usernames||{}; const ids=room.userIds||{}; let slot=null;
        if(Number.isFinite(uid)){
          const m1 = ids['Player 1']===uid, m2 = ids['Player 2']===uid;
          if(m1 && !m2) slot=1; else if(!m1 && m2) slot=2; else if(m1 && m2){ const p1=room.players[0], p2=room.players[1]; if(!isOpen(p1)) slot=1; else if(!isOpen(p2)) slot=2; }
        }
        if(!slot && name){ const m1=u['Player 1']===name, m2=u['Player 2']===name; if(m1 && !m2) slot=1; else if(!m1 && m2) slot=2; else if(m1 && m2){ const p1=room.players[0], p2=room.players[1]; if(!isOpen(p1)) slot=1; else if(!isOpen(p2)) slot=2; } }
        if(!slot){ send(ws,{ type:'savedDenied' }); break; }
        const existing = room.players[slot-1];
        if(existing && existing!==ws && isOpen(existing)){
          const bothMatch = Number.isFinite(uid) ? ((room.userIds?.['Player 1']===uid) && (room.userIds?.['Player 2']===uid)) : ((room.usernames?.['Player 1']===name) && (room.usernames?.['Player 2']===name));
          if(bothMatch){ const alt=slot===1?2:1; const altExisting=room.players[alt-1]; if(!isOpen(altExisting)) slot=alt; else { send(ws,{ type:'savedDenied' }); break; } }
          else { send(ws,{ type:'savedDenied' }); break; }
        }
        room.players[slot-1]=ws; room.paused=true; room.lastActivity=Date.now();
        const sideKey=(slot===1)?'Player 1':'Player 2'; if(!room.userIds) room.userIds={'Player 1':null,'Player 2':null}; if(Number.isFinite(uid)) room.userIds[sideKey]=uid; if(typeof name==='string' && name){ if(!room.usernames) room.usernames={'Player 1':'Player 1','Player 2':'Player 2'}; room.usernames[sideKey]=name; }
        state.set(ws,{ ...(state.get(ws)||{}), roomId: room.id, playerNumber: slot, alive:true });
        send(ws,{ type:'savedQueued', you: slot, usernames: room.usernames, colors: room.colors, avatars: room.avatars, gameId: room.id, token: room.tokens?.[slot] });
        broadcastPresence(room); saveRooms();
        if(room.players.every(isOpen)){
          if(!room.countdownTimer && room.countdownValue==null){ startCountdown(room.id); }
        }
        break;
      }
      case 'joinGame': {
        if(st.roomId) return;
        const username=(data.username||'').toString().slice(0,40);
        const userId = Number(data.userId);
        const color=normalizeColor(data.color)||null;
        const avatar=normalizeAvatar(data.avatar)||null;
        let stake=null; if(typeof data.stake==='number'&&isFinite(data.stake)) stake=Math.max(0.01,Number(data.stake));
        st.username=username; if(Number.isFinite(userId)) st.userId=userId; st.desiredColor=color; st.avatar=avatar; st.stake=stake; state.set(ws,st);
        addToWaiting(ws); send(ws,{type:'queued'});
        const pair=takePair(); if(pair) createRoom(pair[0],pair[1]);
        break;
      }
      case 'makeMove': {
        if(!st.roomId) return; const room=rooms.get(st.roomId); if(!room) return; if(room.countdownValue!=null) return;
        const { r, c, r2, c2 } = data;
        if(!Number.isInteger(r)||!Number.isInteger(c)||!Number.isInteger(r2)||!Number.isInteger(c2)) return;
        const res = room.game.makeMove(r,c,r2,c2);
        if(res){
          broadcast(room,{ type:'gameUpdate', board: room.game.board, currentPlayer: room.game.currentPlayer, winner: room.game.winner||null, lastMove: res });
          saveRooms();
        }
        break;
      }
      case 'resetGame': {
        if(!st.roomId) return; const room=rooms.get(st.roomId); if(!room) return; room.game=new CheckersGame(); room.rematchVotes=new Set(); broadcast(room,{type:'resetAck'}); saveRooms(); break;
      }
      case 'rematchVote': {
        if(!st.roomId) return; const room=rooms.get(st.roomId); if(!room) return;
        if(typeof data.stake==='number'&&isFinite(data.stake)){ st.stake=Math.max(0.01,Number(data.stake)); state.set(ws,st); broadcast(room,{type:'stakes', stakes: stakesFor(room)}); }
        if(!room.rematchVotes) room.rematchVotes=new Set(); room.rematchVotes.add(st.playerNumber); broadcast(room,{type:'rematchUpdate', count: room.rematchVotes.size});
        if(room.rematchVotes.size>=2){ room.game=new CheckersGame(); room.rematchVotes=new Set(); broadcast(room,{type:'rematchStart'}); saveRooms(); }
        break;
      }
      case 'setUsername':{
        const name=(data.username||'').toString().slice(0,40); if(!name) break; st.username=name; state.set(ws,st);
        if(!st.roomId) break; const room=rooms.get(st.roomId); if(!room) break; const side=st.playerNumber===1?'Player 1':'Player 2';
        if(!room.usernames) room.usernames={'Player 1':'Player 1','Player 2':'Player 2'}; room.usernames[side]=name; broadcast(room,{ type:'usernames', usernames: room.usernames }); saveRooms();
        break;
      }
      case 'setAvatar':{
        let avatar=null; if(typeof data.avatar==='string'){ const s=data.avatar.trim().toLowerCase(); if(AVATAR_IDS.has(s)) avatar=s; }
        if(!avatar) break; st.avatar=avatar; state.set(ws,st);
        if(!st.roomId) break; const room=rooms.get(st.roomId); if(!room) break; const side=st.playerNumber===1?'Player 1':'Player 2';
        if(!room.avatars) room.avatars={'Player 1':'rocket','Player 2':'alien'}; room.avatars[side]=avatar; broadcast(room,{ type:'avatars', avatars: room.avatars }); saveRooms();
        break;
      }
      case 'setColor':{
        let color=null; if(typeof data.color==='string'){ const s=data.color.trim(); if(/^#[0-9a-fA-F]{6}$/.test(s)) color=s.toLowerCase(); }
        if(!color) break; st.desiredColor=color; state.set(ws,st);
        if(!st.roomId) break; const room=rooms.get(st.roomId); if(!room) break; const side=st.playerNumber===1?'Player 1':'Player 2';
        if(!room.colors) room.colors={'Player 1':'#ef4444','Player 2':'#3b82f6'}; room.colors[side]=color; broadcast(room,{ type:'colors', colors: room.colors }); saveRooms();
        break;
      }
      case 'leaveGame': {
        waiting.delete(ws);
        const s=state.get(ws);
        if(s?.roomId){
          const room=rooms.get(s.roomId);
          if(room){
            if(room.countdownValue!=null){ cancelCountdown(room.id,true); }
            else {
              room.paused=true; room.lastActivity=Date.now();
              if(s.playerNumber===1 || s.playerNumber===2){ room.players[s.playerNumber-1] = null; }
              const side = s.playerNumber===1?'Player 1':'Player 2';
              broadcast(room,{ type:'playerLeft', side });
              broadcastPresence(room);
              saveRooms();
            }
          }
          const st2 = state.get(ws) || {}; delete st2.roomId; delete st2.playerNumber; state.set(ws, st2);
        }
        break;
      }
      default: break;
    }
  });

  ws.on('close',()=>disconnect(ws));
  ws.on('error',()=>disconnect(ws));
});
}

if(process.env.UNIFIED_WS !== '1'){
  standaloneServer = http.createServer(app);
  wss = new WebSocket.Server({ server: standaloneServer });
  attachHandlers();
  standaloneServer.listen(PORT,'0.0.0.0',()=>{ console.log(`Checkers WS listening on http://0.0.0.0:${PORT}`); });
}

module.exports.attachUnified = function(server, path='/ws/checkers'){
  if(wss) return wss;
  wss = new WebSocket.Server({ noServer: true });
  attachHandlers();
  try{
    server.on('upgrade', (req, socket, head) => {
      try{
        if(!req || typeof req.url !== 'string') return; const u = req.url.split('?')[0];
        if(u !== path) return;
        wss.handleUpgrade(req, socket, head, (ws) => { wss.emit('connection', ws, req); });
      }catch{ try{ socket.destroy(); }catch{} }
    });
  }catch{}
  return wss;
};
