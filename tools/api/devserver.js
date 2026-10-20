// ローカル確認用のサーバー：/api/rpf（api/rpf.js）と public/ の静的ファイル
//   node tools/api/devserver.js                     … メモリだけのにせ Upstash を使う（ポート 8813）
//   node tools/api/devserver.js --port 9000 --host 0.0.0.0
//   node tools/api/devserver.js --no-db             … データベースなし（ping が ready:false になる）
//   node tools/api/devserver.js --upstash-url URL --upstash-token TOKEN   … 指定した Upstash 互換サーバーを使う
// 本物のデータベースに書きこまないように、DB の環境変数はいったん全部消してから始める
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { createFakeUpstash } = require('./fake_upstash.js');

const ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC = path.join(ROOT, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
};

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) o[k] = argv[++i];
    else o[k] = true;
  }
  return o;
}

function serveStatic(req, res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch (e) {
    res.writeHead(400);
    return res.end('bad path');
  }
  let file = path.join(PUBLIC, rel);
  // public/ の外は見せない
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) {
    res.writeHead(403);
    return res.end('forbidden');
  }
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) {
      file = path.join(file, 'index.html');
      st = fs.existsSync(file) ? fs.statSync(file) : null;
      err = st ? null : new Error('nf');
    }
    if (err || !st || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('not found');
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-store',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

async function start(argv = process.argv.slice(2)) {
  const o = parseArgs(argv);
  for (const k of Object.keys(process.env)) {
    if (/KV_REST_API|REDIS_REST|KV_URL|REDIS_URL|UPSTASH/i.test(k)) delete process.env[k];
  }
  let fake = null;
  let db = 'none (--no-db)';
  if (!o['no-db']) {
    if (typeof o['upstash-url'] === 'string') {
      process.env.KV_REST_API_URL = o['upstash-url'];
      process.env.KV_REST_API_TOKEN = typeof o['upstash-token'] === 'string' ? o['upstash-token'] : '';
      db = o['upstash-url'];
    } else {
      fake = await createFakeUpstash({ port: 0 });
      process.env.KV_REST_API_URL = fake.url;
      process.env.KV_REST_API_TOKEN = fake.token;
      db = 'in-memory fake ' + fake.url;
    }
  }
  const handler = require(path.join(ROOT, 'api', 'rpf.js'));
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/api/rpf' || pathname === '/api/rpf/') {
      Promise.resolve()
        .then(() => handler(req, res))
        .catch((e) => {
          console.error('handler crashed:', e);
          if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end('{"ok":false,"err":"crash"}');
        });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      return res.end();
    }
    serveStatic(req, res, pathname);
  });
  const port = o.port !== undefined ? Number(o.port) : Number(process.env.PORT || 8813);
  const host = typeof o.host === 'string' ? o.host : '127.0.0.1';
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const url = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${server.address().port}`;
  console.log(`devserver: ${url}/  (api: /api/rpf, db: ${db})`);
  const stop = () => {
    if (server.closeAllConnections) server.closeAllConnections();
    server.close();
    if (fake) fake.close();
  };
  return { url, server, fake, stop };
}

module.exports = { start };

if (require.main === module) {
  start().then(
    ({ stop }) => {
      const quit = () => {
        stop();
        process.exit(0);
      };
      process.on('SIGINT', quit);
      process.on('SIGTERM', quit);
    },
    (e) => {
      console.error('devserver failed:', e.message);
      process.exit(1);
    }
  );
}
