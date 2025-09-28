// WarEngine.js — server-side game logic for War (no JSX)
// CommonJS export to be used by Node server

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const RANK_VAL = Object.fromEntries(RANKS.map((r, i) => [r, i + 2])); // 2..14

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push({ rank: r, suit: s });
  return d;
}

class WarGame {
  constructor() {
    const deck = shuffle(makeDeck());
    // split deck: two equal piles
    this.p1Pile = deck.filter((_, i) => i % 2 === 0);
    this.p2Pile = deck.filter((_, i) => i % 2 === 1);

    this.scores = { 'Player 1': 0, 'Player 2': 0 };
    this.round = 0;
  }

  getScores() { return { ...this.scores }; }

  // internal: resolve ties via "war" until winner found or piles exhausted
  _resolveWar(a, b) {
    let depth = 1; // we already have one tie
    let lastA = a, lastB = b;

    while (true) {
      // each player places one face-down card if possible
      if (this.p1Pile.length > 0) this.p1Pile.pop();
      if (this.p2Pile.length > 0) this.p2Pile.pop();

      // now each draws one face-up
      if (this.p1Pile.length === 0 || this.p2Pile.length === 0) {
        // cannot continue war; determine winner by pile availability
        const winner = this.p1Pile.length > this.p2Pile.length ? 'Player 1'
                      : this.p2Pile.length > this.p1Pile.length ? 'Player 2'
                      : null; // still tie
        return { depth, lastA, lastB, winner };
      }

      lastA = this.p1Pile.pop();
      lastB = this.p2Pile.pop();
      const va = RANK_VAL[lastA.rank] || 0;
      const vb = RANK_VAL[lastB.rank] || 0;
      if (va === vb) { depth += 1; continue; }
      return { depth, lastA, lastB, winner: va > vb ? 'Player 1' : 'Player 2' };
    }
  }

  playRound() {
    // if out of cards, emit matchWinner based on score
    if (this.p1Pile.length === 0 || this.p2Pile.length === 0) {
      const s1 = this.scores['Player 1'];
      const s2 = this.scores['Player 2'];
      const matchWinner = s1 === s2 ? null : (s1 > s2 ? 'Player 1' : 'Player 2');
      return { p1Card: null, p2Card: null, roundWinner: null, scores: this.getScores(), round: this.round, warDepth: 0, matchWinner };
    }

    const a = this.p1Pile.pop();
    const b = this.p2Pile.pop();
    const va = RANK_VAL[a.rank] || 0;
    const vb = RANK_VAL[b.rank] || 0;

    let warDepth = 0;
    let roundWinner = null;
    let p1Card = a, p2Card = b;

    if (va === vb) {
      const r = this._resolveWar(a, b);
      warDepth = r.depth;
      p1Card = r.lastA; // expose last face-up cards
      p2Card = r.lastB;
      roundWinner = r.winner; // could be null if truly exhausted and tied
    } else {
      roundWinner = va > vb ? 'Player 1' : 'Player 2';
    }

    if (roundWinner) this.scores[roundWinner] += 1;
    this.round += 1;

    // compute match end if no more cards
    let matchWinner = null;
    if (this.p1Pile.length === 0 || this.p2Pile.length === 0) {
      const s1 = this.scores['Player 1'];
      const s2 = this.scores['Player 2'];
      matchWinner = s1 === s2 ? null : (s1 > s2 ? 'Player 1' : 'Player 2');
    }

    return { p1Card, p2Card, roundWinner, scores: this.getScores(), round: this.round, warDepth, matchWinner };
  }
}

module.exports = { WarGame };
