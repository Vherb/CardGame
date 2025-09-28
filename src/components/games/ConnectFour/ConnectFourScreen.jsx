/* eslint-disable react/jsx-pascal-case */
import React, { useCallback, useEffect, useState } from "react";
import "./ConnectFourScreen.css";
import GameBoard from "./GameBoard";
import LoginOverlay from "../../common/LoginOverlay";
import NavBar from "./../../NavBar"; // <-- your existing nav

export default function ConnectFourScreen() {
  const isAuthed = useCallback(() => !!localStorage.getItem('token') && !!localStorage.getItem('username'), []);
  const [authed, setAuthed] = useState(isAuthed());
  useEffect(()=>{
    const onChange = ()=> setAuthed(isAuthed());
    window.addEventListener('authchange', onChange);
    return ()=> window.removeEventListener('authchange', onChange);
  }, [isAuthed]);

  // Ensure page stops exactly at bottom (remove global bottom pad) while C4 screen is mounted
  useEffect(() => {
    try {
      const cls = 'no-bottom-pad';
      const cls2 = 'hide-global-led';
      const html = document.documentElement; const body = document.body; const root = document.getElementById('root');
      html && html.classList.add(cls, cls2); body && body.classList.add(cls, cls2); root && root.classList.add(cls, cls2);
      return () => { html && html.classList.remove(cls, cls2); body && body.classList.remove(cls, cls2); root && root.classList.remove(cls, cls2); };
    } catch {}
  }, []);
  return (
    <div className="cf-screen cf-c4">
      {/* Your fixed NavBar */}
      <NavBar />

      {/* Spacer so content starts directly below your NavBar */}
      <div className="nav-spacer" aria-hidden="true" />

      {/* Scrollable content area */}
      <main className="app-content" style={{ position:'relative' }}>
        {!authed && (<LoginOverlay />)}
        {/* Embedded mode: GameBoard hides its own header/spacer */}
        <GameBoard embedded />
      </main>
    </div>
  );
}
