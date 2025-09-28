import React, { useEffect, useMemo, useRef, useState } from 'react';

const PRESETS = [
  'Good luck!','Well played!','Nice move!','Oops!','Brb','GG','Rematch?','Good game','Hello!','Thanks!'
];

export default function QuickChat({ onSend, messages = [], youKey = 'you', align = 'right', fixed = false, offsetTop, canSend = true }){
  const [open, setOpen] = useState(false);
  const [cooldownMs, setCooldownMs] = useState(0);
  const [draft, setDraft] = useState('');
  const [visible, setVisible] = useState(false);
  const spamRef = useRef({ times: [], timer: null, hideTimer: null });
  const isMobile = useMemo(()=>{
    try{ return typeof window!== 'undefined' && (window.matchMedia('(pointer:coarse)').matches || window.matchMedia('(max-width: 640px)').matches); }catch{return false;}
  },[]);
  const feedRef = useRef(null);         // floating feed
  const sheetFeedRef = useRef(null);    // feed inside bottom sheet
  useEffect(() => {
    // Scroll whichever feed is visible
    try {
      if (open && sheetFeedRef.current) {
        sheetFeedRef.current.scrollTop = sheetFeedRef.current.scrollHeight;
      } else if (feedRef.current) {
        feedRef.current.scrollTop = feedRef.current.scrollHeight;
      }
    } catch {}
    // Mobile: when sheet is closed, show floating feed briefly on new messages, then auto-hide
    try {
      if (isMobile && !open) {
        setVisible(true);
        if (spamRef.current.hideTimer) clearTimeout(spamRef.current.hideTimer);
        spamRef.current.hideTimer = setTimeout(()=> setVisible(false), 6000);
      }
    } catch {}
  }, [messages]);
  const wrapStyle = {};
  if (align === 'right' || align === 'left') {
    if (typeof offsetTop === 'number') wrapStyle.top = `${offsetTop}px`;
    else if (typeof offsetTop === 'string') wrapStyle.top = offsetTop;
  }
  // Mobile UX: FAB + bottom sheet with presets and feed at bottom
  if (isMobile) {
    const handleSend = (t) => {
      if (cooldownMs > 0 || !canSend) return;
      const now = Date.now();
      const times = spamRef.current.times.filter(ts => now - ts < 3000);
      times.push(now); spamRef.current.times = times;
      if (times.length >= 4) {
        setCooldownMs(5000);
        const tmr = setInterval(()=>{
          setCooldownMs(ms => {
            const nxt = Math.max(0, ms - 1000);
            if (nxt === 0) clearInterval(tmr);
            return nxt;
          });
        }, 1000);
        return;
      }
      onSend?.(t);
    };
    const handleSendDraft = ()=>{
      const t = (draft || '').trim().slice(0, 160);
      if (!t) return;
      handleSend(t);
      setDraft('');
    };
    const openSheet = ()=> setOpen(true);
    const closeSheet = ()=>{
      setOpen(false);
      try{
        setVisible(true);
        if (spamRef.current.hideTimer) clearTimeout(spamRef.current.hideTimer);
        spamRef.current.hideTimer = setTimeout(()=> setVisible(false), 6000);
      }catch{}
    };
    const toggleSheet = ()=>{ if (open) closeSheet(); else openSheet(); };
    return (
      <>
        <button type="button" aria-label="Quick chat" className={`qc-fab ${open ? 'is-open' : ''}`} onClick={toggleSheet}>
          <span aria-hidden>💬</span>
        </button>
        {open && (
          <div className="qc-sheet">
            <div className="qc-sheet-hdr">
              <span>Quick Chat</span>
              <button className="qc-x" onClick={closeSheet} aria-label="Close chat">×</button>
            </div>
            <div className="qc-sheet-feed" ref={sheetFeedRef}>
              {messages.slice(-4).map((m, i) => (
                <div key={i} className={`qc-bubble ${m.from===youKey?'qc-you':'qc-opp'}`}>
                  <span className="qc-name">{m.username || (m.from===youKey?'You':'Opponent')}:</span>
                  <span className="qc-text">{m.text}</span>
                </div>
              ))}
            </div>
            <div className="qc-input-row">
              <input
                type="text"
                className="qc-input"
                value={draft}
                maxLength={160}
                placeholder={cooldownMs>0?`Wait ${Math.ceil(cooldownMs/1000)}s…`:(!canSend?'Connecting…':'Type a message…')}
                onChange={(e)=> setDraft(e.target.value)}
                onKeyDown={(e)=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); handleSendDraft(); } }}
                disabled={cooldownMs>0 || !canSend}
              />
              <button type="button" className="qc-send" onClick={handleSendDraft} disabled={cooldownMs>0 || !canSend || !draft.trim()}>Send</button>
            </div>
            <div className="qc-row qc-row-mobile">
              {PRESETS.map((t) => (
                <button key={t} type="button" className="qc-btn" onClick={() => handleSend(t)} disabled={cooldownMs>0 || !canSend}>
                  {t}
                </button>
              ))}
            </div>
            {cooldownMs>0 && (
              <div className="qc-hint">Please wait {Math.ceil(cooldownMs/1000)}s before sending more.</div>
            )}
          </div>
        )}
        {!open && (
          <div className={`qc-feed-float ${visible? 'is-visible':'is-hidden'}`} ref={feedRef}>
            {messages.slice(-4).map((m, i) => (
              <div key={i} className={`qc-bubble ${m.from===youKey?'qc-you':'qc-opp'}`}>
                <span className="qc-name">{m.username || (m.from===youKey?'You':'Opponent')}:</span>
                <span className="qc-text">{m.text}</span>
              </div>
            ))}
          </div>
        )}
        <style>{`
          .qc-fab{position:fixed;right:.9rem;bottom:calc(var(--footer-h,52px) + env(safe-area-inset-bottom, 0px) + 10px);width:56px;height:56px;border-radius:50%;border:1px solid var(--btn-border);background:var(--btn-bg);color:var(--btn-text);display:grid;place-items:center;box-shadow:0 6px 22px rgba(0,0,0,.25);z-index:5000;font-size:1.35rem}
          .qc-fab:active{transform:scale(.98)}
          .qc-sheet{position:fixed;left:0;right:0;bottom:calc(var(--footer-h,52px) + env(safe-area-inset-bottom, 0px));background:var(--panel-bg);border-top-left-radius:14px;border-top-right-radius:14px;padding:.6rem .8rem .7rem;box-shadow:0 -8px 28px rgba(0,0,0,.25);z-index:4999;backdrop-filter:saturate(1.05) blur(6px)}
          .qc-sheet-hdr{display:flex;justify-content:space-between;align-items:center;color:var(--text);font-weight:800;margin-bottom:.5rem}
          .qc-sheet-feed{max-height:35vh;overflow:auto;display:flex;flex-direction:column;gap:.35rem;margin-bottom:.55rem}
          .qc-x{appearance:none;background:transparent;border:none;color:var(--muted);font-size:1.5rem;line-height:1;padding:.1rem .3rem;border-radius:.35rem}
          .qc-row{display:flex;gap:.4rem;flex-wrap:wrap}
          .qc-row-mobile{justify-content:flex-start}
          .qc-btn{appearance:none;border:1px solid var(--btn-border);border-radius:.8rem;background:var(--btn-bg);color:var(--btn-text) !important;padding:.55rem .8rem;font-size:.95rem;line-height:1;font-weight:900;letter-spacing:.01em;box-shadow:0 6px 18px rgba(0,0,0,.2), inset 0 1px 0 rgba(255,255,255,.04)}
          .qc-btn:active{transform:translateY(1px)}
          .qc-input-row{display:flex;gap:.45rem;align-items:center;margin-top:.55rem}
          .qc-input{flex:1;min-width:0;appearance:none;border:1px solid var(--input-border);border-radius:.6rem;background:var(--input-bg);color:var(--input-text);padding:.55rem .6rem;font-size:1rem}
          .qc-input::placeholder{color:var(--input-placeholder)}
          .qc-send{appearance:none;border:1px solid var(--btn-outline);border-radius:.6rem;background:var(--btn-bg);color:var(--btn-text);font-weight:900;padding:.5rem .75rem}
          .qc-hint{color:var(--text);opacity:.9;font-weight:800;margin-top:.5rem}
          .qc-feed{display:flex;flex-direction:column;gap:.35rem;overflow:auto;scroll-behavior:smooth}
          .qc-feed-float{position:fixed;left:.65rem;bottom:calc(var(--footer-h,52px) + env(safe-area-inset-bottom, 0px) + 8px);max-width:min(320px, 68vw);max-height:40vh;overflow:auto;z-index:4202;padding:.35rem;display:flex;flex-direction:column;gap:.3rem;pointer-events:none;}
          .qc-feed-float.is-hidden{opacity:0;transition:opacity .3s ease}
          .qc-feed-float.is-visible{opacity:1;transition:opacity .15s ease}
          .qc-bubble{background:var(--card-bg);color:var(--text);border:1px solid var(--card-border);padding:.3rem .55rem;border-radius:.55rem;font-size:.9rem;box-shadow:0 8px 20px rgba(0,0,0,.18)}
          .qc-bubble.qc-you{background:linear-gradient(180deg, rgba(0,0,0,0.02), rgba(0,0,0,0.06)), var(--card-bg);border-color:var(--divider);}
          .qc-name{opacity:.95;margin-right:.4rem;font-weight:800}
        `}</style>
      </>
    );
  }
  // Desktop/tablet: existing side panel UI
  return (
    <div className={`qc-wrap qc-${align} ${fixed ? 'qc-fixed' : ''}`} style={wrapStyle}>
      <div className="qc-row">
        {PRESETS.map((t) => (
          <button key={t} type="button" className="qc-btn" onClick={() => onSend?.(t)}>
            {t}
          </button>
        ))}
      </div>
      <div className="qc-feed" ref={feedRef}>
        {messages.map((m, i) => (
          <div key={i} className={`qc-bubble ${m.from===youKey?'qc-you':'qc-opp'}`}>
            <span className="qc-name">{m.username || (m.from===youKey?'You':'Opponent')}:</span>
            <span className="qc-text">{m.text}</span>
          </div>
        ))}
      </div>
      <DesktopInput
        draft={draft}
        setDraft={setDraft}
        cooldownMs={cooldownMs}
        setCooldownMs={setCooldownMs}
        spamRef={spamRef}
        onSend={onSend}
      />
      <style>{`
        .qc-wrap{position:absolute;pointer-events:auto;z-index:30}
        .qc-wrap.qc-fixed{position:fixed}
        /* Side panel layouts */
        .qc-right{top:.65rem;bottom:.65rem;right:.65rem;width:300px;display:flex;flex-direction:column;gap:.5rem}
        .qc-left{top:.65rem;bottom:.65rem;left:.65rem;width:300px;display:flex;flex-direction:column;gap:.5rem}
        /* Top/Bottom bar layouts (legacy) */
        .qc-bottom{left:0;right:0;bottom:.65rem;display:flex;flex-direction:column;gap:.45rem;align-items:center}
        .qc-top{left:0;right:0;top:.65rem;display:flex;flex-direction:column;gap:.45rem;align-items:center}
        .qc-row{display:flex;gap:.4rem;flex-wrap:wrap}
        .qc-right .qc-row, .qc-left .qc-row{justify-content:flex-start}
        .qc-bottom .qc-row, .qc-top .qc-row{justify-content:center}
        .qc-btn{appearance:none;border:1px solid var(--btn-border);border-radius:.8rem;background:var(--btn-bg);color:var(--btn-text);padding:.6rem .9rem;font-size:1rem;line-height:1;font-weight:900;letter-spacing:.01em;box-shadow:0 6px 18px rgba(0,0,0,.2), inset 0 1px 0 rgba(255,255,255,.04)}
        .qc-btn:hover{filter:brightness(1.03)}
        .qc-btn:focus{outline:2px solid var(--btn-outline); outline-offset:2px}
        .qc-feed{display:flex;flex-direction:column;gap:.35rem;overflow:auto;flex:1;scroll-behavior:smooth}
        .qc-right .qc-feed, .qc-left .qc-feed{max-height:100%}
        .qc-bottom .qc-feed, .qc-top .qc-feed{max-width:100%;align-items:center}
        .qc-bubble{background:var(--card-bg);color:var(--text);border:1px solid var(--card-border);padding:.3rem .55rem;border-radius:.55rem;font-size:.9rem;box-shadow:0 8px 20px rgba(0,0,0,.18);backdrop-filter:saturate(1.05) blur(2px)}
        .qc-bubble.qc-you{background:linear-gradient(180deg, rgba(0,0,0,0.02), rgba(0,0,0,0.06)), var(--card-bg);border-color:var(--divider)}
        .qc-name{opacity:.95;margin-right:.4rem;font-weight:800}
        .qc-input-row{display:flex;gap:.45rem;align-items:center;margin-top:.4rem}
        .qc-input{flex:1;min-width:0;appearance:none;border:1px solid var(--input-border);border-radius:.6rem;background:var(--input-bg);color:var(--input-text);padding:.5rem .6rem;font-size:1rem}
        .qc-input::placeholder{color:var(--input-placeholder)}
        .qc-send{appearance:none;border:1px solid var(--btn-outline);border-radius:.6rem;background:var(--btn-bg);color:var(--btn-text);font-weight:900;padding:.5rem .75rem}
        .qc-hint{color:var(--text);opacity:.9;font-weight:800;margin-top:.35rem}
        @media (max-width: 640px){ .qc-right,.qc-left{left:.65rem;right:.65rem;width:auto;top:auto;bottom:.65rem} }
      `}</style>
    </div>
  );
}

function DesktopInput({ draft, setDraft, cooldownMs, setCooldownMs, spamRef, onSend }){
  const handleSend = (t) => {
    if (cooldownMs > 0) return;
    const now = Date.now();
    const times = spamRef.current.times.filter(ts => now - ts < 3000);
    times.push(now); spamRef.current.times = times;
    if (times.length >= 4) {
      setCooldownMs(5000);
      const tmr = setInterval(()=>{
        setCooldownMs(ms => {
          const nxt = Math.max(0, ms - 1000);
          if (nxt === 0) clearInterval(tmr);
          return nxt;
        });
      }, 1000);
      return;
    }
    onSend?.(t);
  };
  const handleSendDraft = ()=>{
    const t = (draft || '').trim().slice(0, 160);
    if (!t) return;
    handleSend(t);
    setDraft('');
  };
  return (
    <>
      <div className="qc-input-row">
        <input
          type="text"
          className="qc-input"
          value={draft}
          maxLength={160}
          placeholder={cooldownMs>0?`Wait ${Math.ceil(cooldownMs/1000)}s…`:'Type a message…'}
          onChange={(e)=> setDraft(e.target.value)}
          onKeyDown={(e)=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); handleSendDraft(); } }}
          disabled={cooldownMs>0}
        />
        <button type="button" className="qc-send" onClick={handleSendDraft} disabled={cooldownMs>0 || !draft.trim()}>Send</button>
      </div>
      {cooldownMs>0 && (
        <div className="qc-hint">Please wait {Math.ceil(cooldownMs/1000)}s before sending more.</div>
      )}
    </>
  );
}
