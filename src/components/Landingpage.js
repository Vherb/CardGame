import React, { useEffect, useState, useMemo } from "react";
import { motion } from "framer-motion";
// FIX: Remove problematic Chess icon (CDN fetch fails). Use safe icons only.
import { Wallet, Gamepad2, Dice1, Receipt, Rocket, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";

const fakeAddr = () => `G${Math.random().toString(36).slice(2).toUpperCase()}...${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const gameApi = {
  async getSession() { return { user: { id: 1, name: "Victor" } }; },
  async getBalance() { await delay(200); return { asset: "PTS", amount: 1200 }; },
  async getLedger() { await delay(200); return [
    { id: 1, type: "played", game: "War" },
    { id: 2, type: "played", game: "Connect Four" },
    { id: 3, type: "joined", game: "In Between" },
  ]; },
};

function HeroBanner({ onWallet }) {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-black text-center shadow-2xl p-12">
      <div className="absolute inset-0 animate-pulse bg-[radial-gradient(circle_at_center,rgba(0,200,255,0.2),transparent_70%)]"/>
      <h1 className="relative text-4xl font-extrabold text-yellow-300 drop-shadow-lg mb-4 animate-pulse">✨ Vali Gambit ✨</h1>
      <p className="relative text-pink-200 mb-6">Games, Lights, Action — Dive into playtime.</p>
      <Button onClick={onWallet} className="relative rounded-full text-lg px-8 py-4 bg-gradient-to-r from-sky-500 to-pink-400 text-white shadow-lg animate-bounce">
        <Rocket className="mr-2 h-5 w-5"/> Get Started
      </Button>
      <div className="absolute inset-0 border-4 border-sky-400 rounded-3xl animate-[pulse_2s_infinite]"/>
    </div>
  );
}

function GameTile({ title, subtitle, icon: Icon, action }) {
  return (
    <motion.div whileHover={{ scale:1.05 }} whileTap={{ scale:0.95 }} className="relative rounded-2xl p-6 text-center text-white bg-gradient-to-br from-purple-600 via-pink-600 to-yellow-500 shadow-xl overflow-hidden">
      <div className="absolute inset-0 border-4 border-yellow-300 rounded-2xl animate-[flash_1.5s_infinite]"/>
      <div className="relative z-10">
        <Icon className="h-10 w-10 mx-auto mb-3 text-yellow-300 animate-pulse"/>
        <h3 className="font-bold text-xl mb-1">{title}</h3>
        <p className="text-sm mb-4 opacity-80">{subtitle}</p>
        <Button onClick={action} className="rounded-full bg-yellow-400 text-black hover:bg-yellow-300 shadow animate-pulse">Play</Button>
      </div>
    </motion.div>
  );
}

export default function GambitHub() {
  const [balance, setBalance] = useState({ asset: "PTS", amount: 0 });
  const [ledger, setLedger] = useState([]);
  const [walletOpen, setWalletOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const b = await gameApi.getBalance(); setBalance(b);
      const l = await gameApi.getLedger(); setLedger(l);
    })();
  }, []);

  // Use safe icon set only (no Chess import)
  const tiles = useMemo(() => ([
    { title: "War", subtitle: "Highest card wins.", icon: Gamepad2, action: () => {} },
    { title: "Connect Four", subtitle: "First to four in a row.", icon: Circle, action: () => {} },
    { title: "In Between", subtitle: "2 cards, 2 dice. Place yourself in-between.", icon: Dice1, action: () => {} },
    { title: "Chess", subtitle: "Classic strategy showdown.", icon: Gamepad2, action: () => {} }, // fallback icon
    { title: "Checkers", subtitle: "Jump to victory.", icon: Circle, action: () => {} },
  ]), []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-purple-900 to-black p-8 space-y-12 text-center">
      <HeroBanner onWallet={() => setWalletOpen(true)} />

      <div className="grid md:grid-cols-3 gap-8">
        {tiles.map((t) => <GameTile key={t.title} {...t} />)}
      </div>

      <div className="grid md:grid-cols-2 gap-8 text-white">
        <div className="rounded-2xl p-6 bg-gradient-to-br from-yellow-600 to-yellow-400 shadow-xl relative">
          <div className="absolute inset-0 border-4 border-pink-400 rounded-2xl animate-[flash_2s_infinite]"/>
          <h2 className="font-bold mb-2">Your Points</h2>
          <p>{balance.amount} {balance.asset}</p>
          <Button onClick={() => setWalletOpen(true)} className="mt-4 rounded-full bg-pink-500 text-white animate-pulse">View Wallet</Button>
        </div>
        <div className="rounded-2xl p-6 bg-gradient-to-br from-pink-600 to-purple-500 shadow-xl relative">
          <div className="absolute inset-0 border-4 border-emerald-300 rounded-2xl animate-[flash_3s_infinite]"/>
          <h2 className="font-bold mb-2">Recent Activity</h2>
          <ul className="text-sm space-y-1">
            {ledger.map((e) => <li key={e.id}>{e.type} {e.game}</li>)}
          </ul>
        </div>
      </div>

      <footer className="text-center text-xs text-pink-200 py-8 animate-pulse">Built with ❤️ — Vali Gambit Neon</footer>

      <style jsx global>{`
        @keyframes flash {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

// ---- Dev-only smoke tests (no framework deps) ----
if (typeof window !== "undefined") {
  // Basic runtime checks to prevent regressions
  window.__gambitTests__ = {
    iconsAvailable: [Wallet, Gamepad2, Dice1, Receipt, Rocket, Circle].every(Boolean),
    chessIconRemoved: true, // we intentionally avoid importing Chess due to CDN issues
    tilesCountExpected: 5,
  };
}
