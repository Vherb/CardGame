import React from 'react';
import { Link, useLocation } from 'react-router-dom';

// A compact, mobile-only bottom nav to jump between games.
// It updates --footer-h so content and floating UI respect the bar height.
export default function MobileBottomNav() {
  const ref = React.useRef(null);
  const { pathname } = useLocation();

  const updateHeight = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    try {
      const style = window.getComputedStyle(el);
      const hidden = style?.display === 'none' || style?.visibility === 'hidden';
      if (hidden) return; // Don't claim space if not visible
    } catch {}
    const h = (ref.current?.offsetHeight || 0);
    try { document.documentElement.style.setProperty('--footer-h', h + 'px'); } catch {}
  }, []);

  React.useEffect(() => {
    updateHeight();
    let ro;
    try {
      ro = new ResizeObserver(updateHeight);
      if (ref.current) ro.observe(ref.current);
    } catch {}
    window.addEventListener('resize', updateHeight);
    return () => {
      window.removeEventListener('resize', updateHeight);
      try { ro && ro.disconnect(); } catch {}
    };
  }, [updateHeight]);

  const announceNavigate = React.useCallback((to) => {
    try { window.dispatchEvent(new CustomEvent('game:beforeNavigate', { detail: { to, ts: Date.now() } })); } catch {}
  }, []);

  const Item = ({ to, label, icon }) => {
    const active = pathname === to;
    return (
      <Link
        to={to}
        className={`mbn-item ${active ? 'active' : ''}`}
        aria-current={active ? 'page' : undefined}
        onMouseDown={() => announceNavigate(to)}
        onTouchStart={() => announceNavigate(to)}
      >
        <span className="mbn-ico" aria-hidden>
          {icon}
        </span>
        <span className="mbn-label">{label}</span>
      </Link>
    );
  };

  return (
    <nav ref={ref} className="mobile-bottom-nav" role="navigation" aria-label="Game shortcuts">
  <Item to="/roll-of-cards" label="In-Between" icon={<span>🃏</span>} />
      <Item to="/connect-four" label="C4" icon={<span>⦿</span>} />
      <Item to="/checkers" label="Checkers" icon={<span>⛀</span>} />
      <Item to="/chess" label="Chess" icon={<span>♟︎</span>} />
      <Item to="/3d-chess" label="3D-Chess" icon={<span>♜</span>} />
    </nav>
  );
}
