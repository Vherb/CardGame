/* eslint-disable no-useless-computed-key */
import React from "react";
import Game from "./components/games/RollofCards/Game";
import InBetweenGame from "./components/games/inBetween/InBetween";
import ConnectFourScreen from "./components/games/ConnectFour/ConnectFourScreen";
import GameTable from "./components/games/War/GameTable";
import CheckersScreen from "./components/games/Checkers/CheckersScreen";
import ChessScreen from "./components/games/Chess/ChessScreen";
import RaumschachScreen from "./components/games/Chess3D/RaumschachScreen";
import BattleshipScreen from "./components/games/Battleship/BattleshipScreen";
import LandingPage from "./components/Landing/LandingPage";

import "./App.css";
import "./theme.css";
import "bootstrap/dist/css/bootstrap.min.css";
import RegistrationForm from "./components/RegistrationForm";
import { Routes, Route, useLocation } from "react-router-dom";
import MobileBottomNav from "./components/MobileBottomNav";

/* --- Add: global LedBar used across all pages --- */
function LedBar({ color = "rgba(255,110,220,0.95)", speed = undefined }) {
  // Renders a fixed full-width LED rail; animation/timing come from the global CSS below
  const runRef = React.useRef(null);
  React.useEffect(() => {
    try { runRef.current?.style?.setProperty('--led-color', color); } catch {}
  }, [color]);
  return (
    <div className="led-topbar" aria-hidden="true">
      <div ref={runRef} className="led-run" />
    </div>
  );
}

function App() {
  function ScrollToTop(){
    const { pathname } = useLocation();
    React.useEffect(()=>{ try{ window.scrollTo({ top:0, left:0, behavior:'auto' }); }catch{} }, [pathname]);
    return null;
  }
  class ErrorBoundary extends React.Component {
    constructor(props){ super(props); this.state = { hasError: false, message: '' }; }
    static getDerivedStateFromError(err){ return { hasError: true, message: String(err?.message || err) }; }
    componentDidCatch(err, info){ console.error('UI ErrorBoundary caught:', err, info); }
    render(){
      if(this.state.hasError){
        return (
          <div style={{ color:'#fff', background:'#0b1220', minHeight:'100vh', display:'grid', placeItems:'center', padding:24 }}>
            <div style={{ maxWidth: 820 }}>
              <h2>Something went wrong loading the page.</h2>
              <p style={{ opacity:.85 }}>Error: {this.state.message}</p>
              <p style={{ opacity:.7 }}>Check the browser console for details.</p>
            </div>
          </div>
        );
      }
      return this.props.children;
    }
  }

  return (
    <>
      {/* Global LedBar / Footer injected once so all game pages share the exact same look */}
  <LedBar color="rgba(255,110,220,0.95)" />
      <ScrollToTop />
      <ErrorBoundary>
        <Routes>
          <Route path='/' element={<LandingPage />} />
          <Route path='/game2' element={<InBetweenGame />} />
          <Route path='/registration' element={<RegistrationForm />} />
          <Route path='/welcome' element={<LandingPage />} />
          <Route path='/roll-of-cards' element={<Home />} />
          <Route path='/connect-four' element={<ConnectFourScreen />} />
          <Route path='/war' element={<GameTable />} />
          <Route path='/checkers' element={<CheckersScreen />} />
          <Route path='/chess' element={<ChessScreen />} />
          <Route path='/3d-chess' element={<RaumschachScreen />} />
          <Route path='/battleship' element={<BattleshipScreen />} />
        </Routes>
      </ErrorBoundary>
      {/* Mobile-only bottom navigation; adjusts --footer-h when visible */}
      <MobileBottomNav />
      <Footer />

      {/* Global theme CSS: LED, footer, small safe bottom padding — used by all three games */}
      <style>{`
        /* LED topbar (shared across games)
           - position relative to navbar height so it aligns on every page
           - very high z-index and !important to avoid being hidden by per-page navbars */
        :root { --nav-height: 56px; --footer-h: 52px; } /* default; pages can override if needed */
        .led-topbar {
          position: fixed !important;
          top: calc(var(--nav-height, 56px) + 8px) !important;
          left: 0 !important;
          width: 100vw !important;
          height: 12px !important;
          pointer-events: none !important;
          z-index: 100000 !important; /* ensure it's above page navbars */
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: visible !important;
          background: transparent !important;
        }
        html.hide-global-led .led-topbar,
        body.hide-global-led .led-topbar,
        #root.hide-global-led .led-topbar { display: none !important; }
        .led-run {
          --led-color: rgba(255,110,220,0.95);
          --led-speed: var(--global-led-speed);
          position: relative;
          width: 120vw;
          height: 10px;
          margin-left: -10vw;
          border-radius: 999px;
          background:
            linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(255,255,255,0.05) 16%, var(--led-color) 46%, rgba(255,255,255,0.05) 58%, rgba(0,0,0,0) 100%),
            linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0));
          background-size: 300% 100%, 100% 100%;
          filter: blur(4px) saturate(1.15);
          opacity: 1;
          mix-blend-mode: screen;
          z-index: 100000 !important;
          animation: led-bg-move var(--led-speed) linear infinite, led-pulse calc(var(--led-speed) * 2) ease-in-out infinite;
        }
        .led-run::before {
          content: "";
          position: absolute;
          left: -50%;
          top: -120%;
          width: 42%;
          height: 380%;
          transform: skewX(-18deg);
          background: linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.75) 45%, rgba(255,255,255,0) 100%);
          filter: blur(7px) saturate(1.25);
          opacity: 1;
          mix-blend-mode: screen;
          border-radius: 6px;
          animation: led-sweep calc(var(--led-speed) * 1.05) cubic-bezier(.2,.8,.2,1) infinite;
          pointer-events: none;
        }
        @keyframes led-bg-move {
          0%   { background-position: 0% 50%, 0% 0%; }
          35%  { background-position: 60% 50%, 0% 0%; }
          70%  { background-position: 120% 50%, 0% 0%; }
          100% { background-position: 240% 50%, 0% 0%; }
        }
        @keyframes led-sweep {
          0%   { left: -50%; opacity: 0; transform: skewX(-18deg) translateX(0); }
          20%  { left: -10%; opacity: 0.95; transform: skewX(-18deg) translateX(6%); }
          50%  { left: 40%;  opacity: 0.85; transform: skewX(-18deg) translateX(10%); }
          80%  { left: 110%; opacity: 0.4; transform: skewX(-18deg) translateX(18%); }
          100% { left: 170%; opacity: 0; transform: skewX(-18deg) translateX(20%); }
        }
        @keyframes led-pulse {
          0%   { transform: scaleY(0.985); opacity: 0.92; }
          50%  { transform: scaleY(1.03);  opacity: 1;    }
          100% { transform: scaleY(0.985); opacity: 0.92; }
        }

        /* Global themed footer (shared) */
        .theme-footer {
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          height: auto;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 4200;
          background: var(--footer-bg) !important;
          border-top: 1px solid var(--footer-border) !important;
          box-shadow: var(--surface-shadow) !important;
          color: var(--text);
          font-size: 0.9rem;
          -webkit-backdrop-filter: none !important;
          backdrop-filter: none !important;
          pointer-events: auto;
          padding: 8px 0 calc(env(safe-area-inset-bottom, 0px) + 6px);
        }
        .theme-footer::before { display:none !important; }
        .theme-footer .theme-footer-inner { width: min(1200px, 96%); display:grid; grid-template-columns: 1fr auto 1fr; gap:14px; align-items:center; padding: 8px 12px; }
        .theme-footer .brand { display:flex; align-items:center; gap:10px; font-size: 16px; }
        .theme-footer .brand-mark { filter: drop-shadow(0 0 6px rgba(255,110,220,0.5)); }
        .theme-footer .brand-name { letter-spacing: .2px; }
        .theme-footer .tagline { color: var(--muted); font-size: .9rem; opacity: .9; margin-top: 2px; }
        .theme-footer .text-link { color: var(--link); text-decoration:none; opacity:.95; margin:0 8px; }
        .theme-footer .text-link:hover { color: var(--link-hover); text-decoration:underline; }
        .theme-footer .sep { color: var(--divider); margin: 0 6px; }
        .theme-footer .footer-left { justify-self: start; text-align: left; display:flex; flex-direction:column; gap:2px; }
        .theme-footer .footer-center { justify-self: center; text-align: center; white-space: nowrap; }
        .theme-footer .footer-right { justify-self: end; text-align: right; display:flex; align-items:center; gap:12px; }
        .theme-footer .social-icons { display:flex; align-items:center; gap:10px; }
        .theme-footer .social-icons .soc { color: var(--muted); display:inline-flex; align-items:center; justify-content:center; width: 28px; height: 28px; border-radius: 8px; transition: color .2s ease, transform .2s ease, filter .2s ease; }
        .theme-footer .social-icons .soc:hover { color: var(--text); transform: translateY(-1px) scale(1.06); filter: drop-shadow(0 0 8px rgba(255,110,220,.35)); }
        .theme-footer .social-icons .soc.x:hover { color:#1DA1F2; }
        .theme-footer .social-icons .soc.discord:hover { color:#5865F2; }
        .theme-footer .social-icons .soc.instagram:hover { color:#E1306C; }
        .theme-footer .social-icons .soc.tiktok:hover { color:#69C9D0; }
        .theme-footer .social-icons .soc.youtube:hover { color:#FF0000; }
        .theme-footer .social-icons .soc.github:hover { color:#cdd9e5; }
        .theme-footer .copy { color: var(--muted); opacity:.9; }
        html, body, #root { padding-bottom: calc(var(--footer-h) + env(safe-area-inset-bottom, 0px) + 20px) !important; }
        html.no-bottom-pad, body.no-bottom-pad, #root.no-bottom-pad { padding-bottom: 0 !important; }

        /* Desktop: ensure grid columns */
        @media (min-width: 992px) {
          .theme-footer .theme-footer-inner { grid-template-columns: 1fr auto 1fr; }
        }

        /* Mobile-only bottom nav */
        .mobile-bottom-nav {
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 4300;
          display: none; /* default hidden, shown via media query */
          background: var(--footer-bg);
          border-top: 1px solid var(--footer-border);
          box-shadow: var(--surface-shadow);
          padding: 6px 10px calc(env(safe-area-inset-bottom, 0px) + 8px);
        }
        .mobile-bottom-nav { color: var(--text); }
        .mobile-bottom-nav .mbn-item {
          flex: 1 1 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 2px;
          color: var(--muted);
          text-decoration: none;
          font-size: 12px;
        }
        .mobile-bottom-nav .mbn-item .mbn-ico { font-size: 18px; line-height: 1; }
        .mobile-bottom-nav .mbn-item.active { color: var(--text); filter: brightness(1.05); }
        @media (max-width: 576px) {
          .mobile-bottom-nav { display: flex; gap: 6px; }
          .theme-footer { display: none !important; }
          /* Ensure items take equal space */
          .mobile-bottom-nav { justify-content: space-between; }
        }

      `}</style>
    </>
  );
}

function Home() {
  return (
    <div className='App game-background' style={{ background: "transparent" }}>
      {/* small top offset so game isn't tucked under a fixed navbar */}
      <div style={{ paddingTop: 8 }}>
        <Game />
      </div>
    </div>
  );
}

/* --- NEW: Theme-matching footer used on all pages --- */
function Footer() {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!ref.current) return;
    const setH = () => {
      // Only set --footer-h if footer is actually visible (desktop/tablet)
      try {
        const style = window.getComputedStyle(ref.current);
        const hidden = style?.display === 'none' || style?.visibility === 'hidden';
        if (hidden) return;
      } catch {}
      const h = ref.current?.offsetHeight || 0;
      try { document.documentElement.style.setProperty('--footer-h', h + 'px'); } catch {}
    };
    setH();
    let ro;
    try{
      ro = new ResizeObserver(setH);
      ro.observe(ref.current);
    } catch {}
    window.addEventListener('resize', setH);
    return () => {
      window.removeEventListener('resize', setH);
      try{ ro && ro.disconnect(); }catch{}
    };
  }, []);
  return (
    <footer ref={ref} className="theme-footer" role="contentinfo" aria-label="Site footer">
      <div className="theme-footer-inner">
        <div className="footer-left">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">⚡</span>
            <strong className="brand-name">Neon Games</strong>
          </div>
          <div className="tagline d-none d-md-block">Arcade‑vibe multiplayer classics</div>
        </div>
        <nav className="footer-center" aria-label="Footer">
          <a href="/welcome" className="text-link">Home</a>
          <span className="sep">•</span>
          <a href="/roll-of-cards" className="text-link">Roll of Cards</a>
          <span className="sep d-none d-sm-inline">•</span>
          <a href="/connect-four" className="text-link">Connect Four</a>
          <span className="sep d-none d-sm-inline">•</span>
          <a href="/checkers" className="text-link">Checkers</a>
          <span className="sep d-none d-sm-inline">•</span>
          <a href="/chess" className="text-link d-none d-md-inline">Chess</a>
          <span className="sep d-none d-lg-inline">•</span>
          <a href="/3d-chess" className="text-link d-none d-lg-inline">3D Chess</a>
          <span className="sep d-none d-xl-inline">•</span>
          <a href="/registration" className="text-link d-none d-xl-inline">Account</a>
        </nav>
        <div className="footer-right">
          <div className="social-icons" aria-label="Social links">
            {/* Replace with your actual profiles */}
            <a className="soc x" href="https://twitter.com/" target="_blank" rel="noopener noreferrer" aria-label="X (Twitter)">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" role="img" aria-hidden="true"><path d="M18.244 2H21l-6.56 7.49L22 22h-6.59l-5.16-6.71L3.93 22H1.17l7.02-8.01L2 2h6.7l4.66 6.2L18.24 2Zm-2.31 18h2.2L8.17 4h-2.3l10.06 16Z"/></svg>
            </a>
            <a className="soc discord" href="https://discord.com/" target="_blank" rel="noopener noreferrer" aria-label="Discord">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" role="img" aria-hidden="true"><path d="M20.317 4.369A19.791 19.791 0 0 0 16.558 3c-.2.363-.43.85-.589 1.232a18.27 18.27 0 0 0-4-.003A12.3 12.3 0 0 0 11.38 3 19.73 19.73 0 0 0 7.64 4.37C3.67 9.7 2.88 14.9 3.25 20.05a19.86 19.86 0 0 0 4.9 1.58c.396-.54.75-1.116 1.06-1.72a12.9 12.9 0 0 1-1.67-.64c.14-.1.28-.21.41-.32a13.9 13.9 0 0 0 11.99 0c.13.11.27.22.41.32-.53.21-1.09.46-1.68.65.31.6.66 1.17 1.06 1.71a19.82 19.82 0 0 0 4.9-1.58c.4-5.68-.68-10.82-3.97-15.68ZM9.68 15.33c-1.02 0-1.85-1-1.85-2.24 0-1.24.82-2.25 1.85-2.25 1.03 0 1.86 1.01 1.85 2.25 0 1.24-.82 2.24-1.85 2.24Zm4.64 0c-1.02 0-1.85-1-1.85-2.24 0-1.24.83-2.25 1.85-2.25 1.03 0 1.85 1.01 1.85 2.25s-.82 2.24-1.85 2.24Z"/></svg>
            </a>
            <a className="soc instagram" href="https://instagram.com/" target="_blank" rel="noopener noreferrer" aria-label="Instagram">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" role="img" aria-hidden="true"><path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Zm0 2a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H7Zm5 3.5A5.5 5.5 0 1 1 6.5 13 5.5 5.5 0 0 1 12 7.5Zm0 2A3.5 3.5 0 1 0 15.5 13 3.5 3.5 0 0 0 12 9.5Zm5.75-3.25a1 1 0 1 1-1 1 1 1 0 0 1 1-1Z"/></svg>
            </a>
            <a className="soc tiktok" href="https://tiktok.com/" target="_blank" rel="noopener noreferrer" aria-label="TikTok">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" role="img" aria-hidden="true"><path d="M12.66 2h3.08c.2 1.08.7 2.06 1.43 2.86a6.1 6.1 0 0 0 2.93 1.74v3.2a8.02 8.02 0 0 1-5.02-1.75v7.11a6.45 6.45 0 1 1-6.45-6.45c.42 0 .84.04 1.24.12v3.24a3.23 3.23 0 1 0 2.3 3.1V2Z"/></svg>
            </a>
            <a className="soc youtube" href="https://youtube.com/" target="_blank" rel="noopener noreferrer" aria-label="YouTube">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" role="img" aria-hidden="true"><path d="M23.5 6.2s-.23-1.62-.93-2.33c-.89-.93-1.89-.94-2.35-.99C16.98 2.5 12 2.5 12 2.5h-.01s-4.98 0-8.21.38c-.46.05-1.46.06-2.35.99C.73 4.58.5 6.2.5 6.2S.25 8.12.25 10.03v1.85c0 1.92.25 3.84.25 3.84s.23 1.62.93 2.33c.89.93 2.06.9 2.58 1 1.88.18 7.99.37 7.99.37s4.99-.01 8.22-.39c.46-.05 1.46-.06 2.35-.99.7-.71.93-2.33.93-2.33s.25-1.92.25-3.84v-1.85c0-1.91-.25-3.83-.25-3.83ZM9.75 13.5V7.75l6.25 2.88-6.25 2.87Z"/></svg>
            </a>
            <a className="soc github" href="https://github.com/" target="_blank" rel="noopener noreferrer" aria-label="GitHub">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" role="img" aria-hidden="true"><path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.8-.25.8-.56V20.1c-3.26.7-3.95-1.4-3.95-1.4-.53-1.36-1.3-1.72-1.3-1.72-1.06-.73.08-.72.08-.72 1.17.08 1.79 1.2 1.79 1.2 1.04 1.78 2.74 1.27 3.41.97.1-.77.4-1.28.72-1.57-2.6-.3-5.33-1.3-5.33-5.8 0-1.28.46-2.32 1.2-3.14-.12-.3-.52-1.53.11-3.19 0 0 .98-.32 3.2 1.2a11.1 11.1 0 0 1 5.82 0c2.22-1.52 3.2-1.2 3.2-1.2.63 1.66.23 2.89.11 3.19.74.82 1.2 1.86 1.2 3.14 0 4.51-2.74 5.5-5.36 5.8.42.36.77 1.07.77 2.16v3.2c0 .31.22.67.8.56A11.5 11.5 0 0 0 12 .5Z"/></svg>
            </a>
          </div>
          <small className="copy">© {new Date().getFullYear()}</small>
        </div>
      </div>
    </footer>
  );
}

export default App;
