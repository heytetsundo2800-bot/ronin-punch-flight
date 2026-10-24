# ディスクの点検（v1.5：21枚。先生・学食・犬など）
#  1) 21枚すべて：使う → 横に出る → 技を出す → 消える（あとに残らない）
#  2) 攻撃のディスクの弾は、モンスターの口のあたりから出る
#  3) 溜め中に強い攻撃を受けると、モンスターが割れて消える
#  4) ディスクの画面：21枚のカードと絵が出る
# 使い方：public を 8812 で配信してから python3 tools/disc_test.py
import asyncio
import sys
from playwright.async_api import async_playwright

URL = 'http://localhost:8812/?norender=1'
IDS = ['akahon', 'tangocho', 'pencil', 'cookie', 'drink', 'eyemask', 'eki', 'mameta', 'ramen', 'hachimaki', 'coffee', 'shield', 'keshigomu', 'marksheet', 'tani', 'warp', 'homewarp', 'jet', 'fuwa', 'screw', 'book']
SHOTS = ('akahon', 'tangocho', 'pencil', 'cookie')
results = []


def check(name, ok, info=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name, info)


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        ctx = await b.new_context(viewport={'width': 402, 'height': 874}, is_mobile=True, has_touch=True)
        own = '{' + ','.join(f'{i}:1' for i in IDS) + '}'
        await ctx.add_init_script("localStorage.setItem('rpf_noacct', '1'); localStorage.setItem('rpf_save_v1', JSON.stringify({name:'テスト', tutorial:true, seenRules:{scramble:1,flag:1,ball:1}, char:'even', mode:'scramble', diff:'normal', stage:'sakura', rp: 100, om:" + own + "}));")
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append('PE ' + str(e)))
        # 静的サーバーには /api が無いので、その 404 は数えない
        pg.on('console', lambda m: errs.append('C ' + m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        await pg.goto(URL)
        await pg.wait_for_selector('.screen.title', timeout=40000)
        await pg.wait_for_timeout(1200)
        await pg.mouse.click(201, 640)
        await pg.wait_for_selector('.screen.home', timeout=15000)
        # ---- ディスクの画面 ----
        await pg.click('.tabs button[data-t="om"]')
        await pg.wait_for_selector('.discsel .omgrid .omcard', timeout=15000)
        n = await pg.evaluate("() => document.querySelectorAll('.omgrid .omcard').length")
        # 絵は1フレームに少しずつ作るので、全部そろうまで待つ
        try:
            await pg.wait_for_function("() => [...document.querySelectorAll('.omgrid .omcard img')].every(i => i.src.startsWith('data:image/png'))", timeout=30000)
        except Exception:
            pass
        imgs = await pg.evaluate("() => [...document.querySelectorAll('.omgrid .omcard img')].filter(i => i.src.startsWith('data:image/png') && i.src.length > 2000).length")
        check('disc screen: 21 cards', n == len(IDS), n)
        check('disc screen: pictures', imgs == len(IDS), imgs)
        mon = await pg.evaluate("() => { const L = window.__app.lobby; return L.view + ':' + (L.mon ? L.mon.userData.id : 'none') + ':' + (L.mon && L.mon.visible); }")
        check('disc screen: 3D monster preview', mon.startswith('disc:') and mon.endswith(':true'), mon)
        await pg.click('.omgrid .omcard[data-id="marksheet"]')
        await pg.wait_for_timeout(300)
        mon2 = await pg.evaluate("() => window.__app.lobby.monId")
        check('disc screen: tapping a card shows that model', mon2 == 'shusseki', mon2)
        await pg.click('.back')
        await pg.wait_for_selector('.screen.home', timeout=15000)
        vis = await pg.evaluate("() => window.__app.lobby.model.visible")
        check('home: character is back', vis)
        # ---- 試合 ----
        await pg.click('.battlebtn', force=True)
        await pg.wait_for_function('window.__app.match && window.__app.match.phase === "play"', timeout=60000)
        await pg.evaluate("""() => { const m = window.__app.match, P = m.player; window.__app.input.enabled = false;
          for (const q of m.punchers) if (q !== P) { q.brain = null; q.pos.set(70, 60, 110); q.vel.set(0, 0, 0); }
          window.__e = m.punchers.find(q => q.team !== P.team); }""")

        async def wg(sec):
            t0 = await pg.evaluate("() => window.__app.match.time")
            await pg.wait_for_function(f"() => window.__app.match.time >= {t0} + {sec}", timeout=90000)

        async def reset(id):
            await pg.evaluate(f"""() => {{ const m = window.__app.match, P = m.player, e = window.__e;
              m.skills.active.length = 0; P.state = 'hover'; P.stateT = 0; P.invuln = 5; P.stunT = 0; P.hurtT = 0;
              P.pos.set(0, 42, -30); P.vel.set(0, 0, 0); P.yaw = 0; P.hp = P.maxHp * 0.5; P.charge = null; P.diskLock = 0;
              P.omamori[0] = '{id}'; P.omCd[0] = 0; e.alive = true; e.hp = e.maxHp; e.pos.set(0, 42, -12); e.vel.set(0, 0, 0); P.lock = e; }}""")

        for id in IDS:
            await reset(id)
            ok = await pg.evaluate("() => window.__app.match.player.useOmamori(0)")
            await wg(0.1)
            s1 = await pg.evaluate("() => { const s = window.__app.match.fx.summons.get(window.__app.match.player); return s ? s.g.userData.id : ''; }")
            # 技が出た瞬間：弾の出る場所と、モンスターの位置
            got = await pg.evaluate("""() => new Promise((res) => { const m = window.__app.match, P = m.player; const t0 = performance.now();
              const tick = () => { const s = m.fx.summons.get(P); if (s && s.phase === 'act') { const pr = m.combat.projectiles[m.combat.projectiles.length - 1];
                  res({ act: true, d: pr && pr.owner === P ? pr.pos.clone().addScaledVector(pr.vel, -pr.age).distanceTo(s.g.position) : -1 }); return; }
                if (performance.now() - t0 > 60000) { res({ act: false }); return; } requestAnimationFrame(tick); }; tick(); })""")
            await wg(2.2)
            left = await pg.evaluate("() => window.__app.match.fx.summons.size + window.__app.match.fx.leaving.length")
            check(f'{id}: used', ok)
            check(f'{id}: monster appears', s1 != '', s1)
            check(f'{id}: monster acts', got.get('act'))
            if id in SHOTS:
                check(f'{id}: shot starts at the monster', 0 <= got.get('d', -1) < 3.5, round(got.get('d', -1), 2))
            check(f'{id}: monster goes away', left == 0, left)
        # ---- 次のモンスターに替わるとき：前のモンスターは消える動きを最後まで見せる ----
        await reset('akahon')
        await pg.evaluate("() => window.__app.match.player.useOmamori(0)")
        await wg(0.3)
        sw = await pg.evaluate("""() => { const m = window.__app.match, P = m.player; const old = m.fx.summons.get(P);
          P.charge = null; m.fx.summonAct(P, 'drink'); const now = m.fx.summons.get(P);
          return { old: old ? old.g.userData.id : '', now: now ? now.g.userData.id : '', leaving: m.fx.leaving.length, oldInScene: !!(old && old.g.parent), oldPhase: old ? old.phase : '' }; }""")
        check('switch: new model comes out', sw['now'] == 'obachan', sw)
        check('switch: old model plays its exit', sw['old'] == 'rocker' and sw['leaving'] == 1 and sw['oldInScene'] and sw['oldPhase'] == 'leave', sw)
        await wg(0.6)
        lv = await pg.evaluate("() => window.__app.match.fx.leaving.length")
        check('switch: old monster is gone after its exit', lv == 0, lv)
        await wg(2.0)
        # ---- 溜め中に攻撃を受けると割れる ----
        await reset('akahon')
        await pg.evaluate("() => window.__app.match.player.useOmamori(0)")
        await wg(0.3)
        await pg.evaluate("() => { const m = window.__app.match; m.player.invuln = 0; m.combat.damage(window.__e, m.player, 50, { kind: 'disk', heavy: true }); }")
        await wg(0.05)
        br = await pg.evaluate("() => ({ s: window.__app.match.fx.summons.size, sh: window.__app.match.fx.shards.length, ch: !!window.__app.match.player.charge })")
        check('break: monster shatters', br['s'] == 0 and br['sh'] > 0 and not br['ch'], br)
        await wg(1.0)
        sh = await pg.evaluate("() => window.__app.match.fx.shards.length")
        check('break: pieces disappear', sh == 0, sh)
        check('no page errors', not errs, errs[:3])
        await b.close()
    bad = [n for n, ok in results if not ok]
    print(f'disc test: {len(results) - len(bad)}/{len(results)} passed')
    sys.exit(1 if bad else 0)


asyncio.run(main())
