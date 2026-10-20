import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, 'public');
fs.mkdirSync(out, { recursive: true });
const dev = process.argv.includes('--dev');
const ver = Date.now().toString(36);
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
  define: { 'process.env.NODE_ENV': '"production"' },
});
let html = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8');
html = html.replaceAll('__VER__', ver).replaceAll('__ORIGIN__', origin);
fs.writeFileSync(path.join(out, 'index.html'), html);
// サービスワーカー（オフラインでも開ける）
let sw = fs.readFileSync(path.join(root, 'web/sw.js'), 'utf8');
sw = sw.replaceAll('__VER__', ver);
fs.writeFileSync(path.join(out, 'sw.js'), sw);
for (const f of fs.readdirSync(path.join(root, 'web'))) {
  if (f === 'index.html' || f === 'sw.js') continue;
  fs.copyFileSync(path.join(root, 'web', f), path.join(out, f));
}
const sz = (f) => (fs.statSync(path.join(out, f)).size / 1024).toFixed(0) + 'KB';
console.log('built', ver, 'app.js', sz('app.js'), 'app.css', sz('app.css'));
