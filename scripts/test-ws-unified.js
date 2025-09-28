// Usage: node scripts/test-ws-unified.js ws://localhost:3002/ws/chess
const WebSocket = require('ws');

const url = process.argv[2] || 'ws://localhost:3002/ws/chess';
console.log('[test] connecting to', url);
const ws = new WebSocket(url);
ws.on('open', () => {
  console.log('[test] open');
  try { ws.send(JSON.stringify({ type:'setUsername', username:'Tester' })); } catch {}
  try { ws.send(JSON.stringify({ type:'joinGame', username:'Tester' })); } catch {}
});
ws.on('message', (buf) => {
  let m; try { m = JSON.parse(buf.toString()); } catch { m = buf.toString(); }
  if (m && m.type) console.log('[test] msg', m.type);
  else console.log('[test] msg', m);
  if (m && (m.type==='countdown' || m.type==='startGame' || m.type==='paired')){
    // Success criteria reached; exit shortly
    setTimeout(()=>{ try{ ws.close(); }catch{}; process.exit(0); }, 250);
  }
});
ws.on('error', (e) => { console.error('[test] error', e.message); process.exit(1); });
ws.on('close', () => { console.log('[test] close'); });
