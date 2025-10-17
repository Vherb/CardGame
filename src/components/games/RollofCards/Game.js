// Game.js
import React, { useState, useEffect, useRef, useMemo } from "react";
import NavBar from "./../../NavBar";
import ThreeDiceCanvas from "./ThreeDiceCanvas";
import "./../../App.css";
import "./Game.css";
import "bootstrap/dist/css/bootstrap.min.css";
import CardDealTwoMeuk from "./CardDealTwo_Meuk";

import {
  Container,
  Row,
  Col,
  Button as BsButton,
  Modal,
  OverlayTrigger,
  Tooltip as BsTooltip,
  Tabs,
  Tab
} from "react-bootstrap";

import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import CancelRoundedIcon from "@mui/icons-material/CancelRounded";
import EmojiEventsRoundedIcon from "@mui/icons-material/EmojiEventsRounded";
import InfoRoundedIcon from "@mui/icons-material/InfoRounded";

import { Keypair } from "@stellar/stellar-base";
import { ethers } from "ethers";
import * as xrpl from "xrpl";

import chip1 from "./chips/1.png";
import chip5 from "./chips/5.png";
import chip10 from "./chips/10.png";
import chip25 from "./chips/25.png";
import chip50 from "./chips/50.png";
import chip100 from "./chips/100.png";
import chip250 from "./chips/250.png";
import chip500 from "./chips/500.png";
import chip1000 from "./chips/1000.png";

// ---------- Config ----------
const CHIP_SRC = { 1: chip1, 5: chip5, 10: chip10, 25: chip25, 50: chip50, 100: chip100, 250: chip250, 500: chip500, 1000: chip1000 };
const API =
  process.env.REACT_APP_API_BASE ||
  `http://${window.location.hostname}:3002`;

const isPhone = window.matchMedia("(max-width: 575.98px)").matches;

// UI timings
const CARD_FIRST_DELAY_MS = 250;
const CARD_STAGGER_MS = 900;
const CARD_TOTAL_MS = 1000;
const AUTO_ROLL_DELAY_MS = CARD_FIRST_DELAY_MS + CARD_STAGGER_MS + CARD_TOTAL_MS + 150;

// ====== HOUSE-FAVOR NUMBERS ======
// Main bet jackpots (profit multipliers) — apply to SC winnings (reduced)
const JACKPOT_EXACT_PROFIT = 2.0;             // was 5.0
const JACKPOT_ACE_SNAKE_PROFIT = 5.0;         // was 3.0
const JACKPOT_DOUBLE_ACE_SNAKE_PROFIT = 10.0; // was 25.0

// Side bet config — SC jackpot tickets only
const SIDE_STAKE_SC = 1.0;

// House edge on profits (applied to PROFIT only, never to stake returns)
const HOUSE_EDGE = 0.99; // ~1% rake on profit only (tuned ~8% edge)

// Base component added to (streak - 1) for BETWEEN wins (tuned ~8% edge)
const BETWEEN_BASE = 0.16;

// Helpers
function authFetch(path, options = {}) {
  const token = localStorage.getItem("token") || "";
  return fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}
const isAuthed = () =>
  !!localStorage.getItem("token") && !!localStorage.getItem("username");

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Spread bonus: rewards tighter spreads on BETWEEN wins — softened
function spreadBonus(lo, hi) {
  const w = Math.max(0, hi - lo - 1);     // numbers strictly between
  const tight = 1 - (w / 9);               // 0..1
  return clamp(1 + 0.30 * tight, 1, 1.45); // cap at 1.45
}

/* Removed unused LedBar/LedFrame helpers */

// =====================================================
export default function Game() {
  // When on phone, disable global bottom padding so content can be flush with bottom nav/footer
  useEffect(() => {
    if (!isPhone) return;
    try {
      document.documentElement.classList.add('no-bottom-pad');
      document.body.classList.add('no-bottom-pad');
      const root = document.getElementById('root');
      if (root) root.classList.add('no-bottom-pad');
    } catch {}
    return () => {
      try {
        document.documentElement.classList.remove('no-bottom-pad');
        document.body.classList.remove('no-bottom-pad');
        const root = document.getElementById('root');
        if (root) root.classList.remove('no-bottom-pad');
      } catch {}
    };
  }, []);
  // ----- Cards -----
  const cardValues = useMemo(() => ([
    { label: "Ace", suit: "Spades", unicode: "🂡", color: "black" },
    { label: "2", suit: "Spades", unicode: "🂢", color: "black" },
    { label: "3", suit: "Spades", unicode: "🂣", color: "black" },
    { label: "4", suit: "Spades", unicode: "🂤", color: "black" },
    { label: "5", suit: "Spades", unicode: "🂥", color: "black" },
    { label: "6", suit: "Spades", unicode: "🂦", color: "black" },
    { label: "7", suit: "Spades", unicode: "🂧", color: "black" },
    { label: "8", suit: "Spades", unicode: "🂨", color: "black" },
    { label: "9", suit: "Spades", unicode: "🂩", color: "black" },
    { label: "10", suit: "Spades", unicode: "🂪", color: "black" },
    { label: "Jack", suit: "Spades", unicode: "🂫", color: "black" },
    { label: "Queen", suit: "Spades", unicode: "🂭", color: "black" },
    { label: "King", suit: "Spades", unicode: "🂮", color: "black" },

    { label: "Ace", suit: "Clubs", unicode: "🃑", color: "black" },
    { label: "2", suit: "Clubs", unicode: "🃒", color: "black" },
    { label: "3", suit: "Clubs", unicode: "🃓", color: "black" },
    { label: "4", suit: "Clubs", unicode: "🃔", color: "black" },
    { label: "5", suit: "Clubs", unicode: "🃕", color: "black" },
    { label: "6", suit: "Clubs", unicode: "🃖", color: "black" },
    { label: "7", suit: "Clubs", unicode: "🃗", color: "black" },
    { label: "8", suit: "Clubs", unicode: "🃘", color: "black" },
    { label: "9", suit: "Clubs", unicode: "🃙", color: "black" },
    { label: "10", suit: "Clubs", unicode: "🃚", color: "black" },
    { label: "Jack", suit: "Clubs", unicode: "🃛", color: "black" },
    { label: "Queen", suit: "Clubs", unicode: "🃝", color: "black" },
    { label: "King", suit: "Clubs", unicode: "🃞", color: "black" },

    { label: "Ace", suit: "Hearts", unicode: "🂱", color: "red" },
    { label: "2", suit: "Hearts", unicode: "🂲", color: "red" },
    { label: "3", suit: "Hearts", unicode: "🂳", color: "red" },
    { label: "4", suit: "Hearts", unicode: "🂴", color: "red" },
    { label: "5", suit: "Hearts", unicode: "🂵", color: "red" },
    { label: "6", suit: "Hearts", unicode: "🂶", color: "red" },
    { label: "7", suit: "Hearts", unicode: "🂷", color: "red" },
    { label: "8", suit: "Hearts", unicode: "🂸", color: "red" },
    { label: "9", suit: "Hearts", unicode: "🂹", color: "red" },
    { label: "10", suit: "Hearts", unicode: "🂺", color: "red" },
    { label: "Jack", suit: "Hearts", unicode: "🂻", color: "red" },
    { label: "Queen", suit: "Hearts", unicode: "🂽", color: "red" },
    { label: "King", suit: "Hearts", unicode: "🂾", color: "red" },

    { label: "Ace", suit: "Diamonds", unicode: "🃁", color: "red" },
    { label: "2", suit: "Diamonds", unicode: "🃂", color: "red" },
    { label: "3", suit: "Diamonds", unicode: "🃃", color: "red" },
    { label: "4", suit: "Diamonds", unicode: "🃄", color: "red" },
    { label: "5", suit: "Diamonds", unicode: "🃅", color: "red" },
    { label: "6", suit: "Diamonds", unicode: "🃆", color: "red" },
    { label: "7", suit: "Diamonds", unicode: "🃇", color: "red" },
    { label: "8", suit: "Diamonds", unicode: "🃈", color: "red" },
    { label: "9", suit: "Diamonds", unicode: "🃉", color: "red" },
    { label: "10", suit: "Diamonds", unicode: "🃊", color: "red" },
    { label: "Jack", suit: "Diamonds", unicode: "🃋", color: "red" },
    { label: "Queen", suit: "Diamonds", unicode: "🃍", color: "red" },
    { label: "King", suit: "Diamonds", unicode: "🃎", color: "red" },
  ]), []);

  // ---------- AUTH ----------
  const [authed, setAuthed] = useState(isAuthed());
  const [profile, setProfile] = useState(null);

  // ---------- Game state ----------
  const [currentRoundId, setCurrentRoundId] = useState(0);
  const settledRoundRef = useRef(-1);
  const hasRolledRef = useRef(false);
  const [isRolling, setIsRolling] = useState(false);

  const [placedChips, setPlacedChips] = useState([]);
  const nextChipId = useRef(1);

  // --- track last bet/stack for "Rebet"
  const lastBetRef = useRef(0);
  const [lastBetAmt, setLastBetAmt] = useState(0);
  const lastPlacedChipsRef = useRef([]);
  // persist side-bet choices too so Rebet restores them
  const lastSideColorRef = useRef(false);
  const lastSideDiceRef = useRef(false);

  const [cardValue1, setCardValue1] = useState("");
  const [cardValue2, setCardValue2] = useState("");

  const frozenARef = useRef(null);
  const frozenBRef = useRef(null);
  const betAtDealRef = useRef(0);

  const [roundOver, setRoundOver] = useState(true);

  // ===== SC + mirrors =====
  const [scBalance, setScBalance] = useState(0);

  const [xlmBalance, setXlmBalance] = useState(0);
  const [ethAddress, setEthAddress] = useState("");
  const [ethBalance, setEthBalance] = useState(0);
  const [xrpAddress, setXrpAddress] = useState("");
  const [xrpSecret, setXrpSecret] = useState("");
  const [xrpBalance, setXrpBalance] = useState(0);

  const [publicKey, setPublicKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const secretKeyRef = useRef(secretKey);
  const publicKeyRef = useRef(publicKey);
  useEffect(() => { secretKeyRef.current = secretKey; }, [secretKey]);
  useEffect(() => { publicKeyRef.current = publicKey; }, [publicKey]);

  const [bet, setBet] = useState(0);
  const [roundResult, setRoundResult] = useState("");
  // Rebet animation state
  const [isRebetting, setIsRebetting] = useState(false);
  const rebetTimersRef = useRef([]);

  // ====== STREAK (house-favor) ======
  const [payoutMultiplier, setPayoutMultiplier] = useState(1.16);
  const payoutMultiplierRef = useRef(1.16);
  useEffect(() => { payoutMultiplierRef.current = payoutMultiplier; }, [payoutMultiplier]);

  const MULTIPLIER_MIN = 1.16; // tuned floor
  const MULTIPLIER_MAX = 100.0;
  const clamp1 = (n) => clamp(Number(n.toFixed(2)), MULTIPLIER_MIN, MULTIPLIER_MAX);
  const bumpOnNormalWin = () => setPayoutMultiplier((m) => clamp1(m + 0.12));
  const bumpOnJackpotWin = () => setPayoutMultiplier((m) => clamp1(m + 0.50));
  const resetOnLoss      = () => setPayoutMultiplier((m) => clamp1(m - 0.148)); // tuned soft decay
  const bumpOnTie        = () => setPayoutMultiplier((m) => clamp1(m + 0.045)); // tuned tie bump

  // removed unused cardsDrawn flag
  const [cardsSettled, setCardsSettled] = useState(false);
  const autoRollRef = useRef(false);

  // HUD popups
  const [lowFundsOpen, setLowFundsOpen] = useState(false);
  const openLowFunds = () => setLowFundsOpen(true);
  const closeLowFunds = () => setLowFundsOpen(false);

  const [flyDelta, setFlyDelta] = useState(null);
  const flyTimerRef = useRef(null);
  const triggerFly = (type, dir, jsx) => {
    if (flyTimerRef.current) clearTimeout(flyTimerRef.current);
    setFlyDelta({ id: Date.now(), type, dir, jsx });
    flyTimerRef.current = setTimeout(() => setFlyDelta(null), 1700);
  };
  useEffect(() => () => { if (flyTimerRef.current) clearTimeout(flyTimerRef.current); }, []);

  const [resultToast, setResultToast] = useState(null);
  const toastTimerRef = useRef(null);
  const showToast = (type, amount, title) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setResultToast({ type, amount: Number(amount) || 0, title });
    toastTimerRef.current = setTimeout(() => setResultToast(null), 5000);
  };
  useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); }, []);

  // BIG WIN overlay
  const [bigWin, setBigWin] = useState(null);
  const bigWinTimerRef = useRef(null);
  const triggerBigWin = ({ badge, title = "BIG WIN!", note = null, ttl = 3200 }) => {
    setBigWin({ id: Date.now(), badge, title, note });
    if (bigWinTimerRef.current) window.clearTimeout(bigWinTimerRef.current);
    bigWinTimerRef.current = window.setTimeout(() => setBigWin(null), ttl);
  };
  useEffect(() => () => { if (bigWinTimerRef.current) window.clearTimeout(bigWinTimerRef.current); }, []);

  // Modals
  const [walletOpen, setWalletOpen] = useState(false);
  const openWallet = () => setWalletOpen(true);
  const closeWallet = () => setWalletOpen(false);

  const [rulesOpen, setRulesOpen] = useState(false);
  const openRules = () => setRulesOpen(true);
  const closeRules = () => setRulesOpen(false);

  // Close Rules overlay on ESC
  useEffect(() => {
    if (!rulesOpen) return;
    const onKey = (e) => { if (e.key === "Escape") closeRules(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rulesOpen]);

  // Side bets (SC only)
  const [sideColorOn, setSideColorOn] = useState(false);
  const [sideDiceOn, setSideDiceOn] = useState(false);
  const sideActiveRef = useRef({ color: false, dice: false });
  const waitingSideTxRef = useRef(false);

  // SC Jackpot pool HUD
  const [poolSC, setPoolSC] = useState(0);

  // --- DB helpers ---
  const loadScBalance = async () => {
    const r = await authFetch("/balance");
    if (!r.ok) throw new Error("Fetch SC balance failed");
    const { sc_balance } = await r.json();
    setScBalance(Number(sc_balance) || 0);
  };

  const fetchScPool = async () => {
    try {
      const r = await authFetch("/jackpot/sc");
      if (!r.ok) return;
      const j = await r.json();
      setPoolSC(Number(j.pool_sc) || 0);
    } catch {}
  };

  const refreshXlmBalance = async () => {
    try {
      await authFetch("/balance/xlm/sync", { method: "POST" });
    } catch {}
    try {
      const me2 = await authFetch("/me");
      if (me2.ok) {
        const d = await me2.json();
        const xlm = ("xlm_balance" in d) ? d.xlm_balance : d.sc_balance;
        setXlmBalance(Number(xlm) || 0);
      }
    } catch {}
  };

  // ---------- login/logout sync ----------
  useEffect(() => {
    const update = () => setAuthed(isAuthed());
    update();
    window.addEventListener("storage", update);
    window.addEventListener("authchange", update);
    return () => {
      window.removeEventListener("storage", update);
      window.removeEventListener("authchange", update);
    };
  }, []);

  // Boot / profile load
  useEffect(() => {
    const resetBoard = () => {
      setBet(0);
      setPlacedChips([]);
  setRoundResult("");
      setRoundOver(true);
      setIsRolling(false);
      setCardValue1("");
      setCardValue2("");
  // reset streak to floor
  setPayoutMultiplier(MULTIPLIER_MIN);
      settledRoundRef.current = -1;
      hasRolledRef.current = false;
      setCardsSettled(false);
      setSideColorOn(false);
      setSideDiceOn(false);
      sideActiveRef.current = { color: false, dice: false };
      waitingSideTxRef.current = false;
    };

    const boot = async () => {
      if (!isAuthed()) {
        setProfile(null);
        setPublicKey("");
        setSecretKey("");
        setScBalance(0);
        setXlmBalance(0);
        setEthAddress("");
        setEthBalance(0);
        setXrpAddress("");
        setXrpSecret("");
        setXrpBalance(0);
        resetBoard();
        return;
      }
      try {
        const me = await authFetch("/me");
        if (me.ok) {
          const data = await me.json();
          setProfile(data);
          if (data.public_key) setPublicKey(data.public_key);
          if (data.xrp_address) setXrpAddress(data.xrp_address);
          if (data.eth_address) setEthAddress(data.eth_address);
          if (Number.isFinite(data.xrp_balance)) setXrpBalance(Number(data.xrp_balance));
          if (Number.isFinite(data.eth_balance)) setEthBalance(Number(data.eth_balance));
          if (Number.isFinite(data.sc_balance)) setScBalance(Number(data.sc_balance));
          const xlm = ("xlm_balance" in data) ? data.xlm_balance : data.sc_balance;
          if (Number.isFinite(xlm)) setXlmBalance(Number(xlm));
        }

        if (!secretKeyRef.current) {
          try {
            const secRes = await authFetch("/wallet/secret");
            if (secRes.ok) {
              const { secret_key } = await secRes.json();
              if (secret_key) setSecretKey(secret_key);
            }
          } catch {}
        }

        if (!xrpSecret) {
          try {
            const xr = await authFetch("/wallet/xrp/secret");
            if (xr.ok) {
              const { secret } = await xr.json();
              if (secret) {
                setXrpSecret(secret);
                localStorage.setItem("xrpSecret", secret);
              }
            }
          } catch {}
        }

        await loadScBalance();
        fetchScPool();

        if (publicKey || (profile && profile.public_key)) refreshXlmBalance();
        if (ethAddress) {
          await authFetch("/balance/eth/sync", { method: "POST" }).catch(()=>{});
          const me2 = await authFetch("/me"); if (me2.ok) { const d = await me2.json(); setEthBalance(Number(d.eth_balance)||0); }
        }
        if (xrpAddress) {
          await authFetch("/balance/xrp/sync", { method: "POST" }).catch(()=>{});
          const me3 = await authFetch("/me"); if (me3.ok) { const d = await me3.json(); setXrpBalance(Number(d.xrp_balance)||0); }
        }
      } catch {
        setAuthed(false);
        setProfile(null);
        setPublicKey("");
        setSecretKey("");
        setScBalance(0);
        setXlmBalance(0);
        setEthAddress("");
        setEthBalance(0);
        setXrpAddress("");
        setXrpSecret("");
        setXrpBalance(0);
        resetBoard();
      }
    };
    boot();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  useEffect(() => {
    if (!authed) { setPoolSC(0); return; }
    fetchScPool();
    const t = setInterval(fetchScPool, 5000);
    return () => clearInterval(t);
  }, [authed]);

  // ---------- ETH helpers ----------
  const ETH_CHAIN_ID = 11155111;
  const ensureEth = async () => {
    if (!window.ethereum) throw new Error("MetaMask not found. Please install MetaMask.");
    const provider = new ethers.BrowserProvider(window.ethereum);
    const net = await provider.getNetwork();
    if (Number(net?.chainId) !== ETH_CHAIN_ID) {
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0xaa36a7" }],
        });
      } catch {
        throw new Error("Please switch MetaMask to Sepolia.");
      }
    }
    return provider;
  };

  const connectEth = async () => {
    try {
      const provider = await ensureEth();
      const accs = await provider.send("eth_requestAccounts", []);
      const addr = ethers.getAddress(accs[0]);
      setEthAddress(addr);
      await authFetch("/wallet/eth", { method: "POST", body: JSON.stringify({ address: addr }) });
      const bal = await provider.getBalance(addr);
      setEthBalance(Number(ethers.formatEther(bal)));
      await authFetch("/balance/eth/sync", { method: "POST" });
      const me2 = await authFetch("/me"); if (me2.ok) { const d = await me2.json(); setEthBalance(Number(d.eth_balance)||0); }
    } catch (e) {
      alert(e.message || String(e));
    }
  };

  const refreshEthBalance = async () => {
    if (!ethAddress) return;
    try {
      const provider = await ensureEth();
      const bal = await provider.getBalance(ethAddress);
      setEthBalance(Number(ethers.formatEther(bal)));
      await authFetch("/balance/eth/sync", { method: "POST" });
      const me2 = await authFetch("/me"); if (me2.ok) { const d = await me2.json(); setEthBalance(Number(d.eth_balance)||0); }
    } catch {}
  };

  // ---------- XRPL helpers ----------
  const xrplClientRef = useRef(null);
  const ensureXrpl = async () => {
    if (xrplClientRef.current && xrplClientRef.current.isConnected()) return xrplClientRef.current;
    const c = new xrpl.Client("wss://s.altnet.rippletest.net:51233");
    await c.connect();
    xrplClientRef.current = c;
    return c;
  };

  const fundXrpFromFaucet = async () => {
    const addr = xrpAddress;
    if (!addr) { alert("No XRP address yet. Create one first."); return; }
    const r = await authFetch("/fund/xrp", { method: "POST" });
    const j = await r.json().catch(()=>({}));
    if (!r.ok) {
      alert(j?.message || "XRPL faucet failed");
    } else {
      alert("XRPL faucet sent test funds.");
    }
    await authFetch("/balance/xrp/sync", { method: "POST" });
    const me2 = await authFetch("/me"); if (me2.ok) { const d = await me2.json(); setXrpBalance(Number(d.xrp_balance)||0); }
  };

  const createAndAttachXrpWallet = async () => {
    try {
      const c = await ensureXrpl();
      void c;
      const w = xrpl.Wallet.generate();
      const address = w.address;
      const secret = w.seed;

      const res = await authFetch("/wallet/xrp", {
        method: "POST",
        body: JSON.stringify({ address, secret })
      });
      const j = await res.json().catch(()=>({}));
      if (!res.ok) throw new Error(j?.message || "Attach failed");

      setXrpAddress(address);
      setXrpSecret(secret);
      localStorage.setItem("xrpSecret", secret);

      alert("XRPL wallet created & attached.");
    } catch (e) {
      alert(e.message || String(e));
    }
  };

  // ---------- XLM Friendbot ----------
  const [walletMsg, setWalletMsg] = useState("");
  const friendbotFund = async () => {
    const pub = publicKeyRef.current || profile?.public_key;
    if (!pub) { alert("No XLM address yet. Create your Stellar deposit address first."); return; }
    const res = await authFetch("/fund/xlm", { method: "POST" });
    const j = await res.json().catch(()=>({}));
    if (!res.ok) {
      alert(j?.detail || j?.message || "Friendbot failed");
    } else {
      alert(j?.alreadyFunded ? "Account is already funded on testnet." : "Funded (testnet).");
    }
    await refreshXlmBalance();
  };

  // ---------- XLM address attach ----------
  const createAndAttachXlmAddress = async () => {
    if (profile?.public_key) {
      setWalletMsg("Wallet is already attached to your account.");
      return;
    }
    try {
      const kp = Keypair.random();
      const pub = kp.publicKey();
      const sec = kp.secret();

      const r = await authFetch("/wallet", {
        method: "POST",
        body: JSON.stringify({ public_key: pub, secret_key: sec }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.message || "Attach failed");

      setPublicKey(pub);
      setSecretKey(sec);
      setProfile((p) => ({ ...(p || {}), public_key: pub }));
      setWalletMsg("Deposit address created and attached to your account.");
    } catch (e) {
      setWalletMsg(`Failed to create address: ${e.message}`);
    }
  };

  // ---------- SC game settlement ----------
  const scAdjust = async (delta, memo) => {
    const r = await authFetch("/sc/adjust", {
      method: "POST",
      body: JSON.stringify({ delta: Number(delta), memo }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.message || "SC adjust failed");
    setScBalance(Number(j.sc_balance) || 0);
    return j;
  };

  const contributeSideBetsSC = async (tickets) => {
    const sc = Number(tickets) * SIDE_STAKE_SC;
    if (sc <= 0) return;
    const r = await authFetch("/jackpot/sc/contribute", {
      method: "POST",
      body: JSON.stringify({ sc }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.message || "Side bet contribution failed");
    fetchScPool();
    return j;
  };

  const jackpotPayoutSC = async () => {
    const r = await authFetch("/jackpot/sc/payout", { method: "POST" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.message || "Jackpot payout failed");
    await loadScBalance();
    await fetchScPool();
    return j;
  };

  // ---------- Flow ----------
  const chipValues = [1, 5, 10, 25, 50, 100, 250, 500, 1000];

  const onPickChip = (value) => {
    if (!roundOver || isRolling || !authed || isRebetting) return;
    setBet((b) => Number((Number(b) + value).toFixed(2)));
    setPlacedChips((prev) => [...prev, { id: nextChipId.current++, value }]);
  };

  // Remember the most recent completed round’s bet + side toggles for Rebet
  const snapshotLastBet = () => {
    // Prefer the bet amount locked at deal time for reliability
    const dealAmt = Number(betAtDealRef.current) || 0;
    const amt = dealAmt > 0 ? dealAmt : (Number(bet) || 0);
    lastBetRef.current = amt;
    setLastBetAmt(amt);
    // Capture the visual chip stack before we clear it
    lastPlacedChipsRef.current = placedChips.slice();
    // Use the side bets that were actually locked for the round
    lastSideColorRef.current = !!sideActiveRef.current.color;
    lastSideDiceRef.current = !!sideActiveRef.current.dice;
  };

  // Clear the current UI bet state (does NOT snapshot)
  const clearBetUI = () => {
    setBet(0);
    setPlacedChips([]);
    setSideColorOn(false);
    setSideDiceOn(false);
    sideActiveRef.current = { color: false, dice: false };
  };

  const clearBet = () => {
    if (roundOver && !isRolling) {
      // user-requested: manual Clear Bet should NOT snapshot last bet
      clearBetUI();
    }
  };

  const rebet = () => {
    if (!roundOver || isRolling || !authed || isRebetting) return;
    const lb = Number(lastBetAmt || lastBetRef.current) || 0;
    if (lb <= 0) return;

    // cancel any pending rebet timers just in case
    if (rebetTimersRef.current.length) {
      rebetTimersRef.current.forEach((t) => clearTimeout(t));
      rebetTimersRef.current = [];
    }

    setIsRebetting(true);
    // start from empty and drop chips in sequentially for a visual effect
    setBet(0);
    setPlacedChips([]);

    let chips = (lastPlacedChipsRef.current || []).slice();
    // Fallback: if we somehow didn’t capture chip breakdown, synthesize from amount greedily
    if (chips.length === 0 && lb > 0) {
      const denoms = [1000, 500, 250, 100, 50, 25, 10, 5, 1];
      let rem = Math.floor(lb); // use whole units only since our chip set is integer
      const synth = [];
      for (const d of denoms) {
        while (rem >= d) { synth.push({ value: d }); rem -= d; }
        if (rem === 0) break;
      }
      chips = synth;
    }
    const delay = Math.max(28, Math.min(80, 600 / Math.max(1, chips.length))); // faster for many chips
    if (chips.length === 0) {
      // No chip breakdown available; just set the amount instantly
      setBet(lb);
      setIsRebetting(false);
    } else {
      const totalMs = (chips.length - 1) * delay + 120;
      // safety: ensure we always exit rebetting
      const safety = setTimeout(() => setIsRebetting(false), totalMs + 400);
      rebetTimersRef.current.push(safety);
      chips.forEach((c, i) => {
        const tid = setTimeout(() => {
          setPlacedChips((prev) => [...prev, { id: nextChipId.current++, value: c.value }]);
          setBet((b) => Number((Number(b) + (Number(c.value) || 0)).toFixed(2)));
          if (i === chips.length - 1) {
            // after last chip, finish
            setIsRebetting(false);
          }
        }, i * delay);
        rebetTimersRef.current.push(tid);
      });
    }

    // restore side bets immediately (UI toggle state)
    setSideColorOn(!!lastSideColorRef.current);
    setSideDiceOn(!!lastSideDiceRef.current);
    sideActiveRef.current = { color: !!lastSideColorRef.current, dice: !!lastSideDiceRef.current };
  };

  // cleanup any rebet timers on unmount
  useEffect(() => () => {
    if (rebetTimersRef.current.length) {
      rebetTimersRef.current.forEach((t) => clearTimeout(t));
      rebetTimersRef.current = [];
    }
  }, []);

  const getCardNumber = (card) => {
    if (!card) return null;
    const lbl = card.label;
    if (lbl === "Ace") return 1;
    if (["Jack", "Queen", "King"].includes(lbl)) return 10;
    const n = Number(lbl);
    return Number.isFinite(n) ? n : null;
  };

  const dealAndStartAsyncSideContrib = () => {
    const i1 = Math.floor(Math.random() * cardValues.length);
    const i2 = Math.floor(Math.random() * cardValues.length);
    const c1 = cardValues[i1];
    const c2 = cardValues[i2];
    setCardValue1(c1);
    setCardValue2(c2);

    const fa = getCardNumber(c1);
    const fb = getCardNumber(c2);
    frozenARef.current = fa;
    frozenBRef.current = fb;

    setRoundResult("");
    setRoundOver(false);
  // set cards drawn -> no longer tracked

    hasRolledRef.current = false;
    settledRoundRef.current = -1;

    setCardsSettled(false);
    setTimeout(() => setCardsSettled(true), AUTO_ROLL_DELAY_MS);
  };

  const drawCards = async () => {
    if (!roundOver || !authed) return;

    const betNum = Number(bet) || 0;
    const nSides = ((sideColorOn ? 1 : 0) + (sideDiceOn ? 1 : 0));
    const sideNeed = SIDE_STAKE_SC * nSides;
    const needed = betNum + sideNeed;
    if (betNum <= 0) return;

    if ((Number(scBalance) || 0) - needed < 0) {
      setRoundResult("Insufficient SC balance.");
      openLowFunds();
      return;
    }

    // Lock UI amounts for this round
    betAtDealRef.current = betNum;
  // removed UI stake mirrors
    sideActiveRef.current = { color: !!sideColorOn, dice: !!sideDiceOn };

    // Immediately reserve SC: subtract stake + side bet tickets
    try {
      await scAdjust(-needed, "Lock round stake + side tickets");
    } catch (e) {
      setRoundResult(`Could not lock SC: ${e.message}`);
      return;
    }

    dealAndStartAsyncSideContrib();

    if (nSides > 0) {
      waitingSideTxRef.current = true;
      contributeSideBetsSC(nSides)
        .then(() => {
          setTimeout(fetchScPool, 250);
          setTimeout(fetchScPool, 1200);
          setTimeout(fetchScPool, 3000);
        })
        .catch((e) => {
          // if side contribution fails, refund the side part only
          scAdjust(+sideNeed, "Refund side tickets (contribution failed)").catch(()=>{});
          sideActiveRef.current = { color: false, dice: false };
          setRoundResult((prev) => (prev ? prev + " " : "") + `Side bet contribution failed: ${e.message}`);
          // removed UI stake mirror
        })
        .finally(() => {
          waitingSideTxRef.current = false;
        });
    }
  };

  const [rollAnimKeyLocal, setRollAnimKeyLocal] = useState(0);

  const [diceHeight, setDiceHeight] = useState(260);
  useEffect(() => {
    const setH = () => setDiceHeight(window.innerWidth < 600 ? 140 : 260);
    setH();
    window.addEventListener("resize", setH, { passive: true });
    return () => window.removeEventListener("resize", setH);
  }, []);


  useEffect(() => {
    if (!cardsSettled) return;
    if (!autoRollRef.current) return;
    if (roundOver || isRolling) return;
    autoRollRef.current = false;
    setRollAnimKeyLocal((k) => k + 1);
    // inline roll to avoid missing dep warning
    hasRolledRef.current = true;
    setIsRolling(true);
    setCurrentRoundId((id) => id + 1);
  }, [cardsSettled, roundOver, isRolling]);

  const startGame = async () => {
    if (!roundOver || isRolling || !authed) return;
    const betNum = Number(bet) || 0;

    const nSides = ((sideColorOn ? 1 : 0) + (sideDiceOn ? 1 : 0));
    const sideNeed = SIDE_STAKE_SC * nSides;
    const needed = betNum + sideNeed;
    if (betNum <= 0) return;

    if ((Number(scBalance) || 0) - needed < 0) {
      setRoundResult("Insufficient SC balance.");
      openLowFunds();
      return;
    }

    autoRollRef.current = true;
    await drawCards();
  };

  const tieMessage = (betAmt) => `It's a tie — your bet ${betAmt.toFixed(2)} SC was unlocked.`;

  // ----- Side bets (SC pool only) -----
  function settleSideColor({ a, b, d1, d2, enabled }) {
    if (!enabled) return { jackpot: false, label: null };
    const bothAces = a === 1 && b === 1;
    const snakeEyes = d1 === 1 && d2 === 1;
    if (bothAces && snakeEyes) {
      return { jackpot: true, label: "Ace + Snake Eyes JACKPOT (Full Pool)" };
    }
    return { jackpot: false, label: "Card Side Miss" };
  }
  function settleSideDice({ a, b, d1, d2, enabled }) {
    if (!enabled) return { jackpot: false, label: null };
    const dl = Math.min(d1, d2), dh = Math.max(d1, d2);
    const cl = Math.min(a, b),  ch = Math.max(a, b);
    const diceAdjacent  = (dh - dl) === 1;
    const cardsAdjacent = (ch - cl) === 1;
    const stackedDiceThenCards = diceAdjacent && cardsAdjacent && (dh + 1 === cl);
    const stackedCardsThenDice = diceAdjacent && cardsAdjacent && (ch + 1 === dl);
    if (stackedDiceThenCards || stackedCardsThenDice) {
      return { jackpot: true, label: "Consecutive 4 JACKPOT (Full Pool)" };
    }
    return { jackpot: false, label: "Dice Pattern Miss" };
  }

  // ---------- Finish round / settle (SC only) ----------
  const finishRoundWith = async (d1, d2) => {
    const a = frozenARef.current;
    const b = frozenBRef.current;
    const betSnap = Number(betAtDealRef.current) || 0;

    if (!Number.isFinite(betSnap) || betSnap <= 0) {
      setRoundOver(true);
  // removed UI stake mirrors
      return;
    }

    const enabledColor = sideActiveRef.current.color;
    const enabledDice  = sideActiveRef.current.dice;

    const sideColor = settleSideColor({ a, b, d1, d2, enabled: enabledColor });
    const sideDice  = settleSideDice ({ a, b, d1, d2, enabled: enabledDice });

    if ((sideColor.jackpot || sideDice.jackpot)) {
      jackpotPayoutSC().then(() => {
        setTimeout(fetchScPool, 1200);
        setTimeout(fetchScPool, 4000);
        triggerBigWin({
          badge: "JACKPOT",
          title: "FULL POOL!",
          note: sideColor.jackpot && sideDice.jackpot ? "Both Side Bets Hit" : sideColor.jackpot ? "Card Side Jackpot" : "Dice Side Jackpot",
        });
        showToast("win", 0, "JACKPOT (Pool Paid)");
      }).catch(()=>{});
    }

    const sum = Number(d1) + Number(d2);
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);

    const payJackpot = async (profitFactor, label) => {
      const streak = payoutMultiplierRef.current || 1;
      // PROFIT ONLY — stake was locked at deal and must be returned on win
      const mainProfitRaw = betSnap * profitFactor * streak;
      const mainProfit = mainProfitRaw * HOUSE_EDGE;

      // 1) credit profit
      if (mainProfit > 0) {
        await scAdjust(+mainProfit, `Main bet jackpot ${profitFactor}x`);
      }
      // 2) return stake
      await scAdjust(+betSnap, "Return stake (jackpot)");

      const totalReturn = betSnap + mainProfit;
      const sideLbls = [sideColor.label, sideDice.label].filter(Boolean).join(" | ");
      setRoundResult(`${label}! You won ${totalReturn.toFixed(2)} SC${sideLbls ? ` — ${sideLbls}` : ""}.`);
      triggerFly("win", "up", (<span className="fly-line"><span className="pos">+{totalReturn.toFixed(2)} SC</span></span>));
      triggerBigWin({ badge: `${profitFactor}x`, title: "BIG WIN!", note: label });
      showToast("win", totalReturn, label);

      if (profitFactor >= 5) bumpOnJackpotWin(); else bumpOnNormalWin();
    };

    try {
      if (a === 1 && b === 1 && d1 === 1 && d2 === 1) {
        await payJackpot(JACKPOT_DOUBLE_ACE_SNAKE_PROFIT, "DOUBLE ACE + SNAKE EYES!");
      } else if (sum === a + b) {
        await payJackpot(JACKPOT_EXACT_PROFIT, "JACKPOT!");
      } else if ((a === 1 || b === 1) && d1 === 1 && d2 === 1) {
        await payJackpot(JACKPOT_ACE_SNAKE_PROFIT, "ACE + SNAKE EYES!");
      } else if (sum > lo && sum < hi) {
        const streak = payoutMultiplierRef.current || 1;
        const B = spreadBonus(lo, hi);
  const rawProfit = betSnap * Math.max(0, (streak - 1) + BETWEEN_BASE) * B; // Option A: base profit component
        const totalProfit = rawProfit * HOUSE_EDGE;

        if (totalProfit > 0) await scAdjust(+totalProfit, "Between win (with spread bonus)");
        // stake unlock:
        await scAdjust(+betSnap, "Return stake");

        const totalReturn = betSnap + totalProfit;
        const sideLbls = [sideColor.label, sideDice.label].filter(Boolean).join(" | ");
        setRoundResult(`You won ${totalReturn.toFixed(2)} SC${sideLbls ? ` — ${sideLbls}` : ""}. Winnings ${totalProfit.toFixed(2)} SC + stake returned.`);
        triggerFly("win", "up", (<span className="fly-line"><span className="pos">+{totalReturn.toFixed(2)} SC</span></span>));
        showToast("win", totalReturn, "Win");

        bumpOnNormalWin();
      } else if (sum === a || sum === b) {
        await scAdjust(+betSnap, "Tie return stake");
        const sideLbls = [sideColor.label, sideDice.label].filter(Boolean).join(" | ");
        setRoundResult(tieMessage(betSnap) + (sideLbls ? ` ${sideLbls}.` : "" ));
        triggerFly("tie", "up", (<span className="fly-line"><span>{betSnap.toFixed(2)} SC</span></span>));
        showToast("tie", betSnap, "Tie");
        bumpOnTie();
      } else {
        // Loss: stake already deducted; nothing else to do
        const sideLbls = [sideColor.label, sideDice.label].filter(Boolean).join(" | ");
        setRoundResult(`You lost ${betSnap.toFixed(2)} SC${sideLbls ? ` — ${sideLbls}` : ""}.`);
        triggerFly("loss", "down", (<span className="fly-line"><span className="neg">-{betSnap.toFixed(2)} SC</span></span>));
        showToast("loss", betSnap, "Loss");
        resetOnLoss();
      }
    } catch (e) {
      // If anything fails, try to refund stake (best effort)
      try { await scAdjust(+betSnap, "Refund stake (settle error)"); } catch {}
      setRoundResult(`Round unresolved: ${e.message}`);
      showToast("refunded", 0, "Settle Error");
    }

  // removed UI stake mirror
  setRoundOver(true);

  // End of round: remember this bet and side toggles, then clear UI
  snapshotLastBet();
  clearBetUI();
  };

  // ---------- Render ----------
  const ToastIcon = ({ type, title }) => {
    if (title === "JACKPOT!" || title === "ACE + SNAKE EYES!" || title === "DOUBLE ACE + SNAKE EYES!" || title?.includes("JACKPOT"))
      return <EmojiEventsRoundedIcon className="toast-ico ico-jackpot" />;
    if (type === "win") return <CheckCircleRoundedIcon className="toast-ico ico-win" />;
    if (type === "tie" || type === "refunded") return <InfoRoundedIcon className="toast-ico ico-tie" />;
    return <CancelRoundedIcon className="toast-ico ico-loss" />;
  };

  // Show actual SC balance (no temporary subtraction)
  const displayBalance = Math.max(0, Number(scBalance));

  // live spread bonus preview (if cards shown)
  const getNum = (c) => getCardNumber(c);
  const aNum = getNum(cardValue1);
  const bNum = getNum(cardValue2);
  const liveSpread = (Number.isFinite(aNum) && Number.isFinite(bNum))
    ? spreadBonus(Math.min(aNum,bNum), Math.max(aNum,bNum))
    : null;

  return (
    <>
      <NavBar />

      {/* small top margin so game sits just below the NavBar
          also expose the navbar height as a CSS variable so the global LED aligns */
      }
      <Container
        fluid
        className="px-0 mt-0 mb-4 roc-wrap"
        style={{ '--nav-height': 'var(--nav-height, 64px)' }}
      >

        {/* push the poker table down and use the shared page background (not green felt) */}
        <div
          className="poker-table"
          style={{
            paddingTop: isPhone ? 0 : "calc(var(--nav-height, 64px) + 12px)",
            background: "radial-gradient(60% 80% at 50% 10%, #3b1d55 0%, #140a1c 55%, #0a0613 75%, #000 100%)",
            boxSizing: "border-box"
          }}
        >
           <div className="table-rim">
            {/* dark/neon table surface; add an inline LED rail anchored at the top of the surface */}
            <div
              className="table-surface"
              style={{
                background: "radial-gradient(60% 60% at 50% 10%, #2b0d34 0%, #14081a 50%, #000 100%)",
                position: "relative",
                overflow: "visible"
              }}
            >
              {/* Calm purple LED strip anchored at the top of this table surface.
                  --led-duration controls speed; set to a long value for a calming motion. */}
              <div className="led-inline" aria-hidden="true">
                <div className="led-run led-run-inline" style={{ '--led-duration': '18s' }} />
              </div>

               <div className="war-over-table-glow" aria-hidden="true" />
              {!authed && (
                <div className="login-overlay">
                  <div className="overlay-card">
                    <h4 className="mb-2">Log in to play</h4>
                    <div className="text-muted mb-3">Balance is tracked in your account.</div>
                    <a href="/registration" className="btn btn-primary btn-sm">Go to Login / Register</a>
                  </div>
                </div>
              )}

              {/* HUD */}
              <div className="hud-bar mb-3">
                <div className="hud-left">
                  <div className="stat stat-balance">
                    <span className="stat-label">Balance</span>
                    <span className="stat-value">{displayBalance.toFixed(2)} SC</span>
                    {flyDelta && (
                      <span key={flyDelta.id} className={`balance-fly ${flyDelta.type} ${flyDelta.dir}`}>
                        {flyDelta.jsx}
                      </span>
                    )}
                  </div>

                  <div className="stat">
                    <span className="stat-label">Streak Bonus</span>
                    <span className="stat-chip">{payoutMultiplier.toFixed(2)}x</span>
                  </div>

                  <div className="stat">
                    <span className="stat-label">Jackpot</span>
                    <span className="stat-chip">{poolSC.toFixed(2)} SC</span>
                  </div>
 {liveSpread && (
   <div className="stat stat--spread">
     <span className="stat-label">Spread Bonus</span>
     <span className="stat-chip">{liveSpread.toFixed(2)}x</span>
   </div>
 )}
                </div>

                <div className="hud-right">
                  <OverlayTrigger placement="left" overlay={<BsTooltip>Wallet</BsTooltip>}>
                    <BsButton onClick={openWallet} variant="secondary" className="wallet-btn" size="sm" disabled={!authed}>
                      <AccountBalanceWalletIcon style={{ marginRight: 6, verticalAlign: "-3px" }} />
                      Wallet
                    </BsButton>
                  </OverlayTrigger>
                </div>
              </div>

              {/* Cards + Dice */}
              <div
                className="table-grid"
                style={{
                  display: "grid",
                  gridTemplateColumns: window.innerWidth >= 992 ? "minmax(0, 7fr) minmax(0, 3fr)" : "1fr",
                  gap: window.innerWidth >= 992 ? 16 : 12,
                  alignItems: "start"
                }}
              >
                <div>
                  <div className="small-muted mb-2">Cards</div>
                  <div className="cards-zone" style={{ background: "transparent" }}>
                   
<CardDealTwoMeuk
  basePath="/cards/meuk"
  c1={cardValue1}
  c2={cardValue2}
  animateKey={`${cardValue1?.label}-${cardValue1?.suit}-${cardValue2?.label}-${cardValue2?.suit}`}

  /* === PHONE-ONLY TWEAKS === */
  height={isPhone ? 172 : (window.innerWidth < 600 ? 180 : 220)}
  cameraZoom={isPhone ? 180 : 150}

  /* Move the DECK far to the left so it’s not under the dealt cards */
  deckX={isPhone ? -1.5 : 1.60}
  deckY={isPhone ? 0.0 : 0.0}

  /* Center the two dealt cards */
  leftX={isPhone ? -0.38 : -0.9}
  rightX={isPhone ?  0.38 : -0.2}

  zLift={isPhone ? 0.12 : 0.15}
  firstDelayMs={CARD_FIRST_DELAY_MS}
  staggerMs={CARD_STAGGER_MS}
  totalMs={CARD_TOTAL_MS}
  underlayColor="transparent"
  underlayShowDeg={isPhone ? 88 : 95}
/>


                  </div>
                </div>

                <div>
                  <div className="small-muted mb-2">Dice</div>
                 <div
  className="dice-zone"
  style={{ background: "transparent", overflow: "visible" }}
>

                    <div
  style={{
    transform: window.innerWidth < 600 ? "translateY(-48px)" : "none",
    transition: "transform .2s ease",
  }}
>
  <ThreeDiceCanvas
    animateKey={rollAnimKeyLocal}
    height={window.innerWidth < 600 ? Math.max(180, diceHeight) : diceHeight}
    biasToTargets={false}
    onSettle={async ({ d1, d2 }) => {
      if (!hasRolledRef.current) return;
      if (settledRoundRef.current === currentRoundId) return;
      settledRoundRef.current = currentRoundId;
      hasRolledRef.current = false;
      try { await finishRoundWith(d1, d2); }
      finally { setIsRolling(false); }
    }}
  />
</div>

                  </div>
                </div>
              </div>

              {/* Bet Spot */}
              <Row className="mt-2">
                <Col xs={12}>
                  <div className="bet-spot">
                    {/* LEFT tiny side-bet (Card Side) — SC only */}
                    <OverlayTrigger
                      placement="top"
                      overlay={<BsTooltip><div style={{maxWidth:260}}><strong>Card Side (SC)</strong><br/>Jackpot only if both cards are Aces and dice are 1 &amp; 1.</div></BsTooltip>}
                    >
                      <div
                        onClick={() => {
                          if (!authed || !roundOver || isRolling || waitingSideTxRef.current) return;
                          const next = !sideColorOn;
                          if (next) {
                            const need = (Number(bet) || 0) + SIDE_STAKE_SC + (sideDiceOn ? SIDE_STAKE_SC : 0);
                            if ((Number(scBalance)||0) - need < 0) { setRoundResult("Insufficient SC."); openLowFunds(); return; }
                          }
                          setSideColorOn(next);
                        }}
                        role="button"
                        aria-label="Toggle Card Side bet"
                        style={{
                          width: 38, height: 38, borderRadius: "50%",
                          border: sideColorOn ? "2px solid #38d39f" : "2px solid #2e3b4a",
                          boxShadow: sideColorOn ? "0 0 12px rgba(56, 211, 159, .45)" : "none",
                          background: "#0b1220",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          marginRight: 10,
                          cursor: (!authed || !roundOver || isRolling || waitingSideTxRef.current) ? "not-allowed" : "pointer",
                          opacity: (!authed || !roundOver || isRolling || waitingSideTxRef.current) ? 0.5 : 1,
                        }}
                      >
                        {sideColorOn ? <img src={chip1} alt="1 SC" style={{ width: 28, height: 28, borderRadius: "50%" }} /> : <span style={{ fontSize: 12, color: "#9fb1c6" }}>C</span>}
                      </div>
                    </OverlayTrigger>

                    <div className="bet-spot-felt">
                      <div className="bet-spot-label">Your Bet</div>
                      <div className="bet-spot-stack">
                        {placedChips.slice(-20).map((chip, idx) => {
                          const src = CHIP_SRC[chip.value] || CHIP_SRC[1];
                          const x = (idx % 5) * 4 - 8;
                          const y = -Math.floor(idx / 5) * 4;
                          const r = (idx % 7) * 3 - 9;
                          return (
                            <img
                              key={chip.id}
                              src={src}
                              alt={`${chip.value}`}
                              className="bet-spot-chip bet-spot-chip--sm"
                              style={{ transform: `translate(${x}px, ${y}px) rotate(${r}deg)` }}
                            />
                          );
                        })}
                      </div>
                      <div className="bet-spot-total">{Number(bet).toFixed(2)} SC</div>
                    </div>

                    {/* RIGHT tiny side-bet (Dice Side) — SC only */}
                    <OverlayTrigger
                      placement="top"
                      overlay={<BsTooltip><div style={{maxWidth:260}}><strong>Dice Side (SC)</strong><br/>Two adjacent dice + the next adjacent card pair (either order) → 4-number run jackpot.</div></BsTooltip>}
                    >
                      <div
                        onClick={() => {
                          if (!authed || !roundOver || isRolling || waitingSideTxRef.current) return;
                          const next = !sideDiceOn;
                          if (next) {
                            const need = (Number(bet) || 0) + SIDE_STAKE_SC + (sideColorOn ? SIDE_STAKE_SC : 0);
                            if ((Number(scBalance)||0) - need < 0) { setRoundResult("Insufficient SC."); openLowFunds(); return; }
                          }
                          setSideDiceOn(next);
                        }}
                        role="button"
                        aria-label="Toggle Dice Side bet"
                        style={{
                          width: 38, height: 38, borderRadius: "50%",
                          border: sideDiceOn ? "2px solid #38a1d3" : "2px solid #2e3b4a",
                          boxShadow: sideDiceOn ? "0 0 12px rgba(56, 161, 211, .45)" : "none",
                          background: "#0b1220",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          marginLeft: 10,
                          cursor: (!authed || !roundOver || isRolling || waitingSideTxRef.current) ? "not-allowed" : "pointer",
                          opacity: (!authed || !roundOver || isRolling || waitingSideTxRef.current) ? 0.5 : 1,
                        }}
                      >
                        {sideDiceOn ? <img src={chip1} alt="1 SC" style={{ width: 28, height: 28, borderRadius: "50%" }} /> : <span style={{ fontSize: 12, color: "#9fb1c6" }}>D</span>}
                      </div>
                    </OverlayTrigger>
                  </div>
                </Col>
              </Row>

              {/* Toast */}
              {resultToast && (
                <div className={`result-toast fancy ${resultToast.type}`}>
                  <div className="toast-glow"></div>
                  <div className="toast-inner">
                    <ToastIcon type={resultToast.type} title={resultToast.title} />
                    <div className="toast-text">
                      <div className="toast-title">
                        {resultToast.title ||
                          (resultToast.type === "win" ? "Win" :
                           resultToast.type === "tie" ? "Tie" :
                           resultToast.type === "refunded" ? "Refunded" : "Loss")}
                      </div>
                      <div className="toast-amount">
                        {resultToast.type === "win" ? "+" : resultToast.type === "loss" ? "-" : ""}
                        {Math.abs(resultToast.amount).toFixed(2)} SC
                      </div>
                    </div>
                  </div>
                  <div className="toast-shine" />
                  <div className="toast-sparkles" />
                </div>
              )}

              {/* BIG WIN overlay */}
              {bigWin && (
                <div className="big-win-overlay">
                  <div className="big-win-card">
                    <div className="big-win-title">{bigWin.title}</div>
                    <div className="big-win-badge">{bigWin.badge}</div>
                    {bigWin.note && <div className="big-win-note">{bigWin.note}</div>}
                    <div className="big-win-sparkles">
                      {Array.from({ length: 22 }).map((_, i) => (
                        <span key={i} style={{ "--d": `${i * 0.05}s` }} />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Bottom Controls */}
              <Row className="g-2 mt-3">
                <Col xs={12} lg={8}>
                  {/* Clamp to container width to avoid any right-side bleed on phones */}
                  <div className="chip-tray-clamp">
                  <div className="chip-tray wide">
  {/* Desktop/Tablet (>= sm): chips left, controls right */}
  <div className="d-none d-sm-flex align-items-center justify-content-between w-100">
    <div className="d-flex flex-wrap align-items-center gap-2">
      {chipValues.map((v) => (
        <button
          key={v}
          className="chip use-img"
          data-val={v}
          style={{ "--chip-img": `url(${CHIP_SRC[v]})` }}
          onClick={() => onPickChip(v)}
          title={`Add ${v}`}
          disabled={!authed}
        >
          <span className="chip-inner"><span className="chip-text">{v}</span></span>
        </button>
      ))}
    </div>

    <div className="d-flex align-items-center gap-2">
      <BsButton size="sm" variant="outline-light" onClick={clearBet} className="chip-clear" disabled={isRebetting}>
        Clear Bet
      </BsButton>

      <BsButton size="sm" variant="outline-light" onClick={rebet} className="chip-rebet" disabled={!authed || !roundOver || isRolling || isRebetting || (Number(lastBetAmt ?? lastBetRef.current) || 0) <= 0}>
        Rebet
      </BsButton>

      <BsButton
        variant="outline-light"
        className="start-game-btn"
        style={{
          minWidth: 220,
          paddingLeft: 18,
          paddingRight: 18,
          boxShadow: "0 8px 30px rgba(150,100,230,0.35), 0 0 18px rgba(150,100,230,0.12)",
          borderRadius: 8,
          fontSize: "0.8rem"
        }}
        onClick={startGame}
        disabled={!roundOver || isRolling || (Number(bet) || 0) <= 0 || !authed || isRebetting}
      >
        Start Game
      </BsButton>
    </div>
  </div>

  {/* Phone (< sm): horizontally scrollable chip row using Bootstrap overflow + nowrap */}
  <div className="chip-scroller d-sm-none overflow-auto w-100" aria-label="Chip values">
    <div className="chip-track d-flex flex-nowrap align-items-center">
      {chipValues.map((v) => (
        <button
          key={v}
          className="chip use-img"
          data-val={v}
          style={{ "--chip-img": `url(${CHIP_SRC[v]})` }}
          onClick={() => onPickChip(v)}
          title={`Add ${v}`}
          disabled={!authed}
        >
          <span className="chip-inner"><span className="chip-text">{v}</span></span>
        </button>
      ))}
      <BsButton size="sm" variant="outline-light" onClick={clearBet} className="chip-clear ms-1 flex-shrink-0" disabled={isRebetting}>
        Clear Bet
      </BsButton>
      <BsButton size="sm" variant="outline-light" onClick={rebet} className="chip-rebet ms-1 flex-shrink-0" disabled={!authed || !roundOver || isRolling || isRebetting || (Number(lastBetAmt ?? lastBetRef.current) || 0) <= 0}>
        Rebet
      </BsButton>
    </div>

    {/* soft edges so the scroll affordance is obvious */}
    <div className="chip-fade chip-fade--left" aria-hidden="true" />
    <div className="chip-fade chip-fade--right" aria-hidden="true" />
  </div>

  <div className="bet-readout mt-2">
    Current bet: <strong>{Number(bet).toFixed(2)} SC</strong>
    {(sideColorOn || sideDiceOn) && (
      <span className="ms-3 small" style={{ color: "#9fb1c6" }}>
        + Side bets: <strong>{(SIDE_STAKE_SC * ((sideColorOn?1:0) + (sideDiceOn?1:0))).toFixed(2)} SC</strong>
      </span>
    )}
  </div>

  {/* Phone-only Start button so it’s always accessible */}
  <div className="d-sm-none mt-2">
    <BsButton
      className="start-game-btn-mobile w-100"
      variant="primary"
      style={{ fontSize: "0.85rem" }}
      onClick={startGame}
      disabled={!roundOver || isRolling || (Number(bet) || 0) <= 0 || !authed || isRebetting}
    >
      Start Game
    </BsButton>
  </div>
                  </div>
                  </div>
                </Col>

                <Col xs={12}>
                  {roundResult && (<><hr className="my-2" /><div style={{ fontSize: ".95rem" }}>{roundResult}</div></>)}
                </Col>
              </Row>

              {/* How to Play button */}
              <Row className="mt-3">
                <Col xs={12}>
                  <BsButton variant="outline-light" className="w-100" onClick={openRules}>
                    How to Play &amp; Rules
                  </BsButton>
                </Col>
              </Row>

              {/* Rules Overlay */}
              {rulesOpen && (
                <div className="rules-overlay" onClick={closeRules}>
                  <div
                    className="rules-card"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="roc-rules-title"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="rules-header">
                      <h4 id="roc-rules-title" className="mb-0">How to Play &amp; Rules</h4>
                      <button type="button" className="btn-close" aria-label="Close" onClick={closeRules} />
                    </div>
                    <div className="rules-body">
                      <section className="mb-3">
                        <h6 className="mb-2">Goal</h6>
                        <p className="small" style={{ color: "#9fb1c6" }}>
                          Place your main bet in <strong>Stake Coins (SC)</strong>. Two cards are dealt, then the dice roll.
                          Optional Side Bets (SC-only) can win the entire SC Jackpot pool.
                        </p>
                      </section>

                      <section className="mb-3">
                        <h6 className="mb-2">Main Bet — Payouts</h6>
                        <ul className="small" style={{ color: "#cfe3ff", marginLeft: "1.1rem" }}>
                          <li><strong>Exact Sum Jackpot:</strong> If dice total equals (card A + card B), you win <strong>3×</strong> profit × Streak Bonus; stake returned.</li>
                          <li><strong>Ace + Snake Eyes:</strong> At least one Ace and dice are 1+1 → <strong>2×</strong> profit × Streak Bonus; stake returned.</li>
                          <li><strong>Double Ace + Snake Eyes:</strong> Both Aces and dice 1+1 → <strong>10×</strong> profit × Streak Bonus; stake returned.</li>
                          <li><strong>Between:</strong> Dice total strictly between the two card values → profit = (Streak Bonus − 1) × bet × <em>Spread Bonus</em> (up to 1.30×); stake returns.</li>
                          <li><strong>Tie:</strong> Dice total equals a single card value → stake returns.</li>
                          <li><strong>Loss:</strong> Otherwise, bet is lost.</li>
                        </ul>
                        <p className="small" style={{ color: "#9fb1c6" }}>
                          Profits pay a small rake; stake is never raked. Face cards are 10. Aces are 1. Streak starts at 1.05× and caps at 2.00×.
                        </p>
                      </section>

                      <section className="mb-3">
                        <h6 className="mb-2">Streak &amp; Spread</h6>
                        <ul className="small" style={{ color: "#cfe3ff", marginLeft: "1.1rem" }}>
                          <li><strong>Streak Bonus:</strong> Each win nudges your multiplier up (starts at 1.05×, caps at 2.00×). Ties slightly bump it; losses reset to 1.05×.</li>
                          <li><strong>Spread Bonus:</strong> Tighter gaps between your two card values increase the Between win profit up to 1.30×.</li>
                        </ul>
                      </section>

                      <section className="mb-3">
                        <h6 className="mb-2">Side Bets — SC Jackpot Tickets (1 SC each)</h6>
                        <ul className="small" style={{ color: "#cfe3ff", marginLeft: "1.1rem" }}>
                          <li><strong>Card Side:</strong> Jackpot only when both cards are Aces and dice are 1 &amp; 1.</li>
                          <li><strong>Dice Side:</strong> Dice are an adjacent pair and cards are the next adjacent pair, forming a 4-number run (either order).</li>
                        </ul>
                        <p className="small" style={{ color: "#9fb1c6" }}>
                          Side-bet funds top up the SC pool immediately. Jackpots pay from the pool separately from your main bet.
                        </p>
                      </section>

                      <section className="mb-1">
                        <h6 className="mb-2">Examples</h6>
                        <ul className="small" style={{ color: "#cfe3ff", marginLeft: "1.1rem" }}>
                          <li><strong>Between:</strong> Cards 7 and 10; dice total 8 or 9 → win (profit from Streak × Spread), stake returns.</li>
                          <li><strong>Exact Sum:</strong> Cards Ace (1) and 5; dice total 6 → Exact Sum Jackpot (3× profit), stake returns.</li>
                          <li><strong>Tie:</strong> Cards 4 and Queen (10); dice total 10 → tie, stake returns.</li>
                        </ul>
                      </section>
                    </div>
                    <div className="rules-actions">
                      <BsButton variant="primary" onClick={closeRules}>Got it</BsButton>
                    </div>
                  </div>
                </div>
              )}

              {/* Wallet Modal */}
              <Modal show={walletOpen} onHide={closeWallet} centered dialogClassName="wallet-dark" scrollable>
                <div style={{ background: "#12171d", color: "#e7efff", border: "1px solid #1f2a36", borderRadius: 6, maxHeight: "calc(100dvh - 24px)" }}>
                  <Modal.Header closeButton style={{ borderBottom: "1px solid #1f2a36" }}>
                    <Modal.Title>Wallet</Modal.Title>
                  </Modal.Header>
                  <Modal.Body style={{ maxHeight: "calc(100dvh - 180px)", overflowY: "auto", paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 8px)" }}>
                    <Tabs defaultActiveKey="deposit" id="wallet-tabs" className="mb-3">
                      <Tab eventKey="deposit" title="Deposit">
                        {/* SC balance */}
                        <div className="wallet-mini-stats mb-3">
                          <div><span className="mini-label">Stake Coins</span><span className="mini-value">{Number(scBalance).toFixed(2)} SC</span></div>
                          <div><span className="mini-label">Jackpot Pool</span><span className="mini-value">{poolSC.toFixed(2)} SC</span></div>
                        </div>

                        {/* XLM Panel */}
                        <div className="p-3 mb-3" style={{ background: "#0b1220", borderRadius: 6, border: "1px solid #1f2a36" }}>
                          <div className="mb-2" style={{ color: "#9fb1c6" }}><strong>Stellar (Testnet)</strong></div>
                          {!profile?.public_key ? (
                            <>
                              <div className="small mb-2" style={{ color: "#9fb1c6" }}>Create your XLM testnet deposit address.</div>
                              <BsButton size="sm" variant="success" onClick={createAndAttachXlmAddress}>Create XLM Address</BsButton>
                              {walletMsg && <div className="small mt-2" style={{ color: "#9fb1c6" }}>{walletMsg}</div>}
                            </>
                          ) : (
                            <>
                              <div className="small" style={{ color: "#cfe3ff" }}>
                                Address: <code style={{ wordBreak: "break-all" }}>{publicKey || profile.public_key}</code>
                              </div>
                              <div className="d-flex flex-wrap gap-2 mt-2">
                                <BsButton size="sm" variant="success" onClick={friendbotFund}>Fund (Friendbot)</BsButton>
                                <BsButton size="sm" variant="outline-light" onClick={refreshXlmBalance}>Refresh</BsButton>
                              </div>
                              <div className="small mt-2" style={{ color: "#cfe3ff" }}>
                                Mirror Balance: <strong>{Number(xlmBalance).toFixed(6)} XLM</strong>
                                                           </div>
                            </>
                          )}
                        </div>

                        {/* XRP Panel */}
                        <div className="p-3 mb-3" style={{ background: "#0b1220", borderRadius: 6, border: "1px solid #1f2a36" }}>
                          <div className="mb-2" style={{ color: "#9fb1c6" }}><strong>XRPL Testnet</strong></div>
                          {!xrpAddress ? (
                            <>
                              <div className="small mb-2" style={{ color: "#9fb1c6" }}>
                                Create an XRPL testnet wallet (address + secret). Secret is stored server-side for dev.
                              </div>
                              <BsButton size="sm" variant="success" onClick={createAndAttachXrpWallet}>Create XRPL Wallet</BsButton>
                            </>
                          ) : (
                            <>
                              <div className="small" style={{ color: "#cfe3ff" }}>
                                Address: <code>{xrpAddress}</code><br/>
                                Secret: <code>{xrpSecret ? "(hidden in DB)" : "(stored in DB)"}</code><br/>
                                Mirror Balance: <strong>{xrpBalance.toFixed(6)} XRP</strong>
                              </div>
                              <div className="d-flex gap-2 mt-2">
                                <BsButton size="sm" variant="warning" onClick={fundXrpFromFaucet}>Faucet</BsButton>
                                <BsButton size="sm" variant="outline-light" onClick={async () => {
                                  await authFetch("/balance/xrp/sync", { method: "POST" });
                                  const me2 = await authFetch("/me"); if (me2.ok) { const d = await me2.json(); setXrpBalance(Number(d.xrp_balance)||0); }
                                }}>Refresh</BsButton>
                              </div>
                            </>
                          )}
                        </div>

                        {/* ETH Panel */}
                        <div className="p-3 mb-3" style={{ background: "#0b1220", borderRadius: 6, border: "1px solid #1f2a36" }}>
                          <div className="mb-2" style={{ color: "#9fb1c6" }}><strong>Ethereum (Sepolia)</strong></div>
                          <div className="d-flex gap-2 mb-2">
                            <BsButton size="sm" variant="warning" onClick={connectEth}>Connect MetaMask</BsButton>
                            <BsButton size="sm" variant="outline-light" onClick={refreshEthBalance} disabled={!ethAddress}>Refresh</BsButton>
                          </div>
                          <div className="small" style={{ color: "#cfe3ff" }}>
                            Address: <code>{ethAddress || "—"}</code><br/>
                            Mirror Balance: <strong>{ethBalance.toFixed(6)} ETH</strong>
                          </div>
                        </div>

                        {/* Convert crypto -> SC */}
                        <ConvertToSC
                          xlmBalance={xlmBalance}
                          xrpBalance={xrpBalance}
                          ethBalance={ethBalance}
                          onConverted={async () => {
                            await loadScBalance();
                            await refreshXlmBalance();
                            await authFetch("/balance/xrp/sync", { method: "POST" }).catch(()=>{});
                            await authFetch("/balance/eth/sync", { method: "POST" }).catch(()=>{});
                            const me2 = await authFetch("/me"); if (me2.ok) {
                              const d = await me2.json();
                              const xlm = ("xlm_balance" in d) ? d.xlm_balance : d.sc_balance;
                              setXlmBalance(Number(xlm)||0);
                              setXrpBalance(Number(d.xrp_balance)||0);
                              setEthBalance(Number(d.eth_balance)||0);
                            }
                          }}
                        />
                      </Tab>

                      <Tab eventKey="withdraw" title="Withdraw">
                        <WithdrawSC
                          defaultXLM={publicKey || profile?.public_key || ""}
                          defaultXRP={xrpAddress || ""}
                          defaultETH={ethAddress || ""}
                          onDone={async () => { await loadScBalance(); }}
                        />
                      </Tab>

                      <Tab eventKey="rules" title="How to Play">
                        <div className="p-2">
                          <div className="mb-3">
                            <h6 className="mb-2">Goal</h6>
                            <div className="small" style={{ color: "#9fb1c6" }}>
                              Place your main bet in <strong>Stake Coins (SC)</strong>. Two cards are dealt, then the dice roll. Side bets (SC-only) can pay the entire SC Jackpot pool.
                            </div>
                          </div>

                          <div className="mb-3">
                            <h6 className="mb-2">Main Bet — Payouts</h6>
                            <ul className="small" style={{ color: "#cfe3ff", marginLeft: "1.1rem" }}>
                              <li><strong>Exact Sum Jackpot:</strong> If dice total equals (card A + card B), you win <strong>3×</strong> profit × Streak Bonus; stake returned.</li>
                              <li><strong>Ace + Snake Eyes:</strong> At least one Ace and dice are 1+1 → <strong>2×</strong> profit × Streak Bonus; stake returned.</li>
                              <li><strong>Double Ace + Snake Eyes:</strong> Both Aces and dice 1+1 → <strong>10×</strong> profit × Streak Bonus; stake returned.</li>
                              <li><strong>Between:</strong> Dice total strictly between the two card values → profit = (Streak Bonus − 1) × bet × <em>Spread Bonus</em> (up to 1.30×); stake returns.</li>
                              <li><strong>Tie:</strong> Dice total equals a single card value → stake returns.</li>
                              <li><strong>Loss:</strong> Otherwise, bet is lost.</li>
                            </ul>
                            <div className="small" style={{ color: "#9fb1c6" }}>
                              Profits pay a small rake; stake is never raked. Face cards are 10. Aces are 1. Streak starts at 1.05× and caps at  2.00×.
                            </div>
                          </div>

                          <div className="mb-3">
                            <h6 className="mb-2">Side Bets — SC Jackpot Tickets (1 SC each)</h6>
                            <ul className="small" style={{ color: "#cfe3ff", marginLeft: "1.1rem" }}>
                              <li><strong>Card Side:</strong> Jackpot only when both cards are Aces and dice are 1 &amp; 1.</li>
                              <li><strong>Dice Side:</strong> Dice are an adjacent pair and cards are the next adjacent pair, forming a 4-number run (either order).</li>
                            </ul>
                            <div className="small" style={{ color: "#9fb1c6" }}>
                              Side-bet funds top up the SC pool immediately. Jackpots pay from the pool separately from your main bet.
                            </div>
                          </div>
                        </div>
                      </Tab>
                    </Tabs>
                  </Modal.Body>
                </div>
              </Modal>

              {/* Low funds */}
              <Modal show={lowFundsOpen} onHide={closeLowFunds} centered>
                <div style={{ background: "#12171d", color: "#e7efff", border: "1px solid #1f2a36", borderRadius: 6 }}>
                  <Modal.Header closeButton style={{ borderBottom: "1px solid #1f2a36" }}>
                    <Modal.Title>Insufficient balance</Modal.Title>
                  </Modal.Header>
                  <Modal.Body>
                    You don’t have enough SC to place that bet.

                    <div className="mt-3 d-flex gap-2">
                      <BsButton variant="primary" onClick={() => { closeLowFunds(); openWallet(); }}>
                        Open Wallet
                      </BsButton>
                      <BsButton variant="outline-light" onClick={closeLowFunds}>Cancel</BsButton>
                    </div>
                  </Modal.Body>
                </div>
              </Modal>

            </div>
          </div>
        </div>
      </Container>
    </>
  );
}

/* -------------------- Deposit: Convert to SC -------------------- */
function ConvertToSC({ xlmBalance, xrpBalance, ethBalance, onConverted }) {
  const [asset, setAsset] = useState("XLM"); // XLM | XRP | ETH
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState(null);
  const [busy, setBusy] = useState(false);

  // client-side mirrors of server safety + ROUND DOWN to decimals
  // (leaves safety buffer for reserves/fees; values tuned to avoid false errors)
  const KEEP = { XLM: 1.50005, XRP: 10.00001, ETH: 0 };
  const DECS = { XLM: 6, XRP: 6, ETH: 6 };
  const scale = (a) => 10 ** DECS[a];
  const floorDec = (n, a) => Math.floor((Number(n) || 0) * scale(a)) / scale(a);

  const balByAsset = {
    XLM: Number(xlmBalance) || 0,
    XRP: Number(xrpBalance) || 0,
    ETH: Number(ethBalance) || 0,
  };
  const avail = balByAsset[asset];
  const spendable = floorDec(Math.max(0, avail - KEEP[asset]), asset);

  const amtNum = Number(amount);
  const exceeds = Number.isFinite(amtNum) && (amtNum > spendable + (1 / scale(asset)) * 0.000001);

  const setMax = () => {
    setQuote(null);
    setAmount(spendable.toFixed(DECS[asset]));
  };

  const doQuote = async () => {
    if (!Number(amount)) return;
    if (exceeds) {
      setAmount(spendable.toFixed(DECS[asset]));
      return;
    }
    setBusy(true);
    try {
      const r = await authFetch("/sc/deposit/quote", {
        method: "POST",
        body: JSON.stringify({ asset, amount: Number(amount) }),
      });
      const j = await r.json();
      if (!r.ok) {
        if (j?.max_spendable != null) {
          setAmount(Number(j.max_spendable).toFixed(DECS[asset]));
        }
        throw new Error(j?.message || "Quote failed");
      }
      setQuote(j);
    } catch (e) {
      alert(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const doConvert = async () => {
    if (!quote || exceeds) return;
    setBusy(true);
    try {
      const r = await authFetch("/sc/deposit/credit", {
        method: "POST",
        body: JSON.stringify({ asset, amount: Number(amount) }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.message || "Convert failed");
      setAmount("");
      setQuote(null);
      onConverted && onConverted();
      alert(`Credited ${j.credited_sc} SC`);
    } catch (e) {
      alert(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const balText =
    asset === "XLM" ? `${avail.toFixed(6)} XLM` :
    asset === "XRP" ? `${avail.toFixed(6)} XRP` :
    `${avail.toFixed(6)} ETH`;

  return (
    <div className="p-3" style={{ background: "#0b1220", borderRadius: 6, border: "1px solid #1f2a36" }}>
      <div className="mb-2" style={{ color: "#9fb1c6" }}><strong>Convert Crypto ➜ SC</strong></div>
      <div className="small mb-2" style={{ color: "#cfe3ff" }}>
        Balance: {balText} &nbsp;|&nbsp; Max spendable: <strong>
          {spendable.toFixed(DECS[asset])} {asset}
        </strong>
      </div>
      <div className="d-flex flex-wrap gap-2 mb-2">
        <BsButton size="sm" variant={asset==="XLM"?"primary":"outline-light"} onClick={()=>{ setAsset("XLM"); setQuote(null); }}>XLM</BsButton>
        <BsButton size="sm" variant={asset==="XRP"?"primary":"outline-light"} onClick={()=>{ setAsset("XRP"); setQuote(null); }}>XRP</BsButton>
        <BsButton size="sm" variant={asset==="ETH"?"primary":"outline-light"} onClick={()=>{ setAsset("ETH"); setQuote(null); }}>ETH</BsButton>
      </div>
      <div className="mb-1 d-flex gap-2">
        <input
          className={`form-control form-control-sm ${exceeds ? "is-invalid" : ""}`}
          type="number" min="0" step="any"
          placeholder={`Amount in ${asset}`}
          value={amount}
          onChange={(e)=>{ setAmount(e.target.value); setQuote(null); }}
        />
        <BsButton size="sm" variant="secondary" onClick={setMax} disabled={busy}>Max</BsButton>
        <BsButton size="sm" variant="info" onClick={doQuote} disabled={busy || !Number(amount)}>Quote</BsButton>
      </div>
      {exceeds && (
        <div className="small text-danger mb-2">
          Over the spendable limit. Max: {spendable.toFixed(DECS[asset])} {asset}
        </div>
      )}
      {quote && !exceeds && (
        <div className="small mb-2" style={{ color: "#cfe3ff" }}>
          Rate: ${quote.usd_price.toFixed(4)} / {quote.asset} &nbsp;|&nbsp; You’ll get <strong>{quote.sc.toFixed(4)} SC</strong>
        </div>
      )}
      <BsButton size="sm" variant="success" onClick={doConvert} disabled={!quote || busy || exceeds}>Convert to SC</BsButton>
    </div>
  );
}

/* -------------------- Withdraw: SC to crypto -------------------- */
function WithdrawSC({ defaultXLM, defaultXRP, defaultETH, onDone }) {
  const [asset, setAsset] = useState("XRP");
  const [sc, setSc] = useState("");
  const [to, setTo] = useState("");
  const [quote, setQuote] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (asset === "XLM") setTo(defaultXLM || "");
    if (asset === "XRP") setTo(defaultXRP || "");
    if (asset === "ETH") setTo(defaultETH || "");
    setQuote(null);
  }, [asset, defaultXLM, defaultXRP, defaultETH]);

  const setMax = async () => {
    try {
      const r = await authFetch("/balance");
      const j = await r.json().catch(()=>({ sc_balance: 0 }));
      const bal = Number(j.sc_balance) || 0;
      setSc(bal.toFixed(2));
      setQuote(null);
    } catch {}
  };

  const doQuote = async () => {
    setBusy(true);
    try {
      const r = await authFetch("/sc/withdraw/quote", {
        method: "POST",
        body: JSON.stringify({ asset, sc: Number(sc) }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.message || "Quote failed");
      const balRes = await authFetch("/balance");
      const balJ = await balRes.json().catch(()=>({sc_balance:0}));
      if ((Number(balJ.sc_balance)||0) < (Number(sc)||0)) {
        j.note = "You don’t have enough SC to withdraw that amount.";
      }
      setQuote(j);
    } catch (e) {
      alert(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const doRedeem = async () => {
    if (!quote) return;
    setBusy(true);
    try {
      const r = await authFetch("/sc/withdraw/redeem", {
        method: "POST",
        body: JSON.stringify({ asset, sc: Number(sc), to: to || undefined }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.message || "Withdraw failed");
      alert(`Withdrew ${j.amount} ${j.asset}\nTX: ${j.tx_hash || "(n/a)"}`);
      setSc("");
      setQuote(null);
      onDone && onDone();
    } catch (e) {
      alert(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-3" style={{ background: "#0b1220", borderRadius: 6, border: "1px solid #1f2a36" }}>
      <div className="mb-2" style={{ color: "#9fb1c6" }}><strong>Withdraw SC ➜ Crypto</strong></div>

      <div className="d-flex flex-wrap gap-2 mb-2">
        <BsButton size="sm" variant={asset==="XRP"?"primary":"outline-light"} onClick={()=>setAsset("XRP")}>XRP</BsButton>
        <BsButton size="sm" variant={asset==="XLM"?"primary":"outline-light"} onClick={()=>setAsset("XLM")}>XLM</BsButton>
        <BsButton size="sm" variant={asset==="ETH"?"primary":"outline-light"} onClick={()=>setAsset("ETH")}>ETH</BsButton>
      </div>

      <div className="mb-2">
        <label className="small mb-1">Destination ({asset})</label>
        <input className="form-control form-control-sm" placeholder={`Defaults to your saved ${asset} address`} value={to} onChange={(e)=>setTo(e.target.value)} />
      </div>

      <div className="d-flex gap-2 mb-2">
        <input className="form-control form-control-sm" type="number" min="0" step="any" placeholder="Amount in SC" value={sc} onChange={(e)=>setSc(e.target.value)} />
        <BsButton size="sm" variant="secondary" onClick={setMax}>Max</BsButton>
        <BsButton size="sm" variant="info" onClick={doQuote} disabled={busy || !sc}>Quote</BsButton>
      </div>

      {quote && (
        <div className="small mb-2" style={{ color: "#cfe3ff" }}>
          Rate: ${quote.usd_price.toFixed(4)} / {quote.asset} &nbsp;|&nbsp; You’ll receive <strong>{quote.asset_amount} {quote.asset}</strong>
          {quote.note && <div className="text-warning mt-1">{quote.note}</div>}
        </div>
      )}

      <BsButton size="sm" variant="success" onClick={doRedeem} disabled={!quote || busy}>Withdraw</BsButton>
    </div>
  );
}