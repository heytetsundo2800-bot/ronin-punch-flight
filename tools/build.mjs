import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, 'public');
fs.mkdirSync(out, { recursive: true });
const dev = process.argv.includes('--dev');
const ver = Date.now().toString(36);
// 曲のファイルが変わったときだけ、曲を読みなおす（版の番号＝中身のハッシュ）
import crypto from 'crypto';
const mh = crypto.createHash('sha1');
for (const f of fs.readdirSync(path.join(root, 'web')).filter((f) => f.endsWith('.m4a') || f.endsWith('.mp3')).sort()) mh.update(fs.readFileSync(path.join(root, 'web', f)));
const mver = mh.digest('hex').slice(0, 8);
const origin = process.env.ORIGIN || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL : 'https://ronin-punch-flight.vercel.app');

await esbuild.build({
  entryPoints: [path.join(root, 'src/main.js')],
  bundle: true,
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  target: ['es2020'],
  outfile: path.join(out, 'app.js'),
  legalComments: 'none',
  logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"production"', __MVER__: JSON.stringify(mver) },
});
let html = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8');
html = html.replaceAll('__VER__', ver).replaceAll('__ORIGIN__', origin);
fs.writeFileSync(path.join(out, 'index.html'), html);
// v1.7.1：アイコンちがいの入口（/icon10/ など）。中身は同じゲームで、ホーム画面に追加したときのアイコンだけがちがう
const ICON_ENTRIES = { icon10: { manifest: '/manifest-icon10.json', icon: '/icon10-192.png', apple: '/icon10-apple.png' } };
for (const [dir, E] of Object.entries(ICON_ENTRIES)) {
  const rep = [
    ['<link rel="manifest" href="/manifest.json">', `<link rel="manifest" href="${E.manifest}">`],
    ['<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">', `<link rel="icon" type="image/png" sizes="192x192" href="${E.icon}">`],
    ['<link rel="apple-touch-icon" href="/apple-touch-icon.png">', `<link rel="apple-touch-icon" href="${E.apple}">`],
  ];
  let h = html;
  for (const [a, b] of rep) {
    if (!h.includes(a)) throw new Error('icon entry ' + dir + ': index.html に ' + a + ' がない');
    h = h.replace(a, b);
  }
  fs.mkdirSync(path.join(out, dir), { recursive: true });
  fs.writeFileSync(path.join(out, dir, 'index.html'), h);
}
// サービスワーカー（オフラインでも開ける）
let sw = fs.readFileSync(path.join(root, 'web/sw.js'), 'utf8');
sw = sw.replaceAll('__VER__', ver).replaceAll('__MVER__', mver);
fs.writeFileSync(path.join(out, 'sw.js'), sw);
for (const f of fs.readdirSync(path.join(root, 'web'))) {
  if (f === 'index.html' || f === 'sw.js') continue;
  if (fs.statSync(path.join(root, 'web', f)).isDirectory()) continue;
  fs.copyFileSync(path.join(root, 'web', f), path.join(out, f));
}
const sz = (f) => (fs.statSync(path.join(out, f)).size / 1024).toFixed(0) + 'KB';
console.log('built', ver, 'app.js', sz('app.js'), 'app.css', sz('app.css'));
