// Chess WS server — full rules using local engine
const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const engine = require('./engine');

class ChessGame {
	constructor(){ this.state = engine.initGame(); this.winner=null; }
	get currentColor(){ return this.state.sideToMove; }
	toBoard(){
		const b=Array.from({length:8},()=>Array(8).fill(null));
		for(let r=0;r<8;r++) for(let c=0;c<8;c++){
			const idx = r*8 + c; const p=this.state.board[idx]; if(!p) continue; b[r][c] = { c:p.c, t:p.t };
		}
		return b;
	}
	makeMove(r,c,r2,c2, promotion){
		if(this.winner) return null;
		const from = r*8 + c; const to = r2*8 + c2;
		const legal = engine.generateLegalMoves(this.state);
		// Find matching move (promotion awareness)
		let mv = legal.find(m => m.from===from && m.to===to && (m.promotion||'')===(promotion||''));
		if(!mv){
			// If promotion omitted but required, default to queen
			const needsPromo = legal.some(m => m.from===from && m.to===to && m.promotion);
			if(needsPromo){ mv = legal.find(m => m.from===from && m.to===to && m.promotion==='q'); }
		}
		if(!mv) return null;
		engine.makeMove(this.state, mv);
		// Determine end state
		const checkmate = engine.isCheckmate(this.state);
		const stalemate = engine.isStalemate(this.state);
		const draw = engine.detectDraw(this.state);
		if(checkmate){ this.winner = engine._internal ? (this.state.sideToMove==='w'?'b':'w') : (this.state.sideToMove==='w'?'b':'w'); }
		else if(stalemate || (draw && draw.type && draw.type!=='none')){ this.winner = 'draw'; }
		return { r,c,r2,c2 };
	}
}

const PORT = Number(process.env.CHESS_PORT) || 3012;
const app = express(); app.use(cors()); app.use(express.json());
app.get('/',(_req,res)=>res.send('Chess WS server running'));
app.get('/health',(_req,res)=>res.json({ok:true,ts:Date.now()}));
app.get('/rooms', (_req,res)=>{
	try{
		const list = [...rooms.values()].map(r=>({ id:r.id, usernames:r.usernames, paused:!!r.paused, mode:r.mode, players:[ !!r.players?.[0] && isOpen(r.players[0]), !!r.players?.[1] && isOpen(r.players[1]) ], countdown: r.countdownValue }));
		res.json({ ok:true, list });
	}catch(e){ res.status(500).json({ ok:false, error: String(e.message||e) }); }
});
// Diagnostics: status and perft
app.post('/status',(req,res)=>{
	try{
		const fen = (req.body && req.body.fen) ? String(req.body.fen) : null;
		const st = fen ? engine.loadFEN(fen) : engine.initGame();
		const data = {
			fen: engine.getFEN(st),
			inCheck: engine.inCheck(st, st.sideToMove),
			isCheckmate: engine.isCheckmate(st),
			isStalemate: engine.isStalemate(st),
			draw: engine.detectDraw(st)
		};
		res.json(data);
	}catch(e){ res.status(400).json({ error: String(e.message||e) }); }
});
app.post('/perft',(req,res)=>{
	try{
		const fen = (req.body && req.body.fen) ? String(req.body.fen) : null;
		const depth = Math.max(0, Math.min(6, Number((req.body && req.body.depth) ?? 2)));
		const st = fen ? engine.loadFEN(fen) : engine.initGame();
		const nodes = engine.perft(st, depth);
		res.json({ nodes, depth, fen: engine.getFEN(st) });
	}catch(e){ res.status(400).json({ error: String(e.message||e) }); }
});
let standaloneServer = null;
let wss = null; // created in standalone or unified attach
// Simple file logger for diagnostics
const LOG_DIR = path.join(__dirname, '../../../..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'chess.log');
function logLine(msg){
	try{
		if(!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
		const line = `[${new Date().toISOString()}] ${msg}\n`;
		fs.appendFileSync(LOG_FILE, line);
	}catch{}
}

let nextRoomId=1; const waiting=new Set(); const rooms=new Map(); const state=new WeakMap();
// Persistence: save rooms so paused games survive restarts
const SAVE_FILE = process.env.CHESS_SAVE_FILE || path.join(__dirname, 'rooms.save.json');
function serializeRoom(room){
	try{
		return {
			id: room.id,
			fen: engine.getFEN(room.game.state),
			mode: room.mode,
			pieceColors: room.pieceColors,
			avatars: room.avatars,
			usernames: room.usernames,
			userIds: room.userIds || null,
			tokens: room.tokens,
			paused: !!room.paused,
			lastActivity: room.lastActivity || Date.now()
		};
	}catch{ return null; }
}
function saveRooms(){
	try{
		const payload = {
			nextRoomId,
			rooms: [...rooms.values()].map(serializeRoom).filter(Boolean)
		};
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
				const st = engine.loadFEN(String(s.fen||''));
				const game = new ChessGame();
				game.state = st;
				const room = {
					id: Number(s.id)||nextRoomId++,
					game,
					players: [null, null],
					usernames: s.usernames || { w:'White', b:'Black' },
					userIds: (s.userIds && (typeof s.userIds.w !== 'undefined' || typeof s.userIds.b !== 'undefined')) ? s.userIds : { w: null, b: null },
					pieceColors: s.pieceColors || { w:'#e5e7eb', b:'#111827' },
					avatars: s.avatars || { w:'rocket', b:'alien' },
					mode: (s.mode==='free'?'free':'strict'),
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
// Separate waiting pools for same-mode matchmaking
const waitingPools = { strict: new Set(), free: new Set() };
const isOpen=ws=>ws&&ws.readyState===WebSocket.OPEN; const send=(ws,p)=>{ if(!isOpen(ws)) return; try{ ws.send(JSON.stringify(p)); }catch{} }; const broadcast=(room,p)=>{ for(const ws of room.players) send(ws,p); };
function broadcastPresence(room){
	try{
		if(!room) return;
		const present = { w: isOpen(room.players[0]), b: isOpen(room.players[1]) };
		broadcast(room, { type:'presence', present });
	}catch{}
}
function addToWaiting(ws){
	if(!isOpen(ws)) return false;
	const st = state.get(ws) || {};
	const mode = (st.mode === 'free') ? 'free' : 'strict';
	waitingPools[mode].add(ws);
	return true;
}
function takePair(){
	// Clean dead sockets
	for (const pool of [waitingPools.strict, waitingPools.free]) {
		for (const ws of [...pool]) if(!isOpen(ws)) pool.delete(ws);
	}
	// Try strict then free
	for (const key of ['strict','free']){
		const pool = waitingPools[key];
		const live = [...pool];
		if(live.length>=2){
			const a = live[0]; const b = live.find(x=>x!==a);
			if(b){ pool.delete(a); pool.delete(b); return [a,b,key]; }
		}
	}
	return null;
}
function stakesFor(room){ const[a,b]=room.players; const sa=state.get(a)?.stake; const sb=state.get(b)?.stake; return { w:(typeof sa==='number'?sa:'—'), b:(typeof sb==='number'?sb:'—') }; }

function startCountdown(roomId){
	const room=rooms.get(roomId); if(!room) return; room.countdownValue=5;
	const payload={ usernames:room.usernames, stakes:stakesFor(room), pieceColors: room.pieceColors, avatars: room.avatars, mode: room.mode, type:'paired', gameId: roomId };
	const [a,b]=room.players;
	send(a,{...payload,you:1, token: room.tokens?.[1]});
	send(b,{...payload,you:2, token: room.tokens?.[2]});
	sendCountdown(room);
	room.countdownTimer=setInterval(()=>{
		const r=rooms.get(roomId); if(!r) return; if(!r.players.every(isOpen)){ cancelCountdown(roomId,true); return; }
		r.countdownValue-=1; if(r.countdownValue>0){ sendCountdown(r); return; }
		clearInterval(r.countdownTimer); r.countdownTimer=null; r.countdownValue=null;
		const start={ type:'startGame', currentColor:r.game.currentColor, board: r.game.toBoard(), pieceColors: r.pieceColors, avatars: r.avatars, mode: r.mode, gameId: roomId };
		const[sa,sb]=r.players; send(sa,{...start,playerNumber:1, token: r.tokens?.[1]}); send(sb,{...start,playerNumber:2, token: r.tokens?.[2]});
		saveRooms();
	},1000);
}
function sendCountdown(room){ if(room.countdownValue==null) return; broadcast(room,{ type:'countdown', value:room.countdownValue }); }
function cancelCountdown(roomId,notify){ const room=rooms.get(roomId); if(!room) return; if(room.countdownTimer){ clearInterval(room.countdownTimer); room.countdownTimer=null; } room.countdownValue=null; if(notify){ for(const ws of room.players) if(isOpen(ws)) send(ws,{type:'opponentLeft'}); } destroyRoom(roomId); }
function createRoom(a,b,mode='strict'){ if(!isOpen(a)||!isOpen(b)||a===b) return; const id=nextRoomId++; const game=new ChessGame(); const stA=state.get(a)||{}; const stB=state.get(b)||{}; const nameA=(stA.username||'White').toString().slice(0,40)||'White'; const nameB=(stB.username||'Black').toString().slice(0,40)||'Black'; const usernames={ w:nameA, b:nameB };
	const defaultW = '#e5e7eb'; const defaultB = '#111827';
	const pieceColors = { w: (typeof stA.pieceColor==='string'?stA.pieceColor:defaultW), b: (typeof stB.pieceColor==='string'?stB.pieceColor:defaultB) };
	const avatars = { w: (typeof stA.avatar==='string'?stA.avatar:'rocket'), b: (typeof stB.avatar==='string'?stB.avatar:'alien') };
	const userIds = { w: (Number.isFinite(stA.userId)?stA.userId:null), b: (Number.isFinite(stB.userId)?stB.userId:null) };
	const tokens = { 1: uuidv4(), 2: uuidv4() };
	rooms.set(id,{ id, game, players:[a,b], usernames, userIds, pieceColors, avatars, mode:(mode==='free'?'free':'strict'), tokens, rematchVotes:new Set(), countdownTimer:null, countdownValue:null, paused:false, lastActivity: Date.now() }); state.set(a,{...stA,roomId:id,playerNumber:1,alive:true}); state.set(b,{...stB,roomId:id,playerNumber:2,alive:true}); saveRooms(); startCountdown(id);
}
function destroyRoom(id){ const room=rooms.get(id); if(!room) return; if(room.countdownTimer){ clearInterval(room.countdownTimer); room.countdownTimer=null; } for(const ws of room.players){ const st=state.get(ws); if(st){ delete st.roomId; delete st.playerNumber; } } rooms.delete(id); saveRooms(); }
function disconnect(ws){
	waiting.delete(ws);
	for(const pool of [waitingPools.strict, waitingPools.free]) pool.delete(ws);
	const st=state.get(ws);
	if(st?.roomId){
		const room=rooms.get(st.roomId);
		if(room){
			if(room.countdownValue!=null){ cancelCountdown(room.id,true); state.delete(ws); return; }
			room.paused=true; room.lastActivity=Date.now();
			saveRooms();
			const side = st.playerNumber===2?'b':'w';
			broadcast(room,{ type:'playerLeft', side });
			broadcastPresence(room);
		}
	}
	state.delete(ws);
}
setInterval(()=>{
	for(const ws of wss.clients){ const st=state.get(ws)||{}; if(st.alive===false){ try{ws.terminate();}catch{} disconnect(ws); continue; } st.alive=true; state.set(ws,st); try{ws.ping();}catch{} }
	for(const pool of [waitingPools.strict, waitingPools.free]){ for(const ws of [...pool]) if(!isOpen(ws)) pool.delete(ws); }
},30000);

function attachHandlers(){
if(!wss) return;
wss.on('connection',(ws)=>{
	try{ console.log('[ws] client connected'); logLine('[ws] client connected'); }catch{}
	state.set(ws,{alive:true}); ws.on('pong',()=>{ const st=state.get(ws); if(st) st.alive=true; });
	try{ send(ws, { type:'hello', ts: Date.now() }); }catch{}
	ws.on('message',(raw)=>{
		let data; try{ data=JSON.parse(raw.toString()); }catch{ return; }
		try{ console.log('[ws] recv', data && data.type ? data.type : typeof data); logLine(`[ws] recv ${data && data.type ? data.type : typeof data}`); }catch{}
		const st=state.get(ws)||{};
		try{ send(ws, { type:'echo', got: data?.type||null }); }catch{}
		switch(data.type){
			case 'quickChat':{
				const st1 = state.get(ws) || {};
				if(!st1.roomId) break;
				const now = Date.now();
				st1._lastChatTs = st1._lastChatTs || 0;
				if(now - st1._lastChatTs < 700){ break; }
				st1._lastChatTs = now; state.set(ws, st1);
				const room = rooms.get(st1.roomId); if(!room) break;
				if(room.countdownValue!=null){ break; }
				const side = st1.playerNumber===2?'b':'w';
				const name = (room.usernames && room.usernames[side]) || (side==='w'?'White':'Black');
				const textRaw = (data.text||'').toString();
				const text = textRaw.slice(0, 80);
				try{
					const msg=`[chat] room #${st1.roomId} side=${side} user='${name}' text='${text}'`;
					console.log(msg); logLine(msg);
					const recipients = room.players.map((p,i)=>({ idx:i+1, open: isOpen(p) }));
					console.log('[chat] recipients', JSON.stringify(recipients));
				}catch{}
				// Explicit send with logging to debug delivery
				const payload = { type:'quickChat', from: side, username: name, text, ts: now };
				for(let i=0;i<room.players.length;i++){
					const rws = room.players[i];
					if(isOpen(rws)){
						try{ rws.send(JSON.stringify(payload)); console.log(`[chat] sent to p${i+1}`); }catch(e){ console.log(`[chat] send fail p${i+1}: ${e && e.message ? e.message : e}`); }
					} else {
						try{ console.log(`[chat] skip p${i+1} (closed)`); }catch{}
					}
				}
				break;
			}
			case 'joinSavedGame':{
				const id = Number(data.gameId)||0; const token = (data.token||'').toString();
				const room = rooms.get(id); if(!room){ send(ws,{ type:'savedDenied' }); break; }
				// Ensure this socket is not in any matchmaking queue
				waiting.delete(ws);
				for(const pool of [waitingPools.strict, waitingPools.free]) pool.delete(ws);
				let slot=null; if(token===room.tokens?.[1]) slot=1; else if(token===room.tokens?.[2]) slot=2;
				// Prefer userId match if provided
				if(!slot){
					const uid = Number(data.userId);
					if(Number.isFinite(uid) && room.userIds){
						if(room.userIds.w === uid && room.userIds.b !== uid) slot = 1;
						else if(room.userIds.b === uid && room.userIds.w !== uid) slot = 2;
						else if(room.userIds.w === uid && room.userIds.b === uid){
							const p1=room.players[0], p2=room.players[1];
							if(!isOpen(p1)) slot=1; else if(!isOpen(p2)) slot=2;
						}
					}
				}
				// Fallback: allow joining by username; handle same-name on both sides by choosing a free slot
				if(!slot){
					const name = (data.username || state.get(ws)?.username || '').toString().slice(0,40);
					if(name){
						const u=room.usernames||{}; const matchW = u.w===name; const matchB = u.b===name;
						if(matchW && !matchB) slot=1; else if(!matchW && matchB) slot=2; else if(matchW && matchB){
							const p1=room.players[0], p2=room.players[1];
							if(!isOpen(p1)) slot=1; else if(!isOpen(p2)) slot=2; else slot=null;
						}
					}
				}
				if(!slot){
					if(data.allowAny===true){
						const p1=room.players[0], p2=room.players[1];
						if(!isOpen(p1)) slot=1; else if(!isOpen(p2)) slot=2; else slot=null;
					}
				}
				if(!slot){ send(ws,{ type:'savedDenied' }); break; }
	// Attach this socket to the saved room slot
				room.players[slot-1] = ws;
				// Update persisted identities for this slot if provided
				const sideKey1 = (slot===1)?'w':'b';
				if(!room.userIds) room.userIds = { w: null, b: null };
				const uid1 = Number(data.userId);
				if(Number.isFinite(uid1)) room.userIds[sideKey1] = uid1;
				if(typeof data.username === 'string' && data.username){
					if(!room.usernames) room.usernames = { w:'White', b:'Black' };
					room.usernames[sideKey1] = data.username.toString().slice(0,40);
				}
				room.paused = true; // keep paused until countdown completes
				room.lastActivity = Date.now();
				state.set(ws,{ ...(state.get(ws)||{}), roomId: room.id, playerNumber: slot, alive: true });
	try{ console.log(`[saved] joinSavedGame: room #${room.id} slot ${slot} by token=${!!token} name='${(state.get(ws)?.username)||data.username||''}'`); }catch{}
				// Acknowledge queued saved game to the joiner
				send(ws,{
					type:'savedQueued',
					you: slot,
					usernames: room.usernames,
					pieceColors: room.pieceColors,
					avatars: room.avatars,
					mode: room.mode,
					gameId: room.id,
					token: room.tokens?.[slot]
				});
				// Inform presence to both
				broadcastPresence(room);
				saveRooms();
				// If both present, start countdown just like fresh pairing
				try{
					const p1Open = isOpen(room.players[0]);
					const p2Open = isOpen(room.players[1]);
					const msg=`[saved] presence after joinSavedGame room #${room.id}: w=${p1Open} b=${p2Open}`;
					console.log(msg); logLine(msg);
				}catch{}
				if(room.players.every(isOpen)){
					// Avoid double countdowns
					if(!room.countdownTimer && room.countdownValue==null){
						try{ const msg=`[saved] starting countdown for room #${room.id} (joinSavedGame)`; console.log(msg); logLine(msg); }catch{}
						startCountdown(room.id);
					}
				}
				break;
			}
			case 'resumeGame':{
				const id = Number(data.gameId)||0; const token = (data.token||'').toString();
				const room = rooms.get(id); if(!room) { send(ws,{type:'resumeDenied'}); break; }
				let slot=null; if(token===room.tokens?.[1]) slot=1; else if(token===room.tokens?.[2]) slot=2;
				if(!slot){ send(ws,{type:'resumeDenied'}); break; }
				room.players[slot-1]=ws; room.paused=false; room.lastActivity=Date.now();
				state.set(ws,{ ...st, roomId: room.id, playerNumber: slot, alive:true });
				const start={ type:'startGame', currentColor:room.game.currentColor, board: room.game.toBoard(), pieceColors: room.pieceColors, avatars: room.avatars, mode: room.mode, gameId: room.id };
				send(ws,{...start, playerNumber: slot, token: room.tokens?.[slot]});
				const opp = room.players[(slot===1)?1:0]; if(isOpen(opp)) send(opp,{ type:'playerBack', side: slot===2?'b':'w' });
				broadcastPresence(room);
				saveRooms();
				break;
			}
			case 'listMySavedGames':{
				// Return saved rooms tied to this userId (preferred) or username
				const name = (data.username || state.get(ws)?.username || '').toString().slice(0,40);
				const uid = Number(data.userId);
				const out=[];
				for(const room of rooms.values()){
					let you=null;
					if(Number.isFinite(uid) && room.userIds){ if(room.userIds.w===uid) you=1; else if(room.userIds.b===uid) you=2; }
					if(!you && name){ const u = room.usernames||{}; if(u.w===name) you=1; else if(u.b===name) you=2; }
					if(you){ out.push({ gameId: room.id, you, usernames: room.usernames, mode: room.mode, paused: !!room.paused }); }
				}
				send(ws,{ type:'mySavedGames', list: out });
				break;
			}
			case 'finishSavedGame':{
				const id = Number(data.gameId)||0; const room = rooms.get(id);
				if(!room){ send(ws,{ type:'savedRemoved', gameId: id, ok:false }); break; }
				const uid = Number(data.userId);
				const name = (data.username || state.get(ws)?.username || '').toString().slice(0,40);
				let authorized=false;
				if(Number.isFinite(uid) && room.userIds){ if(room.userIds.w===uid || room.userIds.b===uid) authorized=true; }
				if(!authorized && name){ const u=room.usernames||{}; if(u.w===name || u.b===name) authorized=true; }
				if(!authorized){ send(ws,{ type:'savedDenied' }); break; }
				destroyRoom(id);
				send(ws,{ type:'savedRemoved', gameId: id, ok:true });
				break;
			}
			case 'claimSavedGame':{
				let id = Number(data.gameId)||0; let room = rooms.get(id);
				// Ensure this socket is not in any matchmaking queue
				waiting.delete(ws);
				for(const pool of [waitingPools.strict, waitingPools.free]) pool.delete(ws);
				const uid = Number(data.userId);
				const nameRaw = (state.get(ws)?.username || data.username || '').toString();
				const name = nameRaw.slice(0,40);
				if(!Number.isFinite(uid) && !name){ send(ws,{ type:'savedDenied' }); break; }
				// If room not found or id not provided, try resolving by usernames (most recent, prefer paused)
				if(!room){
					const other = (data.otherUsername || '').toString().slice(0,40);
					const candidates = [];
					for(const r of rooms.values()){
						const u = r.usernames||{}; const ids = r.userIds||{}; const hasYou = Number.isFinite(uid) ? (ids.w===uid || ids.b===uid) : (u.w===name || u.b===name);
						const hasOther = other ? (u.w===other || u.b===other) : true;
						if(hasYou && hasOther){ candidates.push(r); }
					}
					if(candidates.length){
						candidates.sort((a,b)=> (Number(b.lastActivity||0)-Number(a.lastActivity||0)) || (Number(b.id)-Number(a.id)) );
						let pick = candidates.find(r=>r.paused) || candidates[0];
						room = pick; id = room?.id||0;
					}
				}
				if(!room){ send(ws,{ type:'savedDenied' }); break; }
				const u = room.usernames||{}; const ids = room.userIds||{}; let slot=null;
				if(Number.isFinite(uid)){
					const matchWId = ids.w===uid, matchBId = ids.b===uid;
					if(matchWId && !matchBId) slot=1; else if(!matchWId && matchBId) slot=2; else if(matchWId && matchBId){
						const p1=room.players[0], p2=room.players[1];
						if(!isOpen(p1)) slot=1; else if(!isOpen(p2)) slot=2; else slot=null;
					}
				}
				if(!slot && name){
					const matchW=u.w===name, matchB=u.b===name;
					if(matchW && !matchB) slot=1; else if(!matchW && matchB) slot=2; else if(matchW && matchB){
						const p1=room.players[0], p2=room.players[1];
						if(!isOpen(p1)) slot=1; else if(!isOpen(p2)) slot=2; else slot=null;
					}
				}
				if(!slot){ send(ws,{ type:'savedDenied' }); break; }
				// If slot already taken by a live socket and it's not this ws, try the other matched slot (same-name case)
				const existing = room.players[slot-1];
				if(existing && existing!==ws && isOpen(existing)){
					const bothMatch = Number.isFinite(uid)
						? ((room.userIds?.w===uid) && (room.userIds?.b===uid))
						: ((room.usernames?.w===name) && (room.usernames?.b===name));
					if(bothMatch){ const alt = slot===1?2:1; const altExisting=room.players[alt-1]; if(!isOpen(altExisting)) slot=alt; else { send(ws,{ type:'savedDenied' }); break; } }
					else { send(ws,{ type:'savedDenied' }); break; }
				}
	room.players[slot-1] = ws; room.paused=true; room.lastActivity=Date.now();
				// Update identities on join
				const sideKey2 = (slot===1)?'w':'b';
				if(!room.userIds) room.userIds = { w: null, b: null };
				if(Number.isFinite(uid)) room.userIds[sideKey2] = uid;
				if(typeof name === 'string' && name){ if(!room.usernames) room.usernames={ w:'White', b:'Black' }; room.usernames[sideKey2]=name; }
				state.set(ws,{ ...(state.get(ws)||{}), roomId: room.id, playerNumber: slot, alive:true });
	try{ console.log(`[saved] claimSavedGame: room #${room.id} slot ${slot} by name='${name}'`); }catch{}
				send(ws,{ type:'savedQueued', you: slot, usernames: room.usernames, pieceColors: room.pieceColors, avatars: room.avatars, mode: room.mode, gameId: room.id, token: room.tokens?.[slot] });
				broadcastPresence(room); saveRooms();
				try{
					const p1Open = isOpen(room.players[0]);
					const p2Open = isOpen(room.players[1]);
					const msg=`[saved] presence after claimSavedGame room #${room.id}: w=${p1Open} b=${p2Open}`;
					console.log(msg); logLine(msg);
				}catch{}
				if(room.players.every(isOpen)){
					if(!room.countdownTimer && room.countdownValue==null){
						try{ const msg=`[saved] starting countdown for room #${room.id} (claimSavedGame)`; console.log(msg); logLine(msg); }catch{}
						startCountdown(room.id);
					}
				}
				break;
			}
			case 'getMoves':{
				if(!st.roomId) return; const room=rooms.get(st.roomId); if(!room) return; if(room.countdownValue!=null) return;
				const { r,c }=data; if(!Number.isInteger(r)||!Number.isInteger(c)) return;
				const game=room.game; const board=game.toBoard(); const pc=board?.[r]?.[c]; if(!pc) { send(ws,{type:'moves', from:{r,c}, moves:[]}); return; }
				// Only provide moves for the current side's piece
				if(pc.c !== game.currentColor){ send(ws,{type:'moves', from:{r,c}, moves:[]}); return; }
				const from = r*8 + c;
				const all = room.mode==='free' ? engine._internal.generatePseudoLegalMoves(game.state) : engine.generateLegalMoves(game.state);
				const mv = all.filter(m=>m.from===from).map(m=>({ r2: Math.floor(m.to/8), c2: m.to%8, promotion: m.promotion||undefined }));
				send(ws,{ type:'moves', from:{r,c}, moves: mv });
				break;
			}
			case 'joinGame':{
				if(st.roomId) return;
				const username=(data.username||'').toString().slice(0,40);
				const userId = Number(data.userId);
				let stake=null; if(typeof data.stake==='number'&&isFinite(data.stake)) stake=Math.max(0.01,Number(data.stake));
				// sanitize pieceColor as hex #RRGGBB
				let pieceColor=null; if(typeof data.pieceColor==='string'){ const s=data.pieceColor.trim(); if(/^#[0-9a-fA-F]{6}$/.test(s)) pieceColor=s.toLowerCase(); }
				// sanitize avatar id (alphanumeric + dashes)
				let avatar=null; if(typeof data.avatar==='string'){ const s=data.avatar.trim(); if(/^[a-zA-Z0-9\-]{1,24}$/.test(s)) avatar=s; }
				// mode
				const mode = (String(data.mode||'strict').toLowerCase()==='free') ? 'free' : 'strict';
				st.username=username; if(Number.isFinite(userId)) st.userId=userId; st.stake=stake; if(pieceColor) st.pieceColor=pieceColor; if(avatar) st.avatar=avatar;
				st.mode=mode;
				state.set(ws,st);
				addToWaiting(ws); send(ws,{type:'queued'});
				const pair=takePair(); if(pair) createRoom(pair[0],pair[1], pair[2]||mode);
				break;
			}
			case 'makeMove':{
				if(!st.roomId) return; const room=rooms.get(st.roomId); if(!room) return; if(room.countdownValue!=null) return;
				const { r,c,r2,c2, promotion }=data; if(!Number.isInteger(r)||!Number.isInteger(c)||!Number.isInteger(r2)||!Number.isInteger(c2)) return;
				if(room.mode==='free'){
					const from = r*8 + c; const to = r2*8 + c2;
					const all = engine._internal.generatePseudoLegalMoves(room.game.state);
					let mv = all.find(m=>m.from===from && m.to===to && (m.promotion||'')===(promotion||''));
					if(!mv){ const needsPromo = all.some(m=>m.from===from && m.to===to && m.promotion); if(needsPromo){ mv = all.find(m=>m.from===from && m.to===to && m.promotion==='q'); } }
					if(!mv) return;
					engine._internal.applyMoveWithUndoRecord(room.game.state, mv);
					// maintain simple history entry for undo symmetry if needed
					room.game.state.history.push(mv);
					const res={ r,c,r2,c2 };
					broadcast(room,{ type:'gameUpdate', board: room.game.toBoard(), currentColor: room.game.currentColor, winner: null, lastMove: res, pieceColors: room.pieceColors });
				} else {
					const res=room.game.makeMove(r,c,r2,c2,promotion);
					if(res){ const w=room.game.winner; broadcast(room,{ type:'gameUpdate', board: room.game.toBoard(), currentColor: room.game.currentColor, winner: w||null, lastMove: res, pieceColors: room.pieceColors }); }
				}
				saveRooms();
				break;
			}
			case 'setPieceColor':{
				// accept updates even when not in a room yet (waiting)
				let color=null; if(typeof data.pieceColor==='string'){ const s=data.pieceColor.trim(); if(/^#[0-9a-fA-F]{6}$/.test(s)) color=s.toLowerCase(); }
				if(!color) return;
				st.pieceColor=color; state.set(ws,st);
				if(!st.roomId) return; const room=rooms.get(st.roomId); if(!room) return;
				const side = st.playerNumber===2 ? 'b' : 'w';
				if(!room.pieceColors) room.pieceColors={ w:'#e5e7eb', b:'#111827' };
				room.pieceColors[side]=color;
				broadcast(room,{ type:'pieceColors', pieceColors: room.pieceColors });
				saveRooms();
				break;
			}
			case 'setAvatar':{
				// sanitize avatar id (alphanumeric + dashes, up to 24 chars)
				let avatar=null; if(typeof data.avatar==='string'){ const s=data.avatar.trim(); if(/^[a-zA-Z0-9\-]{1,24}$/.test(s)) avatar=s; }
				if(!avatar) return; st.avatar=avatar; state.set(ws,st);
				if(!st.roomId) return; const room=rooms.get(st.roomId); if(!room) return;
				const side = st.playerNumber===2 ? 'b' : 'w';
				if(!room.avatars) room.avatars={ w:'rocket', b:'alien' };
				room.avatars[side]=avatar;
				broadcast(room,{ type:'avatars', avatars: room.avatars });
				saveRooms();
				break;
			}
			case 'setUsername':{
				// update username during matchmaking or in-room
				const name=(data.username||'').toString().slice(0,40);
				if(!name) return; st.username=name; state.set(ws,st);
				if(!st.roomId) return; const room=rooms.get(st.roomId); if(!room) return;
				const side = st.playerNumber===2 ? 'b' : 'w';
				if(!room.usernames) room.usernames={ w:'White', b:'Black' };
				room.usernames[side]=name;
				broadcast(room,{ type:'usernames', usernames: room.usernames });
				saveRooms();
				break;
			}
	case 'resetGame':{ if(!st.roomId) return; const room=rooms.get(st.roomId); if(!room) return; room.game=new ChessGame(); room.rematchVotes=new Set(); broadcast(room,{type:'resetAck'}); saveRooms(); break; }
	case 'rematchVote':{ if(!st.roomId) return; const room=rooms.get(st.roomId); if(!room) return; if(typeof data.stake==='number'&&isFinite(data.stake)){ st.stake=Math.max(0.01,Number(data.stake)); state.set(ws,st); const[a,b]=room.players; const sa=state.get(a)?.stake; const sb=state.get(b)?.stake; broadcast(room,{type:'stakes', stakes:{ w:(typeof sa==='number'?sa:'—'), b:(typeof sb==='number'?sb:'—') }}); } if(!room.rematchVotes) room.rematchVotes=new Set(); room.rematchVotes.add(st.playerNumber); broadcast(room,{type:'rematchUpdate', count: room.rematchVotes.size}); if(room.rematchVotes.size>=2){ room.game=new ChessGame(); room.rematchVotes=new Set(); broadcast(room,{type:'rematchStart', pieceColors: room.pieceColors }); saveRooms(); } break; }
			case 'leaveGame':{
				waiting.delete(ws);
				const s=state.get(ws);
				if(s?.roomId){
					const room=rooms.get(s.roomId);
					if(room){
						if(room.countdownValue!=null){
							cancelCountdown(room.id,true);
						} else {
							room.paused=true; room.lastActivity=Date.now();
							// Detach this socket from the room so presence reflects correctly
							if(s.playerNumber===1 || s.playerNumber===2){
								room.players[s.playerNumber-1] = null;
							}
							const side = s.playerNumber===2?'b':'w';
							broadcast(room,{ type:'playerLeft', side });
							broadcastPresence(room);
							saveRooms();
						}
					}
					// Clear this socket's in-room state
					const st2 = state.get(ws) || {};
					delete st2.roomId; delete st2.playerNumber; state.set(ws, st2);
				}
				break;
			}
			default: break;
		}
	});
	ws.on('close',()=>disconnect(ws)); ws.on('error',()=>disconnect(ws));
});
}

// Standalone startup unless unified mode is requested
if(process.env.UNIFIED_WS !== '1'){
	standaloneServer = http.createServer(app);
	wss = new WebSocket.Server({ server: standaloneServer });
	attachHandlers();
	standaloneServer.listen(PORT,'0.0.0.0',()=>{ console.log(`Chess WS listening on http://0.0.0.0:${PORT}`); try{ logLine(`server listening on ${PORT}`);}catch{} });
}

// Unified attach API
module.exports.attachUnified = function(server, path='/ws/chess'){
	if(wss) return wss;
	// Use noServer + manual routing so multiple WS servers can share one HTTP server safely
	wss = new WebSocket.Server({ noServer: true });
	attachHandlers();
	try{
		server.on('upgrade', (req, socket, head) => {
			try{
				if (!req || typeof req.url !== 'string') return;
				if (req.url.split('?')[0] !== path) return; // only handle our path
				wss.handleUpgrade(req, socket, head, (ws) => {
					wss.emit('connection', ws, req);
				});
			}catch{ try{ socket.destroy(); }catch{} }
		});
	}catch{}
	return wss;
};
