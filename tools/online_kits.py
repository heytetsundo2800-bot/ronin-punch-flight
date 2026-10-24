# オンライン対戦で v1.5 の仲間の技がちゃんと伝わるか（ホスト＝コーダイ、ゲスト＝はやた）
# 使い方：node tools/api/devserver.js --port 8813 を動かしてから python3 tools/online_kits.py
import asyncio, json
from playwright.async_api import async_playwright

U = 'http://127.0.0.1:8813/'
results = []


def check(name, ok, info=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + ('  ' + str(info) if info != '' else ''), flush=True)


async def dev(b, name, char, extra=''):
    ctx = await b.new_context(viewport={'width': 393, 'height': 852}, is_mobile=True, has_touch=True)
    save = {'name': name, 'tutorial': True, 'seenRules': {'scramble': 1, 'flag': 1, 'ball': 1}, 'char': char, 'mode': 'scramble', 'diff': 'easy', 'stage': 'sakura'}
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
        try:
            await A.wait_for_selector('.room .code', timeout=30000)
        except Exception:
            print('A screen:', (await A.evaluate("() => document.body.innerText"))[:300], A.errs[:3])
            raise
        code = (await A.inner_text('.room .code')).strip()
        ctxB, B = await dev(b, 'ゲストくん', 'hayata', '&room=' + code)
        await B.wait_for_selector('.room .code', timeout=45000)
        await A.wait_for_timeout(1500)
        await A.click('.start')
        for pg in (A, B):
            await pg.wait_for_function("() => window.__app.match && window.__app.match.phase === 'play'", timeout=40000)
        check('both reached play', True)
        # 同じ相性の結果
        sa = await A.evaluate("() => JSON.stringify(window.__app.match.synergies)")
        sb = await B.evaluate("() => JSON.stringify(window.__app.match.synergies)")
        check('same synergy list on both', sa == sb, sa[:120])
        ids = await B.evaluate("() => window.__app.match.punchers.map(p => p.def.id)")
        ida = await A.evaluate("() => window.__app.match.punchers.map(p => p.def.id)")
        check('same roster on both', ids == ida, ids)
        # CPUを止めておく（ためしの邪魔にならないように）
        await A.evaluate("() => { const m = window.__app.match; for (const p of m.punchers) if (p.brain) p.brain.update = () => {}; m.player.invuln = 99; }")
        await B.evaluate("() => { const m = window.__app.match; m.fx._say = m.fx.say; window.__says = []; m.fx.say = function (p, t, c, l) { window.__says.push(t); return this._say(p, t, c, l); }; }")
        # 1) ゲストのスキル：チャリで静岡まで（自分の端末ですぐ動く・ホストで効き目）
        await B.evaluate("() => { const P = window.__app.match.player; P.pos.set(0, 60, -20); P.vel.set(0,0,0); P.state = 'hover'; P.stunT = 0; P.hurtT = 0; P.ksCd = 0; P.charge = null; P.lock = null; P.yaw = 0; P.pitch = 0; P.intent.events.push({ type: 'skill', slot: 2 }); }")
        await B.wait_for_timeout(300)
        g = await B.evaluate("() => { const m = window.__app.match; const P = m.player; return { st: P.state, v: Math.round(P.vel.length()), bike: (m.fx.kprops || []).some(q => q.kind === 'bike' && q.p === P) }; }")
        check('guest bike dash moves locally right away', g['st'] == 'skill' and g['v'] > 30 and g['bike'], g)
        await A.wait_for_timeout(900)
        ks = await A.evaluate("() => window.__app.match.punchers.find(p => p.displayName === 'ゲストくん').stats.ks")
        check('host counted the guest skill', ks == 1, ks)
        says = await B.evaluate("() => window.__says.slice()")
        check('guest got the skill words from host (fx.say)', '静岡まで！' in says, says[:6])
        # 2) ホストが決める状態（ゲストに効き目 → ゲストの端末に届く）
        await A.evaluate("() => { const m = window.__app.match; const g = m.punchers.find(p => p.displayName === 'ゲストくん'); g.addMod('fresh', { spd: 0.3 }, 4); g.addMod('chug', { atk: 0.4 }, 0.6); }")
        await A.wait_for_timeout(1400)
        st = await B.evaluate("() => { const P = window.__app.match.player; return { spd: P.modSpd, drunk: +P.drunkT.toFixed(2), status: P.status }; }")
        check('guest got speed-up from host (modSpd)', abs(st['spd'] - 0.3) < 0.02, st)
        check('guest got drunk after chug ended (drunkT + status bit)', st['drunk'] > 0.5 and (st['status'] & 2), st)
        # 3) ホスト本人のスキル（一気飲み）→ ゲストから見て怒りのしるし
        await A.evaluate("() => { const P = window.__app.match.player; P.state = 'hover'; P.ksCd = 0; P.charge = null; P.stunT = 0; P.hurtT = 0; P.intent.events.push({ type: 'skill', slot: 2 }); }")
        await A.wait_for_timeout(800)
        hs = await B.evaluate("() => { const m = window.__app.match; const h = m.punchers.find(p => p.displayName === 'ホストさん'); return h.status; }")
        check('guest sees host status (rage while chugging)', hs & 1, hs)
        # 4) 新しい弾の種類・わなの種類がそのまま届く
        await A.evaluate("""() => { const m = window.__app.match; const P = m.player; const THREE = P.pos.constructor;
          m.combat.spawnProjectile({ owner: P, pos: P.pos.clone().add(new THREE(0, 30, 0)), vel: new THREE(0, 0, 3), dmg: 1, radius: 0.5, life: 3, kind: 'vomit', opts: {} });
          m.combat.spawnProjectile({ owner: P, pos: P.pos.clone().add(new THREE(3, 30, 0)), vel: new THREE(0, 0, 3), dmg: 1, radius: 0.5, life: 3, kind: 'voice', opts: {} });
          m.combat.addArea({ owner: P, team: P.team, pos: P.pos.clone().add(new THREE(0, 40, 0)), r: 5.5, life: 4, kind: 'noodle', update: () => {} }); }""")
        await A.wait_for_timeout(700)
        pr = await B.evaluate("() => { const m = window.__app.match; const s = m.snaps[m.snaps.length - 1]; return { pr: s.pr.map(x => x.kind), ar: s.ar.map(x => x.kind), meshes: m.areasR.size }; }")
        check('guest sees new projectile kinds', 'vomit' in pr['pr'] and 'voice' in pr['pr'], pr)
        check('guest sees the noodle trap', 'noodle' in pr['ar'] and pr['meshes'] >= 1, pr)
        # 5) ゲストのスペシャルの動き（ボディプレスの、自分の端末での動き）
        mv = await B.evaluate("""async () => { const m = window.__app.match; const P = m.player; const d0 = P.def; P.def = Object.assign({}, d0, { special: { id: 'bodyPress' } }); P.state = 'hover'; P.pos.set(0, 50, 0); P.vel.set(0,0,0);
          m.skills.fireSpecial(P); const y0 = P.pos.y; await new Promise(r => setTimeout(r, 350)); const y1 = P.pos.y; P.def = d0; return { y0, y1, act: m.skills.active.map(a => a.kind) }; }""")
        check('guest body press goes up locally', mv['y1'] > mv['y0'] + 1, mv)
        # 6) ホストの技で止められたとき、ゲストが溜めていたディスクも止まる（cc がとどく）
        await B.evaluate("() => { const P = window.__app.match.player; P.state = 'hover'; P.stunT = 0; P.hurtT = 0; P.charge = null; P.diskLock = 0; P.omCd[0] = 0; P.pos.set(0, 60, 30); P.vel.set(0,0,0); P.useOmamori(0); }")
        await A.wait_for_timeout(250)
        await A.evaluate("""() => { const m = window.__app.match, P = m.player, g = m.punchers.find(q => q.displayName === 'ゲストくん');
          const d0 = P.def;
          P.def = Object.assign({}, d0, { skill: { id: 'moriTalk', name: '盛りトーク', cd: 11 } });
          P.pos.copy(g.pos).add(new P.pos.constructor(0, 0, -6)); P.yaw = 0; P.lock = g; P.updateAxes(); P.state = 'hover';
          m.skills.useKS(P); P.def = d0; }""")
        await B.wait_for_timeout(900)
        ch = await B.evaluate("() => { const P = window.__app.match.player; return { charge: !!P.charge, stun: +P.stunT.toFixed(2), cd: +P.omCd[0].toFixed(1) }; }")
        check('guest disc charge is cancelled by a host hold (cc)', not ch['charge'], ch)
        # 7) トリキの三大欲求：ゲストが出した順番をホストも使う
        await A.evaluate("() => { const m = window.__app.match, g = m.punchers.find(q => q.displayName === 'ゲストくん'); window.__d0 = g.def; g.def = Object.assign({}, g.def, { skill: { id: 'desires', name: '三大欲求', cd: 10 } }); g.desireIdx = 0; }")
        await B.evaluate("() => { const m = window.__app.match, P = m.player; window.__d0 = P.def; P.def = Object.assign({}, P.def, { skill: { id: 'desires', name: '三大欲求', cd: 10 } }); P.desireIdx = 2; P.ksCd = 0; P.state = 'hover'; P.stunT = 0; P.hurtT = 0; P.charge = null; P.intent.events.push({ type: 'skill', slot: 2 }); }")
        await A.wait_for_timeout(900)
        di = await A.evaluate("() => { const m = window.__app.match, g = m.punchers.find(q => q.displayName === 'ゲストくん'); const v = g.desireIdx; g.def = window.__d0; return v; }")
        dg = await B.evaluate("() => { const P = window.__app.match.player; const v = P.desireIdx; P.def = window.__d0; return v; }")
        check('三大欲求 stays in step (host uses the guest index)', di == 3 and dg == 3, (di, dg))
        check('no errors on host', not A.errs, A.errs[:4])
        check('no errors on guest', not B.errs, B.errs[:4])
        print('ALL PASS' if all(results) else 'SOME FAILED', sum(results), '/', len(results))
        await b.close()


asyncio.run(main())
