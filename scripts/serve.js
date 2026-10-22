#!/usr/bin/env node
/* Zero-dependency static server for the single-file app.
   Usage: node scripts/serve.js            (PORT=4173 by default)
   The app itself is one HTML file — this is only a convenience for previewing. */
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '0.0.0.0';

const types = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/plain; charset=utf-8'
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = url === '/' ? 'bookmark-station.html' : url.replace(/^\/+/, '');
  let full = path.join(root, file);
  if (!full.startsWith(root)) { res.writeHead(403).end('Forbidden'); return; }
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    full = path.join(root, 'bookmark-station.html');
  }
  fs.readFile(full, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': types[path.extname(full)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(buf);
  });
});

server.listen(port, host, () => {
  console.log(`Bookmark Station → http://${host}:${port}/`);
  console.log('Tip: for real JSON-file sync, open bookmark-station.html from your disk (file://), not via a server.');
});
