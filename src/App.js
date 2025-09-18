import React from "react";
import Game from "./components/games/RollofCards/Game";
import InBetweenGame from "./components/games/inBetween/InBetween";
import ConnectFourScreen from "./components/games/ConnectFour/ConnectFourScreen";
import GameTable from "./components/games/War/GameTable";

import "./App.css";
import "bootstrap/dist/css/bootstrap.min.css";
import RegistrationForm from "./components/RegistrationForm";
import { Routes, Route } from "react-router-dom";

/* --- Add: global LedBar used across all pages --- */
function LedBar({ color = "rgba(255,110,220,0.95)", speed = 5 }) {
	// Renders a fixed full-width LED rail; animation/timing come from the global CSS below
	return (
		<div className="led-topbar" aria-hidden="true">
			<div className="led-run" style={{ ['--led-color']: color, ['--led-speed']: `${speed}s` }} />
		</div>
	);
}

function App() {
  return (
    <>
      {/* Global LedBar / Footer injected once so all game pages share the exact same look */}
      <LedBar color="rgba(255,110,220,0.95)" speed={5} />

      <Routes>
        <Route path='/' element={<Home />} />
        <Route path='/game2' element={<InBetweenGame />} />
        <Route path='/registration' element={<RegistrationForm />} />
        <Route path='/connect-four' element={<ConnectFourScreen />} />
        <Route path='/war' element={<GameTable />} />
      </Routes>
      <Footer />

      {/* Global theme CSS: LED, footer, small safe bottom padding — used by all three games */}
      <style>{`
        /* LED topbar (shared across games)
           - position relative to navbar height so it aligns on every page
           - very high z-index and !important to avoid being hidden by per-page navbars */
        :root { --nav-height: 56px; } /* default; pages can override if needed */
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
        .led-run {
          --led-color: rgba(255,110,220,0.95);
          --led-speed: 5s;
          position: relative;
          width: 120vw;
          height: 8px;
          margin-left: -10vw;
          border-radius: 999px;
          background:
            linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(255,255,255,0.02) 18%, var(--led-color) 46%, rgba(255,255,255,0.02) 54%, rgba(0,0,0,0) 100%),
            linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0));
          background-size: 300% 100%, 100% 100%;
          filter: blur(5px) saturate(1.05);
          opacity: 0.98;
          mix-blend-mode: screen;
          z-index: 100000 !important;
          animation: led-bg-move var(--led-speed) linear infinite, led-pulse calc(var(--led-speed) * 2) ease-in-out infinite;
        }
        .led-run::before {
          content: "";
          position: absolute;
          left: -50%;
          top: -120%;
          width: 36%;
          height: 360%;
          transform: skewX(-18deg);
          background: linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.55) 45%, rgba(255,255,255,0) 100%);
          filter: blur(8px) saturate(1.15);
          opacity: 0.95;
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
          height: 52px;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 4200;
          background: linear-gradient(180deg, rgba(20,12,27,0.96), rgba(8,6,12,0.98));
          border-top: 1px solid rgba(255,110,220,0.05);
          box-shadow: 0 -10px 30px rgba(99,64,255,0.04), inset 0 1px 0 rgba(255,255,255,0.01);
          color: #cfe3ff;
          font-size: 0.9rem;
          -webkit-backdrop-filter: blur(6px);
          backdrop-filter: blur(6px);
          pointer-events: auto;
        }
        .theme-footer::before {
          content: "";
          position: absolute;
          left: 0;
          right: 0;
          top: -6px;
          height: 6px;
          background:
            linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(255,255,255,0.03) 20%, rgba(255,110,220,0.9) 48%, rgba(255,255,255,0.03) 56%, rgba(0,0,0,0) 100%);
          background-size: 300% 100%;
          filter: blur(6px);
          mix-blend-mode: screen;
          animation: led-bg-move 5s linear infinite;
          z-index: 4201;
          pointer-events: none;
        }
        .theme-footer .theme-footer-inner { width: min(1180px, 96%); display:flex; gap:12px; align-items:center; justify-content:space-between; padding: 0 12px; }
        .theme-footer .text-link { color: #bfcff8; text-decoration:none; opacity:.95; margin:0 6px; }
        .theme-footer .text-link:hover { color:#fff; text-decoration:underline; }
        html, body, #root { padding-bottom: 72px !important; } /* avoid footer overlap */
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
  return (
    <footer className="theme-footer" role="contentinfo" aria-label="Site footer">
      <div className="theme-footer-inner">
        <div className="footer-left">
          <strong>Neon Games</strong> — Roll of Cards · InBetween · Connect Four · War
        </div>
        <div className="footer-center">
          <a href="/registration" className="text-link">Account</a>
          <span className="sep">•</span>
          <a href="/connect-four" className="text-link">Connect Four</a>
          <span className="sep">•</span>
          <a href="/game2" className="text-link">InBetween</a>
        </div>
        <div className="footer-right">
          <small>Made for dev / testnet • © {new Date().getFullYear()}</small>
        </div>
      </div>
    </footer>
  );
}

export default App;
