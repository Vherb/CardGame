import React from 'react';
import ReactDOM from 'react-dom/client';
import './theme.css';
import './App.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import { BrowserRouter } from "react-router-dom";

// Ensure we always start scrolled to the top
try {
    if ('scrollRestoration' in window.history) {
        window.history.scrollRestoration = 'manual';
    }
} catch {}
window.scrollTo?.(0, 0);

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
    <React.StrictMode>
        <BrowserRouter>
            <App />
        </BrowserRouter>
    </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
