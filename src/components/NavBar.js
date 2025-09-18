/* eslint-disable react/jsx-pascal-case */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navbar, Nav, Container, Button, NavDropdown, Spinner } from "react-bootstrap";
import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap-icons/font/bootstrap-icons.css";
import "./NavBar.css";

/* ===== API base: env → same host/IP (port 3002) → localhost ===== */
function resolveApiBase() {
  if (process.env.REACT_APP_API_BASE) return process.env.REACT_APP_API_BASE;
  if (typeof window !== "undefined") {
    const { protocol, hostname } = window.location; // works for 192.168.x.x too
    return `${protocol}//${hostname}:3002`;
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
    // initial
    sync();
    return () => {
      window.removeEventListener("authchange", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

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

  return (
    <Navbar ref={navRef} className="app-navbar shadow-sm" bg="dark" variant="dark" fixed="top" expand="md">
      <Container fluid>
        {/* Brand */}
        <Navbar.Brand href="/" className="brand">
          <span className="brand-emblem">🎲</span>
          <span className="brand-name">Gambit</span>
        </Navbar.Brand>

        <Navbar.Toggle aria-controls="main-nav">
          <i className="bi bi-list" />
        </Navbar.Toggle>

        <Navbar.Collapse id="main-nav">
          <Nav className="me-auto">
            <Nav.Link href="/">Roll of Cards</Nav.Link>
            <Nav.Link href="/connect-four">Connect 4</Nav.Link>
            <Nav.Link href="/war">War</Nav.Link>
          </Nav>

          {/* Right HUD */}
          <div className="hud-right d-flex align-items-center gap-2">
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
                <NavDropdown.Item onClick={refreshBalance}>
                  <i className="bi bi-arrow-clockwise me-2" />
                  Refresh Balance
                </NavDropdown.Item>
                <NavDropdown.Divider />
                <NavDropdown.Item onClick={handleLogout}>
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
    </Navbar>
  );
}
