import React from 'react';
import './login-overlay.css';

export default function LoginOverlay({ className = '', style, title = 'Log in to play', sub = 'Balance is tracked in your account.', ctaHref = '/registration', ctaText = 'Go to Login / Register' }) {
  return (
    <div className={`login-overlay ${className}`.trim()} style={style}>
      <div className="overlay-card text-center">
        <h4 className="mb-2">{title}</h4>
        {sub ? <div className="text-muted mb-3">{sub}</div> : null}
        <a href={ctaHref} className="btn btn-primary btn-sm">{ctaText}</a>
      </div>
    </div>
  );
}
