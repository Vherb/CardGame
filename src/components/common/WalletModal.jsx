import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Tabs, Tab, Button as BsButton } from "react-bootstrap";
import * as xrpl from "xrpl";
import { Keypair, Networks } from "@stellar/stellar-base";
import { ethers } from "ethers";

// Local API helpers (keep self-contained)
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

function isAuthed() {
  return !!localStorage.getItem("token") && !!localStorage.getItem("username");
}

export default function WalletModal({ show, onHide }) {
  const [authed, setAuthed] = useState(isAuthed());
  const [profile, setProfile] = useState(null);

  // Balances and addresses
  const [scBalance, setScBalance] = useState(0);
  const [poolSC, setPoolSC] = useState(0);

  const [xlmBalance, setXlmBalance] = useState(0);
  const [publicKey, setPublicKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const publicKeyRef = useRef(publicKey);
  useEffect(() => { publicKeyRef.current = publicKey; }, [publicKey]);

  const [xrpAddress, setXrpAddress] = useState("");
  const [xrpSecret, setXrpSecret] = useState("");
  const [xrpBalance, setXrpBalance] = useState(0);

  const [ethAddress, setEthAddress] = useState("");
  const [ethBalance, setEthBalance] = useState(0);

  const [walletMsg, setWalletMsg] = useState("");

  const fetchProfile = useCallback(async () => {
    if (!authed) { setProfile(null); return; }
    try {
      const me = await authFetch("/me");
      if (me.ok) {
        const data = await me.json();
        setProfile(data);
        if (data.public_key) setPublicKey(data.public_key);
        if (data.sc_balance != null) setScBalance(Number(data.sc_balance) || 0);
        const xlm = ("xlm_balance" in data) ? data.xlm_balance : data.sc_balance;
        if (xlm != null) setXlmBalance(Number(xlm) || 0);
        if (data.xrp_address) setXrpAddress(data.xrp_address);
        if (data.xrp_balance != null) setXrpBalance(Number(data.xrp_balance) || 0);
        if (data.eth_address) setEthAddress(data.eth_address);
        if (data.eth_balance != null) setEthBalance(Number(data.eth_balance) || 0);
      }
    } catch {}
  }, [authed]);

  const loadScBalance = useCallback(async () => {
    try {
      const r = await authFetch("/balance");
      const j = await r.json().catch(()=>({}));
      setScBalance(Number(j.sc_balance) || 0);
      try { window.dispatchEvent(new Event('balance:update')); } catch {}
    } catch {}
  }, []);

  const fetchScPool = useCallback(async () => {
    try {
      const r = await authFetch("/jackpot/sc");
      if (!r.ok) return;
      const j = await r.json();
      setPoolSC(Number(j.pool_sc) || 0);
    } catch {}
  }, []);

  // XRPL helpers
  const xrplClientRef = useRef(null);
  const ensureXrpl = async () => {
    if (xrplClientRef.current && xrplClientRef.current.isConnected()) return xrplClientRef.current;
    const c = new xrpl.Client("wss://s.altnet.rippletest.net:51233");
    await c.connect();
    xrplClientRef.current = c;
    return c;
  };

  const createAndAttachXrpWallet = async () => {
    try {
      const c = await ensureXrpl(); void c;
      const w = xrpl.Wallet.generate();
      const address = w.address;
      const secret = w.seed;
      const res = await authFetch("/wallet/xrp", { method: "POST", body: JSON.stringify({ address, secret }) });
      const j = await res.json().catch(()=>({}));
      if (!res.ok) throw new Error(j?.message || "Attach failed");
      setXrpAddress(address);
      setXrpSecret(secret);
      localStorage.setItem("xrpSecret", secret);
      alert("XRPL wallet created & attached.");
      await authFetch("/balance/xrp/sync", { method: "POST" }).catch(()=>{});
      await fetchProfile();
    } catch (e) { alert(e.message || String(e)); }
  };

  const fundXrpFromFaucet = async () => {
    if (!xrpAddress) { alert("No XRP address yet."); return; }
    const r = await authFetch("/fund/xrp", { method: "POST" });
    const j = await r.json().catch(()=>({}));
    if (!r.ok) alert(j?.message || "XRPL faucet failed"); else alert("XRPL faucet sent test funds.");
    await authFetch("/balance/xrp/sync", { method: "POST" });
    await fetchProfile();
  };

  // ETH helpers
  const ETH_CHAIN_ID = 11155111; // Sepolia
  const ensureEth = async () => {
    if (!window.ethereum) throw new Error("MetaMask not found. Please install MetaMask.");
    const provider = new ethers.BrowserProvider(window.ethereum);
    const net = await provider.getNetwork();
    if (Number(net?.chainId) !== ETH_CHAIN_ID) {
      try {
        await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xaa36a7" }] });
      } catch { throw new Error("Please switch MetaMask to Sepolia."); }
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
      await authFetch("/balance/eth/sync", { method: "POST" });
      await fetchProfile();
    } catch (e) { alert(e.message || String(e)); }
  };

  const refreshEthBalance = async () => {
    if (!ethAddress) return;
    try {
      const provider = await ensureEth();
      const bal = await provider.getBalance(ethAddress);
      setEthBalance(Number(ethers.formatEther(bal)));
      await authFetch("/balance/eth/sync", { method: "POST" });
      await fetchProfile();
    } catch {}
  };

  // XLM
  const friendbotFund = async () => {
    const pub = publicKeyRef.current || profile?.public_key;
    if (!pub) { alert("No XLM address yet. Create your Stellar deposit address first."); return; }
    const res = await authFetch("/fund/xlm", { method: "POST" });
    const j = await res.json().catch(()=>({}));
    if (!res.ok) { alert(j?.detail || j?.message || "Friendbot failed"); }
    else { alert(j?.alreadyFunded ? "Account is already funded on testnet." : "Funded (testnet)." ); }
    await refreshXlmBalance();
  };

  const createAndAttachXlmAddress = async () => {
    if (profile?.public_key) { setWalletMsg("Wallet is already attached to your account."); return; }
    try {
      const kp = Keypair.random();
      const pub = kp.publicKey();
      const sec = kp.secret();
      const r = await authFetch("/wallet", { method: "POST", body: JSON.stringify({ public_key: pub, secret_key: sec }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.message || "Attach failed");
      setPublicKey(pub);
      setSecretKey(sec);
      setProfile((p) => ({ ...(p || {}), public_key: pub }));
      setWalletMsg("Deposit address created and attached to your account.");
      await fetchProfile();
    } catch (e) { setWalletMsg(`Failed to create address: ${e.message}`); }
  };

  const refreshXlmBalance = async () => {
    try { await authFetch("/balance/xlm/sync", { method: "POST" }); } catch {}
    try {
      const me2 = await authFetch("/me");
      if (me2.ok) {
        const d = await me2.json();
        const xlm = ("xlm_balance" in d) ? d.xlm_balance : d.sc_balance;
        setXlmBalance(Number(xlm) || 0);
      }
    } catch {}
  };

  // Convert and Withdraw subcomponents
  const onConverted = async () => {
    await loadScBalance();
    await refreshXlmBalance();
    await authFetch("/balance/xrp/sync", { method: "POST" }).catch(()=>{});
    await authFetch("/balance/eth/sync", { method: "POST" }).catch(()=>{});
    await fetchProfile();
    try { window.dispatchEvent(new Event('balance:update')); } catch {}
  };

  useEffect(() => {
    if (!show) return;
    setAuthed(isAuthed());
    fetchProfile();
    loadScBalance();
    fetchScPool();
  }, [show, fetchProfile, fetchScPool, loadScBalance]);

  const fmt6 = useMemo(() => (n) => (Number(n) || 0).toFixed(6), []);

  return (
    <Modal show={show} onHide={onHide} centered dialogClassName="wallet-dark" scrollable>
      <div style={{ background: "#12171d", color: "#e7efff", border: "1px solid #1f2a36", borderRadius: 6, maxHeight: "calc(100dvh - 24px)" }}>
        <Modal.Header closeButton style={{ borderBottom: "1px solid #1f2a36" }}>
          <Modal.Title>Wallet</Modal.Title>
        </Modal.Header>
        <Modal.Body style={{ maxHeight: "calc(100dvh - 180px)", overflowY: "auto", paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 8px)" }}>
          <Tabs defaultActiveKey="deposit" id="wallet-tabs" className="mb-3">
            <Tab eventKey="deposit" title="Deposit">
              <div className="wallet-mini-stats mb-3">
                <div><span className="mini-label">Stake Coins</span><span className="mini-value">{(Number(scBalance)||0).toFixed(2)} SC</span></div>
                <div><span className="mini-label">Jackpot Pool</span><span className="mini-value">{(Number(poolSC)||0).toFixed(2)} SC</span></div>
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
                      Mirror Balance: <strong>{fmt6(xlmBalance)} XLM</strong>
                    </div>
                  </>
                )}
              </div>

              {/* XRP Panel */}
              <div className="p-3 mb-3" style={{ background: "#0b1220", borderRadius: 6, border: "1px solid #1f2a36" }}>
                <div className="mb-2" style={{ color: "#9fb1c6" }}><strong>XRPL Testnet</strong></div>
                {!xrpAddress ? (
                  <>
                    <div className="small mb-2" style={{ color: "#9fb1c6" }}>Create an XRPL testnet wallet (address + secret). Secret is stored server-side for dev.</div>
                    <BsButton size="sm" variant="success" onClick={createAndAttachXrpWallet}>Create XRPL Wallet</BsButton>
                  </>
                ) : (
                  <>
                    <div className="small" style={{ color: "#cfe3ff" }}>
                      Address: <code>{xrpAddress}</code><br/>
                      Secret: <code>{xrpSecret ? "(hidden in DB)" : "(stored in DB)"}</code><br/>
                      Mirror Balance: <strong>{fmt6(xrpBalance)} XRP</strong>
                    </div>
                    <div className="d-flex gap-2 mt-2">
                      <BsButton size="sm" variant="warning" onClick={fundXrpFromFaucet}>Faucet</BsButton>
                      <BsButton size="sm" variant="outline-light" onClick={async () => {
                        await authFetch("/balance/xrp/sync", { method: "POST" }).catch(()=>{});
                        await fetchProfile();
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
                  Mirror Balance: <strong>{fmt6(ethBalance)} ETH</strong>
                </div>
              </div>

              <ConvertToSC xlmBalance={xlmBalance} xrpBalance={xrpBalance} ethBalance={ethBalance} onConverted={onConverted} />
            </Tab>

            <Tab eventKey="withdraw" title="Withdraw">
              <WithdrawSC
                defaultXLM={publicKey || profile?.public_key || ""}
                defaultXRP={xrpAddress || ""}
                defaultETH={ethAddress || ""}
                onDone={async () => { await loadScBalance(); }}
              />
            </Tab>
          </Tabs>
        </Modal.Body>
      </div>
    </Modal>
  );
}

function ConvertToSC({ xlmBalance, xrpBalance, ethBalance, onConverted }) {
  const [asset, setAsset] = useState("XLM");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState(null);
  const [busy, setBusy] = useState(false);

  const KEEP = { XLM: 1.50005, XRP: 10.00001, ETH: 0 };
  const DECS = { XLM: 6, XRP: 6, ETH: 6 };
  const scale = (a) => 10 ** DECS[a];
  const floorDec = (n, a) => Math.floor((Number(n) || 0) * scale(a)) / scale(a);

  const balByAsset = { XLM: Number(xlmBalance) || 0, XRP: Number(xrpBalance) || 0, ETH: Number(ethBalance) || 0 };
  const avail = balByAsset[asset];
  const spendable = floorDec(Math.max(0, avail - KEEP[asset]), asset);

  const exceeds = Number(amount) > spendable + (1 / scale(asset)) * 0.000001;

  const setMax = () => { setQuote(null); setAmount(spendable.toFixed(DECS[asset])); };

  const doQuote = async () => {
    if (!Number(amount)) return;
    if (exceeds) { setAmount(spendable.toFixed(DECS[asset])); return; }
    setBusy(true);
    try {
      const r = await authFetch("/sc/deposit/quote", { method: "POST", body: JSON.stringify({ asset, amount: Number(amount) }) });
      const j = await r.json();
      if (!r.ok) {
        if (j?.max_spendable != null) setAmount(Number(j.max_spendable).toFixed(DECS[asset]));
        throw new Error(j?.message || "Quote failed");
      }
      setQuote(j);
    } catch (e) { alert(e.message || String(e)); } finally { setBusy(false); }
  };

  const doConvert = async () => {
    if (!quote || exceeds) return;
    setBusy(true);
    try {
      const r = await authFetch("/sc/deposit/credit", { method: "POST", body: JSON.stringify({ asset, amount: Number(amount) }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.message || "Convert failed");
      setAmount(""); setQuote(null);
      onConverted && onConverted();
      alert(`Credited ${j.credited_sc} SC`);
    } catch (e) { alert(e.message || String(e)); } finally { setBusy(false); }
  };

  return (
    <div className="p-3" style={{ background: "#0b1220", borderRadius: 6, border: "1px solid #1f2a36" }}>
      <div className="mb-2" style={{ color: "#9fb1c6" }}><strong>Convert Crypto ➜ SC</strong></div>
      <div className="small mb-2" style={{ color: "#cfe3ff" }}>
        Balance: {asset === "XLM" ? `${(avail||0).toFixed(6)} XLM` : asset === "XRP" ? `${(avail||0).toFixed(6)} XRP` : `${(avail||0).toFixed(6)} ETH`} &nbsp;|&nbsp; Max spendable: <strong>{spendable.toFixed(DECS[asset])} {asset}</strong>
      </div>
      <div className="d-flex flex-wrap gap-2 mb-2">
        <BsButton size="sm" variant={asset==="XLM"?"primary":"outline-light"} onClick={()=>{ setAsset("XLM"); setQuote(null); }}>XLM</BsButton>
        <BsButton size="sm" variant={asset==="XRP"?"primary":"outline-light"} onClick={()=>{ setAsset("XRP"); setQuote(null); }}>XRP</BsButton>
        <BsButton size="sm" variant={asset==="ETH"?"primary":"outline-light"} onClick={()=>{ setAsset("ETH"); setQuote(null); }}>ETH</BsButton>
      </div>
      <div className="mb-1 d-flex gap-2">
        <input className={`form-control form-control-sm ${exceeds ? "is-invalid" : ""}`} type="number" min="0" step="any" placeholder={`Amount in ${asset}`} value={amount} onChange={(e)=>{ setAmount(e.target.value); setQuote(null); }} />
        <BsButton size="sm" variant="secondary" onClick={setMax} disabled={busy}>Max</BsButton>
        <BsButton size="sm" variant="info" onClick={doQuote} disabled={busy || !Number(amount)}>Quote</BsButton>
      </div>
      {exceeds && (
        <div className="small text-danger mb-2">Over the spendable limit. Max: {spendable.toFixed(DECS[asset])} {asset}</div>
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
      const r = await authFetch("/sc/withdraw/quote", { method: "POST", body: JSON.stringify({ asset, sc: Number(sc) }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.message || "Quote failed");
      const balRes = await authFetch("/balance");
      const balJ = await balRes.json().catch(()=>({sc_balance:0}));
      if ((Number(balJ.sc_balance)||0) < (Number(sc)||0)) { j.note = "You don’t have enough SC to withdraw that amount."; }
      setQuote(j);
    } catch (e) { alert(e.message || String(e)); } finally { setBusy(false); }
  };

  const doRedeem = async () => {
    if (!quote) return;
    setBusy(true);
    try {
      const r = await authFetch("/sc/withdraw/redeem", { method: "POST", body: JSON.stringify({ asset, sc: Number(sc), to: to || undefined }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.message || "Withdraw failed");
      alert(`Withdrew ${j.amount} ${j.asset}\nTX: ${j.tx_hash || "(n/a)"}`);
      setSc(""); setQuote(null);
      onDone && onDone();
    } catch (e) { alert(e.message || String(e)); } finally { setBusy(false); }
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
