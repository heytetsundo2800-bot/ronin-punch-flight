# カメラと引っかかりの点検
#  1) 陣地から前へ飛んで、校門・鳥居の柱にぶつからないか（4人とも）
#  2) 物のそばでいろいろな向きに止まっても、カメラが壁の中に入らないか
#  3) CPUだけで遊ばせて、同じ所に長くとどまるCPUがいないか
# 使い方：node tools/api/devserver.js --port 8813 を動かしてから python3 tools/camera_test.py [stage...]
import asyncio, json, sys
from playwright.async_api import async_playwright

U = 'http://127.0.0.1:8813/?norender=1'
STAGES = sys.argv[1:] or ['sakura', 'campus']
results = []


def check(name, ok, info=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + ('  ' + str(info) if info != '' else ''), flush=True)


SPAWN_RUN = """(slot) => new Promise((res) => {
  const m = window.__app.match, P = m.player, I = window.__app.input;
  const b = m.stage.bases[P.team];
  P.pos.copy(b.respawn[slot]); P.vel.set(0, 0, 0); P.yaw = b.faceYaw; P.pitch = 0; P.state = 'hover'; P.lock = null; P.updateAxes();
  for (const e of m.punchers) if (e !== P) { e.brain = null; e.pos.set(95, 5, 0); }
  I._s = I.sample; I.sample = function () { this._s(); this.hold = true; this.stickX = 0; this.stickY = 0; };
  const z0 = P.pos.z;
  setTimeout(() => { I.sample = I._s; res({ moved: +Math.abs(P.pos.z - z0).toFixed(1), sp: +P.vel.length().toFixed(1) }); }, 2200);
})"""

CAM_SWEEP = """(n) => new Promise((res) => {
  const m = window.__app.match, P = m.player, W = m.world, V = P.pos.constructor;
  for (const e of m.punchers) if (e !== P) { e.brain = null; e.pos.set(95, 5, 0); }
  window.__app.input.enabled = false;
  // 当たりのある物のまわりに置く
  const cols = W.cols.filter((c) => c.kind !== 'island' && c.kind !== 'rock');
  const info = { ground: false, hitWall: false, wallNormal: new V(), groundY: 0 };
  let inside = 0, close = 0, done = 0; const bad = [];
  const rnd = (a, b) => a + Math.random() * (b - a);
  const step = () => {
    if (done >= n) { res({ n, inside, close, bad: bad.slice(0, 6) }); return; }
    // 前の結果を調べる
    if (done > 0) {
      const c = m.camera.position.clone();
      const v = new V();
      const q = c.clone(); W.resolveSphere(q, 0.12, v, info);
      if (q.distanceTo(c) > 0.02) { inside++; bad.push([P.pos.x, P.pos.y, P.pos.z, P.yaw].map((x) => +x.toFixed(1))); }
      if (m.cam.close) close++;
    }
    const col = cols[Math.floor(Math.random() * cols.length)];
    const cx = (col.min[0] + col.max[0]) / 2, cz = (col.min[2] + col.max[2]) / 2;
    const a = Math.random() * Math.PI * 2, r = (Math.max(col.max[0] - col.min[0], col.max[2] - col.min[2]) / 2) + rnd(0.9, 3.5);
    P.pos.set(cx + Math.cos(a) * r, rnd(col.min[1] + 0.5, col.max[1] + 1), cz + Math.sin(a) * r);
    const q2 = P.pos.clone(); W.resolveSphere(q2, P.radius, new V(), info); P.pos.copy(q2);
    P.vel.set(0, 0, 0); P.state = 'hover'; P.lock = null;
    // うしろが物のほうを向くように（カメラが物のがわに来る）
    P.yaw = Math.atan2(P.pos.x - cx, P.pos.z - cz) + rnd(-0.6, 0.6); P.pitch = rnd(-0.4, 0.4); P.updateAxes();
    m.cam.first = true;
    done++;
    setTimeout(step, 90);
  };
  step();
})"""


async def run(b, stage):
    ctx = await b.new_context(viewport={'width': 393, 'height': 852}, device_scale_factor=1, is_mobile=True, has_touch=True)
    pg = await ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    save = {'name': 'テスト', 'tutorial': True, 'seenRules': {'scramble': 1, 'flag': 1, 'ball': 1}, 'char': 'tora', 'mode': 'scramble', 'diff': 'normal', 'stage': stage}
    await pg.add_init_script("localStorage.setItem('rpf_save_v1', JSON.stringify(%s))" % json.dumps(save, ensure_ascii=False))
    await pg.goto(U)
    await pg.wait_for_selector('#boot', state='detached', timeout=30000)
    await pg.wait_for_selector('.screen.title', timeout=30000)
    await pg.mouse.click(196, 600)
    await pg.wait_for_selector('.battlebtn', timeout=15000)
    await pg.click('.battlebtn', force=True)
    await pg.wait_for_function('window.__app.match && window.__app.match.phase === "play"', timeout=30000)
    await pg.wait_for_timeout(400)
    await pg.evaluate("() => { const m = window.__app.match; window.__B = m.punchers.find(q => q.brain).brain.constructor; }")
    for slot in range(4):
        r = await pg.evaluate(SPAWN_RUN, slot)
        check(f'[{stage}] spawn slot {slot}: flying forward is not blocked', r['moved'] > 12 and r['sp'] > 8, r)
    r = await pg.evaluate(CAM_SWEEP, 240)
    rate = r['inside'] / r['n']
    check(f'[{stage}] camera stays out of walls near props', rate < 0.01, (r['inside'], r['n'], r['bad']))
    print(f'  camera jammed close (character hidden): {r["close"]}/{r["n"]}')
    # CPUだけで遊ばせて、長くとどまるCPUをさがす
    await pg.evaluate("() => { const app = window.__app; const m = app.match; m.timeLeft = 180; const B = window.__B; const roles = ['collector', 'dropper', 'support', 'collector']; for (const p of m.punchers) { p.brain = new B(p, m, roles[p.slot % 4]); } const bases = m.stage.bases; for (const p of m.punchers) { p.pos.copy(bases[p.team].respawn[p.slot % 4]); p.vel.set(0, 0, 0); } app.input.enabled = false; app.simSpeed = 6; }")
    camp = await pg.evaluate("""() => new Promise((res) => {
      const m = window.__app.match; const tr = new Map(); let ticks = 0; const worst = [];
      const iv = setInterval(() => {
        ticks++;
        for (const p of m.punchers) {
          if (!p.alive || !p.brain) { tr.delete(p); continue; }
          const g = p.brain.goal; const kind = g ? g.kind : '-';
          const t = tr.get(p);
          if (!t || t.pos.distanceTo(p.pos) > 4 || kind === 'guard' || kind === 'deposit' || kind === 'fight' || kind === 'guardian' || kind === 'escort') tr.set(p, { pos: p.pos.clone(), since: m.time, kind });
          else if (m.time - t.since > 25) { worst.push([p.displayName, kind, [p.pos.x, p.pos.y, p.pos.z].map((x) => +x.toFixed(0)), +(m.time - t.since).toFixed(0)]); tr.set(p, { pos: p.pos.clone(), since: m.time, kind }); }
        }
        if (m.phase !== 'play' || ticks > 60) { clearInterval(iv); res({ t: +m.time.toFixed(0), worst, stuck: m.punchers.reduce((a, p) => a + (p.brain ? (p.brain.stuckTotal || 0) : 0), 0), score: [m.mode.score(0), m.mode.score(1)] }); }
      }, 1000);
    })""")
    check(f'[{stage}] no CPU camps in one spot for 25s+', not camp['worst'], camp)
    check(f'[{stage}] no page errors', not errs, errs[:3])
    await ctx.close()


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        for st in STAGES:
            await run(b, st)
        print(f'camera test: {sum(results)}/{len(results)} passed')
        await b.close()

asyncio.run(main())
