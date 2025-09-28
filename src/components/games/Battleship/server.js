// Battleship WS server — matchmaking + placement + turn-based firing
const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const PORT = Number(process.env.BATTLESHIP_PORT) || 3015;
const app = express(); app.use(cors()); app.use(express.json());
app.get('/',(_req,res)=>res.send('Battleship WS server running'));
app.get('/health',(_req,res)=>res.json({ok:true,ts:Date.now()}));
const server = http.createServer(app); const wss = new WebSocket.Server({ server });

// Simple file logger
const LOG_DIR = path.join(__dirname, '../../../..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'battleship.log');
function logLine(msg){ try{ if(!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR,{recursive:true}); fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);}catch{} }

const SIZE = 10;
const SHIPS = [5,4,3,3,2];

function inside(r,c){ return r>=0 && r<SIZE && c>=0 && c<SIZE; }
function cellsForShip(r,c,len,dir){ const out=[]; for(let i=0;i<len;i++){ const rr=r+(dir==='V'?i:0); const cc=c+(dir==='H'?i:0); out.push([rr,cc]); } return out; }
function validPlacement(ships){
  try{
    if(!Array.isArray(ships) || ships.length!==SHIPS.length) return false;
    const used = new Set();
    for(let i=0;i<ships.length;i++){
      const s = ships[i]||{}; const len = Number(s.len); const dir = s.dir==='V'?'V':'H'; const r=Number(s.r), c=Number(s.c);
      if(len!==SHIPS[i]) return false; if(!Number.isInteger(r)||!Number.isInteger(c)) return false;
      const cells=cellsForShip(r,c,len,dir);
      for(const [rr,cc] of cells){ if(!inside(rr,cc)) return false; const k=`${rr}-${cc}`; if(used.has(k)) return false; used.add(k); }
    }
    return true;
  }catch{ return false; }
}

function newRoom(a,b){
  return {
    id: 0,
    players: [a,b],
    usernames: { p1:'Player 1', p2:'Player 2' },
    userIds: { p1:null, p2:null },
    tokens: { 1: uuidv4(), 2: uuidv4() },
    countdownTimer: null,
    countdownValue: null,
    phase: 'place', // 'place' | 'battle' | 'over'
    boards: {
      p1: { ships:null, hits:new Set(), misses:new Set() },
      p2: { ships:null, hits:new Set(), misses:new Set() },
    },
    current: 1, // 1 or 2
    winner: null,
    lastShot: null,
    lastActivity: Date.now()
  };
}

let nextRoomId=1; const state=new WeakMap();
const waiting = new Set();
const rooms = new Map();
const isOpen=ws=>ws && ws.readyState===WebSocket.OPEN;
const send=(ws,p)=>{ if(!isOpen(ws)) return; try{ ws.send(JSON.stringify(p)); }catch{} };

function addToWaiting(ws){ if(!isOpen(ws)) return false; waiting.add(ws); return true; }
function takePair(){ for(const ws of [...waiting]) if(!isOpen(ws)) waiting.delete(ws); const live=[...waiting]; if(live.length>=2){ const a=live[0]; const b=live.find(x=>x!==a); if(b){ waiting.delete(a); waiting.delete(b); return [a,b]; } } return null; }

function sendCountdown(room){ if(room.countdownValue==null) return; for(const ws of room.players) send(ws,{ type:'countdown', value:room.countdownValue }); }
function cancelCountdown(room,notify){ if(room.countdownTimer){ clearInterval(room.countdownTimer); room.countdownTimer=null; } room.countdownValue=null; if(notify){ for(const ws of room.players) if(isOpen(ws)) send(ws,{ type:'opponentLeft' }); } rooms.delete(room.id); }
function startCountdown(room){ room.countdownValue=5; const [a,b]=room.players; const payload={ type:'paired', you:1, usernames:room.usernames, gameId: room.id, token: room.tokens[1] }; const payloadB={ ...payload, you:2, token: room.tokens[2] }; send(a,payload); send(b,payloadB); sendCountdown(room);
  room.countdownTimer=setInterval(()=>{ const r=rooms.get(room.id); if(!r) return; if(!r.players.every(isOpen)){ cancelCountdown(r,true); return; } r.countdownValue-=1; if(r.countdownValue>0){ sendCountdown(r); return; } clearInterval(r.countdownTimer); r.countdownTimer=null; r.countdownValue=null; // start
    const startA={ type:'startGame', you:1, phase:r.phase, gameId:r.id };
    const startB={ type:'startGame', you:2, phase:r.phase, gameId:r.id };
    send(r.players[0], startA); send(r.players[1], startB);
  },1000);
}

function broadcastPresence(room){ try{ const present={ p1:isOpen(room.players[0]), p2:isOpen(room.players[1]) }; for(const ws of room.players) send(ws,{ type:'presence', present }); }catch{}
}

function beginBattleIfReady(room){
  if(room.phase!=='place') return; if(!room.boards.p1.ships || !room.boards.p2.ships) return;
  room.phase='battle'; room.current=1; room.lastShot=null; room.winner=null;
  const a=room.players[0], b=room.players[1];
  send(a,{ type:'gameUpdate', phase:'battle', yourTurn: room.current===1 });
  send(b,{ type:'gameUpdate', phase:'battle', yourTurn: room.current===2 });
}

function shipCellsFromPlacement(ships){
  return ships.map(s=>({ len:Number(s.len), dir:(s.dir==='V'?'V':'H'), cells: cellsForShip(Number(s.r), Number(s.c), Number(s.len), (s.dir==='V'?'V':'H')) }));
}

function cellKey(r,c){ return `${r}-${c}`; }
function allShipCells(shipObj){ return shipObj.cells.map(([r,c])=>cellKey(r,c)); }

wss.on('connection',(ws)=>{
  state.set(ws,{ alive:true }); ws.on('pong',()=>{ const st=state.get(ws); if(st) st.alive=true; });
  send(ws,{ type:'hello', ts: Date.now() });
  ws.on('message',(raw)=>{
    let data; try{ data=JSON.parse(raw.toString()); }catch{ return; }
    const st=state.get(ws)||{};
    switch(data.type){
      case 'quickChat':{
        const st1=state.get(ws)||{}; if(!st1.roomId) break; const room=rooms.get(st1.roomId); if(!room) break; if(room.countdownValue!=null) break; const text=(data.text||'').toString().slice(0,80); const side=st1.playerNumber===2?'p2':'p1'; const name=room.usernames[side]||side; const payload={ type:'quickChat', from: side, username: name, text, ts: Date.now() }; for(const rws of room.players) if(isOpen(rws)) send(rws,payload); break; }
      case 'joinGame':{
        if(st.roomId) break; const username=(data.username||'').toString().slice(0,40); const userId=Number(data.userId); st.username=username; if(Number.isFinite(userId)) st.userId=userId; state.set(ws,st); addToWaiting(ws); send(ws,{type:'queued'}); const pair=takePair(); if(pair){ const room=newRoom(pair[0], pair[1]); room.id=nextRoomId++; // attach names
            const stA=state.get(room.players[0])||{}; const stB=state.get(room.players[1])||{}; room.usernames.p1=(stA.username||'Player 1'); room.usernames.p2=(stB.username||'Player 2'); room.userIds.p1=(Number.isFinite(stA.userId)?stA.userId:null); room.userIds.p2=(Number.isFinite(stB.userId)?stB.userId:null);
            rooms.set(room.id, room); state.set(room.players[0],{...stA,roomId:room.id,playerNumber:1}); state.set(room.players[1],{...stB,roomId:room.id,playerNumber:2}); startCountdown(room); }
        break; }
      case 'placeShips':{
        if(!st.roomId) break; const room=rooms.get(st.roomId); if(!room) break; if(room.phase!=='place') break; const ships=data.ships; if(!validPlacement(ships)) { send(ws,{ type:'placeDenied' }); break; }
        const side = st.playerNumber===2?'p2':'p1'; room.boards[side].ships = shipCellsFromPlacement(ships);
        send(ws,{ type:'placeAck' }); room.lastActivity=Date.now(); beginBattleIfReady(room); break; }
      case 'fire':{
        if(!st.roomId) break; const room=rooms.get(st.roomId); if(!room) break; if(room.phase!=='battle') break; const shooter=st.playerNumber; if(room.current!==shooter) break; const r=Number(data.r), c=Number(data.c); if(!Number.isInteger(r)||!Number.isInteger(c)||!inside(r,c)) break; const me = shooter===1?'p1':'p2'; const opp = shooter===1?'p2':'p1'; const k=cellKey(r,c);
        if(room.boards[opp].hits.has(k) || room.boards[opp].misses.has(k)){ send(ws,{ type:'gameUpdate', yourTurn:true, repeat:true }); break; }
        let hit=false, sunk=null; const ships=room.boards[opp].ships||[]; for(const ship of ships){ const cells=allShipCells(ship); if(cells.includes(k)){ hit=true; room.boards[opp].hits.add(k); // check sunk
            const allHit = cells.every(cc => room.boards[opp].hits.has(cc)); if(allHit) sunk = { len: ship.len, cells: ship.cells }; break; } }
        if(!hit) room.boards[opp].misses.add(k);
        room.lastShot={ by: shooter, r, c, hit, sunk }; room.lastActivity=Date.now();
        // victory?
        const oppAllCells = (room.boards[opp].ships||[]).flatMap(s=>allShipCells(s));
        const allHit = oppAllCells.length>0 && oppAllCells.every(cc => room.boards[opp].hits.has(cc));
        if(allHit){ room.phase='over'; room.winner=shooter; }
        // next turn if miss
        if(!hit && room.phase!=='over'){ room.current = shooter===1?2:1; }
        const a=room.players[0], b=room.players[1];
        // send masked updates
        send(a,{ type:'gameUpdate', phase: room.phase, yourTurn: room.current===1, lastShot: room.lastShot, you:1, winner: room.winner||null,
          youHits:[...room.boards.p2.hits], youMisses:[...room.boards.p2.misses], // what P1 sees on target board (P2 board)
          yourBoardHits:[...room.boards.p1.hits], yourBoardMisses:[...room.boards.p1.misses] });
        send(b,{ type:'gameUpdate', phase: room.phase, yourTurn: room.current===2, lastShot: room.lastShot, you:2, winner: room.winner||null,
          youHits:[...room.boards.p1.hits], youMisses:[...room.boards.p1.misses],
          yourBoardHits:[...room.boards.p2.hits], yourBoardMisses:[...room.boards.p2.misses] });
        break; }
      case 'leaveGame':{
        if(st.roomId){ const room=rooms.get(st.roomId); if(room){ room.phase='over'; room.winner = st.playerNumber===1?2:1; for(const rws of room.players) if(isOpen(rws)) send(rws,{ type:'opponentLeft' }); rooms.delete(room.id); } const st2=state.get(ws)||{}; delete st2.roomId; delete st2.playerNumber; state.set(ws,st2); }
        waiting.delete(ws); break; }
      default: break;
    }
  });
  ws.on('close',()=>{ const st=state.get(ws)||{}; waiting.delete(ws); if(st.roomId){ const room=rooms.get(st.roomId); if(room){ room.phase='over'; room.winner = st.playerNumber===1?2:1; for(const rws of room.players) if(isOpen(rws)) send(rws,{ type:'opponentLeft' }); rooms.delete(room.id); } } state.delete(ws); });
  ws.on('error',()=>{ try{ ws.close(); }catch{} });
});

setInterval(()=>{ for(const ws of wss.clients){ const st=state.get(ws)||{}; if(st.alive===false){ try{ws.terminate();}catch{}; continue; } st.alive=true; state.set(ws,st); try{ ws.ping(); }catch{} } }, 30000);

server.listen(PORT,'0.0.0.0',()=>{ console.log(`Battleship WS listening on http://0.0.0.0:${PORT}`); try{ logLine(`server listening on ${PORT}`);}catch{} });
