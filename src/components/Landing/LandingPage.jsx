import React, { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion, useScroll, useTransform } from 'framer-motion';
import confetti from 'canvas-confetti';
import NavBar from "../NavBar";
import './LandingPage.css';
import arrowImg from '../../assets/arrow.png';

export default function LandingPage(){
  const rootRef = useRef(null);
  const { scrollYProgress } = useScroll();
  const y1 = useTransform(scrollYProgress, [0, 1], [0, 120]);
  const y2 = useTransform(scrollYProgress, [0, 1], [0, -80]);

  useEffect(()=>{
    const io = new IntersectionObserver((entries)=>{
      entries.forEach(e=>{
        if(e.isIntersecting){ e.target.classList.add('reveal-in'); }
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.12 });
    const nodes = rootRef.current?.querySelectorAll?.('.reveal');
    nodes && nodes.forEach(n=>io.observe(n));
    return ()=> io.disconnect();
  },[]);

  return (
    <div className="landing-page" ref={rootRef}>
      <NavBar />
      {/* Hero */}
      <section className="hero section">
        <div className="hero-bg" aria-hidden="true" />
        <div className="container-narrow text-center">
          {/* LED rails for arcade vibe */}
          <div className="led-rail led-rail--top" aria-hidden />

          {/* Parallax neon shapes */}
          <motion.div style={{ y: y1 }} className="hero-float hero-float--a" aria-hidden />
          <motion.div style={{ y: y2 }} className="hero-float hero-float--b" aria-hidden />

          <h1 className="display neon-title">Neon Games</h1>
          <p className="subtitle">Arcade vibes. Modern multiplayer classics.</p>
          <div className="cta-row">
            <Link className="btn btn-primary btn-lg" to="/roll-of-cards">Play Roll of Cards</Link>
            <a
              className="btn btn-outline-light btn-lg"
              href="#games"
              onClick={(e) => {
                e.preventDefault();
                try {
                  const el = document.getElementById('games');
                  if (el) {
                    const navH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-height') || '56', 10) || 56;
                    const y = el.getBoundingClientRect().top + window.scrollY - (navH + 12);
                    window.scrollTo({ top: y, behavior: 'smooth' });
                  }
                } catch {}
              }}
            >
              Explore Games
            </a>
            <Link
              className="btn btn-success btn-lg"
              to="/registration"
              onClick={() => {
                try {
                  confetti({ particleCount: 80, spread: 70, origin: { y: 0.2 } });
                  setTimeout(() => confetti({ particleCount: 60, spread: 60, origin: { y: 0.2 } }), 200);
                } catch {}
              }}
            >
              Create a free account
            </Link>
          </div>
          <div className="scroll-ind" aria-hidden>
            <span />
          </div>
          <div className="led-rail led-rail--bottom" aria-hidden />
        </div>
      </section>

      {/* Games Gallery */}
      <section id="games" className="section games-grid reveal">
        <div className="container-wide">
          <h2 className="section-title">Featured Games</h2>
          <div className="grid">
            <GameCard title="Roll of Cards" to="/roll-of-cards" emoji="🃏🎲" blurb="Cards meet dice—bet and win with streak and spread bonuses." />
            <GameCard title="Connect Four" to="/connect-four" emoji="⦿⦿" blurb="Drop discs and connect four in a row." />
            <GameCard title="Checkers" to="/checkers" emoji="⛀⛂" blurb="Classic jumps to victory." />
            <GameCard title="Chess" to="/chess" emoji="♟︎♞" blurb="Strategize and checkmate." />
            <GameCard title="3D Chess" to="/3d-chess" emoji="♜" blurb="Stacked boards for galaxy-brain plays." />
            <GameCard title="War" to="/war" emoji="🂠" blurb="High card takes the pot." />
          </div>
        </div>
      </section>

      {/* Showcase band (parallax) */}
      <section className="band parallax reveal" aria-label="Showcase">
        <div className="arrow-bg" style={{ backgroundImage: `url(${arrowImg})` }} aria-hidden />
        <div className="band-inner">
          <h3>Built for quick matches and good vibes</h3>
          <p>Zero-friction lobbies, snappy animations, and mobile-first layouts.</p>
        </div>
      </section>

      {/* Features */}
      <section className="section features reveal">
        <div className="container-wide">
          <h2 className="section-title">Why you’ll love it</h2>
          <div className="feat-grid">
            <Feature icon={Shield()} title="Fair play" text="Clear rules, transparent outcomes, and friendly rematches." />
            <Feature icon={Zap()} title="Fast and fluid" text="No laggy layouts—everything tuned for responsiveness." />
            <Feature icon={Chat()} title="QuickChat" text="Say more with fewer taps using built-in quick messages." />
            <Feature icon={Devices()} title="Mobile ready" text="Edge‑to‑edge boards and bottom nav on phones." />
          </div>
        </div>
      </section>

      {/* CTA footer */}
      <section className="section final-cta reveal">
        <div className="container-narrow text-center">
          <h3 className="mb-3">Ready to play?</h3>
          <Link className="btn btn-primary btn-lg" to="/roll-of-cards">Jump into Roll of Cards</Link>
        </div>
      </section>
    </div>
  );
}

function GameCard({ title, blurb, emoji, to }){
  return (
    <Link to={to} className="game-card">
      <div className="gc-bg" aria-hidden>
        <div className="glow" />
      </div>
      <div className="gc-body">
        <div className="emoji" aria-hidden>{emoji}</div>
        <div className="title">{title}</div>
        <div className="blurb">{blurb}</div>
      </div>
    </Link>
  );
}

function Feature({ icon, title, text }){
  return (
    <div className="feature">
      <div className="icon" aria-hidden dangerouslySetInnerHTML={{ __html: icon }} />
      <div className="ft-title">{title}</div>
      <div className="ft-text">{text}</div>
    </div>
  );
}

// Simple inline SVGs (no external icon libs)
const Shield = () => `<svg viewBox='0 0 24 24' width='28' height='28' fill='none' stroke='currentColor' stroke-width='1.5'><path d='M12 3l7 3v6c0 5-3.5 9-7 9s-7-4-7-9V6l7-3z'/></svg>`;
const Zap    = () => `<svg viewBox='0 0 24 24' width='28' height='28' fill='none' stroke='currentColor' stroke-width='1.5'><path d='M13 2L3 14h7l-1 8 10-12h-7l1-8z'/></svg>`;
const Chat   = () => `<svg viewBox='0 0 24 24' width='28' height='28' fill='none' stroke='currentColor' stroke-width='1.5'><path d='M4 5h16v10H7l-3 4V5z'/></svg>`;
const Devices= () => `<svg viewBox='0 0 24 24' width='28' height='28' fill='none' stroke='currentColor' stroke-width='1.5'><rect x='2' y='7' width='14' height='10' rx='2'/><rect x='8' y='3' width='14' height='14' rx='2'/></svg>`;
