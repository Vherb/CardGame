const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

/* ----------------- Simple Checkers Engine ----------------- */
function defaultBoard() {
	const board = Array.from({ length: 8 }, () => Array(8).fill(null));
	for (let r = 0; r < 3; r++) {
		for (let c = 0; c < 8; c++) if ((r + c) % 2 === 1) board[r][c] = 'B';
	}
	for (let r = 5; r < 8; r++) {
		for (let c = 0; c < 8; c++) if ((r + c) % 2 === 1) board[r][c] = 'R';
	}
	return board;
}
class CheckersGame {
	constructor() {
		this.board = defaultBoard();
		this.turn = 'R';
		this.winner = null;
	}
	inBounds(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
	makeMove(move) {
		if (this.winner) return false;
		const { from, to } = move || {};
		if (!from || !to) return false;
		const [fr, fc] = from, [tr, tc] = to;
		if (!this.inBounds(fr, fc) || !this.inBounds(tr, tc)) return false;
		const p = this.board[fr][fc];
		if (!p || (p[0] !== this.turn)) return false;
		if (this.board[tr][tc] !== null) return false;
		const dr = tr - fr, dc = tc - fc;
		const isKing = p.length > 1 && p[1] === 'K';
		const forward = this.turn === 'R' ? 1 : -1;
		const canSimple = Math.abs(dr) === 1 && Math.abs(dc) === 1 && (isKing || dr === forward);
		const canJump = Math.abs(dr) === 2 && Math.abs(dc) === 2 && (isKing || dr === 2 * forward);
		if (!canSimple && !canJump) return false;
		if (canJump) {
			const mr = (fr + tr) >> 1, mc = (fc + tc) >> 1;
			const mid = this.board[mr][mc];
			if (!mid || mid[0] === this.turn) return false;
			this.board[mr][mc] = null;
		}
		this.board[fr][fc] = null;
		let newP = p;
		if ((this.turn === 'R' && tr === 7) || (this.turn === 'B' && tr === 0)) {
			newP = this.turn + 'K';
		}
		this.board[tr][tc] = newP;
		this.turn = this.turn === 'R' ? 'B' : 'R';
		this.updateWinner();
		return true;
	}
	updateWinner() {
		let rCount = 0, bCount = 0;
		for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
			const v = this.board[r][c];
			if (!v) continue;
			if (v[0] === 'R') rCount++; else bCount++;
		}
		if (rCount === 0) this.winner = 'B';
		else if (bCount === 0) this.winner = 'R';
		else this.winner = null;
	}
}

/* ----------------- Helpers ----------------- */
function normalizeColor(c) {
	if (typeof c !== 'string') return null;
	const s = c.trim();
	return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s) ? s : null;
}
function pickAlternateColor(taken) {
	const palette = ['#ef4444','#3b82f6','#22c55e','#eab308','#a855f7','#f97316','#111827','#6b7280'];
	const t = (taken || '').toLowerCase();
	return palette.find(p => p.toLowerCase() !== t) || '#3b82f6';
}
const AVATAR_IDS = new Set(['rocket','dragon','brain','fox','lion','panda','penguin','alien']);
function normalizeAvatar(a) {
	if (typeof a !== 'string') return null;
	const id = a.trim().toLowerCase();
	return AVATAR_IDS.has(id) ? id : null;
}

/* ----------------- Server State ----------------- */
const PORT = process.env.PORT || 3011;
const app = express();
app.use(cors());

app.get('/', (_req, res) => res.send('Checkers WS server running'));
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

let wss = null;               // WS server instance
let standaloneServer = null;  // standalone http server when not unified

let nextRoomId = 1;
const waiting = new Set();
const rooms = new Map();
const state = new WeakMap();
const isOpen = ws => ws && ws.readyState === WebSocket.OPEN;

const send = (ws, payload) => { if (isOpen(ws)) try { ws.send(JSON.stringify(payload)); } catch {} };
const broadcast = (room, payload) => { for (const ws of room.players) send(ws, payload); };

function addToWaiting(ws){ if (!isOpen(ws)) return false; waiting.add(ws); return true; }
function takePair(){ for (const ws of [...waiting]) if (!isOpen(ws)) waiting.delete(ws); const live=[...waiting]; if(live.length<2) return null; const a=live[0], b=live.find(x=>x!==a); if(!b) return null; waiting.delete(a); waiting.delete(b); return [a,b]; }

function startCountdown(roomId){
	const room = rooms.get(roomId); if (!room) return;
	room.countdownValue = 5;
	const payload = { usernames: room.usernames, colors: room.colors, avatars: room.avatars, type: 'paired' };
	const [a,b] = room.players;
	send(a, { ...payload, you: 1, token: room.tokens?.[1], gameId: room.id });
	send(b, { ...payload, you: 2, token: room.tokens?.[2], gameId: room.id });
	sendCountdown(room);
	room.countdownTimer = setInterval(() => {
		const r = rooms.get(roomId); if (!r) return;
		if (!r.players.every(isOpen)) { cancelCountdown(roomId, true); return; }
		r.countdownValue -= 1;
		if (r.countdownValue > 0) { sendCountdown(r); return; }
		clearInterval(r.countdownTimer); r.countdownTimer=null; r.countdownValue=null;
		const start = { type:'startGame', board: r.game.board, turn: r.game.turn, usernames: r.usernames, colors: r.colors, avatars: r.avatars };
		const [sa,sb]=r.players; send(sa, { ...start, playerNumber:1, token: r.tokens?.[1], gameId: r.id }); send(sb, { ...start, playerNumber:2, token: r.tokens?.[2], gameId: r.id });
	}, 1000);
}
function sendCountdown(room){ if (room.countdownValue == null) return; broadcast(room, { type:'countdown', value: room.countdownValue }); }
function cancelCountdown(roomId, notifyOpponent){ const room=rooms.get(roomId); if(!room) return; if(room.countdownTimer){ clearInterval(room.countdownTimer); room.countdownTimer=null; } room.countdownValue=null; if(notifyOpponent){ for(const ws of room.players) if(isOpen(ws)) send(ws,{ type:'opponentLeft' }); } const r=rooms.get(roomId); if(r){ r.paused=true; r.lastActivity=Date.now(); saveRooms(); } }

function createRoom(a,b){
	if(!isOpen(a)||!isOpen(b)||a===b) return;
	const id = nextRoomId++;
	const game = new CheckersGame();
	const stA = state.get(a)||{}, stB=state.get(b)||{};
	const nameA = (stA.username||'Red').toString().slice(0,40) || 'Red';
	const nameB = (stB.username||'Black').toString().slice(0,40) || 'Black';
	const usernames = { 'Player 1': nameA, 'Player 2': nameB };
	let colA = normalizeColor(stA.desiredColor)||'#ef4444'; let colB = normalizeColor(stB.desiredColor)||'#3b82f6'; if(colB.toLowerCase()===colA.toLowerCase()) colB=pickAlternateColor(colA);
	const colors = { 'Player 1': colA, 'Player 2': colB };
	const avA = normalizeAvatar(stA.avatar)||'rocket'; const avB = normalizeAvatar(stB.avatar)||'alien'; const avatars = { 'Player 1': avA, 'Player 2': avB };
	const userIds = { 'Player 1': Number.isFinite(stA.userId)?stA.userId:null, 'Player 2': Number.isFinite(stB.userId)?stB.userId:null };
	const tokens = { 1: uuidv4(), 2: uuidv4() };
	rooms.set(id, { id, game, players:[a,b], usernames, colors, avatars, userIds, tokens, rematchVotes:new Set(), countdownTimer:null, countdownValue:null, paused:false, lastActivity: Date.now() });
	state.set(a, { ...stA, roomId:id, playerNumber:1, alive:true }); state.set(b, { ...stB, roomId:id, playerNumber:2, alive:true });
	startCountdown(id);
}
function destroyRoom(id){ const room=rooms.get(id); if(!room) return; if(room.countdownTimer){ clearInterval(room.countdownTimer); room.countdownTimer=null; } for(const ws of room.players){ const st=state.get(ws); if(st){ delete st.roomId; delete st.playerNumber; } } rooms.delete(id); saveRooms(); }
function disconnect(ws){ waiting.delete(ws); const st=state.get(ws); if(st?.roomId){ const room=rooms.get(st.roomId); if(room){ if(room.countdownValue!=null){ cancelCountdown(room.id,true); } else { room.paused=true; room.lastActivity=Date.now(); if(st.playerNumber===1||st.playerNumber===2) room.players[st.playerNumber-1]=null; const side=st.playerNumber===1?'Player 1':'Player 2'; broadcast(room,{ type:'playerLeft', side }); broadcastPresence(room); saveRooms(); } } } state.delete(ws); }

setInterval(()=>{ if(!wss) return; for(const ws of wss.clients){ const st=state.get(ws)||{}; if(st.alive===false){ try{ws.terminate();}catch{} disconnect(ws); continue; } st.alive=true; state.set(ws,st); try{ ws.ping(); }catch{} } for(const ws of [...waiting]) if(!isOpen(ws)) waiting.delete(ws); }, 30000);

const SAVE_FILE = process.env.CK_SAVE_FILE || path.join(__dirname, 'rooms.save.json');
function serializeRoom(room){ try{ return { id: room.id, board: room.game.board, turn: room.game.turn, winner: room.game.winner||null, usernames: room.usernames, userIds: room.userIds||null, colors: room.colors, avatars: room.avatars, tokens: room.tokens, paused: !!room.paused, lastActivity: room.lastActivity||Date.now() }; }catch{ return null; } }
function saveRooms(){ try{ const payload={ nextRoomId, rooms:[...rooms.values()].map(serializeRoom).filter(Boolean) }; fs.writeFileSync(SAVE_FILE, JSON.stringify(payload)); }catch{} }
function restoreRooms(){ try{ if(!fs.existsSync(SAVE_FILE)) return; const raw=JSON.parse(fs.readFileSync(SAVE_FILE,'utf8')); nextRoomId=Math.max(1,Number(raw.nextRoomId)||1); const list=Array.isArray(raw.rooms)?raw.rooms:[]; for(const s of list){ try{ const game=new CheckersGame(); if(Array.isArray(s.board)) game.board=s.board; if(typeof s.turn==='string') game.turn=s.turn; if(s.winner==='R'||s.winner==='B') game.winner=s.winner; const room={ id: Number(s.id)||nextRoomId++, game, players:[null,null], usernames: s.usernames||{ 'Player 1':'Red','Player 2':'Black' }, userIds: (s.userIds&&(typeof s.userIds['Player 1']!=='undefined'||typeof s.userIds['Player 2']!=='undefined'))?s.userIds:{ 'Player 1':null,'Player 2':null }, colors: s.colors||{ 'Player 1':'#ef4444','Player 2':'#3b82f6' }, avatars: s.avatars||{ 'Player 1':'rocket','Player 2':'alien' }, tokens: (s.tokens&&s.tokens[1]&&s.tokens[2])?s.tokens:{1:uuidv4(),2:uuidv4()}, rematchVotes:new Set(), countdownTimer:null, countdownValue:null, paused: !!s.paused, lastActivity: Number(s.lastActivity)||Date.now() }; rooms.set(room.id, room); }catch{} } }catch{} }
restoreRooms();

function broadcastPresence(room){ try{ if(!room) return; const present={ 'Player 1': isOpen(room.players[0]), 'Player 2': isOpen(room.players[1]) }; broadcast(room,{ type:'presence', present }); }catch{} }

function attachHandlers(){ if(!wss) return; wss.on('connection',(ws)=>{ state.set(ws,{ alive:true }); ws.on('pong',()=>{ const st=state.get(ws); if(st) st.alive=true; }); ws.on('message',(raw)=>{ let data; try{ data=JSON.parse(raw.toString()); }catch{ return; } const st=state.get(ws)||{}; switch(data.type){
	case 'joinGame': { const username=(data.username||'').toString().slice(0,40); const color=normalizeColor(data.color)||null; const avatar=normalizeAvatar(data.avatar)||null; const userId=Number(data.userId); st.username=username; st.desiredColor=color; st.avatar=avatar; if(Number.isFinite(userId)) st.userId=userId; state.set(ws,st); addToWaiting(ws); send(ws,{ type:'queued' }); const pair=takePair(); if(pair) createRoom(pair[0],pair[1]); break; }
	case 'quickChat': { const st1=state.get(ws)||{}; if(!st1.roomId) break; const now=Date.now(); st1._lastChatTs=st1._lastChatTs||0; if(now-st1._lastChatTs<700) break; st1._lastChatTs=now; state.set(ws,st1); const room=rooms.get(st1.roomId); if(!room) break; if(room.countdownValue!=null) break; const side=st1.playerNumber===1?'Player 1':'Player 2'; const name=(room.usernames&&room.usernames[side])||side; const text=(data.text||'').toString().slice(0,80); broadcast(room,{ type:'quickChat', from: side, username:name, text, ts: now }); break; }
	case 'makeMove': { if(!st.roomId) return; const room=rooms.get(st.roomId); if(!room) return; if(room.countdownValue!=null) return; const side=st.playerNumber===1?'R':'B'; if(room.game.turn!==side) return; const ok=room.game.makeMove(data.move); if(ok){ broadcast(room,{ type:'gameUpdate', board: room.game.board, turn: room.game.turn, winner: room.game.winner||null }); } break; }
	case 'resetGame': { if(!st.roomId) return; const room=rooms.get(st.roomId); if(!room) return; room.game=new CheckersGame(); room.rematchVotes=new Set(); broadcast(room,{ type:'resetAck' }); break; }
	case 'rematchVote': { if(!st.roomId) return; const room=rooms.get(st.roomId); if(!room) return; if(!room.rematchVotes) room.rematchVotes=new Set(); room.rematchVotes.add(st.playerNumber); broadcast(room,{ type:'rematchUpdate', count: room.rematchVotes.size }); if(room.rematchVotes.size>=2){ room.game=new CheckersGame(); room.rematchVotes=new Set(); broadcast(room,{ type:'rematchStart' }); } break; }
	case 'leaveGame': { waiting.delete(ws); const s=state.get(ws); if(s?.roomId){ const room=rooms.get(s.roomId); if(room){ if(room.countdownValue!=null){ cancelCountdown(room.id,true); } else { room.paused=true; room.lastActivity=Date.now(); if(s.playerNumber===1||s.playerNumber===2) room.players[s.playerNumber-1]=null; const side=s.playerNumber===1?'Player 1':'Player 2'; broadcast(room,{ type:'playerLeft', side }); broadcastPresence(room); saveRooms(); } } } break; }
	case 'joinSavedGame': { const id=Number(data.gameId)||0; const token=(data.token||'').toString(); const room=rooms.get(id); if(!room){ send(ws,{type:'savedDenied'}); break; } waiting.delete(ws); let slot=null; if(token===room.tokens?.[1]) slot=1; else if(token===room.tokens?.[2]) slot=2; if(slot){ const existing=room.players[slot-1]; if(existing&&existing!==ws&&isOpen(existing)){ send(ws,{type:'savedDenied'}); break; } } if(!slot){ const uid=Number(data.userId); if(Number.isFinite(uid)&&room.userIds){ if(room.userIds['Player 1']===uid && room.userIds['Player 2']!==uid) slot=1; else if(room.userIds['Player 2']===uid && room.userIds['Player 1']!==uid) slot=2; else if(room.userIds['Player 1']===uid && room.userIds['Player 2']===uid){ const p1=room.players[0],p2=room.players[1]; if(!isOpen(p1)) slot=1; else if(!isOpen(p2)) slot=2; } } }
		if(!slot){ const name=(data.username||state.get(ws)?.username||'').toString().slice(0,40); if(name){ const u=room.usernames||{}; const m1=u['Player 1']===name; const m2=u['Player 2']===name; if(m1&&!m2) slot=1; else if(!m1&&m2) slot=2; else if(m1&&m2){ const p1=room.players[0],p2=room.players[1]; if(!isOpen(p1)) slot=1; else if(!isOpen(p2)) slot=2; } } }
		if(!slot){ if(data.allowAny===true){ const p1=room.players[0],p2=room.players[1]; if(!isOpen(p1)) slot=1; else if(!isOpen(p2)) slot=2; } }
		if(!slot){ send(ws,{ type:'savedDenied' }); break; }
		const existing=room.players[slot-1]; if(existing&&existing!==ws&&isOpen(existing)){ send(ws,{type:'savedDenied'}); break; }
		room.players[slot-1]=ws; const sideKey=(slot===1)?'Player 1':'Player 2'; if(!room.userIds) room.userIds={'Player 1':null,'Player 2':null}; const uid1=Number(data.userId); if(Number.isFinite(uid1)) room.userIds[sideKey]=uid1; if(typeof data.username==='string' && data.username){ if(!room.usernames) room.usernames={'Player 1':'Red','Player 2':'Black'}; room.usernames[sideKey]=data.username.toString().slice(0,40); }
		room.paused=true; room.lastActivity=Date.now(); state.set(ws,{ ...(state.get(ws)||{}), roomId: room.id, playerNumber: slot, alive:true }); send(ws,{ type:'savedQueued', you: slot, usernames: room.usernames, colors: room.colors, avatars: room.avatars, gameId: room.id, token: room.tokens?.[slot] }); broadcastPresence(room); saveRooms(); if(room.players.every(isOpen)){ if(!room.countdownTimer && room.countdownValue==null) startCountdown(room.id); } else { setTimeout(()=>{ const rr=rooms.get(room.id); if(rr&&rr.players&&rr.players.every(isOpen)&&!rr.countdownTimer&&rr.countdownValue==null){ startCountdown(rr.id); } }, 350); }
		break; }
	case 'resumeGame': { const id=Number(data.gameId)||0; const token=(data.token||'').toString(); const room=rooms.get(id); if(!room){ send(ws,{type:'resumeDenied'}); break; } let slot=null; if(token===room.tokens?.[1]) slot=1; else if(token===room.tokens?.[2]) slot=2; if(!slot){ send(ws,{type:'resumeDenied'}); break; } room.players[slot-1]=ws; room.paused=false; room.lastActivity=Date.now(); state.set(ws,{ ...st, roomId: room.id, playerNumber: slot, alive:true }); const start={ type:'startGame', board: room.game.board, turn: room.game.turn, usernames: room.usernames, colors: room.colors, avatars: room.avatars, gameId: room.id }; send(ws,{ ...start, playerNumber: slot, token: room.tokens?.[slot] }); const opp=room.players[(slot===1)?1:0]; if(isOpen(opp)) send(opp,{ type:'playerBack', side: slot===1?'Player 1':'Player 2' }); broadcastPresence(room); saveRooms(); break; }
	case 'listMySavedGames': { const st1=state.get(ws)||{}; const now=Date.now(); if(st1._lastListTs && (now-st1._lastListTs)<800) break; st1._lastListTs=now; state.set(ws,st1); const name=(data.username||state.get(ws)?.username||'').toString().slice(0,40); const uid=Number(data.userId); const out=[]; for(const room of rooms.values()){ let you=null; if(Number.isFinite(uid)&&room.userIds){ if(room.userIds['Player 1']===uid) you=1; else if(room.userIds['Player 2']===uid) you=2; } if(!you&&name){ const u=room.usernames||{}; if(u['Player 1']===name) you=1; else if(u['Player 2']===name) you=2; } if(you){ out.push({ gameId: room.id, you, usernames: room.usernames, paused: !!room.paused }); } } send(ws,{ type:'mySavedGames', list: out }); break; }
	case 'finishSavedGame': { const id=Number(data.gameId)||0; const room=rooms.get(id); if(!room){ send(ws,{ type:'savedRemoved', gameId:id, ok:false }); break; } const uid=Number(data.userId); const name=(data.username||state.get(ws)?.username||'').toString().slice(0,40); let authorized=false; if(Number.isFinite(uid) && room.userIds){ if(room.userIds['Player 1']===uid || room.userIds['Player 2']===uid) authorized=true; } if(!authorized && name){ const u=room.usernames||{}; if(u['Player 1']===name || u['Player 2']===name) authorized=true; } if(!authorized){ send(ws,{ type:'savedDenied' }); break; } destroyRoom(id); send(ws,{ type:'savedRemoved', gameId:id, ok:true }); break; }
	case 'setUsername': { const name=(data.username||'').toString().slice(0,40); if(!name) break; st.username=name; state.set(ws,st); if(!st.roomId) break; const room=rooms.get(st.roomId); if(!room) break; const side=st.playerNumber===1?'Player 1':'Player 2'; if(!room.usernames) room.usernames={'Player 1':'Red','Player 2':'Black'}; room.usernames[side]=name; broadcast(room,{ type:'usernames', usernames: room.usernames }); saveRooms(); break; }
	case 'setAvatar': { let avatar=null; if(typeof data.avatar==='string'){ const s=data.avatar.trim().toLowerCase(); if(AVATAR_IDS.has(s)) avatar=s; } if(!avatar) break; st.avatar=avatar; state.set(ws,st); if(!st.roomId) break; const room=rooms.get(st.roomId); if(!room) break; const side=st.playerNumber===1?'Player 1':'Player 2'; if(!room.avatars) room.avatars={'Player 1':'rocket','Player 2':'alien'}; room.avatars[side]=avatar; broadcast(room,{ type:'avatars', avatars: room.avatars }); saveRooms(); break; }
	case 'setColor': { let color=null; if(typeof data.color==='string'){ const s=data.color.trim(); if(/^#[0-9a-fA-F]{6}$/.test(s)) color=s.toLowerCase(); } if(!color) break; st.desiredColor=color; state.set(ws,st); if(!st.roomId) break; const room=rooms.get(st.roomId); if(!room) break; const side=st.playerNumber===1?'Player 1':'Player 2'; if(!room.colors) room.colors={'Player 1':'#ef4444','Player 2':'#3b82f6'}; room.colors[side]=color; broadcast(room,{ type:'colors', colors: room.colors }); saveRooms(); break; }
	default: break; } }); ws.on('close',()=>disconnect(ws)); ws.on('error',()=>disconnect(ws)); }); }

if (process.env.UNIFIED_WS !== '1') { standaloneServer = http.createServer(app); wss = new WebSocket.Server({ server: standaloneServer }); attachHandlers(); standaloneServer.listen(PORT, '0.0.0.0', ()=>{ console.log(`Checkers WS listening on http://0.0.0.0:${PORT}`); }); }

module.exports.attachUnified = function(server, path = '/ws/checkers'){ if(wss) return wss; wss = new WebSocket.Server({ noServer: true }); attachHandlers(); try{ server.on('upgrade', (req, socket, head)=>{ try{ if(!req||typeof req.url!=='string') return; const u=req.url.split('?')[0]; if(u!==path) return; wss.handleUpgrade(req, socket, head, (ws)=>{ wss.emit('connection', ws, req); }); }catch{ try{ socket.destroy(); }catch{} } }); }catch{} return wss; };
