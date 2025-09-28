/* eslint-disable react/jsx-pascal-case */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navbar, Nav, Container, Button, NavDropdown, Spinner, Modal, Form } from "react-bootstrap";
import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap-icons/font/bootstrap-icons.css";
import "./NavBar.css";
import "../theme.css";
import WalletModal from "./common/WalletModal";
// Removed STL preload; GLB loads are cached lazily

/* ===== API base: env → same host/IP (port 3002) → localhost ===== */
function resolveApiBase() {
  if (process.env.REACT_APP_API_BASE) return process.env.REACT_APP_API_BASE;
  if (typeof window !== "undefined") {
    const { protocol, hostname } = window.location;
    const envHost = (process.env.REACT_APP_SERVER_HOST || "").trim();
    const winHost = (window.SERVER_HOST ? String(window.SERVER_HOST).trim() : "");
    let lsHost = ""; try { lsHost = (localStorage.getItem("serverHost") || "").trim(); } catch {}
    const host = envHost || winHost || lsHost || hostname;
    return `${protocol}//${host}:3002`;
  }
  return "http://localhost:3002";
}
const API = resolveApiBase();

/* ===== Thin auth-aware fetch with timeout + 401 handling ===== */
function authFetch(path, options = {}) {
  const token = localStorage.getItem("token") || "";
  const controller = new AbortController();
  const tm = setTimeout(() => controller.abort(), 12000); // 12s network timeout
  return fetch(`${API}${path}`, {
    ...options,
    signal: (options && options.signal) || controller.signal,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
    .then((res) => {
      clearTimeout(tm);
      if (res.status === 401 || res.status === 419 || res.status === 440) {
        // session expired or unauthorized: clear and broadcast
        localStorage.removeItem("token");
        localStorage.removeItem("username");
        window.dispatchEvent(new Event("authchange"));
      }
      return res;
    })
    .catch((err) => {
      clearTimeout(tm);
      return Promise.reject(err);
    });
}

async function getBalance() {
  try {
    const r = await authFetch("/balance");
    const j = await r.json().catch(() => ({}));
    const n = Number(j?.sc_balance);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export default function NavBar() {
  /* ===== Theme (neon/day) ===== */
  const readTheme = () => localStorage.getItem('theme') || 'neon';
  const [theme, setTheme] = useState(readTheme());
  useEffect(()=>{
    try{
      const root = document.documentElement;
      if(theme === 'day') root.setAttribute('data-theme', 'day');
      else root.removeAttribute('data-theme');
      localStorage.setItem('theme', theme);
      window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
    }catch{}
  }, [theme]);

  /* ===== Auth state ===== */
  const readAuth = () => {
    const token = localStorage.getItem("token") || "";
    const username = localStorage.getItem("username") || "";
    return { isUserLoggedIn: Boolean(token && username), username };
  };
  const [{ isUserLoggedIn, username }, setAuth] = useState(readAuth);
  const showAuthedUI = !!isUserLoggedIn;

  /* ===== Wallet balance ===== */
  const [balance, setBalance] = useState(null); // null = unknown/loading
  const [loadingBal, setLoadingBal] = useState(false);

  const fmtSC = useMemo(() => (n) => `${(Number(n) || 0).toFixed(2)} SC`, []);

  const refreshBalance = useCallback(async () => {
    if (!isUserLoggedIn) return;
    try {
      setLoadingBal(true);
      const n = await getBalance();
      setBalance(n);
    } finally {
      setLoadingBal(false);
    }
  }, [isUserLoggedIn]);

  /* ===== Nav height -> CSS var for spacer ===== */
  const navRef = useRef(null);
  useEffect(() => {
    const applyH = () => {
      const h = navRef.current?.offsetHeight || 64;
      document.documentElement.style.setProperty("--nav-h", `${h}px`);
    };
    applyH();
    const ro = new ResizeObserver(applyH);
    if (navRef.current) ro.observe(navRef.current);
    window.addEventListener("resize", applyH);
    return () => {
      window.removeEventListener("resize", applyH);
      ro.disconnect();
    };
  }, []);

  /* Sync auth across tabs + app */
  useEffect(() => {
    const sync = () => setAuth(readAuth());
    window.addEventListener("authchange", sync);
    window.addEventListener("storage", sync);
  const onBal = () => refreshBalance();
    window.addEventListener('balance:update', onBal);
    // initial
    sync();
    return () => {
      window.removeEventListener("authchange", sync);
      window.removeEventListener("storage", sync);
      window.removeEventListener('balance:update', onBal);
    };
  }, [refreshBalance]);

  /* Keep-alive (calls /me) */
  const keepAlive = useCallback(async () => {
    try {
      await authFetch("/me", { method: "GET" });
    } catch {}
  }, []);

  /* Load/refresh balance when logged in + timers */
  useEffect(() => {
    if (!isUserLoggedIn) {
      setBalance(null);
      return;
    }

    refreshBalance(); // initial

    const ka = setInterval(keepAlive, 5 * 60 * 1000); // keep session warm every 5 min
    const timer = setInterval(refreshBalance, 30000); // refresh every 30s

    const onFocus = () => refreshBalance();
    window.addEventListener("focus", onFocus);

    return () => {
      clearInterval(ka);
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [isUserLoggedIn, refreshBalance, keepAlive]);

  /* ===== Logout ===== */
  const handleLogout = async () => {
    try {
      await authFetch("/logout", { method: "POST" });
    } catch {}
    localStorage.removeItem("token");
    localStorage.removeItem("username");
    window.dispatchEvent(new Event("authchange"));
    setAuth(readAuth());
  };

  /* ===== Gaming Profile (global) ===== */
  const [showProfile, setShowProfile] = useState(false);
  const [profileName, setProfileName] = useState(localStorage.getItem('username') || '');
  const [profileAvatar, setProfileAvatar] = useState(localStorage.getItem('profileAvatar') || 'rocket');
  const [profileColor, setProfileColor] = useState(localStorage.getItem('profileColor') || '#22d3ee');
  const PALETTE = ['#22D3EE','#60A5FA','#A78BFA','#F472B6','#F59E0B','#84CC16','#EF4444','#14B8A6','#EAB308','#FFFFFF'];
  const AVATAR_SET=[{id:'rocket',label:'Rocket',glyph:'🚀'},{id:'dragon',label:'Dragon',glyph:'🐉'},{id:'brain',label:'Brain',glyph:'🧠'},{id:'fox',label:'Fox',glyph:'🦊'},{id:'lion',label:'Lion',glyph:'🦁'},{id:'panda',label:'Panda',glyph:'🐼'},{id:'astronaut',label:'Astronaut',glyph:'🧑‍🚀'},{id:'alien',label:'Alien',glyph:'👾'}];
  const saveProfile = () => {
    if (profileName) localStorage.setItem('username', profileName.slice(0,16));
    localStorage.setItem('profileAvatar', profileAvatar);
    localStorage.setItem('profileColor', profileColor);
    window.dispatchEvent(new Event('profile:update'));
    setShowProfile(false);
  };

  // Wallet modal state
  const [showWallet, setShowWallet] = useState(false);

  return (
    <>
    <Navbar ref={navRef} className="app-navbar shadow-sm" bg="dark" variant="dark" fixed="top" expand="md">
      <Container fluid>
        {/* Brand: Neon Games (match footer branding) */}
        <Navbar.Brand href="/" className="brand">
          <span className="brand-emblem brand-mark" aria-hidden="true">⚡</span>
          <strong className="brand-name">Neon Games</strong>
        </Navbar.Brand>

        <Navbar.Toggle aria-controls="main-nav">
          <i className="bi bi-list" />
        </Navbar.Toggle>

        <Navbar.Collapse id="main-nav">
          <Nav className="me-auto">
            <Nav.Link href="/roll-of-cards">Roll of Cards</Nav.Link>
            <Nav.Link href="/connect-four">Connect 4</Nav.Link>
            <Nav.Link href="/checkers">Checkers</Nav.Link>
            <Nav.Link href="/chess">Chess</Nav.Link>
            <Nav.Link href="/3d-chess">3D Chess</Nav.Link>
            <Nav.Link href="/war">War</Nav.Link>
            <Nav.Link href="/battleship">Battleship</Nav.Link>
          </Nav>

          {/* Right HUD */}
          <div className="hud-right d-flex align-items-center gap-2">
            {/* Theme toggle */}
            <Button variant={theme==='day'?'outline-dark':'outline-light'} size="sm" onClick={()=>setTheme(theme==='day'?'neon':'day')} title={theme==='day'?'Switch to Neon':'Switch to Day'}>
              {theme==='day' ? <i className="bi bi-moon-stars" /> : <i className="bi bi-sun" />}
            </Button>
            {/* Balance (only when authed and loaded) */}
            {showAuthedUI && (
              <div className="balance-badge">
                <i className="bi bi-wallet2 me-1" />
                {loadingBal ? (
                  <Spinner animation="border" size="sm" />
                ) : balance !== null ? (
                  <span className="hud-balance">{fmtSC(balance)}</span>
                ) : null}
              </div>
            )}

            {showAuthedUI ? (
              <NavDropdown
                title={
                  <span>
                    <i className="bi bi-person-circle me-2" />
                    {username}
                  </span>
                }
                id="user-dd"
                align="end"
              >
                <NavDropdown.Item onMouseDown={(e)=>{ e.preventDefault(); e.stopPropagation(); setShowProfile(true); }}>
                  <i className="bi bi-controller me-2" />
                  Set up Gaming Profile
                </NavDropdown.Item>
                <NavDropdown.Item onMouseDown={(e)=>{ e.preventDefault(); e.stopPropagation(); setShowWallet(true); }}>
                  <i className="bi bi-wallet2 me-2" />
                  Wallet…
                </NavDropdown.Item>
                <NavDropdown.Divider />
                <NavDropdown.Item onMouseDown={(e)=>{ e.preventDefault(); e.stopPropagation(); refreshBalance(); }}>
                  <i className="bi bi-arrow-clockwise me-2" />
                  Refresh Balance
                </NavDropdown.Item>
                <NavDropdown.Divider />
                <NavDropdown.Item onMouseDown={(e)=>{ e.preventDefault(); e.stopPropagation(); handleLogout(); }}>
                  <i className="bi bi-box-arrow-right me-2" />
                  Logout
                </NavDropdown.Item>
              </NavDropdown>
            ) : (
              <Button as="a" href="/registration" className="login-btn">
                <i className="bi bi-box-arrow-in-right me-2" />
                Login / Register
              </Button>
            )}
          </div>
        </Navbar.Collapse>
      </Container>
      {/* Bottom LED strip */}
      <div className="nav-led-rail" aria-hidden="true">
        <div className="nav-led-run" />
      </div>
  </Navbar>

    <Modal show={showProfile} onHide={()=>setShowProfile(false)} centered>
      <Modal.Header closeButton className="bg-dark text-light">
        <Modal.Title>Gaming Profile</Modal.Title>
      </Modal.Header>
      <Modal.Body className="bg-dark text-light">
        <div className="mb-3">
          <Form.Label className="fw-bold">Screen Name</Form.Label>
          <Form.Control value={profileName} onChange={e=>setProfileName(e.target.value)} maxLength={16} className="bg-dark-subtle border-0 text-light"/>
          <div className="small text-secondary mt-1">Used across all games.</div>
        </div>
        <div className="mb-3">
          <Form.Label className="fw-bold">Avatar</Form.Label>
          <div className="d-flex flex-wrap gap-2">
            {AVATAR_SET.map(a=> (
              <button key={a.id} type="button" className={`btn btn-outline-light ${profileAvatar===a.id?'active':''}`} onClick={()=>setProfileAvatar(a.id)} title={a.label}>
                <span style={{fontSize:22}}>{a.glyph}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="mb-2">
          <Form.Label className="fw-bold">Piece/Chip Color</Form.Label>
          <div className="d-flex flex-wrap gap-2">
            {PALETTE.map(hex => (
              <button key={hex} type="button" className={`btn ${profileColor.toLowerCase()===hex.toLowerCase()? 'btn-light' : 'btn-outline-light'}`} style={{width:36,height:36,borderRadius:18,background:hex}} onClick={()=>setProfileColor(hex)} aria-label={`Pick ${hex}`} />
            ))}
          </div>
        </div>
      </Modal.Body>
      <Modal.Footer className="bg-dark text-light">
        <Button variant="outline-light" onClick={()=>setShowProfile(false)}>Cancel</Button>
        <Button variant="light" onClick={saveProfile}>Save</Button>
      </Modal.Footer>
    </Modal>
    <WalletModal show={showWallet} onHide={()=>setShowWallet(false)} />
    </>
  );
}
