// Build-time feature flags (Create React App reads REACT_APP_* at build time)
// Usage:
//   REACT_APP_DISABLE_GAMES=war,battleship npm run build
// or
//   REACT_APP_HIDE_WAR=1 REACT_APP_HIDE_BATTLESHIP=1 npm run build

function getDisabledSet() {
  const set = new Set();
  const list = (process.env.REACT_APP_DISABLE_GAMES || '').toLowerCase();
  if (list) list.split(/[\s,]+/).filter(Boolean).forEach((g) => set.add(g));
  if ((process.env.REACT_APP_HIDE_WAR || '').trim()) set.add('war');
  if ((process.env.REACT_APP_HIDE_BATTLESHIP || '').trim()) set.add('battleship');
  return set;
}

const DISABLED = getDisabledSet();

export function isGameEnabled(name) {
  return !DISABLED.has(String(name || '').toLowerCase());
}

export const ENABLE_WAR = isGameEnabled('war');
export const ENABLE_BATTLESHIP = isGameEnabled('battleship');
