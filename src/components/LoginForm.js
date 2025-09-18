// src/components/auth/LoginForm.js
import React, { useMemo, useState } from "react";
import "bootstrap/dist/css/bootstrap.min.css";

const HORIZON = "https://horizon-testnet.stellar.org";

// LocalStorage keys your game already uses
const LS_BAL = "roc_last_balance"; // cached balance
const LS_PUBLIC = "roc_public";    // cached wallet pubkey

// Resolve API base without any external helper files.
// Priority: REACT_APP_API_BASE → same host/IP on port 3002 → localhost:3002
function resolveApiBase() {
  if (process.env.REACT_APP_API_BASE) return process.env.REACT_APP_API_BASE;
  if (typeof window !== "undefined") {
    const { protocol, hostname } = window.location; // works for 192.168.x.x too
    return `${protocol}//${hostname}:3002`;
  }
  return "http://localhost:3002";
}
const API = resolveApiBase();

function timeoutFetch(url, options = {}, ms = 12000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(t));
}

async function fetchStellarBalance(pubkey) {
  try {
    const res = await timeoutFetch(
      `${HORIZON}/accounts/${encodeURIComponent(pubkey)}`,
      { method: "GET" },
      12000
    );
    if (!res.ok) return null;
    const account = await res.json();
    const native = (account.balances || []).find((b) => b.asset_type === "native");
    return native ? parseFloat(native.balance) : 0;
  } catch {
    return null;
  }
}

export default function LoginForm() {
  const [formData, setFormData] = useState({ username: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const canSubmit = useMemo(
    () => formData.username.trim().length >= 3 && formData.password.length >= 4,
    [formData.username, formData.password]
  );

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((s) => ({ ...s, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit || busy) return;
    setErr("");
    setBusy(true);
    try {
      // 1) login
      const res = await timeoutFetch(
        `${API}/login`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData),
        },
        12000
      );

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Login failed");

      // 2) save auth
      localStorage.setItem("token", data.token);
      localStorage.setItem("username", data.username);

      // 3) load profile for wallet pubkey (server returns `public_key`)
      let walletPublic = null;
      try {
        const r2 = await timeoutFetch(
          `${API}/me`,
          { headers: { Authorization: `Bearer ${data.token}` } },
          12000
        );
        if (r2.ok) {
          const me = await r2.json().catch(() => ({}));
          walletPublic = me.public_key || me.wallet_public || null;
        }
      } catch {}

      // 4) preload live XLM balance if pubkey exists
      if (walletPublic) {
        localStorage.setItem(LS_PUBLIC, walletPublic);
        const lumens = await fetchStellarBalance(walletPublic);
        if (lumens != null) localStorage.setItem(LS_BAL, String(lumens));
      }

      // 5) redirect home
      window.location.replace("/");
    } catch (e2) {
      setErr(
        e2.name === "AbortError"
          ? "Connection timed out. Try again."
          : e2.message || "Failed to sign in"
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="d-flex justify-content-center align-items-start" style={{ minHeight: "70vh" }}>
      <div
        className="card bg-dark text-light border-0 shadow-lg mt-5"
        style={{ width: "100%", maxWidth: 420, borderRadius: 16 }}
      >
        <div className="card-body p-4 p-md-5">
          <h2 className="fw-bold mb-2">Welcome back</h2>
          <div className="mb-3 small">
            Don&apos;t have an account?{" "}
            <a className="link-light" href="/registration?tab=register">
              Create one
            </a>
            .
          </div>
          <p className="text-secondary mb-4">Log in to continue playing.</p>

          {err && <div className="alert alert-danger py-2">{err}</div>}

          <form onSubmit={handleSubmit} className="d-grid gap-3">
            <div>
              <label className="form-label">Username</label>
              <input
                className="form-control form-control-lg bg-dark-subtle border-0 text-light"
                name="username"
                value={formData.username}
                onChange={handleChange}
                autoComplete="username"
                placeholder="Your username"
                disabled={busy}
                required
              />
            </div>

            <div>
              <label className="form-label">Password</label>
              <input
                className="form-control form-control-lg bg-dark-subtle border-0 text-light"
                type="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                autoComplete="current-password"
                placeholder="••••••••"
                disabled={busy}
                required
              />
            </div>

            <button
              className="btn btn-light btn-lg fw-bold mt-1"
              type="submit"
              disabled={!canSubmit || busy}
            >
              {busy ? "Signing in…" : "Login"}
            </button>

            <div className="text-center text-body-secondary small mt-2">
              If your session ever expires, the nav will switch to logged-out automatically.
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
