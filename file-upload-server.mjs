#!/usr/bin/env node
/**
 * MyFileUpload - Secure file upload server
 * Bento UI + Theme switching + i18n (zh/en)
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.UPLOAD_PORT || '47891');
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/root/uploads';
const PASSWORD = process.env.UPLOAD_PASSWORD || 'meltemi2026!';
const MAX_SIZE = parseInt(process.env.MAX_SIZE_MB || '5120') * 1024 * 1024;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Load HTML files
const PUBLIC_DIR = path.join(__dirname, 'file-upload-public');
const LOGIN_HTML = fs.readFileSync(path.join(PUBLIC_DIR, 'login.html'), 'utf-8');
const MAIN_HTML = fs.readFileSync(path.join(PUBLIC_DIR, 'main.html'), 'utf-8');

// Session management
const sessions = new Map();

function createSession() {
  const id = crypto.randomBytes(24).toString('hex');
  sessions.set(id, { created: Date.now(), expires: Date.now() + 24 * 3600 * 1000 });
  return id;
}

function validateSession(cookieHeader) {
  if (!cookieHeader) return false;
  const m = cookieHeader.match(/session=([a-f0-9]+)/);
  if (!m) return false;
  const s = sessions.get(m[1]);
  if (!s || s.expires < Date.now()) { sessions.delete(m[1]); return false; }
  return true;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);

  // Health
  if (url.pathname === '/health') { res.writeHead(200); res.end('ok'); return; }

  // Login
  if (url.pathname === '/api/login' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { password } = JSON.parse(body);
        if (password === PASSWORD) {
          const sid = createSession();
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Set-Cookie': 'session=' + sid + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400'
          });
          res.end('{"ok":true}');
        } else {
          res.writeHead(401); res.end('{"error":"wrong"}');
        }
      } catch { res.writeHead(400); res.end('{"error":"bad"}'); }
    });
    return;
  }

  // Logout
  if (url.pathname === '/api/logout' && req.method === 'POST') {
    const m = req.headers.cookie?.match(/session=([a-f0-9]+)/);
    if (m) sessions.delete(m[1]);
    res.writeHead(200, { 'Set-Cookie': 'session=; Path=/; Max-Age=0' });
    res.end('{"ok":true}');
    return;
  }

  // Auth gate
  if (!validateSession(req.headers.cookie)) {
    if (url.pathname.startsWith('/api/')) { res.writeHead(401); res.end('{"error":"unauthorized"}'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(LOGIN_HTML);
    return;
  }

  // Main page
  if (url.pathname === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(MAIN_HTML);
    return;
  }

  // Upload
  if (url.pathname === '/api/upload' && req.method === 'POST') {
    let filename = decodeURIComponent(url.searchParams.get('name') || 'upload_' + Date.now());
    filename = filename.replace(/[/\\]/g, '_');
    const filepath = path.join(UPLOAD_DIR, filename);
    let size = 0;
    const ws = fs.createWriteStream(filepath);
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_SIZE) {
        ws.destroy();
        try { fs.unlinkSync(filepath); } catch {}
        if (!res.headersSent) { res.writeHead(413); res.end('File too large'); }
        return;
      }
      ws.write(chunk);
    });
    req.on('end', () => {
      ws.end(() => {
        if (res.headersSent) return;
        console.log('[UPLOAD] ' + filename + ' (' + (size/1048576).toFixed(1) + 'MB)');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, file: filename, size }));
      });
    });
    req.on('error', () => { ws.destroy(); if (!res.headersSent) { res.writeHead(500); res.end('error'); } });
    return;
  }

  // File list
  if (url.pathname === '/api/files' && req.method === 'GET') {
    try {
      const files = fs.readdirSync(UPLOAD_DIR).map(name => {
        const stat = fs.statSync(path.join(UPLOAD_DIR, name));
        return { name, size: stat.size, date: stat.mtime.toISOString().slice(0, 16).replace('T', ' ') };
      }).sort((a, b) => b.date.localeCompare(a.date));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(files));
    } catch { res.writeHead(200); res.end('[]'); }
    return;
  }

  // Delete file
  if (url.pathname.startsWith('/api/files/') && req.method === 'DELETE') {
    const name = decodeURIComponent(url.pathname.slice('/api/files/'.length)).replace(/[/\\]/g, '_');
    try {
      fs.unlinkSync(path.join(UPLOAD_DIR, name));
      console.log('[DELETE] ' + name);
      res.writeHead(200); res.end('{"ok":true}');
    } catch { res.writeHead(404); res.end('{"error":"not found"}'); }
    return;
  }

  res.writeHead(404); res.end('Not Found');
});

server.timeout = 0;
server.keepAliveTimeout = 120000;

server.listen(PORT, '127.0.0.1', () => {
  console.log('[MyFileUpload] Started on port ' + PORT);
  console.log('[MyFileUpload] Upload dir: ' + UPLOAD_DIR);
  console.log('[MyFileUpload] Max size: ' + Math.round(MAX_SIZE/1048576) + 'MB');
});
