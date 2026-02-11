#!/usr/bin/env node
/**
 * 临时文件上传服务器
 * - 拖拽上传 / 点击选择
 * - 支持大文件（无限制）
 * - 上传到 ~/uploads/
 * - 带简单 token 认证
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const PORT = parseInt(process.env.UPLOAD_PORT || '9090');
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/root/uploads';
const TOKEN = process.env.UPLOAD_TOKEN || crypto.randomBytes(16).toString('hex');
const MAX_SIZE = 500 * 1024 * 1024; // 500MB

// 确保上传目录存在
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const HTML = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>🐲 龙崽文件上传</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%);
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    color: #fff;
  }
  .container { max-width: 600px; width: 90%; text-align: center; }
  h1 { font-size: 2em; margin-bottom: 0.5em; }
  h1 span { font-size: 1.2em; }
  .subtitle { color: #aaa; margin-bottom: 2em; }
  .drop-zone {
    border: 3px dashed #666; border-radius: 20px; padding: 60px 20px;
    cursor: pointer; transition: all 0.3s ease; background: rgba(255,255,255,0.03);
  }
  .drop-zone:hover, .drop-zone.dragover {
    border-color: #7c5cfc; background: rgba(124,92,252,0.1);
    transform: scale(1.02);
  }
  .drop-zone .icon { font-size: 4em; margin-bottom: 0.3em; }
  .drop-zone p { font-size: 1.1em; color: #999; }
  .drop-zone p strong { color: #7c5cfc; }
  input[type="file"] { display: none; }
  .file-list { margin-top: 1.5em; text-align: left; }
  .file-item {
    background: rgba(255,255,255,0.05); border-radius: 12px;
    padding: 12px 16px; margin-bottom: 10px; display: flex;
    align-items: center; gap: 12px;
  }
  .file-item .name { flex: 1; word-break: break-all; font-size: 0.9em; }
  .file-item .size { color: #888; font-size: 0.8em; white-space: nowrap; }
  .file-item .status { font-size: 1.2em; }
  .progress-bar {
    width: 100%; height: 4px; background: rgba(255,255,255,0.1);
    border-radius: 2px; overflow: hidden; margin-top: 6px;
  }
  .progress-bar .fill {
    height: 100%; background: linear-gradient(90deg, #7c5cfc, #00d4ff);
    border-radius: 2px; transition: width 0.2s; width: 0%;
  }
  .stats {
    margin-top: 2em; color: #666; font-size: 0.85em;
    background: rgba(255,255,255,0.03); padding: 12px; border-radius: 10px;
  }
</style>
</head>
<body>
<div class="container">
  <h1><span>🐲</span> 龙崽文件上传</h1>
  <p class="subtitle">拖拽文件到下方区域，或点击选择 · 最大 500MB · 无限制</p>

  <div class="drop-zone" id="dropZone">
    <div class="icon">📁</div>
    <p>拖拽文件到这里<br>或 <strong>点击选择文件</strong></p>
  </div>
  <input type="file" id="fileInput" multiple>

  <div class="file-list" id="fileList"></div>

  <div class="stats" id="stats" style="display:none">
    <span id="statsText"></span>
  </div>
</div>

<script>
const TOKEN = new URLSearchParams(location.search).get('t') || '';
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const fileList = document.getElementById('fileList');
let totalUploaded = 0;

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('dragover');
  handleFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', e => handleFiles(e.target.files));

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
  if (bytes < 1024*1024*1024) return (bytes/1024/1024).toFixed(1) + ' MB';
  return (bytes/1024/1024/1024).toFixed(2) + ' GB';
}

function handleFiles(files) {
  for (const file of files) uploadFile(file);
}

function uploadFile(file) {
  const item = document.createElement('div');
  item.className = 'file-item';
  item.innerHTML = \`
    <div class="status">⏳</div>
    <div class="name">\${file.name}<br><div class="progress-bar"><div class="fill" id="p_\${Date.now()}"></div></div></div>
    <div class="size">\${formatSize(file.size)}</div>
  \`;
  fileList.appendChild(item);
  const progressBar = item.querySelector('.fill');
  const statusEl = item.querySelector('.status');

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/upload?t=' + TOKEN + '&name=' + encodeURIComponent(file.name));

  xhr.upload.onprogress = e => {
    if (e.lengthComputable) {
      const pct = (e.loaded / e.total * 100).toFixed(0);
      progressBar.style.width = pct + '%';
    }
  };

  xhr.onload = () => {
    if (xhr.status === 200) {
      statusEl.textContent = '✅';
      progressBar.style.width = '100%';
      progressBar.style.background = '#00c853';
      totalUploaded++;
      updateStats();
    } else {
      statusEl.textContent = '❌';
      progressBar.style.background = '#ff1744';
    }
  };

  xhr.onerror = () => {
    statusEl.textContent = '❌';
    progressBar.style.background = '#ff1744';
  };

  xhr.send(file);
}

function updateStats() {
  const stats = document.getElementById('stats');
  const text = document.getElementById('statsText');
  stats.style.display = 'block';
  text.textContent = \`已上传 \${totalUploaded} 个文件\`;
}
</script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // 认证
  if (url.searchParams.get('t') !== TOKEN && url.pathname !== '/health') {
    if (url.pathname === '/' && !url.searchParams.has('t')) {
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>⛔ 需要访问令牌</h1><p>请使用带 token 的链接访问</p>');
      return;
    }
  }

  // 健康检查
  if (url.pathname === '/health') {
    res.writeHead(200); res.end('ok'); return;
  }

  // 首页
  if (url.pathname === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML); return;
  }

  // 上传
  if (url.pathname === '/upload' && req.method === 'POST') {
    if (url.searchParams.get('t') !== TOKEN) {
      res.writeHead(403); res.end('Forbidden'); return;
    }

    let filename = url.searchParams.get('name') || `upload_${Date.now()}`;
    // 安全：去掉路径分隔符
    filename = filename.replace(/[/\\]/g, '_');
    const filepath = path.join(UPLOAD_DIR, filename);

    let size = 0;
    const ws = fs.createWriteStream(filepath);

    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_SIZE) {
        ws.destroy();
        fs.unlinkSync(filepath);
        res.writeHead(413); res.end('File too large');
        return;
      }
      ws.write(chunk);
    });

    req.on('end', () => {
      ws.end(() => {
        const mb = (size / 1024 / 1024).toFixed(1);
        console.log(`✅ 收到: ${filename} (${mb}MB) -> ${filepath}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, file: filename, size, path: filepath }));
      });
    });

    req.on('error', err => {
      ws.destroy();
      console.error('Upload error:', err);
      res.writeHead(500); res.end('Upload failed');
    });
    return;
  }

  res.writeHead(404); res.end('Not Found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🐲 上传服务已启动！`);
  console.log(`📎 地址: http://107.173.204.12:${PORT}/?t=${TOKEN}`);
  console.log(`📁 文件保存到: ${UPLOAD_DIR}`);
  console.log(`📏 最大: 500MB`);
  console.log(`\n按 Ctrl+C 停止\n`);
});
