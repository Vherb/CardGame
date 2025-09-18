import React, { useMemo, useState, useEffect, useRef } from 'react';
import 'bootstrap/dist/css/bootstrap.min.css';
import { Button, Card, Row, Col, Badge } from 'react-bootstrap';
import NavBar from '../../NavBar';
import CardReveal from './CardReveal.jsx';

// If you already have API helpers for SC, reuse those instead.
// import { authFetch, scAdjust, getBalance } from '../../lib/wallet';

const FULL_DECK = [
  ...'A23456789TJQK'.split('').flatMap(r => ['S','H','D','C'].map(s => `${r}${s}`))
];
const shuffle = (a) => {
  const arr = a.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

export default function WarGame() {
  // Cards + round
  const [youCard, setYouCard] = useState(null);   // e.g. "AS"
  const [oppCard, setOppCard] = useState(null);
  const [round, setRound] = useState(0);
  const deckRef = useRef(shuffle(FULL_DECK));

  // Stake + balance (swap with your real wallet calls)
  const [stakeSC, setStakeSC] = useState(() => Number(localStorage.getItem('warStake') || 1));
  const [scBalance, setScBalance] = useState(0);

  // Pairing flags (hook these to your CF-style matchmaking if you have it)
  const [isPaired, setIsPaired] = useState(true);
  const [pairedWith, setPairedWith] = useState('Opponent');

  useEffect(() => {
    (async () => {
      try {
        // const bal = await getBalance();
        // setScBalance(Number(bal) || 0);
        setScBalance(100); // demo default — replace with real balance loader
      } catch {}
    })();
  }, []);

  // ----- local deal (replace with your server "deal" message in PvP) -----
  const dealOnce = () => {
    if (deckRef.current.length < 2) deckRef.current = shuffle(FULL_DECK);
    const y = deckRef.current.pop();
    const o = deckRef.current.pop();
    setYouCard(y);
    setOppCard(o);
    setRound(r => r + 1);
  };

  // Winner calc (Ace high)
  const rankValue = (r) => {
    const t = String(r).toUpperCase();
    if (t === 'A') return 14;
    if (t === 'K') return 13;
    if (t === 'Q') return 12;
    if (t === 'J') return 11;
    if (t === 'T') return 10;
    return parseInt(t, 10) || 0;
  };
  const parseRank = (card) => {
    if (!card) return 0;
    if (typeof card === 'string') return rankValue(card.slice(0, -1));
    if (card.rank) return rankValue(card.rank);
    if (card.label) {
      const l = String(card.label);
      if (l === 'Ace') return 14;
      if (l === 'King') return 13;
      if (l === 'Queen') return 12;
      if (l === 'Jack') return 11;
      return parseInt(l, 10) || 0;
    }
    return 0;
  };
  const winner = useMemo(() => {
    const a = parseRank(youCard);
    const b = parseRank(oppCard);
    if (!a || !b) return null;
    if (a === b) return 'Tie';
    return a > b ? 'You' : 'Opponent';
  }, [youCard, oppCard]);

  // Escrow-ish demo (replace with your scAdjust calls)
  const lockStake = async (amt) => {
    const need = Math.max(0.01, Number(amt) || 0);
    if ((Number(scBalance) || 0) < need) {
      alert(`Insufficient SC. Need ${need.toFixed(2)} SC`);
      return false;
    }
    try {
      // await scAdjust(-need, 'War — lock stake');
      setScBalance(b => b - need); // demo
      return true;
    } catch (e) {
      alert(e.message || 'Could not lock stake.');
      return false;
    }
  };
  const settleWin = async (who) => {
    const bet = Math.max(0.01, Number(stakeSC) || 0);
    if (who === 'You') {
      // await scAdjust(+bet * 2, 'War — win payout');
      setScBalance(b => b + bet * 2); // demo
    } else if (who === 'Tie') {
      // await scAdjust(+bet, 'War — tie refund');
      setScBalance(b => b + bet); // demo
    }
  };

  const startRound = async () => {
    if (!isPaired) { alert('Not matched yet.'); return; }
    const ok = await lockStake(stakeSC);
    if (!ok) return;
    // In PvP: send "deal" to server, let server broadcast the two cards.
    dealOnce();
  };

  // settle a bit after the cards animate
  useEffect(() => {
    if (!youCard || !oppCard) return;
    const t = setTimeout(() => { settleWin(winner || 'Tie'); }, 1400);
    return () => clearTimeout(t);
  }, [youCard, oppCard, winner]);

  return (
    <div className="war-page" style={{ minHeight: '100dvh', background: '#0b1220', color: '#e5e7eb' }}>
      <NavBar />

      <div className="container py-3">
        <Row className="mb-2 align-items-center">
          <Col xs="auto"><h3 className="m-0">War (PvP)</h3></Col>
          <Col className="text-muted">Deck in center → one card left, one right</Col>
          <Col xs="auto">
            <Badge bg="secondary" className="me-2">Balance: {Number(scBalance).toFixed(2)} SC</Badge>
            <Badge bg="info">Stake: {Number(stakeSC).toFixed(2)} SC</Badge>
          </Col>
        </Row>

        {/* ===== CARD REVEAL AREA (add this to your existing JSX if you already have a WarGame.jsx) ===== */}
        <Card className="bg-dark border-0 shadow-sm mb-3" style={{ overflow: 'visible' }}>
          <Card.Body style={{ overflow: 'visible' }}>
            <CardReveal
              you={youCard}
              opp={oppCard}
              round={round}
              basePath="/RollofCards/cards"   // <-- SAME art folder as Roll-of-Cards
            />
          </Card.Body>
        </Card>

        {winner && youCard && oppCard && (
          <div className="mb-3">
            <Badge bg={winner === 'You' ? 'success' : winner === 'Opponent' ? 'danger' : 'secondary'}>
              {winner === 'Tie' ? 'Tie!' : `${winner} wins`}
            </Badge>
          </div>
        )}

        <Row className="g-2">
          <Col xs={12} md="auto">
            <Button variant="primary" onClick={startRound}>Deal</Button>
          </Col>
          <Col xs={12} md="auto">
            <Button
              variant="outline-light"
              onClick={() => {
                const v = Number(prompt('Stake in SC', String(stakeSC))) || stakeSC;
                const s = Math.max(0.01, v);
                setStakeSC(s);
                localStorage.setItem('warStake', String(s));
              }}
            >
              Set Stake
            </Button>
          </Col>
          <Col xs={12} md="auto">
            <Button variant="outline-secondary" onClick={() => { setYouCard(null); setOppCard(null); }}>
              Clear Table
            </Button>
          </Col>
        </Row>
      </div>
    </div>
  );
}
