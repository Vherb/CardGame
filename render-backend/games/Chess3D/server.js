// Raumschach WS server (5x5x5) — full matchmaking like Chess
const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const engine = require('./raumEngine.cjs.js');

class RaumGame {
	constructor(){ this.state = engine.createInitialState(); this.winner=null; }
	get currentColor(){ return this.state.sideToMove; }
	toBoard(){
		const b=Array.from({length:5},()=>Array.from({length:5},()=>Array(5).fill(null)));
		for(let l=0;l<5;l++) for(let r=0;r<5;r++) for(let f=0;f<5;f++){
			const p=this.state.board[l][r][f]; if(!p) continue; b[l][r][f] = { c:p.c, t:p.t };
		}
		return b;
	}
	makeMove(from, to){
		if(this.winner) return null;
		const legal = engine.generateLegal(this.state);
		const mv = legal.find(m => m.from.l===from.l && m.from.r===from.r && m.from.f===from.f && m.to.l===to.l && m.to.r===to.r && m.to.f===to.f);
		if(!mv) return null;
		engine.makeMove(this.state, mv);
		return mv;
	}
}

const PORT = Number(process.env.RSCH_PORT) || 3013;
const app = express(); app.use(cors()); app.use(express.json());
app.get('/',(_req,res)=>res.send('Raumschach WS server running'));
app.get('/health',(_req,res)=>res.json({ok:true,ts:Date.now()}));
app.get('/rooms',(_req,res)=>{
	try{
		const list=[...rooms.values()].map(r=>({ id:r.id, usernames:r.usernames, players:[ !!r.players?.[0] && isOpen(r.players[0]), !!r.players?.[1] && isOpen(r.players[1]) ], countdown:r.countdownValue }));
		res.json({ ok:true, list, waiting: [...waitingSet].length });
	}catch(e){ res.status(500).json({ ok:false, error:String(e.message||e) }); }
});
let standaloneServer = null;
let wss = null; // created in standalone or unified attach

// Logging
const LOG_DIR = path.join(__dirname, '../../../..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'raum.log');
function logLine(msg){ try{ if(!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR,{recursive:true}); fs.appendFileSync(LOG_FILE,`[${new Date().toISOString()}] [raum] ${msg}\n`);}catch{} }

// Room + matchmaking state
let nextRoomId=1; const rooms=new Map(); const state=new WeakMap();
const waitingSet = new Set();
const isOpen=ws=>ws&&ws.readyState===WebSocket.OPEN; const send=(ws,p)=>{ if(!isOpen(ws)) return; try{ ws.send(JSON.stringify(p)); }catch{} }; const broadcast=(room,p)=>{ for(const ws of room.players) send(ws,p); };

// Persistence (saved games)
const SAVE_FILE = process.env.RAUM_SAVE_FILE || path.join(__dirname, 'rooms.save.json');
function serializeRoom(room){
	try{
		// Persist full board state and side-to-move for proper resume
		const board = room?.game?.state?.board || null;
		const sideToMove = room?.game?.state?.sideToMove || 'w';
		return {
			id: room.id,
			// No FEN for Raumschach; store board + sideToMove instead
			board,
			sideToMove,
			mode: room.mode || 'strict',
			pieceColors: room.pieceColors,
			avatars: room.avatars,
			usernames: room.usernames,
			userIds: room.userIds||null,
			tokens: room.tokens,
			paused: !!room.paused,
			lastActivity: room.lastActivity||Date.now()
		};
	}catch{ return null; }
}
function saveRooms(){ try{ const payload={ nextRoomId, rooms: [...rooms.values()].map(serializeRoom).filter(Boolean) }; fs.writeFileSync(SAVE_FILE, JSON.stringify(payload)); }catch{} }
function restoreRooms(){
	try{
		if(!fs.existsSync(SAVE_FILE)) return;
		const raw=JSON.parse(fs.readFileSync(SAVE_FILE,'utf8'));
		nextRoomId=Math.max(1,Number(raw.nextRoomId)||1);
		const list=Array.isArray(raw.rooms)?raw.rooms:[];
		for(const s of list){
			try{
				const game=new RaumGame();
				// Restore saved board and side-to-move when available
				if(Array.isArray(s.board) && s.board.length===5){
					try{ game.state.board = s.board; }catch{}
				}
				if(s.sideToMove==='w' || s.sideToMove==='b'){
					try{ game.state.sideToMove = s.sideToMove; }catch{}
				}
				const room={ id:Number(s.id)||nextRoomId++, game, players:[null,null], usernames:s.usernames||{w:'White',b:'Black'}, userIds:(s.userIds&&(typeof s.userIds.w!=='undefined'||typeof s.userIds.b!=='undefined'))?s.userIds:{w:null,b:null}, pieceColors:s.pieceColors||{w:'#e5e7eb',b:'#111827'}, avatars:s.avatars||{w:'rocket',b:'alien'}, mode: (s.mode==='free'?'free':'strict'), tokens:(s.tokens&&s.tokens[1]&&s.tokens[2])?s.tokens:{1:uuidv4(),2:uuidv4()}, rematchVotes:new Set(), countdownTimer:null, countdownValue:null, paused:!!s.paused, lastActivity:Number(s.lastActivity)||Date.now() };
				rooms.set(room.id, room);
			}catch{}
		}
	}catch{}
}
restoreRooms();

function broadcastPresence(room){ try{ if(!room) return; const present = { w: isOpen(room.players[0]), b: isOpen(room.players[1]) }; broadcast(room, { type:'presence', present }); }catch{} }
function addToWaiting(ws){ if(!isOpen(ws)) return false; waitingSet.add(ws); return true; }
function cleanWaiting(){ for(const ws of [...waitingSet]) if(!isOpen(ws)) waitingSet.delete(ws); return waitingSet.size; }
function takePair(){ cleanWaiting(); const live=[...waitingSet]; if(live.length>=2){ const a=live[0]; const b=live.find(x=>x!==a); if(b){ waitingSet.delete(a); waitingSet.delete(b); return [a,b]; } } return null; }
function stakesFor(room){ const[a,b]=room.players; const sa=state.get(a)?.stake; const sb=state.get(b)?.stake; return { w:(typeof sa==='number'?sa:'—'), b:(typeof sb==='number'?sb:'—') }; }

function startCountdown(roomId){ const room=rooms.get(roomId); if(!room) return; room.countdownValue=5; const payload={ usernames:room.usernames, stakes:stakesFor(room), pieceColors: room.pieceColors, avatars: room.avatars, mode: room.mode || 'strict', type:'paired', gameId: roomId }; const [a,b]=room.players; send(a,{...payload,you:1, token: room.tokens?.[1]}); send(b,{...payload,you:2, token: room.tokens?.[2]}); sendCountdown(room); room.countdownTimer=setInterval(()=>{ const r=rooms.get(roomId); if(!r) return; if(!r.players.every(isOpen)){ cancelCountdown(roomId,true); return; } r.countdownValue-=1; if(r.countdownValue>0){ sendCountdown(r); return; } clearInterval(r.countdownTimer); r.countdownTimer=null; r.countdownValue=null; const start={ type:'startGame', currentColor:r.game.currentColor, board: r.game.toBoard(), pieceColors: r.pieceColors, avatars: r.avatars, mode: r.mode || 'strict', gameId: roomId }; const[sa,sb]=r.players; send(sa,{...start,playerNumber:1, token: r.tokens?.[1]}); send(sb,{...start,playerNumber:2, token: r.tokens?.[2]});
	// Immediately broadcast presence so both clients mark each other online at game start
	try{ broadcastPresence(r); }catch{}
	saveRooms(); },1000); }
function sendCountdown(room){ if(room.countdownValue==null) return; broadcast(room,{ type:'countdown', value:room.countdownValue }); }
function cancelCountdown(roomId,notify){ const room=rooms.get(roomId); if(!room) return; if(room.countdownTimer){ clearInterval(room.countdownTimer); room.countdownTimer=null; } room.countdownValue=null; if(notify){ for(const ws of room.players) if(isOpen(ws)) send(ws,{type:'opponentLeft'}); } destroyRoom(roomId); }
function createRoom(a,b){ if(!isOpen(a)||!isOpen(b)||a===b) return; const id=nextRoomId++; const game=new RaumGame(); const stA=state.get(a)||{}; const stB=state.get(b)||{}; const nameA=(stA.username||'White').toString().slice(0,40)||'White'; const nameB=(stB.username||'Black').toString().slice(0,40)||'Black'; const usernames={ w:nameA, b:nameB }; const defaultW = '#e5e7eb'; const defaultB = '#111827'; const pieceColors = { w: (typeof stA.pieceColor==='string'?stA.pieceColor:defaultW), b: (typeof stB.pieceColor==='string'?stB.pieceColor:defaultB) }; const avatars = { w: (typeof stA.avatar==='string'?stA.avatar:'rocket'), b: (typeof stB.avatar==='string'?stB.avatar:'alien') }; const userIds = { w: (Number.isFinite(stA.userId)?stA.userId:null), b: (Number.isFinite(stB.userId)?stB.userId:null) }; const tokens = { 1: uuidv4(), 2: uuidv4() }; rooms.set(id,{ id, game, players:[a,b], usernames, userIds, pieceColors, avatars, mode:'strict', tokens, rematchVotes:new Set(), countdownTimer:null, countdownValue:null, paused:false, lastActivity: Date.now() }); state.set(a,{...stA,roomId:id,playerNumber:1,alive:true}); state.set(b,{...stB,roomId:id,playerNumber:2,alive:true}); try{ console.log('[raum] createRoom', id, usernames); }catch{} saveRooms(); startCountdown(id); }
function destroyRoom(id){ const room=rooms.get(id); if(!room) return; if(room.countdownTimer){ clearInterval(room.countdownTimer); room.countdownTimer=null; } for(const ws of room.players){ const st=state.get(ws); if(st){ delete st.roomId; delete st.playerNumber; } } rooms.delete(id); saveRooms(); }

function withRoom(ws, fn){ const st=state.get(ws)||{}; const id=st.roomId; if(!id) return; const room=rooms.get(id); if(room) fn(room, st); }

setInterval(()=>{
	for(const ws of (wss?.clients||[])){
		const st=state.get(ws)||{}; if(st.alive===false){ try{ws.terminate();}catch{} disconnect(ws); continue; }
		st.alive=true; state.set(ws,st); try{ws.ping();}catch{}
	}
	// clean waiting + opportunistic pairing
	try{
		const before = waitingSet.size; for(const ws of [...waitingSet]) if(!isOpen(ws)) waitingSet.delete(ws);
		const after = waitingSet.size; if(before!==after) logLine(`waiting cleanup: ${before} -> ${after}`);
		const picked = takePair();
		if(picked){ const [a,b] = picked; logLine('periodic sweep paired two clients'); createRoom(a,b); }
	}catch{}
},30000);

function disconnect(ws){ waitingSet.delete(ws); const st=state.get(ws); if(st?.roomId){ const room=rooms.get(st.roomId); if(room){ if(room.countdownValue!=null){ cancelCountdown(room.id,true); state.delete(ws); return; } room.paused=true; room.lastActivity=Date.now(); saveRooms(); const side = st.playerNumber===2?'b':'w'; broadcast(room,{ type:'playerLeft', side }); broadcastPresence(room); } } state.delete(ws); }

function attachHandlers(){
if(!wss) return;
wss.on('connection',(ws)=>{
	try{ console.log('[raum] client connected'); logLine('[raum] client connected'); }catch{}
	state.set(ws,{alive:true}); ws.on('pong',()=>{ const st=state.get(ws); if(st) st.alive=true; });
	send(ws, { type:'hello', ts: Date.now() });
	ws.on('message',(raw)=>{
		let data; try{ data=JSON.parse(raw.toString()); }catch{ return; }
		try{ console.log('[raum] recv', data && data.type ? data.type : typeof data); logLine(`[raum] recv ${data && data.type ? data.type : typeof data}`); }catch{}
		const st=state.get(ws)||{};
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
				broadcast(room, { type:'quickChat', from: side, username: name, text, ts: now });
				break;
			}
			case 'setUsername':{ const v=(data.username||'').toString().slice(0,40); state.set(ws,{...st, username:v}); withRoom(ws,(room,st2)=>{ const side=st2.playerNumber===2?'b':'w'; room.usernames[side]=v; broadcast(room,{ type:'usernames', usernames: room.usernames }); saveRooms(); }); break; }
			case 'setAvatar':{ const v=(data.avatar||'rocket').toString(); state.set(ws,{...st, avatar:v}); withRoom(ws,(room,st2)=>{ const side=st2.playerNumber===2?'b':'w'; room.avatars[side]=v; broadcast(room,{ type:'avatars', avatars: room.avatars }); saveRooms(); }); break; }
			case 'setPieceColor':{ const v=(data.pieceColor||'').toString(); state.set(ws,{...st, pieceColor:v}); withRoom(ws,(room,st2)=>{ const side=st2.playerNumber===2?'b':'w'; if(v) room.pieceColors[side]=v; broadcast(room,{ type:'pieceColors', pieceColors: room.pieceColors }); saveRooms(); }); break; }
			// setMode removed: strict-only queuing
			case 'setStake':{
				let n = Number(data.stake);
				if(!Number.isFinite(n) || n < 0) n = 0;
				n = Math.min(n, 1_000_000);
				// Round to 2 decimals
				n = Math.round(n * 100) / 100;
				state.set(ws,{...st, stake:n});
				// If already paired, we could broadcast updated stakes, but client currently reads them on 'paired'.
				break;
			}
	case 'queue':{
				// Allow atomic queue: accept identity/mode/stake in the same message to avoid races
				let name = (data.username || st.username || '').toString().slice(0,40);
				if(!name) name = 'Player';
				const pieceColor = typeof data.pieceColor === 'string' && data.pieceColor ? data.pieceColor : st.pieceColor;
				const avatar = typeof data.avatar === 'string' && data.avatar ? data.avatar : st.avatar;
				let stake = Number.isFinite(Number(data.stake)) ? Number(data.stake) : st.stake;
				if(!Number.isFinite(stake)) stake = 0; stake = Math.max(0, Math.min(1_000_000, Math.round(stake*100)/100));
	const userId = Number(data.userId);
	state.set(ws,{...st, username:name, pieceColor, avatar, stake, ...(Number.isFinite(userId)?{ userId }:{})});
				addToWaiting(ws);
				const w1 = cleanWaiting();
				try{ logLine(`enqueue via queue: waiting=${w1}`); console.log('[raum] enqueue via queue waiting=', w1); }catch{}
				let picked = takePair();
				if(!picked){
					send(ws,{ type:'queued' });
					setTimeout(()=>{ try{ const again = takePair(); if(again){ const [a,b]=again; console.log('[raum] delayed pair (queue)'); createRoom(a,b); } }catch{} }, 50);
					break;
				}
				{ const [a,b] = picked; try{ logLine(`pair via queue -> room create`); console.log('[raum] pair via queue'); }catch{} createRoom(a,b); }
				break;
			}
	case 'joinGame':{
				// Mirror Chess: accept identity fields, enqueue, respond queued, maybe create room
				let name = (data.username || st.username || '').toString().slice(0,40);
				if(!name) name = 'Player';
				const pieceColor = typeof data.pieceColor === 'string' && data.pieceColor ? data.pieceColor : st.pieceColor;
				const avatar = typeof data.avatar === 'string' && data.avatar ? data.avatar : st.avatar;
				let stake = Number.isFinite(Number(data.stake)) ? Number(data.stake) : st.stake;
				if(!Number.isFinite(stake)) stake = 0; stake = Math.max(0, Math.min(1_000_000, Math.round(stake*100)/100));
	const userId = Number(data.userId);
	state.set(ws,{...st, username:name, pieceColor, avatar, stake, ...(Number.isFinite(userId)?{ userId }:{})});
				addToWaiting(ws);
				const w1 = cleanWaiting();
				try{ logLine(`enqueue via joinGame: waiting=${w1}`); console.log('[raum] enqueue via joinGame waiting=', w1); }catch{}
				send(ws,{ type:'queued' });
				let picked = takePair();
				if(picked){ const [a,b] = picked; try{ logLine(`pair via joinGame -> room create`); console.log('[raum] pair via joinGame'); }catch{} createRoom(a,b); }
				else {
					setTimeout(()=>{ try{ const again = takePair(); if(again){ const [a,b]=again; console.log('[raum] delayed pair (joinGame)'); createRoom(a,b); } }catch{} }, 50);
				}
				break;
			}
			case 'getMoves':{
				withRoom(ws,(room,st2)=>{ const you = st2.playerNumber===2?'b':'w'; if(room.game.currentColor!==you){ send(ws,{ type:'moves', moves:[] }); return; } const moves=engine.generateLegal(room.game.state); send(ws,{ type:'moves', moves }); }); break;
			}
			case 'makeMove':
			case 'move':{
				withRoom(ws,(room,st2)=>{
					const you = st2.playerNumber===2?'b':'w'; if(room.game.currentColor!==you){ send(ws,{ type:'denied' }); return; }
					const { from, to } = data; if(!from||!to){ send(ws,{ type:'illegal' }); return; }
					const mv = room.game.makeMove(from,to); if(!mv){ send(ws,{ type:'illegal' }); return; }
					room.lastActivity=Date.now(); const payload={ type:'update', board: room.game.toBoard(), currentColor: room.game.currentColor, lastMove: mv, checkSq: engine.kingInCheckSquare(room.game.state) };
					broadcast(room,payload); saveRooms();
				});
				break;
			}
			case 'leave':{
				// Mirror Chess 'leaveGame': pause room, detach player socket, broadcast presence
				const s=state.get(ws);
				if(s?.roomId){
					const room=rooms.get(s.roomId);
					if(room){
						if(room.countdownValue!=null){ cancelCountdown(room.id,true); }
						else {
							room.paused=true; room.lastActivity=Date.now();
							if(s.playerNumber===1 || s.playerNumber===2){ room.players[s.playerNumber-1]=null; }
							try{ console.log(`[raum] leave: room #${room.id} side ${s.playerNumber} paused=true usernames=`, room.usernames); logLine(`[leave] room #${room.id} side ${s.playerNumber}`); }catch{}
							const side = s.playerNumber===2?'b':'w';
							broadcast(room,{ type:'playerLeft', side });
							broadcastPresence(room);
							saveRooms();
						}
					}
					const st2=state.get(ws)||{}; delete st2.roomId; delete st2.playerNumber; state.set(ws,st2);
				}
				try{ ws.close(); }catch{}
				break;
			}
			case 'joinSavedGame':{
				const id = Number(data.gameId)||0; const token = (data.token||'').toString();
				const room = rooms.get(id);
				try{
					console.log(`[saved] joinSavedGame request id=${id} token?=${!!token} roomsKeys=[${[...rooms.keys()].join(',')}]`);
					console.log(`[saved] joinSavedGame room snapshot id=${id}: usernames=`, room?.usernames, 'userIds=', room?.userIds, 'paused=', room?.paused);
					logLine(`[saved] joinSavedGame req id=${id} token?=${!!token} room?=${!!room}`);
				}catch{}
	if(!room){ send(ws,{ type:'savedDenied', reason:'no-room' }); break; }
				waitingSet.delete(ws);
				let slot=null; if(token===room.tokens?.[1]) slot=1; else if(token===room.tokens?.[2]) slot=2;
				if(!slot){
					const uid = Number(data.userId);
					if(Number.isFinite(uid) && room.userIds){
						if(room.userIds.w === uid && room.userIds.b !== uid) slot = 1;
						else if(room.userIds.b === uid && room.userIds.w !== uid) slot = 2;
						else if(room.userIds.w === uid && room.userIds.b === uid){
							const p1=room.players[0], p2=room.players[1]; if(!isOpen(p1)) slot=1; else if(!isOpen(p2)) slot=2;
						}
					}
				}
				if(!slot){
					const name = (data.username || state.get(ws)?.username || '').toString().slice(0,40);
					if(name){ const u=room.usernames||{}; const matchW=u.w===name; const matchB=u.b===name; if(matchW && !matchB) slot=1; else if(!matchW && matchB) slot=2; else if(matchW && matchB){ const p1=room.players[0], p2=room.players[1]; if(!isOpen(p1)) slot=1; else if(!isOpen(p2)) slot=2; }
					}
				}
				if(!slot){ if(data.allowAny===true){ const p1=room.players[0], p2=room.players[1]; if(!isOpen(p1)) slot=1; else if(!isOpen(p2)) slot=2; } }
	if(!slot){ try{ console.log(`[saved] joinSavedGame denied: no slot id=${id} token?=${!!token} name='${(data.username||'')}'`); logLine(`[saved] joinSavedGame denied (no slot) id=${id}`);}catch{} send(ws,{ type:'savedDenied', reason:'no-slot' }); break; }
				room.players[slot-1] = ws;
				const sideKey = (slot===1)?'w':'b';
				if(!room.userIds) room.userIds={ w:null, b:null };
				const uid1 = Number(data.userId); if(Number.isFinite(uid1)) room.userIds[sideKey]=uid1;
				if(typeof data.username==='string' && data.username){ if(!room.usernames) room.usernames={ w:'White', b:'Black' }; room.usernames[sideKey] = data.username.toString().slice(0,40); }
				room.paused=true; room.lastActivity=Date.now();
				state.set(ws,{ ...(state.get(ws)||{}), roomId: room.id, playerNumber: slot, alive:true });
				try{ console.log(`[raum saved] joinSavedGame: room #${room.id} slot ${slot}`); logLine(`[saved] joinSavedGame room #${room.id} slot ${slot}`);}catch{}
	send(ws,{ type:'savedQueued', you: slot, usernames: room.usernames, pieceColors: room.pieceColors, avatars: room.avatars, mode: room.mode || 'strict', gameId: room.id, token: room.tokens?.[slot] });
				broadcastPresence(room); saveRooms();
				try{ const p1Open=isOpen(room.players[0]); const p2Open=isOpen(room.players[1]); const msg=`[saved] presence after joinSavedGame room #${room.id}: w=${p1Open} b=${p2Open}`; console.log(msg); logLine(msg);}catch{}
				if(room.players.every(isOpen)){
					if(!room.countdownTimer && room.countdownValue==null){ try{ const msg=`[saved] starting countdown for room #${room.id} (joinSavedGame)`; console.log(msg); logLine(msg);}catch{} startCountdown(room.id); }
				}
				break;
			}
			case 'resumeGame':{
				const id=Number(data.gameId)||0; const token=(data.token||'').toString(); const room=rooms.get(id); if(!room){ send(ws,{type:'resumeDenied'}); break; }
				let slot=null; if(token===room.tokens?.[1]) slot=1; else if(token===room.tokens?.[2]) slot=2; if(!slot){ send(ws,{type:'resumeDenied'}); break; }
				room.players[slot-1]=ws; room.paused=false; room.lastActivity=Date.now(); state.set(ws,{ ...(state.get(ws)||{}), roomId: room.id, playerNumber: slot, alive:true });
				const start={ type:'startGame', currentColor:room.game.currentColor, board: room.game.toBoard(), pieceColors: room.pieceColors, avatars: room.avatars, mode: room.mode || 'strict', gameId: room.id };
				send(ws,{...start, playerNumber: slot, token: room.tokens?.[slot]}); const opp=room.players[(slot===1)?1:0]; if(isOpen(opp)) send(opp,{ type:'playerBack', side: slot===2?'b':'w' }); broadcastPresence(room); saveRooms();
				break;
			}
	case 'listMySavedGames':{
				const name=(data.username || state.get(ws)?.username || '').toString().slice(0,40); const uid=Number(data.userId); const out=[];
				for(const room of rooms.values()){
					let you=null; if(Number.isFinite(uid) && room.userIds){ if(room.userIds.w===uid) you=1; else if(room.userIds.b===uid) you=2; }
					if(!you && name){ const u=room.usernames||{}; if(u.w===name) you=1; else if(u.b===name) you=2; }
					if(you){ out.push({ gameId: room.id, you, usernames: room.usernames, mode: room.mode || 'strict', paused: !!room.paused }); }
				}
				send(ws,{ type:'mySavedGames', list: out });
				break;
			}
			case 'finishSavedGame':{
				const id=Number(data.gameId)||0; const room=rooms.get(id); if(!room){ send(ws,{ type:'savedRemoved', gameId:id, ok:false }); break; }
				const uid=Number(data.userId); const name=(data.username || state.get(ws)?.username || '').toString().slice(0,40);
				let authorized=false; if(Number.isFinite(uid) && room.userIds){ if(room.userIds.w===uid || room.userIds.b===uid) authorized=true; }
				if(!authorized && name){ const u=room.usernames||{}; if(u.w===name || u.b===name) authorized=true; }
	if(!authorized){ send(ws,{ type:'savedDenied', reason:'unauthorized' }); break; }
				destroyRoom(id); send(ws,{ type:'savedRemoved', gameId:id, ok:true });
				break;
			}
			case 'claimSavedGame':{
				let id=Number(data.gameId)||0; let room=rooms.get(id);
				waitingSet.delete(ws);
				const uid=Number(data.userId); const name=((state.get(ws)?.username)||data.username||'').toString().slice(0,40);
				try{
					console.log(`[saved] claimSavedGame request id=${id} name='${name}' uid=${uid} roomsKeys=[${[...rooms.keys()].join(',')}]`);
					if(room){ console.log(`[saved] claimSavedGame room snapshot id=${id}: usernames=`, room.usernames, 'userIds=', room.userIds, 'paused=', room.paused, 'playersOpen=', [isOpen(room.players[0]), isOpen(room.players[1])]); }
					logLine(`[saved] claimSavedGame req id=${id} name='${name}' uid=${uid} room?=${!!room}`);
				}catch{}
	if(!Number.isFinite(uid) && !name){ try{ console.log('[saved] claimSavedGame denied: no identity provided'); }catch{} send(ws,{ type:'savedDenied', reason:'no-identity' }); break; }
				if(!room){ const other=(data.otherUsername||'').toString().slice(0,40); const candidates=[]; for(const r of rooms.values()){ const u=r.usernames||{}; const ids=r.userIds||{}; const hasYou = Number.isFinite(uid) ? (ids.w===uid || ids.b===uid) : (u.w===name || u.b===name); const hasOther = other ? (u.w===other || u.b===other) : true; if(hasYou && hasOther){ candidates.push(r); } } if(candidates.length){ candidates.sort((a,b)=> (Number(b.lastActivity||0)-Number(a.lastActivity||0)) || (Number(b.id)-Number(a.id)) ); let pick=candidates.find(r=>r.paused) || candidates[0]; room=pick; id=room?.id||0; } }
	if(!room){ try{ console.log(`[saved] claimSavedGame denied: no room for id=${id}`); logLine(`[saved] claimSavedGame denied (no room) id=${id}`);}catch{} send(ws,{ type:'savedDenied', reason:'no-room' }); break; }
	const u=room.usernames||{}; const ids=room.userIds||{}; let slot=null; if(Number.isFinite(uid)){ const matchWId=ids.w===uid, matchBId=ids.b===uid; try{ logLine(`[saved] claim id-match check: uid=${uid} w=${String(ids.w)} b=${String(ids.b)} -> w?=${matchWId} b?=${matchBId}`); }catch{} if(matchWId && !matchBId) slot=1; else if(!matchWId && matchBId) slot=2; else if(matchWId && matchBId){ const p1=room.players[0], p2=room.players[1]; if(!isOpen(p1)) slot=1; else if(!isOpen(p2)) slot=2; }
				}
	if(!slot && name){ const matchW=u.w===name, matchB=u.b===name; try{ console.log(`[saved] claim attempt name='${name}' vs`, u); logLine(`[saved] claim name-match: name='${name}' u.w='${u.w}' u.b='${u.b}' -> w?=${matchW} b?=${matchB}`); }catch{} if(matchW && !matchB) slot=1; else if(!matchW && matchB) slot=2; else if(matchW && matchB){ const p1=room.players[0], p2=room.players[1]; if(!isOpen(p1)) slot=1; else if(!isOpen(p2)) slot=2; } }
	try{ logLine(`[saved] claim computed slot=${slot} for id=${id}`); }catch{}
				if(!slot){
					// Guarded fallback: if a concrete gameId is provided and room is paused, attach to any free slot
					if(id && room && room.paused===true){
						const p1=room.players[0], p2=room.players[1];
						if(!isOpen(p1)) slot=1; else if(!isOpen(p2)) slot=2;
						try{ logLine(`[saved] claimSavedGame fallback slot=${slot} for id=${id}`); }catch{}
					}
				}
	if(!slot){ try{ console.log(`[saved] claimSavedGame denied: no slot for name='${name}' uid=${uid} in room #${room.id}`); logLine(`[saved] claimSavedGame denied (no slot) id=${room.id} name='${name}' uid=${uid}`);}catch{} send(ws,{ type:'savedDenied', reason:'no-slot' }); break; }
				const existing=room.players[slot-1]; if(existing && existing!==ws && isOpen(existing)){
					const bothMatch = Number.isFinite(uid) ? ((room.userIds?.w===uid) && (room.userIds?.b===uid)) : ((room.usernames?.w===name) && (room.usernames?.b===name));
					if(bothMatch){ const alt=slot===1?2:1; const altExisting=room.players[alt-1]; if(!isOpen(altExisting)) slot=alt; else { send(ws,{ type:'savedDenied', reason:'both-slots-taken' }); break; } }
					else { send(ws,{ type:'savedDenied', reason:'slot-taken' }); break; }
				}
				room.players[slot-1]=ws; room.paused=true; room.lastActivity=Date.now();
				const sideKey2=(slot===1)?'w':'b'; if(!room.userIds) room.userIds={ w:null, b:null }; if(Number.isFinite(uid)) room.userIds[sideKey2]=uid; if(typeof name==='string' && name){ if(!room.usernames) room.usernames={ w:'White', b:'Black' }; room.usernames[sideKey2]=name; }
				state.set(ws,{ ...(state.get(ws)||{}), roomId: room.id, playerNumber: slot, alive:true });
				try{ console.log(`[saved] claimSavedGame: room #${room.id} slot ${slot} by name='${name}'`); }catch{}
	send(ws,{ type:'savedQueued', you: slot, usernames: room.usernames, pieceColors: room.pieceColors, avatars: room.avatars, mode: room.mode || 'strict', gameId: room.id, token: room.tokens?.[slot] });
				broadcastPresence(room); saveRooms();
				try{ const p1Open=isOpen(room.players[0]); const p2Open=isOpen(room.players[1]); const msg=`[saved] presence after claimSavedGame room #${room.id}: w=${p1Open} b=${p2Open}`; console.log(msg); logLine(msg);}catch{}
				if(room.players.every(isOpen)){
					if(!room.countdownTimer && room.countdownValue==null){ try{ const msg=`[saved] starting countdown for room #${room.id} (claimSavedGame)`; console.log(msg); logLine(msg);}catch{} startCountdown(room.id); }
				}
				break;
			}
			case 'leaveGame':{
				const s=state.get(ws);
				if(s?.roomId){
					const room=rooms.get(s.roomId);
					if(room){
						if(room.countdownValue!=null){ cancelCountdown(room.id,true); }
						else {
							room.paused=true; room.lastActivity=Date.now();
							if(s.playerNumber===1 || s.playerNumber===2){ room.players[s.playerNumber-1]=null; }
							const side = s.playerNumber===2?'b':'w'; broadcast(room,{ type:'playerLeft', side }); broadcastPresence(room); saveRooms();
						}
					}
					const st2=state.get(ws)||{}; delete st2.roomId; delete st2.playerNumber; state.set(ws,st2);
				}
				break;
			}
			default: break;
		}
	});
	ws.on('close',()=>{ waitingSet.delete(ws); disconnect(ws); });
});
}

// Standalone unless unified
if(process.env.UNIFIED_WS !== '1'){
	standaloneServer = http.createServer(app);
	wss = new WebSocket.Server({ server: standaloneServer });
	attachHandlers();
	standaloneServer.listen(PORT,'0.0.0.0',()=>{ console.log(`Raumschach WS listening on http://0.0.0.0:${PORT}`); try{ logLine(`server listening on ${PORT}`);}catch{} });
}

// Unified attach API
module.exports.attachUnified = function(server, path='/ws/raum'){
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
