import React from 'react';

export default function WaitingOverlay({ show = true, title = 'Waiting for Opponent…', body = 'Your game is paused until both players reconnect.', showDots = true }){
  if (!show) return null;
  return (
    <div className="match-overlay waiting-overlay">
      <div className="popup-card" style={{ textAlign: 'center' }}>
        <div className="popup-title">{title}</div>
        <div className="popup-body">{body}</div>
        {showDots && (
          <div className="mm-dots" style={{ marginTop: 8 }}>
            <span className="mm-dot"/>
            <span className="mm-dot"/>
            <span className="mm-dot"/>
          </div>
        )}
      </div>
    </div>
  );
}
