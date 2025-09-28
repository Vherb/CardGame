// CommonJS wrapper of Raumschach (5x5x5) engine for Node server use
const SIZE = 5;

function emptyBoard(){
	return Array.from({length:SIZE},()=>Array.from({length:SIZE},()=>Array(SIZE).fill(null)));
}

function inBounds(f,r,l){ return f>=0 && f<SIZE && r>=0 && r<SIZE && l>=0 && l<SIZE; }
function other(c){ return c==='w'?'b':'w'; }

function createInitialState(){
	const board = emptyBoard();
	const place = (l,r,f,t,c)=>{ board[l][r][f] = { t, c }; };
	const back = ['R','N','K','N','R'];
	const midBack = ['U','B','Q','B','U'];
	for(let f=0; f<5; f++){
		place(0,0,f, back[f], 'w');
		place(0,1,f, 'P', 'w');
		place(1,0,f, midBack[f], 'w');
		place(1,1,f, 'P', 'w');
	}
	for(let f=0; f<5; f++){
		place(4,4,f, back[f], 'b');
		place(4,3,f, 'P', 'b');
		place(3,4,f, midBack[f], 'b');
		place(3,3,f, 'P', 'b');
	}
	return { board, sideToMove:'w', history:[] };
}

function cloneBoard(board){
	return board.map(level=> level.map(row=> row.slice()));
}

function rayMoves(board,f,r,l,c,dirs){
	const moves=[];
	for(const [df,dr,dl] of dirs){
		let nf=f+df, nr=r+dr, nl=l+dl;
		while(inBounds(nf,nr,nl)){
			const occ = board[nl][nr][nf];
			if(!occ){ moves.push([nf,nr,nl]); }
			else { if(occ.c!==c) moves.push([nf,nr,nl]); break; }
		}
	}
	return moves;
}

const DIRS = {
	rook: [ [1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1] ],
	bishop: [
		[1,1,0],[1,-1,0],[-1,1,0],[-1,-1,0],
		[1,0,1],[1,0,-1],[-1,0,1],[-1,0,-1],
		[0,1,1],[0,1,-1],[0,-1,1],[0,-1,-1]
	],
	unicorn: [
		[1,1,1],[1,1,-1],[1,-1,1],[1,-1,-1],
		[-1,1,1],[-1,1,-1],[-1,-1,1],[-1,-1,-1]
	]
};

function knightMoves(board,f,r,l,c){
	const moves=[];
	const steps=[-2,-1,0,1,2];
	for(const df of steps) for(const dr of steps) for(const dl of steps){
		const a=[Math.abs(df),Math.abs(dr),Math.abs(dl)].sort((a,b)=>a-b);
		if(a[0]===0 && a[1]===1 && a[2]===2){
			const nf=f+df, nr=r+dr, nl=l+dl;
			if(!inBounds(nf,nr,nl)) continue;
			const pc = board[nl][nr][nf];
			if(!pc || pc.c!==c) moves.push([nf,nr,nl]);
		}
	}
	return moves;
}

function genMoves(board,f,r,l,c){
	const pc=board[l][r][f]; if(!pc||pc.c!==c) return [];
	const moves=[];
	switch(pc.t){
		case 'R': moves.push(...rayMoves(board,f,r,l,c,DIRS.rook)); break;
		case 'B': moves.push(...rayMoves(board,f,r,l,c,DIRS.bishop)); break;
		case 'Q': moves.push(...rayMoves(board,f,r,l,c,[...DIRS.rook,...DIRS.bishop,...DIRS.unicorn])); break;
		case 'U': moves.push(...rayMoves(board,f,r,l,c,DIRS.unicorn)); break;
		case 'N': moves.push(...knightMoves(board,f,r,l,c)); break;
		case 'K':
			for(const df of [-1,0,1]) for(const dr of [-1,0,1]) for(const dl of [-1,0,1]){
				if(df===0 && dr===0 && dl===0) continue; const nf=f+df, nr=r+dr, nl=l+dl;
				if(inBounds(nf,nr,nl)){
					const tgt=board[nl][nr][nf]; if(!tgt || tgt.c!==c) moves.push([nf,nr,nl]);
				}
			}
			break;
		case 'P': {
			const dir = (c==='w')? 1 : -1; // ranks forward
			const nr=r+dir;
			if(inBounds(f,nr,l) && !board[l][nr][f]) moves.push([f,nr,l]);
			for(const df of [-1,1]){
				if(inBounds(f+df,nr,l) && board[l][nr][f+df] && board[l][nr][f+df].c!==c) moves.push([f+df,nr,l]);
			}
			for(const dl of [-1,1]){
				if(inBounds(f,nr,l+dl) && board[l+dl][nr][f] && board[l+dl][nr][f].c!==c) moves.push([f,nr,l+dl]);
			}
			break; }
		default: break;
	}
	return moves.map(([nf,nr,nl])=> ({ from:{f,r,l}, to:{f:nf,r:nr,l:nl} }));
}

function inBoundsFRL(f,r,l){ return inBounds(f,r,l); }

function findKing(board, c){
	for(let l=0;l<SIZE;l++) for(let r=0;r<SIZE;r++) for(let f=0;f<SIZE;f++){
		const pc=board[l][r][f]; if(pc && pc.c===c && pc.t==='K') return {f,r,l};
	}
	return null;
}

function attacksFromRays(board, f, r, l, byColor){
	for(const [df,dr,dl] of DIRS.rook){
		let nf=f+df, nr=r+dr, nl=l+dl;
		while(inBoundsFRL(nf,nr,nl)){
			const pc=board[nl][nr][nf];
			if(pc){ if(pc.c===byColor && (pc.t==='R' || pc.t==='Q')) return true; break; }
			nf+=df; nr+=dr; nl+=dl;
		}
	}
	for(const [df,dr,dl] of DIRS.bishop){
		let nf=f+df, nr=r+dr, nl=l+dl;
		while(inBoundsFRL(nf,nr,nl)){
			const pc=board[nl][nr][nf];
			if(pc){ if(pc.c===byColor && (pc.t==='B' || pc.t==='Q')) return true; break; }
			nf+=df; nr+=dr; nl+=dl;
		}
	}
	for(const [df,dr,dl] of DIRS.unicorn){
		let nf=f+df, nr=r+dr, nl=l+dl;
		while(inBoundsFRL(nf,nr,nl)){
			const pc=board[nl][nr][nf];
			if(pc){ if(pc.c===byColor && (pc.t==='U' || pc.t==='Q')) return true; break; }
			nf+=df; nr+=dr; nl+=dl;
		}
	}
	return false;
}

function attacksFromKnights(board, f, r, l, byColor){
	const deltas=[]; const vals=[-2,-1,1,2];
	for(const a of vals) for(const b of vals){ if(Math.abs(a)===Math.abs(b)) continue; const perms = [[a,b,0],[a,0,b],[0,a,b],[b,a,0],[b,0,a],[0,b,a]]; for(const p of perms) deltas.push(p); }
	const seen=new Set();
	for(const [df,dr,dl] of deltas){
		const nf=f-df, nr=r-dr, nl=l-dl;
		const key=`${nf},${nr},${nl}`; if(seen.has(key)) continue; seen.add(key);
		if(!inBoundsFRL(nf,nr,nl)) continue;
		const pc=board[nl][nr][nf]; if(pc && pc.c===byColor && pc.t==='N') return true;
	}
	return false;
}

function attacksFromPawns(board, f, r, l, byColor){
	const dir = (byColor==='w') ? 1 : -1;
	const sr = r - dir;
	if(inBoundsFRL(f-1,sr,l)){ const pc=board[l][sr][f-1]; if(pc && pc.c===byColor && pc.t==='P') return true; }
	if(inBoundsFRL(f+1,sr,l)){ const pc=board[l][sr][f+1]; if(pc && pc.c===byColor && pc.t==='P') return true; }
	if(inBoundsFRL(f,sr,l-1)){ const pc=board[l-1]?.[sr]?.[f]; if(pc && pc.c===byColor && pc.t==='P') return true; }
	if(inBoundsFRL(f,sr,l+1)){ const pc=board[l+1]?.[sr]?.[f]; if(pc && pc.c===byColor && pc.t==='P') return true; }
	return false;
}

function attacksFromKing(board, f, r, l, byColor){
	for(let df=-1; df<=1; df++) for(let dr=-1; dr<=1; dr++) for(let dl=-1; dl<=1; dl++){
		if(df===0 && dr===0 && dl===0) continue;
		const nf=f-df, nr=r-dr, nl=l-dl;
		if(!inBoundsFRL(nf,nr,nl)) continue;
		const pc=board[nl][nr][nf]; if(pc && pc.c===byColor && pc.t==='K') return true;
	}
	return false;
}

function isSquareAttacked(board, f, r, l, byColor){
	if(attacksFromRays(board,f,r,l,byColor)) return true;
	if(attacksFromKnights(board,f,r,l,byColor)) return true;
	if(attacksFromPawns(board,f,r,l,byColor)) return true;
	if(attacksFromKing(board,f,r,l,byColor)) return true;
	return false;
}

function inCheck(board, c){
	const k = findKing(board, c); if(!k) return false;
	return isSquareAttacked(board, k.f, k.r, k.l, other(c));
}

function generatePseudo(state){
	const res=[]; const {board, sideToMove:c} = state;
	for(let l=0;l<SIZE;l++) for(let r=0;r<SIZE;r++) for(let f=0;f<SIZE;f++) if(board[l][r][f] && board[l][r][f].c===c){
		res.push(...genMoves(board,f,r,l,c));
	}
	return res;
}

function generateLegal(state){
	const moves = generatePseudo(state);
	const legal=[];
	for(const mv of moves){
		const b2 = cloneBoard(state.board);
		const pc = b2[mv.from.l][mv.from.r][mv.from.f];
		b2[mv.to.l][mv.to.r][mv.to.f] = pc; b2[mv.from.l][mv.from.r][mv.from.f]=null;
		if(pc && pc.t==='P'){
			if(pc.c==='w' && mv.to.r===SIZE-1) b2[mv.to.l][mv.to.r][mv.to.f] = { t:'Q', c:pc.c };
			if(pc.c==='b' && mv.to.r===0) b2[mv.to.l][mv.to.r][mv.to.f] = { t:'Q', c:pc.c };
		}
		if(!inCheck(b2, state.sideToMove)) legal.push(mv);
	}
	return legal;
}

function makeMove(state, mv){
	const {board} = state; const {from,to} = mv; const pc = board[from.l][from.r][from.f]; if(!pc) return false;
	board[to.l][to.r][to.f] = pc; board[from.l][from.r][from.f] = null; state.sideToMove = other(state.sideToMove);
	if(pc.t==='P'){
		if(pc.c==='w' && to.r===SIZE-1) board[to.l][to.r][to.f] = { t:'Q', c:pc.c };
		if(pc.c==='b' && to.r===0) board[to.l][to.r][to.f] = { t:'Q', c:pc.c };
	}
	state.history.push(mv); return true;
}

function kingInCheckSquare(state, color){
	const c = color || state.sideToMove; const k = findKing(state.board, c); if(!k) return null;
	return isSquareAttacked(state.board, k.f, k.r, k.l, other(c)) ? k : null;
}

module.exports = {
	SIZE,
	createInitialState,
	generateLegal,
	makeMove,
	kingInCheckSquare,
};
