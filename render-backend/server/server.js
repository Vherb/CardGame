// server.js — full copy of original unified server with adjusted game paths for Render bundle
// Robust env loading similar to ../server/server.js
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
try {
  const root = path.join(__dirname, '..');
  const candidates = [
    process.env.ENV_FILE,
    '.env.production',
    '.env',
    path.join('..', '.env.production'),
    path.join('..', '.env')
  ]
    .filter(Boolean)
    .map((p) => path.isAbsolute(p) ? p : path.join(root, p));
  for (const f of candidates) { if (fs.existsSync(f)) { dotenv.config({ path: f }); break; } }
} catch { try { require('dotenv').config(); } catch {} }
// Ensure game WS modules run in unified-attach mode and do NOT start standalone servers
process.env.UNIFIED_WS = '1';

const express = require("express");
const mysql = require("mysql2");
const bodyParser = require("body-parser");
const bcrypt = require("bcrypt");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { generateToken } = require("./jwt");
const JWT_SECRET = process.env.JWT_SECRET || "1234";
if (JWT_SECRET === '1234') {
  console.warn("[SECURITY] JWT_SECRET is using the default '1234'. Set JWT_SECRET in your env.");
}

let _fetch = global.fetch;
if (typeof _fetch !== "function") {
  _fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
}
const fetch = _fetch;

const {
  Keypair,
  TransactionBuilder,
  Operation,
  Asset,
  Networks,
  Account,
} = require("@stellar/stellar-base");

const NETWORK_PASSPHRASE = Networks.TESTNET;
const BASE_FEE = "100";
const HORIZON = "https://horizon-testnet.stellar.org";
const FRIENDBOT = "https://friendbot.stellar.org";

// House wallets (TESTNET / DEV)
const HOUSE_PUBLIC = "GAKN3FCJ6Q2Q7G6SUOGVTKZVKUAC3USAS2XXVL53NJNMQQ3QBTPUN5BS";
const HOUSE_SECRET = "SCPWAY4XAJYHWUVEJEIEZ6ZZITARBWEY5Y4LMSQ235HPOQNE2HGIHDCA";

const xrpl = require("xrpl");
const XRPL_WS = "wss://s.altnet.rippletest.net:51233";
const XRPL_FAUCET = "https://faucet.altnet.rippletest.net/accounts";
const HOUSE_XRP_ADDRESS = "rwRHKqsNA6VE9DQH6aVDXwgKMGFCAWrUza";
const HOUSE_XRP_SECRET = "sEdTWiQQCV5ALq3BSjuCjVBWa56phLM";

const { ethers } = require("ethers");
const ETH_SEPOLIA_RPC = "https://rpc.sepolia.org";
const ETH_CHAIN_ID = 11155111;
const HOUSE_ETH_PRIVATE_KEY =
  process.env.HOUSE_ETH_PRIVATE_KEY || "0xYOUR_SEPOLIA_PRIVATE_KEY";

/* -------------------- Express -------------------- */
const app = express();
app.use(bodyParser.json());

/** CORS: allow localhost, 127.0.0.1, and any private LAN IP (10/172.16-31/192.168). */
const LAN_ORIGIN_REGEX =
  /^https?:\/\/(?:(?:localhost)|(?:127\.0\.0\.1)|(?:10(?:\.\d{1,3}){3})|(?:192\.168(?:\.\d{1,3}){2})|(?:172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2}))(?::\d+)?$/i;

const EXTRA_ORIGINS = (process.env.CORS_EXTRA_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // allow curl/postman
      if (LAN_ORIGIN_REGEX.test(origin)) return cb(null, true);
      if (EXTRA_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked: ${origin}`));
    },
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);
app.options("*", cors());

// Health check
app.get("/ping", (_req, res) => res.json({ ok: true }));

/* -------------------- Helpers (XLM) -------------------- */
async function horizonAccount(pub) {
  const r = await fetch(`${HORIZON}/accounts/${encodeURIComponent(pub)}`);
  if (!r.ok) throw new Error(`Horizon ${r.status}`);
  return r.json();
}
function nativeBal(acctJson) {
  const n = (acctJson.balances || []).find((b) => b.asset_type === "native");
  return n ? parseFloat(n.balance) : 0;
}
async function submitTx(tx) {
  const submit = await fetch(`${HORIZON}/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `tx=${encodeURIComponent(tx.toXDR("base64"))}`,
  });
  const body = await submit.json().catch(() => ({}));
  if (!submit.ok) {
    const code =
      body?.extras?.result_codes?.operations?.[0] ||
      body?.extras?.result_codes?.transaction ||
      body?.detail ||
      "tx_failed";
    const err = new Error(code);
    err.body = body;
    throw err;
  }
  return body;
}

/* -------------------- Helpers (XRPL) -------------------- */
let xrplClient;
async function getXrplClient() {
  if (xrplClient && xrplClient.isConnected()) return xrplClient;
  xrplClient = new xrpl.Client(XRPL_WS);
  await xrplClient.connect();
  return xrplClient;
}
async function xrplGetXrpBalance(address) {
  const c = await getXrplClient();
  const info = await c
    .request({ command: "account_info", account: address, ledger_index: "validated" })
    .catch(() => null);
  const drops = info?.result?.account_data?.Balance || "0";
  return Number(drops) / 1_000_000;
}

/* -------------------- Helpers (ETH) -------------------- */
const ethProvider = new ethers.JsonRpcProvider(ETH_SEPOLIA_RPC, ETH_CHAIN_ID);
const houseEthWallet = (() => {
  try {
    return new ethers.Wallet(HOUSE_ETH_PRIVATE_KEY, ethProvider);
  } catch {
    return null;
  }
})();

/* -------------------- Spendable safety buffers -------------------- */
const KEEP_XLM = 1.50005;
const KEEP_XRP = 10.00001;
const KEEP_ETH = 0;

function assetDecimals(asset) {
  if (asset === "XLM") return 6;
  if (asset === "XRP") return 6;
  if (asset === "ETH") return 6;
  return 6;
}
function floorToDecimals(n, dec) {
  const s = 10 ** dec;
  return Math.floor((Number(n) || 0) * s) / s;
}
function maxSpendableRaw(asset, bal) {
  const b = Number(bal) || 0;
  if (asset === "XLM") return Math.max(0, b - KEEP_XLM);
  if (asset === "XRP") return Math.max(0, b - KEEP_XRP);
  if (asset === "ETH") return Math.max(0, b - KEEP_ETH);
  return 0;
}
function maxSpendableRounded(asset, bal) {
  const dec = assetDecimals(asset);
  return floorToDecimals(maxSpendableRaw(asset, bal), dec);
}

/* -------------------- DB -------------------- */
const DB_OPTIONAL = /^(1|true)$/i.test(String(process.env.DB_OPTIONAL || ''));
let dbReady = false;
const dbConfig = {
  host: process.env.MYSQL_HOST || "127.0.0.1",
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "",
  database: process.env.MYSQL_DB || "game",
  port: Number(process.env.MYSQL_PORT) || 3306,
  connectionLimit: 10,
  // Optional TLS for hosted MySQL (set MYSQL_SSL=1 and optionally MYSQL_SSL_REJECT_UNAUTH=0)
  ssl: (() => {
    const use = String(process.env.MYSQL_SSL || '').trim();
    if (!use || use === '0' || /false/i.test(use)) return undefined;
    const reject = !(/0|false/i.test(String(process.env.MYSQL_SSL_REJECT_UNAUTH || '')));
    return { rejectUnauthorized: reject };
  })(),
};
console.log(`[DB] Using host ${dbConfig.host}:${dbConfig.port} ssl=${!!dbConfig.ssl}`);
const db = mysql.createPool(dbConfig);
// DB health endpoint available whether or not DB is ready
app.get('/health/db', (_req, res) => {
  if (!dbReady) return res.status(503).json({ ok: false, error: 'database unavailable' });
  db.query('SELECT 1 AS ok', (err, rows) => {
    if (err) return res.status(500).json({ ok: false, error: String(err.message||err) });
    res.json({ ok: true, row: rows && rows[0] ? rows[0] : null });
  });
});

db.getConnection((err, conn) => {
  if (err) {
    console.error("DB connect failed:", err);
    if (DB_OPTIONAL) {
      console.warn("[DB_OPTIONAL] Continuing without database. Endpoints needing DB will fail.");
      return; // do not run migrations
    }
    return;
  }
  dbReady = true;
  console.log("Connected to the database");
  conn.release();

  const safeQuery = (sql, params, cb) => {
    const q = db.query(sql, params || ((typeof params === 'function') ? undefined : params), (err, r) => {
      if (typeof params === 'function' && !cb) params(err, r);
      else if (cb) cb(err, r);
    });
    if (q && typeof q.on === 'function') q.on('error', () => {});
  };

  safeQuery(
    "CREATE TABLE IF NOT EXISTS jackpot_sc (id INT PRIMARY KEY, pool_sc DECIMAL(32,8) NOT NULL DEFAULT 0)",
    () => safeQuery("INSERT IGNORE INTO jackpot_sc (id, pool_sc) VALUES (1, 0)")
  );
  safeQuery(
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS xlm_balance DECIMAL(32,8) NOT NULL DEFAULT 0",
    (e) => {
      if (e && !/Duplicate column/i.test(String(e && e.message)))
        console.warn("ALTER users add xlm_balance failed:", e && e.message);
    }
  );
  safeQuery(
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS sc_balance DECIMAL(32,8) NOT NULL DEFAULT 0",
    (e) => {
      if (e && !/Duplicate column/i.test(String(e && e.message)))
        console.warn("ALTER users add sc_balance failed:", e && e.message);
      else
        safeQuery(
          "UPDATE users SET sc_balance = coin_balance WHERE (sc_balance = 0 OR sc_balance IS NULL) AND coin_balance IS NOT NULL"
        );
    }
  );
  safeQuery(
    "CREATE TABLE IF NOT EXISTS app_config (k VARCHAR(64) PRIMARY KEY, v TEXT NOT NULL)",
    (e) => { if (e) console.warn("CREATE app_config failed:", e && e.message); }
  );
});

// Note: schema migrations are executed after a successful DB connection using safeQuery above.

/* -------------------- Auth -------------------- */
function requireAuth(req, _res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return _res.status(401).json({ message: "No token" });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    _res.status(401).json({ message: "Invalid token" });
  }
}

/* -------------------- Routes (auth/user) -------------------- */
app.post("/registration", async (req, res) => {
  try {
    const { email, username, password } = req.body || {};
    if (!email || !username || !password)
      return res.status(400).json({ message: "Missing fields" });
    if (!dbReady) return res.status(503).json({ message: "Database unavailable" });
    db.query(
      "SELECT id FROM users WHERE username = ? LIMIT 1",
      [username],
      async (err, rows) => {
        if (err) return res.status(500).json({ message: "Registration failed" });
        if (rows.length)
          return res
            .status(400)
            .json({ message: "Username already exists. Please choose a different username." });
        const hashed = await bcrypt.hash(password, 10);
        db.query(
          "INSERT INTO users (email, username, password, sc_balance) VALUES (?, ?, ?, 0)",
          [email, username, hashed],
          (e2, r2) => {
            if (e2) return res.status(500).json({ message: "Registration failed" });
            if (r2.affectedRows !== 1)
              return res
                .status(500)
                .json({ message: "Registration failed due to a database issue" });
            const userId = Number(r2.insertId) || undefined;
            const token = generateToken({ userId, username, email });
            res.json({ token, username, userId });
          }
        );
      }
    );
  } catch {
    res.status(500).json({ message: "Registration failed" });
  }
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ message: "Missing fields" });
  if (!dbReady) return res.status(503).json({ message: "Database unavailable" });
  db.query(
    "SELECT * FROM users WHERE username = ? LIMIT 1",
    [username],
    async (err, rows) => {
      if (err) return res.status(500).json({ message: "Login failed" });
      if (!rows.length) return res.status(404).json({ message: "User not found" });
      const user = rows[0];
      const ok = await bcrypt.compare(password, user.password);
      if (!ok) return res.status(400).json({ message: "Incorrect password" });
      const token = generateToken({ userId: user.id, username: user.username, email: user.email });
      res.json({ token, username: user.username, userId: user.id });
    }
  );
});

app.get("/me", requireAuth, (req, res) => {
  const { username } = req.user;
  db.query(
    `SELECT id, username, email, sc_balance, public_key,
            xrp_address, eth_address, xrp_balance, eth_balance, xlm_balance
       FROM users WHERE username = ? LIMIT 1`,
    [username],
    (err, rows) => {
      if (err) return res.status(500).json({ message: "DB error" });
      if (!rows.length) return res.status(404).json({ message: "User not found" });
      const u = rows[0];
      res.json({
        userId: u.id,
        username: u.username,
        email: u.email,
        sc_balance: Number(u.sc_balance) || 0,
        public_key: u.public_key || null,
        xrp_address: u.xrp_address || null,
        eth_address: u.eth_address || null,
        xrp_balance: Number(u.xrp_balance) || 0,
        eth_balance: Number(u.eth_balance) || 0,
        xlm_balance: Number(u.xlm_balance) || 0,
      });
    }
  );
});

/* -------------------- Config: Checkers piece defaults -------------------- */
const CHECKERS_DEFAULTS_KEY = "checkers_piece_defaults";
const DEFAULTS_FALLBACK = { yOffset: -0.505, yScale: 1, zOffset: 0.12, xzScale: 0.75 };

app.get("/config/checkers/piece-defaults", async (_req, res) => {
  // Hardcoded global defaults for everyone
  return res.json(DEFAULTS_FALLBACK);
});

app.post("/config/checkers/piece-defaults", requireAuth, (req, res) => {
  try {
    const b = req.body || {};
    const cfg = {
      yOffset: Number(b.yOffset) || 0,
      yScale: Number(b.yScale) || 1,
      zOffset: Number(b.zOffset) || 0,
      xzScale: Number(b.xzScale) || 1,
    };
    const json = JSON.stringify(cfg);
    const sql = "INSERT INTO app_config (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)";
    db.query(sql, [CHECKERS_DEFAULTS_KEY, json], (e, r) => {
      if (e) return res.status(500).json({ ok: false, message: "DB error" });
      res.json({ ok: true, defaults: cfg });
    });
  } catch {
    res.status(500).json({ ok: false, message: "Save failed" });
  }
});

/* -------------------- Wallet attach & helpers -------------------- */
app.post("/wallet", requireAuth, (req, res) => {
  const { username } = req.user;
  const { public_key, secret_key } = req.body || {};
  if (!public_key || typeof public_key !== "string" || public_key.length !== 56)
    return res.status(400).json({ message: "Invalid public key" });
  if (!secret_key || typeof secret_key !== "string" || secret_key.length !== 56)
    return res.status(400).json({ message: "Invalid secret key" });
  const sql = `
    UPDATE users
       SET public_key = ?, secret_key = ?
     WHERE username = ? AND (public_key IS NULL OR public_key = '')
  `;
  db.query(sql, [public_key, secret_key, username], (err, result) => {
    if (err) return res.status(500).json({ message: "DB error" });
    if (result.affectedRows === 0)
      return res.status(409).json({ message: "Wallet already exists for this account" });
    res.json({ ok: true, public_key });
  });
});

app.get("/wallet/secret", requireAuth, (req, res) => {
  const { username } = req.user;
  db.query("SELECT secret_key FROM users WHERE username = ? LIMIT 1", [username], (err, rows) => {
    if (err) return res.status(500).json({ message: "DB error" });
    if (!rows.length) return res.status(404).json({ message: "User not found" });
    res.json({ secret_key: rows[0].secret_key || null });
  });
});

app.post("/wallet/xrp", requireAuth, (req, res) => {
  const { username } = req.user;
  const { address, secret } = req.body || {};
  if (!address || typeof address !== "string" || !address.startsWith("r"))
    return res.status(400).json({ message: "Invalid XRP address" });
  if (!secret || typeof secret !== "string")
    return res.status(400).json({ message: "XRP secret missing" });
  const sql = `
    UPDATE users
       SET xrp_address = ?, xrp_secret = ?
     WHERE username = ? AND (xrp_address IS NULL OR xrp_address = '')
  `;
  db.query(sql, [address, secret, username], (err, result) => {
    if (err) return res.status(500).json({ message: "DB error" });
    if (result.affectedRows === 0)
      return res.status(409).json({ message: "XRP wallet already exists for this account" });
    res.json({ ok: true, address });
  });
});

app.get("/wallet/xrp/secret", requireAuth, (req, res) => {
  const { username } = req.user;
  db.query("SELECT xrp_secret FROM users WHERE username = ? LIMIT 1", [username], (err, rows) => {
    if (err) return res.status(500).json({ message: "DB error" });
    if (!rows.length) return res.status(404).json({ message: "User not found" });
    res.json({ secret: rows[0].xrp_secret || null });
  });
});

app.post("/wallet/eth", requireAuth, (req, res) => {
  const { username } = req.user;
  const { address } = req.body || {};
  if (!address || typeof address !== "string" || !address.startsWith("0x"))
    return res.status(400).json({ message: "Invalid ETH address" });
  db.query(
    "UPDATE users SET eth_address = ? WHERE username = ?",
    [address, username],
    (err) => (err ? res.status(500).json({ message: "DB error" }) : res.json({ ok: true, address }))
  );
});

/* -------------------- Balances -------------------- */
app.get("/balance", requireAuth, (req, res) => {
  const { username } = req.user;
  db.query("SELECT sc_balance FROM users WHERE username = ? LIMIT 1", [username], (e, rows) => {
    if (e) return res.status(500).json({ message: "DB error" });
    if (!rows.length) return res.status(404).json({ message: "User not found" });
    res.json({ sc_balance: Number(rows[0].sc_balance) || 0 });
  });
});

app.post("/balance/xrp/sync", requireAuth, async (req, res) => {
  const { username } = req.user;
  db.query("SELECT xrp_address FROM users WHERE username = ? LIMIT 1", [username], async (err, rows) => {
    if (err) return res.status(500).json({ message: "DB error" });
    if (!rows.length) return res.status(404).json({ message: "User not found" });

    const addr = rows[0].xrp_address;
    if (!addr) return res.json({ xrp_balance: 0 });

    try {
      const bal = await xrplGetXrpBalance(addr);
      db.query(
        "UPDATE users SET xrp_balance = ? WHERE username = ? LIMIT 1",
        [bal, username],
        (uErr) => {
          if (uErr) return res.status(500).json({ message: "DB update error" });
          db.query(
            "SELECT xrp_balance FROM users WHERE username = ? LIMIT 1",
            [username],
            (bErr, bRows) => {
              if (bErr) return res.status(500).json({ message: "DB error" });
              const val = bRows.length ? Number(bRows[0].xrp_balance) || 0 : 0;
              res.json({ xrp_balance: val });
            }
          );
        }
      );
    } catch {
      db.query(
        "SELECT xrp_balance FROM users WHERE username = ? LIMIT 1",
        [username],
        (bErr, bRows) => {
          if (bErr) return res.status(500).json({ message: "DB error" });
          const val = bRows.length ? Number(bRows[0].xrp_balance) || 0 : 0;
          res.json({ xrp_balance: val, stale: true });
        }
      );
    }
  });
});

app.post("/balance/eth/sync", requireAuth, async (req, res) => {
  const { username } = req.user;
  db.query("SELECT eth_address FROM users WHERE username = ? LIMIT 1", [username], async (err, rows) => {
    if (err) return res.status(500).json({ message: "DB error" });
    if (!rows.length) return res.status(404).json({ message: "User not found" });

    const addr = rows[0].eth_address;
    if (!addr) return res.json({ eth_balance: 0 });
    try {
      const balWei = await ethProvider.getBalance(addr);
      const bal = Number(ethers.formatEther(balWei));
      db.query(
        "UPDATE users SET eth_balance = ? WHERE username = ? LIMIT 1",
        [bal, username],
        (uErr) => {
          if (uErr) return res.status(500).json({ message: "DB update error" });
          db.query(
            "SELECT eth_balance FROM users WHERE username = ? LIMIT 1",
            [username],
            (bErr, bRows) => {
              if (bErr) return res.status(500).json({ message: "DB error" });
              const val = bRows.length ? Number(bRows[0].eth_balance) || 0 : 0;
              res.json({ eth_balance: val });
            }
          );
        }
      );
    } catch {
      db.query(
        "SELECT eth_balance FROM users WHERE username = ? LIMIT 1",
        [username],
        (bErr, bRows) => {
          if (bErr) return res.status(500).json({ message: "DB error" });
          const val = bRows.length ? Number(bRows[0].eth_balance) || 0 : 0;
          res.json({ eth_balance: val, stale: true });
        }
      );
    }
  });
});

app.post("/balance/xlm/sync", requireAuth, async (req, res) => {
  const { username } = req.user;
  db.query(
    "SELECT public_key FROM users WHERE username = ? LIMIT 1",
    [username],
    async (err, rows) => {
      if (err) return res.status(500).json({ message: "DB error" });
      if (!rows.length) return res.status(404).json({ message: "User not found" });
      const pub = rows[0].public_key;
      if (!pub) return res.json({ xlm_balance: 0 });

      try {
        const acct = await horizonAccount(pub);
        const bal = nativeBal(acct);
        db.query(
          "UPDATE users SET xlm_balance = ? WHERE username = ? LIMIT 1",
          [bal, username],
          (uErr) => (uErr ? res.status(500).json({ message: "DB update error" }) : res.json({ xlm_balance: bal }))
        );
      } catch {
        db.query(
          "SELECT xlm_balance FROM users WHERE username = ? LIMIT 1",
          [username],
          (bErr, bRows) => {
            if (bErr) return res.status(500).json({ message: "DB error" });
            const val = bRows.length ? Number(bRows[0].xlm_balance) || 0 : 0;
            res.json({ xlm_balance: val, stale: true });
          }
        );
      }
    }
  );
});

/* -------------------- Faucets -------------------- */
app.post("/fund/xlm", requireAuth, async (req, res) => {
  const { username } = req.user;
  db.query("SELECT public_key FROM users WHERE username = ? LIMIT 1", [username], async (err, rows) => {
    if (err) return res.status(500).json({ message: "DB error" });
    if (!rows.length) return res.status(404).json({ message: "User not found" });
    const pub = rows[0].public_key;
    if (!pub) return res.status(400).json({ message: "No XLM address on file" });

    try {
      const r = await fetch(`${FRIENDBOT}/?addr=${encodeURIComponent(pub)}`);
      if (r.ok) return res.json({ ok: true, funded: true, status: r.status });
      if (r.status === 400) {
        try {
          const acct = await horizonAccount(pub);
          const bal = nativeBal(acct);
          return res.json({ ok: true, funded: true, status: 400, note: "Already funded", balance: bal });
        } catch {
          return res.status(500).json({ message: `Friendbot failed ${r.status} and account not found on Horizon` });
        }
      }
      const txt = await r.text().catch(() => "");
      return res.status(500).json({ message: `Friendbot failed ${r.status}: ${txt}` });
    } catch (e) {
      res.status(500).json({ message: String(e.message || e) });
    }
  });
});

app.post("/fund/xrp", requireAuth, async (req, res) => {
  const { username } = req.user;
  db.query("SELECT xrp_address FROM users WHERE username = ? LIMIT 1", [username], async (err, rows) => {
    if (err) return res.status(500).json({ message: "DB error" });
    if (!rows.length) return res.status(404).json({ message: "User not found" });
    const addr = rows[0].xrp_address;
    if (!addr) return res.status(400).json({ message: "No XRP address on file" });

    try {
      const r = await fetch(XRPL_FAUCET, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destination: addr }),
      });
      if (!r.ok) return res.status(500).json({ message: `XRPL faucet failed ${r.status}` });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ message: String(e.message || e) });
    }
  });
});

/* -------------------- Rates -------------------- */
let RATE_CACHE = { t: 0, data: { XLM: 0.12, XRP: 0.55, ETH: 3000 } };
async function fetchRatesUSD() {
  const now = Date.now();
  if (now - RATE_CACHE.t < 60_000 && RATE_CACHE.data) return RATE_CACHE.data;
  try {
    const r = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=stellar,ethereum,ripple&vs_currencies=usd"
    );
    const j = await r.json();
    const data = {
      XLM: Number(j?.stellar?.usd) || RATE_CACHE.data.XLM,
      XRP: Number(j?.ripple?.usd) || RATE_CACHE.data.XRP,
      ETH: Number(j?.ethereum?.usd) || RATE_CACHE.data.ETH,
    };
    RATE_CACHE = { t: now, data };
    return data;
  } catch {
    return RATE_CACHE.data;
  }
}
app.get("/rates", async (_req, res) => {
  const data = await fetchRatesUSD();
  res.json(data);
});

/* -------------------- SC Adjust -------------------- */
app.post("/sc/adjust", requireAuth, (req, res) => {
  const { username } = req.user;
  const { delta, memo } = req.body || {};
  const d = Number(delta);
  if (!Number.isFinite(d) || d === 0) return res.status(400).json({ message: "Bad delta" });

  db.query("SELECT sc_balance FROM users WHERE username = ? LIMIT 1", [username], (e, rows) => {
    if (e) return res.status(500).json({ message: "DB error" });
    if (!rows.length) return res.status(404).json({ message: "User not found" });
    const cur = Number(rows[0].sc_balance) || 0;
    if (d < 0 && cur + d < 0) return res.status(400).json({ message: "Insufficient SC" });
    const next = cur + d;
    db.query(
      "UPDATE users SET sc_balance = ? WHERE username = ? LIMIT 1",
      [next, username],
      (e2) =>
        e2
          ? res.status(500).json({ message: "DB update error" })
          : res.json({ ok: true, sc_balance: next, memo: memo || null })
    );
  });
});

/* -------------------- SC Jackpot -------------------- */
app.get("/jackpot/sc", requireAuth, (_req, res) => {
  db.query("SELECT pool_sc FROM jackpot_sc WHERE id = 1", (e, rows) => {
    if (e) return res.status(500).json({ message: "DB error" });
    const pool = rows.length ? Number(rows[0].pool_sc) || 0 : 0;
    res.json({ pool_sc: pool });
  });
});

app.post("/jackpot/sc/contribute", requireAuth, (req, res) => {
  const { username } = req.user;
  const { sc } = req.body || {};
  const amt = Number(sc);
  if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ message: "Bad amount" });

  db.query("SELECT sc_balance FROM users WHERE username = ? LIMIT 1", [username], (e, rows) => {
    if (e) return res.status(500).json({ message: "DB error" });
    if (!rows.length) return res.status(404).json({ message: "User not found" });
    const bal = Number(rows[0].sc_balance) || 0;
    if (bal < amt) return res.status(400).json({ message: "Insufficient SC" });

    db.query(
      "UPDATE users SET sc_balance = sc_balance - ? WHERE username = ? LIMIT 1",
      [amt, username],
      (e2) => {
        if (e2) return res.status(500).json({ message: "DB update error" });
        db.query("UPDATE jackpot_sc SET pool_sc = pool_sc + ? WHERE id = 1", [amt], (e3) => {
          if (e3) return res.status(500).json({ message: "Pool update error" });
          res.json({ ok: true });
        });
      }
    );
  });
});

app.post("/jackpot/sc/payout", requireAuth, (req, res) => {
  const { username } = req.user;
  db.query("SELECT pool_sc FROM jackpot_sc WHERE id = 1 FOR UPDATE", (e, rows) => {
    if (e) return res.status(500).json({ message: "DB error" });
    const pool = rows.length ? Number(rows[0].pool_sc) || 0 : 0;
    if (pool <= 0) return res.json({ ok: true, paid: 0 });

    db.query(
      "UPDATE users SET sc_balance = sc_balance + ? WHERE username = ? LIMIT 1",
      [pool, username],
      (e2) => {
        if (e2) return res.status(500).json({ message: "DB update error" });
        db.query("UPDATE jackpot_sc SET pool_sc = 0 WHERE id = 1", (e3) => {
          if (e3) return res.status(500).json({ message: "Pool reset error" });
          res.json({ ok: true, paid: pool });
        });
      }
    );
  });
});

/* -------------------- HOUSE STATUS -------------------- */
app.get("/house/status", async (_req, res) => {
  try {
    let xlm = { address: HOUSE_PUBLIC, balance: null };
    try {
      const r = await fetch(`https://horizon-testnet.stellar.org/accounts/${HOUSE_PUBLIC}`);
      const j = await r.json();
      const n = (j.balances || []).find((b) => b.asset_type === "native");
      xlm.balance = n ? parseFloat(n.balance) : 0;
    } catch {}

    let eth = { address: null, balance: null };
    try {
      eth.address = houseEthWallet ? await houseEthWallet.getAddress() : null;
      if (eth.address) {
        const b = await ethProvider.getBalance(eth.address);
        eth.balance = Number(ethers.formatEther(b));
      }
    } catch {}

    let xrp = { address: HOUSE_XRP_ADDRESS || null, balance: null };
    try {
      if (xrp.address) {
        const c = await getXrplClient();
        const info = await c
          .request({ command: "account_info", account: xrp.address, ledger_index: "validated" })
          .catch(() => null);
        const drops = info?.result?.account_data?.Balance || "0";
        xrp.balance = Number(drops) / 1_000_000;
      }
    } catch {}

    let scPool = 0;
    try {
      const [rows] = await db.promise().query("SELECT pool_sc FROM jackpot_sc WHERE id = 1");
      scPool = rows?.length ? Number(rows[0].pool_sc) || 0 : 0;
    } catch {}

    res.json({ xlm, eth, xrp, sc_jackpot: scPool });
  } catch (e) {
    res.status(500).json({ message: String(e.message || e) });
  }
});

/* -------------------- DEPOSIT: crypto -> SC -------------------- */
app.post("/sc/deposit/quote", requireAuth, async (req, res) => {
  const { username } = req.user;
  const { asset, amount } = req.body || {};
  const amt = Number(amount);
  if (!["XLM", "XRP", "ETH"].includes(asset)) return res.status(400).json({ message: "Unsupported asset" });
  if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ message: "Bad amount" });

  const balCol = asset === "ETH" ? "eth_balance" : asset === "XRP" ? "xrp_balance" : "xlm_balance";

  db.query(`SELECT ${balCol} AS bal FROM users WHERE username = ? LIMIT 1`, [username], async (e, rows) => {
    if (e) return res.status(500).json({ message: "DB error" });
    if (!rows.length) return res.status(404).json({ message: "User not found" });

    const curCrypto = Number(rows[0].bal) || 0;
    const dec = assetDecimals(asset);
    const spendable = maxSpendableRounded(asset, curCrypto);

    const rates = await fetchRatesUSD();
    const price = rates[asset] || 0;

    if (amt > spendable) {
      return res.status(400).json({
        message: `Underfunded after reserve/fees. Max spendable is ${spendable.toFixed(dec)} ${asset}`,
        max_spendable: Number(spendable.toFixed(dec)),
        usd_price: price,
        asset,
      });
    }

    const sc = amt * price;
    res.json({
      asset,
      amount: amt,
      usd_price: price,
      sc: Number(sc.toFixed(8)),
      max_spendable: Number(spendable.toFixed(dec)),
    });
  });
});

/**
 * POST /sc/deposit/credit
 * body:
 *  - asset: "XLM" | "XRP" | "ETH"
 *  - amount: number
 *  - tx_hash: (ETH only) user's tx hash to house
 *
 * For XLM/XRP: server submits on-chain transfer FROM user's wallet TO house, then credits SC.
 * For ETH: server verifies tx_hash on Sepolia, then credits SC.
 */
app.post("/sc/deposit/credit", requireAuth, async (req, res) => {
  const { username } = req.user;
  const { asset, amount, tx_hash } = req.body || {};
  const amt = Number(amount);
  if (!["XLM", "XRP", "ETH"].includes(asset)) return res.status(400).json({ message: "Unsupported asset" });
  if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ message: "Bad amount" });

  // Pull user wallets
  db.query(
    "SELECT public_key, secret_key, xrp_address, xrp_secret, eth_address, xlm_balance, xrp_balance, eth_balance FROM users WHERE username = ? LIMIT 1",
    [username],
    async (e, rows) => {
      if (e) return res.status(500).json({ message: "DB error" });
      if (!rows.length) return res.status(404).json({ message: "User not found" });
      const u = rows[0];

      // Price
      const rates = await fetchRatesUSD();
      const price = rates[asset];
      if (!price) return res.status(500).json({ message: "Price unavailable" });
      const scCredit = Number((amt * price).toFixed(8));

      try {
        if (asset === "XLM") {
          if (!u.public_key || !u.secret_key) return res.status(400).json({ message: "No XLM wallet on file" });

          const acctJson = await horizonAccount(u.public_key);
          const source = new Account(u.public_key, acctJson.sequence);
          const tx = new TransactionBuilder(source, {
            fee: BASE_FEE,
            networkPassphrase: NETWORK_PASSPHRASE,
          })
            .addOperation(
              Operation.payment({
                destination: HOUSE_PUBLIC,
                asset: Asset.native(),
                amount: amt.toFixed(7),
              })
            )
            .setTimeout(30)
            .build();
          tx.sign(Keypair.fromSecret(u.secret_key));
          const body = await submitTx(tx);

          db.query(
            "UPDATE users SET xlm_balance = xlm_balance - ?, sc_balance = sc_balance + ? WHERE username = ? LIMIT 1",
            [amt, scCredit, username],
            (e2) =>
              e2
                ? res.status(500).json({ message: "DB update error" })
                : res.json({ ok: true, credited_sc: scCredit, tx_hash: body.hash })
          );
          return;
        }

        if (asset === "XRP") {
          if (!u.xrp_address || !u.xrp_secret) return res.status(400).json({ message: "No XRP wallet on file" });
          const c = await getXrplClient();
          const wallet = xrpl.Wallet.fromSeed(u.xrp_secret);
          const prepared = await c.autofill({
            TransactionType: "Payment",
            Account: wallet.address,
            Destination: HOUSE_XRP_ADDRESS,
            Amount: xrpl.xrpToDrops(amt.toFixed(6)),
          });
          const signed = wallet.sign(prepared);
          const resv = await c.submitAndWait(signed.tx_blob);
          const ok = resv?.result?.meta?.TransactionResult === "tesSUCCESS";
          if (!ok) throw new Error("XRPL deposit submit failed");

          db.query(
            "UPDATE users SET xrp_balance = xrp_balance - ?, sc_balance = sc_balance + ? WHERE username = ? LIMIT 1",
            [amt, scCredit, username],
            (e2) =>
              e2
                ? res.status(500).json({ message: "DB update error" })
                : res.json({ ok: true, credited_sc: scCredit, tx_hash: resv?.result?.tx_json?.hash || "" })
          );
          return;
        }

        if (asset === "ETH") {
          if (!u.eth_address) return res.status(400).json({ message: "No ETH address on file" });
          if (!tx_hash || typeof tx_hash !== "string") {
            return res.status(400).json({ message: "tx_hash required for ETH deposits" });
          }
          if (!houseEthWallet) return res.status(500).json({ message: "House ETH wallet not configured" });

          const tx = await ethProvider.getTransaction(tx_hash);
          if (!tx) return res.status(400).json({ message: "Transaction not found" });

          const houseAddr = (await houseEthWallet.getAddress()).toLowerCase();
          const fromAddr = (u.eth_address || "").toLowerCase();
          const toAddr = (tx.to || "").toLowerCase();

          if (toAddr !== houseAddr) return res.status(400).json({ message: "TX not sent to house address" });
          if ((tx.from || "").toLowerCase() !== fromAddr) return res.status(400).json({ message: "TX not from your saved ETH address" });

          const needWei = ethers.parseEther(amt.toFixed(8));
          if (tx.value < needWei) return res.status(400).json({ message: "TX value less than requested amount" });

          await tx.wait?.(1).catch(() => {});
          db.query(
            "UPDATE users SET eth_balance = eth_balance - ?, sc_balance = sc_balance + ? WHERE username = ? LIMIT 1",
            [amt, scCredit, username],
            (e2) =>
              e2
                ? res.status(500).json({ message: "DB update error" })
                : res.json({ ok: true, credited_sc: scCredit, tx_hash })
          );
          return;
        }

        return res.status(400).json({ message: "Unsupported asset" });
      } catch (chainErr) {
        return res.status(500).json({ message: String(chainErr.message || chainErr) });
      }
    }
  );
});

/* -------------------- WITHDRAW: SC -> crypto -------------------- */
app.post("/sc/withdraw/quote", requireAuth, async (req, res) => {
  const { asset, sc } = req.body || {};
  const scAmt = Number(sc);
  if (!["XLM", "XRP", "ETH"].includes(asset)) return res.status(400).json({ message: "Unsupported asset" });
  if (!Number.isFinite(scAmt) || scAmt <= 0) return res.status(400).json({ message: "Bad amount" });
  const rates = await fetchRatesUSD();
  const price = rates[asset] || 0;
  if (price <= 0) return res.status(500).json({ message: "Bad price" });
  const assetAmt = scAmt / price;
  res.json({ asset, sc: scAmt, usd_price: price, asset_amount: Number(assetAmt.toFixed(8)) });
});

app.post("/sc/withdraw/redeem", requireAuth, async (req, res) => {
  const { username } = req.user;
  const { asset, sc, to } = req.body || {};
  const scAmt = Number(sc);
  if (!["XLM", "XRP", "ETH"].includes(asset)) return res.status(400).json({ message: "Unsupported asset" });
  if (!Number.isFinite(scAmt) || scAmt <= 0) return res.status(400).json({ message: "Bad SC amount" });

  const rates = await fetchRatesUSD();
  const price = rates[asset] || 0;
  if (price <= 0) return res.status(500).json({ message: "Price unavailable" });
  const assetAmt = Number((scAmt / price).toFixed(8));

  db.query(
    "SELECT sc_balance, public_key, xrp_address, eth_address FROM users WHERE username = ? LIMIT 1",
    [username],
    async (e, rows) => {
      if (e) return res.status(500).json({ message: "DB error" });
      if (!rows.length) return res.status(404).json({ message: "User not found" });
      const u = rows[0];
      const bal = Number(u.sc_balance) || 0;
      if (bal < scAmt) return res.status(400).json({ message: "Insufficient SC" });

      let dest =
        (to && String(to)) ||
        (asset === "XLM" ? u.public_key : asset === "XRP" ? u.xrp_address : u.eth_address);
      if (!dest) return res.status(400).json({ message: `No ${asset} address on file` });

      db.query(
        "UPDATE users SET sc_balance = sc_balance - ? WHERE username = ? AND sc_balance >= ? LIMIT 1",
        [scAmt, username, scAmt],
        async (e2, r2) => {
          if (e2) return res.status(500).json({ message: "DB update error" });
          if (!r2.affectedRows) return res.status(400).json({ message: "Insufficient SC" });

          try {
            if (asset === "XLM") {
              const acctJson = await horizonAccount(HOUSE_PUBLIC);
              const source = new Account(HOUSE_PUBLIC, acctJson.sequence);
              const tx = new TransactionBuilder(source, {
                fee: BASE_FEE,
                networkPassphrase: NETWORK_PASSPHRASE,
              })
                .addOperation(
                  Operation.payment({
                    destination: dest,
                    asset: Asset.native(),
                    amount: assetAmt.toFixed(7),
                  })
                )
                .setTimeout(30)
                .build();
              tx.sign(Keypair.fromSecret(HOUSE_SECRET));
              const body = await submitTx(tx);
              return res.json({ ok: true, asset, amount: assetAmt, tx_hash: body.hash });
            }

            if (asset === "XRP") {
              const c = await getXrplClient();
              const wallet = xrpl.Wallet.fromSeed(HOUSE_XRP_SECRET);
              const prepared = await c.autofill({
                TransactionType: "Payment",
                Account: wallet.address,
                Destination: dest,
                Amount: xrpl.xrpToDrops(assetAmt.toFixed(6)),
              });
              const signed = wallet.sign(prepared);
              const resv = await c.submitAndWait(signed.tx_blob);
              const ok = resv?.result?.meta?.TransactionResult === "tesSUCCESS";
              if (!ok) throw new Error("XRPL payout failed");
              return res.json({ ok: true, asset, amount: assetAmt, tx_hash: resv?.result?.tx_json?.hash || "" });
            }

            if (asset === "ETH") {
              if (!houseEthWallet) return res.status(500).json({ message: "House ETH wallet not configured" });
              const tx = await houseEthWallet.sendTransaction({
                to: dest,
                value: ethers.parseEther(assetAmt.toFixed(8)),
              });
              await tx.wait();
              return res.json({ ok: true, asset, amount: assetAmt, tx_hash: tx.hash });
            }

            return res.status(400).json({ message: "Unsupported asset" });
          } catch (payoutErr) {
            db.query(
              "UPDATE users SET sc_balance = sc_balance + ? WHERE username = ? LIMIT 1",
              [scAmt, username],
              () => {}
            );
            return res.status(500).json({ message: String(payoutErr.message || payoutErr) });
          }
        }
      );
    }
  );
});

/* -------------------- Unified WS mounting (Render single service) -------------------- */
try {
  // Always run unified on Render bundle
    const http = require('http');
    const server = http.createServer(app);
    // Attach per-game WS servers to paths (adjusted to local render-backend games)
    try { require('../games/ConnectFour/server.js').attachUnified(server, '/ws/c4'); console.log('[unified] mounted /ws/c4'); } catch (e) { console.warn('C4 attach failed:', e?.message||e); }
    try { require('../games/Checkers/server.js').attachUnified(server, '/ws/checkers'); console.log('[unified] mounted /ws/checkers'); } catch (e) { console.warn('Checkers attach failed:', e?.message||e); }
    try { require('../games/Chess/server.js').attachUnified(server, '/ws/chess'); console.log('[unified] mounted /ws/chess'); } catch (e) { console.warn('Chess attach failed:', e?.message||e); }
    try { require('../games/Chess3D/server.js').attachUnified(server, '/ws/raum'); console.log('[unified] mounted /ws/raum'); } catch (e) { console.warn('Raumschach attach failed:', e?.message||e); }
    try { server.on('upgrade', (req)=>{ try{ console.log('[unified] upgrade', req.url); }catch{} }); } catch {}
  const port = Number(process.env.PORT) || Number(process.env.API_PORT) || 3002;
    server.listen(port, '0.0.0.0', () => console.log(`Unified API+WS on http://0.0.0.0:${port}`));
} catch {
  const port = Number(process.env.PORT) || Number(process.env.API_PORT) || 3002;
  app.listen(port, '0.0.0.0', () => console.log(`Server running on http://0.0.0.0:${port}`));
}
