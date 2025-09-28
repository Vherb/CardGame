const http = require('http');
const https = require('https');
const { URL } = require('url');
const WebSocket = require('ws');

const API_BASE = process.env.API_BASE || 'http://localhost:3002';

function httpJson(method, urlStr, body, headers={}){
  return new Promise((resolve, reject)=>{
    try{
      const u = new URL(urlStr);
      const isHttps = u.protocol === 'https:';
      const data = body ? Buffer.from(JSON.stringify(body)) : null;
      const req = (isHttps?https:http).request({
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (isHttps?443:80),
        path: u.pathname + (u.search||''),
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(data?{ 'Content-Length': data.length }:{}),
          ...headers,
        },
      }, (res)=>{
        const chunks=[]; res.on('data',c=>chunks.push(c));
        res.on('end',()=>{
          const txt = Buffer.concat(chunks).toString('utf8');
          let json = null; try{ json = JSON.parse(txt); }catch{}
          if(res.statusCode>=200 && res.statusCode<300){ resolve(json); }
          else { const err = new Error(json?.message || `HTTP ${res.statusCode}`); err.statusCode=res.statusCode; err.body=json||txt; reject(err); }
        });
      });
      req.on('error', reject);
      if(data) req.write(data);
      req.end();
    }catch(e){ reject(e); }
  });
}

async function registerOrLogin(username, password='passpass'){
  const email = `${username}@smoke.local`;
  try{
    const r = await httpJson('POST', `${API_BASE}/registration`, { email, username, password });
    return { token:r.token, username:r.username, userId: r.userId };
  }catch(e){
    if(e.statusCode===400 || e.statusCode===409){
      const r = await httpJson('POST', `${API_BASE}/login`, { username, password });
      return { token:r.token, username:r.username, userId: r.userId };
    }
    throw e;
  }
}

async function getBalance(token){
  const r = await httpJson('GET', `${API_BASE}/balance`, null, { Authorization: `Bearer ${token}` });
  return Number(r.sc_balance) || 0;
}

async function scAdjust(token, delta, memo=''){ 
  const r = await httpJson('POST', `${API_BASE}/sc/adjust`, { delta:Number(delta), memo }, { Authorization: `Bearer ${token}` });
  return Number(r.sc_balance)||0;
}

function waitFor(ws, type, timeout=15000){
  return new Promise((resolve, reject)=>{
    const to = setTimeout(()=>{ cleanup(); reject(new Error(`timeout waiting for ${type}`)); }, timeout);
    function onMsg(buf){
      try{ const d = JSON.parse(buf.toString()); if(d && d.type===type){ cleanup(); resolve(d); } }catch{}
    }
    function cleanup(){ clearTimeout(to); try{ ws.off('message', onMsg); }catch{} }
    ws.on('message', onMsg);
  });
}

function wsConnect(url){
  const ws = new WebSocket(url);
  return new Promise((resolve, reject)=>{
    ws.once('open', ()=> resolve(ws));
    ws.once('error', reject);
  });
}

module.exports = { API_BASE, httpJson, registerOrLogin, getBalance, scAdjust, waitFor, wsConnect };
