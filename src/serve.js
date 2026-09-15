#!/usr/bin/env node
// Yerel geliştirme sunucusu: public/ klasörünü ve api/*.js fonksiyonlarını Vercel benzeri sunar.
// npm run serve → http://localhost:3000
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5).replace(/\.js$/, '').replace(/[^a-z0-9_-]/gi, '');
    try {
      const mod = await import(`../api/${name}.js`);
      req.query = Object.fromEntries(url.searchParams.entries());
      await mod.default(req, res);
    } catch (err) {
      res.statusCode = err.code === 'ERR_MODULE_NOT_FOUND' ? 404 : 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }
  let filePath = path.normalize(path.join(PUBLIC, decodeURIComponent(url.pathname)));
  if (!filePath.startsWith(PUBLIC)) { res.statusCode = 403; return res.end('forbidden'); }
  try {
    if (fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html');
    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    fs.createReadStream(filePath).pipe(res);
  } catch {
    res.statusCode = 404;
    res.end('not found');
  }
});

server.listen(PORT, () => console.log(`Yerel sunucu: http://localhost:${PORT}  (api: /api/health, /api/analyze?q=...)`));
