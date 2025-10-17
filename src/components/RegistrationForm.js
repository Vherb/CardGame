// src/components/auth/Registration.js
import React, { useMemo, useState } from "react";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import Container from "react-bootstrap/Container";
import NavBar from "./NavBar";
import "bootstrap/dist/css/bootstrap.min.css";

/** Resolve API base
 * - In production behind a reverse proxy (no port or standard ports), use same-origin "/api"
 * - Honor REACT_APP_API_BASE if provided
 * - In dev (CRA on :3000), fall back to http(s)://host:3002
 */
function resolveApiBase() {
  const envBase = (process.env.REACT_APP_API_BASE || '').trim();
  if (envBase) return envBase; // e.g. "/api" or full URL

  const { protocol, hostname, port } = window.location;
  const envHost = (process.env.REACT_APP_SERVER_HOST || '').trim();
  const winHost = (window.SERVER_HOST ? String(window.SERVER_HOST).trim() : '');
  let lsHost = '';
  try { lsHost = (localStorage.getItem('serverHost') || '').trim(); } catch {}
  const host = envHost || winHost || lsHost || hostname;

  // Production/same-origin: when served via standard ports or no explicit port
  if (!port || port === '443' || port === '80') {
    return '/api';
  }

  // Dev fallback: CRA on 3000 talks to backend on 3002
  const targetPort = port === '3000' ? '3002' : port;
  return `${protocol}//${host}:${targetPort}`;
}
const API = resolveApiBase();

function timeoutFetch(url, options = {}, ms = 12000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(t));
}

// Default to LOGIN unless URL explicitly says ?tab=register or ?tab=signup
const getInitialIsRegistering = () => {
  const sp = new URLSearchParams(window.location.search);
  const tab = (sp.get("tab") || "").toLowerCase();
  return tab === "register" || tab === "signup"; // true => show register form
};

function Registration({ onAuthed }) {
  const [formData, setFormData] = useState({ email: "", username: "", password: "" });
  const [registrationError, setRegistrationError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [isRegistering, setIsRegistering] = useState(getInitialIsRegistering());

  const setTab = (reg) => {
    const sp = new URLSearchParams(window.location.search);
    sp.set("tab", reg ? "register" : "login");
    window.history.replaceState({}, "", `${window.location.pathname}?${sp.toString()}`);
    setIsRegistering(reg);
  };

  const canSubmit = useMemo(() => {
    const uOK = formData.username.trim().length >= 3;
    const pOK = formData.password.length >= 6;
    const eOK = isRegistering ? /\S+@\S+\.\S+/.test(formData.email) : true;
    return uOK && pOK && eOK;
  }, [formData, isRegistering]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((s) => ({ ...s, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit || busy) return;

    setRegistrationError(null);
    setBusy(true);

    try {
      const url = `${API}${isRegistering ? "/registration" : "/login"}`;
      const payload = isRegistering
        ? { email: formData.email, username: formData.username, password: formData.password }
        : { username: formData.username, password: formData.password };

      const res = await timeoutFetch(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        12000
      );

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);

  localStorage.setItem("token", data.token);
  localStorage.setItem("username", data.username);
  if (data.userId != null) localStorage.setItem("userId", String(data.userId));

  if (onAuthed) onAuthed({ username: data.username, token: data.token, userId: data.userId });

      // go home
      window.location.replace("/");

      // clear PW field only
      setFormData((s) => ({ ...s, password: "" }));
    } catch (err) {
      setRegistrationError(
        err.name === "AbortError" ? "Connection timed out. Try again." : err.message || "An error occurred. Please try again later."
      );
    } finally {
      setBusy(false);
    }
  };

  const toggleForm = () => {
    setRegistrationError(null);
    setTab(!isRegistering);
  };

  return (
    <Container fluid className="p-0">
      <NavBar />
      <div className="app-nav-spacer" aria-hidden="true" />

      <div className="d-flex justify-content-center align-items-start" style={{ minHeight: "70vh" }}>
        <div className="card bg-dark text-light border-0 shadow-lg mt-5" style={{ width: "100%", maxWidth: 520, borderRadius: 16 }}>
          <div className="card-body p-4 p-md-5">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <h2 className="fw-bold m-0">{isRegistering ? "Create account" : "Login"}</h2>
              <Button variant="outline-light" onClick={toggleForm} className="ms-3" size="sm" disabled={busy}>
                {isRegistering ? "Have an account? Log in" : "New here? Create one"}
              </Button>
            </div>

            <p className="text-secondary mb-4">
              {isRegistering ? "Pick a unique username and a strong password." : "Welcome back — log in to continue playing."}
            </p>

            {registrationError && (
              <div className="alert alert-danger py-2" role="alert">
                {registrationError}
              </div>
            )}

            <Form onSubmit={handleSubmit} className="d-grid gap-3">
              {isRegistering && (
                <Form.Group controlId="formEmail">
                  <Form.Label>Email</Form.Label>
                  <Form.Control
                    type="email"
                    placeholder="you@example.com"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    autoComplete="email"
                    disabled={busy}
                    required
                    className="bg-dark-subtle border-0 text-light form-control-lg"
                  />
                  <Form.Text className="text-muted">We’ll never share your email.</Form.Text>
                </Form.Group>
              )}

              <Form.Group controlId="formUserName">
                <Form.Label>Username</Form.Label>
                <Form.Control
                  type="text"
                  placeholder="Your username"
                  name="username"
                  value={formData.username}
                  onChange={handleChange}
                  autoComplete="username"
                  disabled={busy}
                  required
                  className="bg-dark-subtle border-0 text-light form-control-lg"
                />
              </Form.Group>

              <Form.Group controlId="formPassword">
                <Form.Label>Password</Form.Label>
                <Form.Control
                  type="password"
                  placeholder={isRegistering ? "At least 6 characters" : "••••••••"}
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  autoComplete={isRegistering ? "new-password" : "current-password"}
                  disabled={busy}
                  required
                  className="bg-dark-subtle border-0 text-light form-control-lg"
                />
              </Form.Group>

              {isRegistering && (
                <Form.Group controlId="formTos" className="mt-1">
                  <Form.Check type="checkbox" label="I agree to the terms and conditions" required disabled={busy} />
                </Form.Group>
              )}

              <div className="d-grid">
                <Button variant="light" type="submit" disabled={!canSubmit || busy} size="lg" className="fw-bold">
                  {busy ? (isRegistering ? "Creating…" : "Signing in…") : isRegistering ? "Register" : "Login"}
                </Button>
              </div>

              <div className="text-center text-body-secondary small mt-2">
                You’ll stay signed in until you log out. If your session expires, the nav switches to logged-out automatically.
              </div>
            </Form>
          </div>
        </div>
      </div>
    </Container>
  );
}

export default Registration;
