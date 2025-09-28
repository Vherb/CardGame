/*
	Chess Rules Engine (single-file, drop-in)
	- Board: 64-array, index 0..63 maps a8..h1 (r=0 is rank 8)
	- Pieces: { c: 'w'|'b', t: 'p'|'r'|'n'|'b'|'q'|'k' }
	- GameState: {
			board, sideToMove, castling, enPassant, halfmoveClock, fullmoveNumber,
			history: [], positionCounts: Map
		}

	Exported API:
	- initGame()
	- loadFEN(fen)
	- getFEN(game)
	- generateLegalMoves(game)
	- isLegalMove(game, move)
	- makeMove(game, move)
	- undoMove(game)
	- inCheck(game, color)
	- isCheckmate(game)
	- isStalemate(game)
	- detectDraw(game)
	- perft(game, depth)

	Implementation notes:
	- Helper functions provided below (sq/index mapping, attack detection, pseudo-legal move gen, etc.)
	- Castling validated for empty path and non-attacked squares
	- En passant: correct captured pawn removal; ep square set on double push
	- Promotions: 4 variants (q,r,b,n)
	- Undo fully restores state and positionCounts
*/

// ========== Utilities: board index/coords and algebraic ==========
function rcToIdx(r, c) { return r * 8 + c; }
function idxToRC(idx) { return [Math.floor(idx / 8), idx % 8]; }
function inBoundsRC(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
function other(color) { return color === 'w' ? 'b' : 'w'; }
const FILES = 'abcdefgh';
function idxToSquare(idx) { const [r, c] = idxToRC(idx); return FILES[c] + String(8 - r); }
function squareToIdx(sq) {
	if (!sq || sq === '-') return null;
	const file = FILES.indexOf(sq[0]); const rank = parseInt(sq[1], 10);
	const r = 8 - rank; const c = file;
	if (file < 0 || rank < 1 || rank > 8) return null;
	return rcToIdx(r, c);
}

// ========== Game init and FEN ==========
function emptyBoard() { return new Array(64).fill(null); }
function clonePiece(p) { return p ? { c: p.c, t: p.t } : null; }
function cloneBoard(b) { return b.map(clonePiece); }

function initGame() {
	const game = {
		board: emptyBoard(),
		sideToMove: 'w',
		castling: 'KQkq',
		enPassant: null,
		halfmoveClock: 0,
		fullmoveNumber: 1,
		history: [],
		positionCounts: new Map(),
	};
	// Place pieces from standard start
	const back = ['r','n','b','q','k','b','n','r'];
	// Black back rank r=0, pawns r=1
	for (let c = 0; c < 8; c++) { game.board[rcToIdx(0,c)] = { c:'b', t: back[c] }; game.board[rcToIdx(1,c)] = { c:'b', t:'p' }; }
	// White pawns r=6, back rank r=7
	for (let c = 0; c < 8; c++) { game.board[rcToIdx(6,c)] = { c:'w', t:'p' }; game.board[rcToIdx(7,c)] = { c:'w', t: back[c] }; }
	// Count initial position
	incrPositionCount(game);
	return game;
}

function loadFEN(fen) {
	const parts = (fen || '').trim().split(/\s+/);
	if (parts.length < 4) throw new Error('Invalid FEN');
	const [placement, side, castling, ep, half, full] = parts;
	const rows = placement.split('/'); if (rows.length !== 8) throw new Error('Invalid FEN placement');
	const board = emptyBoard();
	for (let r = 0; r < 8; r++) {
		const row = rows[r]; let c = 0;
		for (const ch of row) {
			if (c > 7) throw new Error('FEN row too long');
			if (/[1-8]/.test(ch)) { c += Number(ch); continue; }
			const isWhite = ch === ch.toUpperCase(); const t = ch.toLowerCase();
			if (!'prnbqk'.includes(t)) throw new Error('Invalid FEN piece');
			board[rcToIdx(r,c)] = { c: isWhite ? 'w' : 'b', t };
			c++;
		}
		if (c !== 8) throw new Error('FEN row too short');
	}
	const game = {
		board,
		sideToMove: side === 'b' ? 'b' : 'w',
		castling: castling === '-' ? '' : castling,
		enPassant: squareToIdx(ep),
		halfmoveClock: Number(half||'0'),
		fullmoveNumber: Number(full||'1'),
		history: [],
		positionCounts: new Map(),
	};
	incrPositionCount(game);
	return game;
}

function getFEN(game) {
	const parts = [];
	// Placement rows r=0..7 correspond to ranks 8..1
	for (let r = 0; r < 8; r++) {
		let row = ''; let empty = 0;
		for (let c = 0; c < 8; c++) {
			const p = game.board[rcToIdx(r,c)];
			if (!p) { empty++; continue; }
			if (empty) { row += String(empty); empty = 0; }
			const ch = p.t;
			row += p.c === 'w' ? ch.toUpperCase() : ch;
		}
		if (empty) row += String(empty);
		parts.push(row);
	}
	const placement = parts.join('/');
	const side = game.sideToMove || 'w';
	const castling = game.castling || '';
	const ep = game.enPassant == null ? '-' : idxToSquare(game.enPassant);
	const half = Number(game.halfmoveClock||0);
	const full = Number(game.fullmoveNumber||1);
	return `${placement} ${side} ${castling||'-'} ${ep} ${half} ${full}`;
}

// ========== Position key for repetition ==========
function positionKey(game) {
	// Only placement + side + castling + enPassant for repetition
	const parts = getFEN(game).split(' ');
	return parts.slice(0, 4).join(' ');
}
function incrPositionCount(game) {
	const key = positionKey(game);
	const prev = game.positionCounts.get(key) || 0;
	game.positionCounts.set(key, prev + 1);
}
function decrPositionCount(game) {
	const key = positionKey(game);
	const prev = game.positionCounts.get(key) || 0;
	if (prev > 1) game.positionCounts.set(key, prev - 1); else game.positionCounts.delete(key);
}

// ========== Attack detection ==========
function findKing(game, color) {
	for (let i = 0; i < 64; i++) { const p = game.board[i]; if (p && p.c === color && p.t === 'k') return i; }
	return -1;
}

function isSquareAttacked(squareIdx, byColor, game) {
	const b = game.board;
	const [sr, sc] = idxToRC(squareIdx);
	// Pawn attacks
	const dir = byColor === 'w' ? -1 : 1;
	for (const dc of [-1, 1]) {
		const r = sr + dir, c = sc + dc;
		if (inBoundsRC(r,c)) {
			const p = b[rcToIdx(r,c)];
			if (p && p.c === byColor && p.t === 'p') return true;
		}
	}
	// Knight attacks
	const KN = [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]];
	for (const [dr,dc] of KN) { const r=sr+dr,c=sc+dc; if(inBoundsRC(r,c)){ const p=b[rcToIdx(r,c)]; if(p&&p.c===byColor&&p.t==='n') return true; } }
	// Sliding attacks: bishops/rooks/queens
	const raysB = [[1,1],[1,-1],[-1,1],[-1,-1]];
	const raysR = [[1,0],[-1,0],[0,1],[0,-1]];
	// Bishop/Queen
	for (const [dr,dc] of raysB) {
		let r=sr+dr, c=sc+dc;
		while (inBoundsRC(r,c)) {
			const p = b[rcToIdx(r,c)];
			if (p) { if (p.c === byColor && (p.t === 'b' || p.t === 'q')) return true; break; }
			r+=dr; c+=dc;
		}
	}
	// Rook/Queen
	for (const [dr,dc] of raysR) {
		let r=sr+dr, c=sc+dc;
		while (inBoundsRC(r,c)) {
			const p = b[rcToIdx(r,c)];
			if (p) { if (p.c === byColor && (p.t === 'r' || p.t === 'q')) return true; break; }
			r+=dr; c+=dc;
		}
	}
	// King adjacency
	for (let dr=-1; dr<=1; dr++) for (let dc=-1; dc<=1; dc++) {
		if(!dr && !dc) continue; const r=sr+dr, c=sc+dc; if(!inBoundsRC(r,c)) continue; const p=b[rcToIdx(r,c)]; if(p&&p.c===byColor&&p.t==='k') return true;
	}
	return false;
}

// ========== Move generation ==========
function generatePseudoLegalMoves(game) {
	const moves = [];
	const side = game.sideToMove;
	const b = game.board;
	const forward = side === 'w' ? -1 : 1;
	const startRank = side === 'w' ? 6 : 1;
	const promoRank = side === 'w' ? 0 : 7;

	const addMove = (from, to, opts={}) => {
		const movingPiece = b[from];
		const capturedPiece = opts.capturedPiece || b[to] || null;
		const flags = {
			isCapture: !!capturedPiece || !!opts.isEnPassant,
			isEnPassant: !!opts.isEnPassant,
			isCastle: opts.isCastle || null,
		};
		const move = { from, to, movingPiece: clonePiece(movingPiece), capturedPiece: capturedPiece?clonePiece(capturedPiece):null, promotion: opts.promotion || undefined, flags };
		moves.push(move);
	};

	for (let i = 0; i < 64; i++) {
		const pc = b[i]; if (!pc || pc.c !== side) continue;
		const [r,c] = idxToRC(i);
		switch (pc.t) {
			case 'p': {
				// Single push
				const r1 = r + forward; if (inBoundsRC(r1,c) && !b[rcToIdx(r1,c)]) {
					if (r1 === promoRank) {
						for (const promo of ['q','r','b','n']) addMove(i, rcToIdx(r1,c), { promotion: promo });
					} else {
						addMove(i, rcToIdx(r1,c));
					}
					// Double push
					if (r === startRank) {
						const r2 = r + 2*forward; if (!b[rcToIdx(r2,c)]) addMove(i, rcToIdx(r2,c));
					}
				}
				// Captures
				for (const dc of [-1, 1]) {
					const cc = c + dc; const rr = r + forward; if (!inBoundsRC(rr,cc)) continue;
					const dstIdx = rcToIdx(rr,cc); const dst = b[dstIdx];
					if (dst && dst.c !== side) {
						if (rr === promoRank) { for (const promo of ['q','r','b','n']) addMove(i, dstIdx, { promotion: promo }); }
						else addMove(i, dstIdx);
					}
				}
				// En passant
				if (game.enPassant != null) {
					const [er, ec] = idxToRC(game.enPassant);
					if (er === r + forward && Math.abs(ec - c) === 1) {
						const capIdx = rcToIdx(r, ec); // pawn being captured
						const capPiece = b[capIdx];
						if (capPiece && capPiece.c !== side && capPiece.t === 'p') {
							addMove(i, game.enPassant, { isEnPassant: true, capturedPiece: capPiece });
						}
					}
				}
				break;
			}
			case 'n': {
				const KN = [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]];
				for (const [dr,dc] of KN) { const rr=r+dr, cc=c+dc; if(!inBoundsRC(rr,cc)) continue; const to=rcToIdx(rr,cc); const dst=b[to]; if(!dst||dst.c!==side) addMove(i,to); }
				break;
			}
			case 'b': {
				const rays = [[1,1],[1,-1],[-1,1],[-1,-1]];
				for (const [dr,dc] of rays) { let rr=r+dr, cc=c+dc; while(inBoundsRC(rr,cc)){ const to=rcToIdx(rr,cc); const dst=b[to]; if(!dst){ addMove(i,to); } else { if(dst.c!==side) addMove(i,to); break; } rr+=dr; cc+=dc; } }
				break;
			}
			case 'r': {
				const rays = [[1,0],[-1,0],[0,1],[0,-1]];
				for (const [dr,dc] of rays) { let rr=r+dr, cc=c+dc; while(inBoundsRC(rr,cc)){ const to=rcToIdx(rr,cc); const dst=b[to]; if(!dst){ addMove(i,to); } else { if(dst.c!==side) addMove(i,to); break; } rr+=dr; cc+=dc; } }
				break;
			}
			case 'q': {
				const rays = [[1,1],[1,-1],[-1,1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
				for (const [dr,dc] of rays) { let rr=r+dr, cc=c+dc; while(inBoundsRC(rr,cc)){ const to=rcToIdx(rr,cc); const dst=b[to]; if(!dst){ addMove(i,to); } else { if(dst.c!==side) addMove(i,to); break; } rr+=dr; cc+=dc; } }
				break;
			}
			case 'k': {
				for (let dr=-1; dr<=1; dr++) for (let dc=-1; dc<=1; dc++) {
					if(!dr && !dc) continue; const rr=r+dr, cc=c+dc; if(!inBoundsRC(rr,cc)) continue; const to=rcToIdx(rr,cc); const dst=b[to]; if(!dst || dst.c!==side) addMove(i,to);
				}
				// Castling
				// King must be on initial square and not in check; path squares empty and not attacked
				const rights = game.castling || '';
				const enemy = other(side);
				const kingIdx = i;
				if (!isSquareAttacked(kingIdx, enemy, game)) {
					if (side === 'w') {
						// King-side: e1->g1; rook h1->f1
						if (rights.includes('K')) {
							const f1 = rcToIdx(7,5), g1 = rcToIdx(7,6);
							if (!b[f1] && !b[g1] && !isSquareAttacked(f1, enemy, game) && !isSquareAttacked(g1, enemy, game)) {
								addMove(i, g1, { isCastle: 'K' });
							}
						}
						if (rights.includes('Q')) {
							const d1 = rcToIdx(7,3), c1 = rcToIdx(7,2), b1 = rcToIdx(7,1);
							if (!b[d1] && !b[c1] && !b[b1] && !isSquareAttacked(d1, enemy, game) && !isSquareAttacked(c1, enemy, game)) {
								addMove(i, c1, { isCastle: 'Q' });
							}
						}
					} else {
						if (rights.includes('k')) {
							const f8 = rcToIdx(0,5), g8 = rcToIdx(0,6);
							if (!b[f8] && !b[g8] && !isSquareAttacked(f8, enemy, game) && !isSquareAttacked(g8, enemy, game)) {
								addMove(i, g8, { isCastle: 'K' });
							}
						}
						if (rights.includes('q')) {
							const d8 = rcToIdx(0,3), c8 = rcToIdx(0,2), b8 = rcToIdx(0,1);
							if (!b[d8] && !b[c8] && !b[b8] && !isSquareAttacked(d8, enemy, game) && !isSquareAttacked(c8, enemy, game)) {
								addMove(i, c8, { isCastle: 'Q' });
							}
						}
					}
				}
				break;
			}
		}
	}

	return moves;
}

function filterKingSafety(game, moves) {
	const legal = [];
	for (const mv of moves) {
		const undo = applyMoveWithUndoRecord(game, mv);
		const inChk = inCheck(game, other(game.sideToMove)); // after move, sideToMove toggled; check if mover's king is attacked
		undoMoveWithRecord(game, undo);
		if (!inChk) legal.push(mv);
	}
	return legal;
}

function generateLegalMoves(game) {
	return filterKingSafety(game, generatePseudoLegalMoves(game));
}

function isLegalMove(game, move) {
	const list = generateLegalMoves(game);
	return list.some(m => sameMove(m, move));
}

function sameMove(a, b) {
	if (!a || !b) return false;
	if (a.from !== b.from || a.to !== b.to) return false;
	const ap = (a.promotion||''); const bp = (b.promotion||'');
	if (ap !== bp) return false;
	// Flags are not required to match exactly for equality
	return true;
}

// ========== Make/Undo ==========
function applyMoveWithUndoRecord(game, move) {
	const b = game.board;
	const from = move.from; const to = move.to;
	const moving = b[from];
	const enemy = other(moving.c);
	const prev = {
		from, to,
		movingPiece: clonePiece(moving),
		capturedPiece: null,
		capturedIdx: null,
		prevCastling: game.castling,
		prevEnPassant: game.enPassant,
		prevHalfmove: game.halfmoveClock,
		prevFullmove: game.fullmoveNumber,
		prevSide: game.sideToMove,
		rookFrom: null, rookTo: null, rookPiece: null, // for castling
	};

	// Capture (normal)
	if (b[to]) { prev.capturedPiece = clonePiece(b[to]); prev.capturedIdx = to; }

	// En passant capture
	if (move.flags && move.flags.isEnPassant) {
		const [tr, tc] = idxToRC(to);
		const dir = moving.c === 'w' ? 1 : -1; // captured pawn is behind the to-square
		const capR = tr + dir; const capC = tc;
		const capIdx = rcToIdx(capR, capC);
		prev.capturedPiece = clonePiece(b[capIdx]); prev.capturedIdx = capIdx;
		b[capIdx] = null;
	}

	// Move piece
	b[to] = moving; b[from] = null;

	// Promotion
	if (move.promotion && moving.t === 'p') {
		moving.t = move.promotion;
	}

	// Castling: move rook
	if (move.flags && move.flags.isCastle) {
		if (moving.c === 'w') {
			if (move.flags.isCastle === 'K') { // e1->g1 rook h1->f1
				prev.rookFrom = rcToIdx(7,7); prev.rookTo = rcToIdx(7,5); prev.rookPiece = clonePiece(b[prev.rookFrom]);
				b[prev.rookTo] = b[prev.rookFrom]; b[prev.rookFrom] = null;
			} else { // Q-side: e1->c1 rook a1->d1
				prev.rookFrom = rcToIdx(7,0); prev.rookTo = rcToIdx(7,3); prev.rookPiece = clonePiece(b[prev.rookFrom]);
				b[prev.rookTo] = b[prev.rookFrom]; b[prev.rookFrom] = null;
			}
		} else {
			if (move.flags.isCastle === 'K') { // e8->g8 rook h8->f8
				prev.rookFrom = rcToIdx(0,7); prev.rookTo = rcToIdx(0,5); prev.rookPiece = clonePiece(b[prev.rookFrom]);
				b[prev.rookTo] = b[prev.rookFrom]; b[prev.rookFrom] = null;
			} else { // e8->c8 rook a8->d8
				prev.rookFrom = rcToIdx(0,0); prev.rookTo = rcToIdx(0,3); prev.rookPiece = clonePiece(b[prev.rookFrom]);
				b[prev.rookTo] = b[prev.rookFrom]; b[prev.rookFrom] = null;
			}
		}
	}

	// Update castling rights
	let rights = game.castling || '';
	// If king moved, remove both rights for that color
	if (moving.t === 'k') {
		rights = moving.c === 'w' ? rights.replace('K','').replace('Q','') : rights.replace('k','').replace('q','');
	}
	// If rook moved from original squares
	if (moving.t === 'r') {
		if (from === rcToIdx(7,0)) rights = rights.replace('Q','');
		if (from === rcToIdx(7,7)) rights = rights.replace('K','');
		if (from === rcToIdx(0,0)) rights = rights.replace('q','');
		if (from === rcToIdx(0,7)) rights = rights.replace('k','');
	}
	// If a rook was captured on original squares
	if (prev.capturedPiece && prev.capturedPiece.t === 'r') {
		if (prev.capturedIdx === rcToIdx(7,0)) rights = rights.replace('Q','');
		if (prev.capturedIdx === rcToIdx(7,7)) rights = rights.replace('K','');
		if (prev.capturedIdx === rcToIdx(0,0)) rights = rights.replace('q','');
		if (prev.capturedIdx === rcToIdx(0,7)) rights = rights.replace('k','');
	}
	// En passant target
	let ep = null;
	if (moving.t === 'p') {
		const [fr,fc] = idxToRC(from); const [tr,tc] = idxToRC(to);
		if (Math.abs(tr - fr) === 2) {
			// square jumped over
			const midR = (fr + tr) / 2; ep = rcToIdx(midR, fc);
		}
	}
	game.castling = rights;
	game.enPassant = ep;

	// Halfmove clock
	if (moving.t === 'p' || prev.capturedPiece) game.halfmoveClock = 0; else game.halfmoveClock += 1;

	// Fullmove number increments after black moves
	if (game.sideToMove === 'b') game.fullmoveNumber += 1;

	// Switch side
	game.sideToMove = enemy;

	// Update position repetition counts
	incrPositionCount(game);

	return prev;
}

function undoMoveWithRecord(game, rec) {
	// Decrement current position count before reverting
	decrPositionCount(game);

	const b = game.board;
	// Restore side, fullmove, halfmove, ep, castling
	game.sideToMove = rec.prevSide;
	game.fullmoveNumber = rec.prevFullmove;
	game.halfmoveClock = rec.prevHalfmove;
	game.enPassant = rec.prevEnPassant;
	game.castling = rec.prevCastling;

	// Move piece back
	const moving = b[rec.to];
	b[rec.from] = moving; b[rec.to] = null;

	// Undo promotion
	if (rec.movingPiece && rec.movingPiece.t !== moving.t) {
		moving.t = rec.movingPiece.t;
	}

	// Restore captured piece
	if (rec.capturedPiece && rec.capturedIdx != null) {
		b[rec.capturedIdx] = rec.capturedPiece;
	}

	// Undo castling rook move
	if (rec.rookFrom != null && rec.rookTo != null) {
		b[rec.rookFrom] = b[rec.rookTo]; b[rec.rookTo] = null;
	}

	return game;
}

function makeMove(game, move) {
	const legal = isLegalMove(game, move);
	if (!legal) throw new Error('Illegal move');
	const undo = applyMoveWithUndoRecord(game, move);
	game.history.push(undo);
	return { newGame: game, capture: undo.capturedPiece || undefined };
}

function undoMove(game) {
	const rec = game.history.pop(); if (!rec) return game;
	undoMoveWithRecord(game, rec);
	return game;
}

// ========== Check / mate / stalemate ==========
function inCheck(game, color) {
	const kingIdx = findKing(game, color);
	if (kingIdx < 0) return false; // malformed
	return isSquareAttacked(kingIdx, other(color), game);
}

function isCheckmate(game) {
	if (!inCheck(game, game.sideToMove)) return false;
	const moves = generateLegalMoves(game);
	return moves.length === 0;
}

function isStalemate(game) {
	if (inCheck(game, game.sideToMove)) return false;
	const moves = generateLegalMoves(game);
	return moves.length === 0;
}

// ========== Draw detection ==========
function detectDraw(game) {
	// 50-move rule
	if (game.halfmoveClock >= 100) return { type: 'fiftyMove' };
	// Repetition
	const key = positionKey(game);
	const count = game.positionCounts.get(key) || 0;
	if (count >= 3) return { type: 'repetition' };
	// Insufficient material
	if (insufficientMaterial(game)) return { type: 'insufficientMaterial' };
	return { type: 'none' };
}

function insufficientMaterial(game) {
	const b = game.board;
	let wB=0, wN=0, wR=0, wQ=0, wP=0;
	let bB=0, bN=0, bR=0, bQ=0, bP=0;
	const bishopsSquares = [];
	for (let i=0;i<64;i++){
		const p=b[i]; if(!p) continue;
		if(p.c==='w'){
			if(p.t==='p') wP++; else if(p.t==='r') wR++; else if(p.t==='q') wQ++; else if(p.t==='n') wN++; else if(p.t==='b'){ wB++; bishopsSquares.push({c:'w',i}); }
		} else {
			if(p.t==='p') bP++; else if(p.t==='r') bR++; else if(p.t==='q') bQ++; else if(p.t==='n') bN++; else if(p.t==='b'){ bB++; bishopsSquares.push({c:'b',i}); }
		}
	}
	// Any queen/rook/pawn present -> not insufficient
	if (wQ||bQ||wR||bR||wP||bP) return false;
	const totalMinors = wB+wN+bB+bN;
	if (totalMinors === 0) return true; // king vs king
	if (totalMinors === 1) return true; // K+B v K or K+N v K
	// Only bishops and/or knights without pawns/rooks/queens
	if ((wN+bN)===0 && (wB+bB)>0){
		// Bishops only: if all bishops are on same color squares, it's insufficient
		let colorMask=null; // 0 for dark, 1 for light
		for(const bs of bishopsSquares){ const [r,c]=idxToRC(bs.i); const col=(r+c)%2; if(colorMask==null) colorMask=col; else if(colorMask!==col) return false; }
		return true;
	}
	if ((wB+bB)===0 && (wN+bN)>0){
		// Knights only: K+N vs K+N is insufficient
		return true;
	}
	// Mixed bishops/knights but no heavy pieces or pawns: generally not strictly insufficient
	return false;
}

// ========== Public helpers wrapping internals for API ==========
function makeUndoable(game, move) { return applyMoveWithUndoRecord(game, move); }

// ========== Perft ==========
function perft(game, depth) {
	if (depth === 0) return 1;
	let nodes = 0;
	const moves = generateLegalMoves(game);
	for (const mv of moves) {
		const rec = applyMoveWithUndoRecord(game, mv);
		nodes += perft(game, depth - 1);
		undoMoveWithRecord(game, rec);
	}
	return nodes;
}

// ========== Exports ==========
module.exports = {
	initGame,
	loadFEN,
	getFEN,
	generateLegalMoves,
	isLegalMove,
	makeMove,
	undoMove,
	inCheck,
	isCheckmate,
	isStalemate,
	detectDraw,
	perft,
	// explicit helpers for testing
	_internal: {
		rcToIdx, idxToRC, idxToSquare, squareToIdx,
		isSquareAttacked, generatePseudoLegalMoves, filterKingSafety,
		applyMoveWithUndoRecord, undoMoveWithRecord,
	},
};

/*
Unit-test style examples (for quick validation):

1) Initial position legal moves (should be 20)
	 const e = require('./engine');
	 let g = e.initGame();
	 console.log('initial moves:', e.generateLegalMoves(g).length === 20);

2) Perft depth 2 (should be 400)
	 g = e.initGame();
	 console.log('perft(2):', e.perft(g,2) === 400);

3) Simple capture scenario
	 g = e.loadFEN('8/8/8/8/4p3/8/4P3/4K3 w - - 0 1');
	 let ms = e.generateLegalMoves(g);
	 const cap = ms.find(m=>m.to===e._internal.rcToIdx(4,4)); // e2xe4
	 console.log('has capture:', !!cap);

4) En-passant scenario
	 g = e.loadFEN('8/8/8/3pP3/8/8/8/4K3 b - e6 0 1');
	 ms = e.generateLegalMoves(g);
	 const ep = ms.find(m=>m.flags && m.flags.isEnPassant);
	 console.log('has en passant:', !!ep);

5) Castling allowed/forbidden
	 g = e.loadFEN('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
	 ms = e.generateLegalMoves(g);
	 const wCastleK = ms.find(m=>m.flags && m.flags.isCastle==='K' && m.from===e._internal.rcToIdx(7,4));
	 const wCastleQ = ms.find(m=>m.flags && m.flags.isCastle==='Q' && m.from===e._internal.rcToIdx(7,4));
	 console.log('castling options present:', !!wCastleK && !!wCastleQ);

6) Promotion scenario
	 g = e.loadFEN('8/P7/8/8/8/8/8/4K3 w - - 0 1');
	 ms = e.generateLegalMoves(g);
	 const promos = ms.filter(m=>m.promotion);
	 console.log('4 promotions generated:', promos.length === 4);

// Example usage
// const e = require('./engine');
// const game = e.initGame();
// console.log(e.getFEN(game));
// const moves = e.generateLegalMoves(game);
// e.makeMove(game, moves[0]);
// console.log(e.getFEN(game));
*/
