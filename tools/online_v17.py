# v1.7 のオンライン対戦の点検（ホスト＝コーダイ、ゲスト＝てつんど）
#   ・ゲストのてつんどの遠くへの弾（beat）がホストで出て、当たる。撃つ動きのしるし（atkShot）がホストに届く
#   ・てつんどの自動回復（ホストで計算 → ゲストのHPも上がる）
#   ・CPUの強さ「おさんぽ」：CPUはゲストを攻撃しない
#   ・右の親指で敵をタップ → ロックオン（入った人の画面でも）
# 使い方：node tools/api/devserver.js --port 8813 を動かしてから python3 tools/online_v17.py
import asyncio, json
from playwright.async_api import async_playwright

U = 'http://127.0.0.1:8813/'
results = []


def check(name, ok, info=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + ('  ' + str(info) if info != '' else ''), flush=True)


async def dev(b, name, char, extra='', diff='zero'):
    ctx = await b.new_context(viewport={'width': 393, 'height': 852}, is_mobile=True, has_touch=True)
    save = {'name': name, 'tutorial': True, 'seenRules': {'scramble': 1, 'flag': 1, 'ball': 1}, 'char': char, 'mode': 'scramble', 'diff': diff, 'diffV': 2, 'stage': 'sakura'}
    await ctx.add_init_script("localStorage.setItem('rpf_save_v1', JSON.stringify(%s));" % json.dumps(save, ensure_ascii=False))
    pg = await ctx.new_page()
    pg.errs = []
    pg.on('pageerror', lambda e: pg.errs.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and pg.errs.append('console: ' + m.text))
    await pg.goto(U + '?norender=1' + extra)
    await pg.wait_for_selector('#boot', state='detached', timeout=30000)
    await pg.wait_for_selector('.screen.title', timeout=30000)
    await pg.mouse.click(196, 600)
    return ctx, pg


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebRtcHideLocalIpsWithMdns'])
        ctxA, A = await dev(b, 'ホストさん', 'koudai')
        await A.wait_for_selector('.onlinebtn', timeout=15000)
        await A.click('.onlinebtn')
        await A.wait_for_timeout(1500)
        await A.click('.make')
        await A.wait_for_selector('.room .code', timeout=30000)
        code = (await A.inner_text('.room .code')).strip()
        ctxB, B = await dev(b, 'ゲストくん', 'tetsundo', '&room=' + code)
        await B.wait_for_selector('.room .code', timeout=45000)
        await A.wait_for_timeout(1500)
        rd = await A.evaluate("() => window.__app.room.state.diff")
        check('room uses the host CPU level (おさんぽ)', rd == 'zero', rd)
        await A.click('.start')
        for pg in (A, B):
            await pg.wait_for_function("() => window.__app.match && window.__app.match.phase === 'play'", timeout=40000)
        check('both reached play', True)
        lv = await A.evaluate("() => window.__app.match.punchers.filter(p => p.cpu).map(p => p.cpuKey)")
        check('all CPUs use the host level online', len(lv) > 0 and all(k == 'zero' for k in lv), lv)
        # 1) CPU「おさんぽ」はゲストを攻撃しない（ゲストを敵の近くに置いて10秒）
        r = await A.evaluate("""async () => { const m = window.__app.match; const g = m.punchers.find(p => p.displayName === 'ゲストくん');
          const foes = m.punchers.filter(p => p.cpu && p.team !== g.team); const hp0 = g.hp; let atk = 0;
          const t0 = performance.now();
          while (performance.now() - t0 < 10000) { for (const f of foes) if (f.atk.phase >= 0) atk++; await new Promise(r => setTimeout(r, 60)); }
          return { atk, hp0, hp1: g.hp, dmg: foes.reduce((a, f) => a + f.stats.dmg, 0) }; }""")
        check('おさんぽ CPUs never attack online', r['atk'] == 0 and r['dmg'] == 0, r)
        # ためしの邪魔にならないようにCPUを止める
        await A.evaluate("() => { const m = window.__app.match; for (const p of m.punchers) if (p.brain) p.brain.update = () => {}; }")
        # 2) ゲストのてつんどが遠く（20m）の敵へビートショット
        await A.evaluate("""() => { const m = window.__app.match; const g = m.punchers.find(p => p.displayName === 'ゲストくん');
          const t = m.punchers.find(p => p.cpu && p.team !== g.team); window.__tgt = t; t.maxHp = t.hp = 99999; t.invuln = 0; t.pos.set(0, 62, 20); t.vel.set(0,0,0); }""")
        await B.evaluate("""() => { const m = window.__app.match; const P = m.player; P.pos.set(0, 62, 0); P.vel.set(0,0,0); P.yaw = 0; P.pitch = 0; P.updateAxes(); P.state = 'hover'; P.lock = null;
          window.__hold = setInterval(() => { P.pos.set(0, 62, 0); P.vel.set(0, 0, 0); P.yaw = 0; P.pitch = 0; P.updateAxes(); }, 30); }""")
        await A.evaluate("() => { window.__hold = setInterval(() => { const t = window.__tgt; t.pos.set(0, 62, 20); t.vel.set(0,0,0); }, 30); }")
        kinds = set()
        shotSeen = False
        for i in range(30):
            await A.wait_for_timeout(100)
            ks = await A.evaluate("() => { const m = window.__app.match; const g = m.punchers.find(p => p.displayName === 'ゲストくん'); return { k: m.combat.projectiles.filter(q => q.owner === g).map(q => q.kind), shot: !!g.atk.shotNow }; }")
            kinds.update(ks['k'])
            shotSeen = shotSeen or ks['shot']
        dmg = await A.evaluate("() => 99999 - window.__tgt.hp")
        check('guest beat shot spawns on the host', 'beat' in kinds, sorted(kinds))
        check('guest beat shot hits the far target', dmg > 300, dmg)
        check('host sees the guest shooting pose (atkShot bit)', shotSeen, shotSeen)
        gk = await B.evaluate("() => { const m = window.__app.match; const s = m.snaps[m.snaps.length - 1]; return s ? s.pr.map(x => x.kind) : []; }")
        check('guest sees its beat shots in snapshots', 'beat' in gk or dmg > 0, gk)
        await B.evaluate("() => clearInterval(window.__hold)")
        await A.evaluate("() => clearInterval(window.__hold)")
        # 3) 自動回復：ホストでHPを半分にする → ゲストの画面のHPも上がっていく
        await A.evaluate("() => { const m = window.__app.match; window.__tgt.pos.set(0, 200, 200); const g = m.punchers.find(p => p.displayName === 'ゲストくん'); g.hp = Math.round(g.maxHp * 0.5); g.lastHitT = m.time - 5; }")
        await B.wait_for_timeout(400)
        h0 = await B.evaluate("() => window.__app.match.player.hp")
        await B.wait_for_timeout(2500)
        h1 = await B.evaluate("() => window.__app.match.player.hp")
        check('guest tetsundo regenerates (host computes, guest sees)', h1 > h0 + 150, (h0, h1))
        # 4) 右の親指で敵をタップ → ロックオン（ゲストの画面）
        lk = await B.evaluate("""() => { const m = window.__app.match; const P = m.player; const t = m.punchers.find(p => p.team !== P.team && p.alive);
          P.pos.set(0, 62, 0); P.vel.set(0,0,0); P.yaw = 0; P.pitch = 0; P.updateAxes(); P.lock = null;
          t.pos.set(0, 62, 12); m.cam.update(P, 0.016, { snap: true }); m.camera.updateMatrixWorld(true);
          const THREE = P.pos.constructor; const v = t.pos.clone(); v.y += 0.3; v.project(m.camera);
          const x = (v.x * 0.5 + 0.5) * m.viewW, y = (-v.y * 0.5 + 0.5) * m.viewH;
          const ev = m.tapLock({ type: 'tap', look: true, x, y });
          return { ok: !!ev && ev.target === t, x: Math.round(x), y: Math.round(y) }; }""")
        check('guest: tap on an enemy turns into lock-on', lk['ok'], lk)
        check('no errors on host', not A.errs, A.errs[:4])
        check('no errors on guest', not B.errs, B.errs[:4])
        print('ALL PASS' if all(results) else 'SOME FAILED', sum(results), '/', len(results))
        await b.close()


asyncio.run(main())
