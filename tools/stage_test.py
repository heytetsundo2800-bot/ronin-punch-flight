# ステージの点検：サクラ・旗・ボール・復活位置が建物にめりこんでいないか、絵がちゃんと出るか
# 使い方：node tools/api/devserver.js --port 8813 を動かしてから python3 tools/stage_test.py [stage]
import asyncio, json, sys
from playwright.async_api import async_playwright

U = 'http://127.0.0.1:8813/'
STAGES = sys.argv[1:] or ['sakura', 'campus']
OUT = '/tmp/claude-0/-home-claude/cb87e6ba-4022-5281-bc59-7be863cc9efb/scratchpad/shots'
results = []


def check(name, ok, info=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + ('  ' + str(info) if info != '' else ''), flush=True)


PROBE = """(st) => {
  const m = window.__app.match; const S = m.stage; const W = m.world;
  const V = m.player.pos.constructor;
  const info = { ground: false, hitWall: false, wallNormal: new V(), groundY: 0 };
  const moved = (p, r) => { const q = p.clone(); const v = new V(); W.resolveSphere(q, r, v, info); return q.distanceTo(p); };
  const bad = (list, r) => list.map((p, i) => [i, +moved(p, r).toFixed(2), [p.x, p.y, p.z].map((n) => +n.toFixed(1))]).filter((x) => x[1] > 0.01);
  // ボールは出る場所が ±4 ずれるので、その範囲も調べる
  const ballBad = [];
  S.ballSpawns.forEach((b, i) => { for (const dx of [-4, 0, 4]) for (const dy of [-1, 2]) for (const dz of [-4, 0, 4]) { const p = b.clone().add(new V(dx, dy, dz)); const d = moved(p, 0.8); if (d > 0.01) ballBad.push([i, dx, dy, dz, +d.toFixed(2)]); } });
  const resp = []; S.bases.forEach((b) => b.respawn.forEach((p) => resp.push(p)));
  const flags = []; S.flagSpawns.forEach((l) => l.forEach((p) => flags.push(p)));
  // 2つのサクラが近すぎないか
  let minGap = 99; const sp = S.sakuraPoints;
  for (let i = 0; i < sp.length; i++) for (let j = i + 1; j < sp.length; j++) minGap = Math.min(minGap, sp[i].distanceTo(sp[j]));
  // まん中から見て反転したら同じ形か
  const mirror = sp.every((p) => sp.some((q) => Math.abs(q.x + p.x) < 0.01 && Math.abs(q.z + p.z) < 0.01 && Math.abs(q.y - p.y) < 0.01));
  return {
    id: S.id, n: sp.length, cols: W.cols.length, minGap: +minGap.toFixed(2), mirror,
    sakura: bad(sp, 1.0), flags: bad(flags, 1.5), resp: bad(resp, 0.9), daruma: bad(S.bases.map((b) => b.daruma), 3.0), goal: bad(S.bases.map((b) => b.goal), 1.0), flagGoal: bad(S.bases.map((b) => b.flagGoal), 1.0), rapid: bad([S.rapidSpawn], 1.4), ballBad,
    draw: m.app.renderer.info.render.calls, tris: m.app.renderer.info.render.triangles,
  };
}"""


async def run(b, stage):
    ctx = await b.new_context(viewport={'width': 393, 'height': 852}, device_scale_factor=1, is_mobile=True, has_touch=True)
    pg = await ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.type + ': ' + m.text) if m.type == 'error' and '404' not in m.text else None)
    save = {'name': 'テスト', 'tutorial': True, 'char': 'tora', 'mode': 'scramble', 'diff': 'normal', 'stage': stage}
    await pg.add_init_script("localStorage.setItem('rpf_save_v1', JSON.stringify(%s))" % json.dumps(save, ensure_ascii=False))
    await pg.goto(U)
    await pg.wait_for_selector('#boot', state='detached', timeout=30000)
    await pg.wait_for_selector('.screen.title', timeout=30000)
    await pg.mouse.click(196, 600)
    await pg.wait_for_selector('.stagebtn', timeout=15000)
    label = await pg.inner_text('.stagebtn b')
    await pg.click('.battlebtn', force=True)
    await pg.wait_for_function('window.__app.match && window.__app.match.phase === "play"', timeout=90000)
    await pg.wait_for_timeout(500)
    r = await pg.evaluate(PROBE, stage)
    check(f'[{stage}] home label', label.strip() != '', label)
    check(f'[{stage}] stage built', r['id'] == stage and r['n'] == 50, (r['id'], r['n'], r['cols']))
    check(f'[{stage}] sakura points are symmetric and spread out', r['mirror'] and r['minGap'] > 3, (r['mirror'], r['minGap']))
    check(f'[{stage}] sakura points not inside things', not r['sakura'], r['sakura'])
    check(f'[{stage}] flags/respawn/daruma/goals clear', not (r['flags'] or r['resp'] or r['daruma'] or r['goal'] or r['flagGoal']), (r['flags'], r['resp'], r['daruma'], r['goal'], r['flagGoal']))
    check(f'[{stage}] rapid ball spawn clear', not r['rapid'], r['rapid'])
    check(f'[{stage}] ball spawns (with jitter) clear', len(r['ballBad']) == 0, r['ballBad'][:40])
    print(f'  draw calls {r["draw"]}  triangles {r["tris"]}')
    # いくつかの場所から写真
    shots = [('overview', [0, 75, -128], [0, 30, 0]), ('base', [0, 40, -128], [0, 30, -80]), ('mid', [-70, 45, -20], [30, 35, -36]), ('low', [20, 18, -10], [-40, 40, -40])]
    await pg.evaluate("() => { const m = window.__app.match; m.introCam = null; m.cam.update = () => {}; window.__app.input.enabled = false; }")
    for name, pos, look in shots:
        await pg.evaluate("([p, l]) => { const m = window.__app.match; m.camera.position.set(...p); m.camera.lookAt(...l); m.camera.updateMatrixWorld(); }", [pos, look])
        await pg.wait_for_timeout(350)
        await pg.screenshot(path=f'{OUT}/stage_{stage}_{name}.png')
    # CPUだけで少し遊ばせて、引っかかりを数える
    await pg.evaluate("() => { const app = window.__app; const m = app.match; const P = m.player; const B = m.punchers.find(q => q.brain).brain.constructor; P.brain = new B(P, m, 'collector'); app.input.enabled = false; app.simSpeed = 6; m.cam.update = m.cam.constructor.prototype.update; }")
    await pg.wait_for_timeout(12000)
    st = await pg.evaluate("() => { const m = window.__app.match; return { t: +(180 - m.timeLeft).toFixed(0), stuck: m.punchers.map(p => p.brain ? (p.brain.stuckTotal || 0) : 0), score: [m.mode.score(0), m.mode.score(1)], held: m.punchers.reduce((a, p) => a + p.carry.sakura.length, 0), ko: m.punchers.reduce((a, q) => a + q.stats.ko, 0) }; }")
    print('  sim:', json.dumps(st, ensure_ascii=False))
    check(f'[{stage}] CPUs collect sakura', st['score'][0] + st['score'][1] + st['held'] > 0, st)
    check(f'[{stage}] no page errors', not errs, errs[:5])
    await ctx.close()


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        for st in STAGES:
            await run(b, st)
        print(f'stage test: {sum(results)}/{len(results)} passed')
        await b.close()

asyncio.run(main())
