# v1.7 の点検：CPUの強さ・てつんど・訓練場・ルールの説明・パンチャー画面・操作（右のタップ・敵をタップ・壁ぞい・速いなぞり）・点数
# 使い方：public を 8812 で配信してから python3 tools/v17_test.py
import asyncio, json
from playwright.async_api import async_playwright

URL = 'http://localhost:8812/?norender=1'
results = []


def check(name, ok, info=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + ('  ' + str(info) if info != '' else ''), flush=True)


SAVE = "localStorage.setItem('rpf_noacct','true'); localStorage.setItem('rpf_sound', JSON.stringify({sfx:0,bgm:0})); localStorage.setItem('rpf_a2hs_shown','true'); localStorage.setItem('rpf_save_v1', JSON.stringify(%s));"


async def page(b, save, w=393, h=852, url=URL):
    ctx = await b.new_context(viewport={'width': w, 'height': h}, is_mobile=True, has_touch=True)
    await ctx.add_init_script(SAVE % json.dumps(save, ensure_ascii=False))
    pg = await ctx.new_page()
    pg.errs = []
    pg.on('pageerror', lambda e: pg.errs.append(str(e)))
    await pg.goto(url)
    await pg.wait_for_selector('#boot', state='detached', timeout=30000)
    await pg.wait_for_selector('.screen.title', timeout=30000)
    await pg.wait_for_timeout(600)
    for _ in range(3):
        await pg.mouse.click(w // 2, int(h * 0.7))
        try:
            await pg.wait_for_selector('.screen.home', timeout=6000)
            break
        except Exception:
            pass
    return ctx, pg


WAITPLAY = "async () => { const M = window.__app.match; await new Promise(r => { const f = () => (M.phase === 'play' ? r() : setTimeout(f, 80)); f(); }); return true; }"


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        base = {'name': 'テスト', 'tutorial': True, 'seenRules': {'scramble': 1, 'flag': 1, 'ball': 1}, 'char': 'tora', 'mode': 'scramble', 'diff': 'easy', 'diffV': 2, 'stage': 'sakura'}

        # ===== 1. 保存の読みかえ・6段階 =====
        ctx, pg = await page(b, {**base, 'diff': 'hard', 'diffV': None})
        d = await pg.evaluate("() => window.__app.save.diff")
        check('old save "hard" becomes 鬼 (oni)', d == 'oni', d)
        n = await pg.evaluate("() => document.querySelectorAll('.diffpick .pips i').length")
        nm = await pg.evaluate("() => document.querySelector('.diffpick b').textContent")
        check('home shows a 6-step CPU picker', n == 6 and nm == '鬼', (n, nm))
        await pg.click('.diffpick .dm')
        await pg.click('.diffpick .dm')
        d2 = await pg.evaluate("() => [window.__app.save.diff, document.querySelector('.diffpick b').textContent, document.querySelector('.diffpick small').textContent]")
        check('picker steps down and saves (鬼 → ふつう)', d2[0] == 'normal' and d2[1] == 'ふつう', d2)
        for _ in range(6):
            if await pg.evaluate("() => document.querySelector('.diffpick .dm').disabled"): break
            await pg.click('.diffpick .dm')
        d3 = await pg.evaluate("() => [window.__app.save.diff, document.querySelector('.diffpick .dm').disabled]")
        check('picker stops at the weakest (おさんぽ)', d3[0] == 'zero' and d3[1], d3)
        await ctx.close()

        # ===== 2. おさんぽ／よわよわ の CPU =====
        for key in ['zero', 'weak']:
            ctx, pg = await page(b, {**base, 'diff': key})
            r = await pg.evaluate("""async (key) => {
              const A = window.__app; A.startMatch(); const M = A.match;
              await new Promise(r => { const f = () => (M.phase === 'play' ? r() : setTimeout(f, 80)); f(); });
              M.noTimer = true;
              const P = M.player; P.maxHp = P.hp = 999999;
              const foes = M.punchers.filter(q => q.team !== P.team);
              let atk = 0, maxHit = 0; const hit0 = M.combat.damage.bind(M.combat);
              M.combat.damage = (src, t, base, o) => { const d = hit0(src, t, base, o); if (src && src.team !== P.team && d > 0) maxHit = Math.max(maxHit, d); return d; };
              const t0 = M.time;
              while (M.time - t0 < 25) {
                // 敵のすぐ前に行く（攻撃したくなる場所）
                const f = foes[Math.floor(M.time / 3) % foes.length];
                if (f.alive) { P.pos.copy(f.pos).addScaledVector(f.forward, 2.2); P.vel.set(0, 0, 0); }
                for (const e of foes) if (e.atk.phase >= 0) atk++;
                await new Promise(r => setTimeout(r, 40));
              }
              const gShots = M.combat.projectiles.filter(q => q.kind === 'guardianShot' && q.owner && q.owner.team !== P.team).length;
              return { atk, toMe: 999999 - P.hp, maxHit, ks: foes.reduce((a, q) => a + q.stats.ks + q.stats.sp + q.stats.om, 0), gShots, keys: foes.map(q => q.cpuKey), ally: M.punchers.find(q => q.team === P.team && q.cpu).cpuKey };
            }""", key)
            if key == 'zero':
                check('おさんぽ: enemies never attack, use no skills, deal no damage', r['atk'] == 0 and r['toMe'] == 0 and r['ks'] == 0, r)
                check('おさんぽ: allies are やさしい, enemies おさんぽ', r['ally'] == 'easy' and all(k == 'zero' for k in r['keys']), r)
            else:
                check('よわよわ: hits are tiny (about a quarter of a normal hit) and no skills', r['maxHit'] <= 200 and r['ks'] == 0, r)
            await ctx.close()

        # ===== 3. てつんど：遠くは撃つ・近くは連打・自動回復 =====
        ctx, pg = await page(b, {**base, 'char': 'tetsundo', 'diff': 'zero'})
        r = await pg.evaluate("""async () => {
          const A = window.__app; A.startMatch(); const M = A.match;
          await new Promise(r => { const f = () => (M.phase === 'play' ? r() : setTimeout(f, 80)); f(); });
          for (const q of M.punchers) if (q.brain) q.brain.update = () => {};
          M.noTimer = true;
          // 的は自動回復しないキャラ（てつんどどうしだと、的の HP を大きくしたぶん回復も大きい）
          const P = M.player, E = M.punchers.find(q => q.team !== P.team && q.def.id !== 'tetsundo');
          const put = (d) => { P.pos.set(0, 62, 0); P.vel.set(0,0,0); P.yaw = 0; P.pitch = 0; P.updateAxes(); E.pos.set(0, 62, d); E.vel.set(0,0,0); };
          E.maxHp = E.hp = 99999; let kinds = new Set(), pose = false;
          let t0 = performance.now();
          while (performance.now() - t0 < 3500) { put(22); for (const q of M.combat.projectiles) if (q.owner === P) kinds.add(q.kind); if (P.atk.shotNow && P.atk.phase >= 0 && P.model.userData) pose = true; await new Promise(r => setTimeout(r, 40)); }
          const far = 99999 - E.hp; const h1 = E.hp; const hits0 = P.stats.hits;
          t0 = performance.now();
          while (performance.now() - t0 < 2500) { put(2.4); await new Promise(r => setTimeout(r, 40)); }
          const near = h1 - E.hp;
          // 31m より遠いと撃たない
          const h2 = E.hp; const n0 = M.combat.projectiles.filter(q => q.owner === P).length;
          t0 = performance.now();
          while (performance.now() - t0 < 1500) { put(40); await new Promise(r => setTimeout(r, 40)); }
          const tooFar = h2 - E.hp;
          // 自動回復
          E.pos.set(0, 200, 200);
          P.hp = Math.round(P.maxHp * 0.5); P.lastHitT = M.time;
          const a0 = P.hp, ta = M.time; await new Promise(r => setTimeout(r, 1500)); const a1 = P.hp, tb = M.time;
          P.lastHitT = M.time - 10; const b0 = P.hp; await new Promise(r => setTimeout(r, 1500)); const b1 = P.hp, tc = M.time;
          return { kinds: [...kinds], far, near, tooFar, pose, hp: P.maxHp, slow: (a1 - a0) / (tb - ta) / P.maxHp, calm: (b1 - b0) / (tc - tb) / P.maxHp };
        }""")
        check('てつんど: beat shots at 22m', 'beat' in r['kinds'] and r['far'] > 400, r)
        check('てつんど: melee at close range', r['near'] > 400, r)
        check('てつんど: no shots beyond the range (40m)', r['tooFar'] == 0, r)
        check('てつんど: regen ~1.5%/s in a fight, ~4%/s when calm', 0.01 < r['slow'] < 0.022 and 0.032 < r['calm'] < 0.05, r)
        check('てつんど: HP raised to 3300', r['hp'] == 3300, r['hp'])
        check('no page errors (kits)', not pg.errs, pg.errs[:3])
        await ctx.close()

        # ===== 4. 訓練場 =====
        ctx, pg = await page(b, {**base, 'char': 'tora', 'rp': 50})
        await pg.click('.trainbtn')
        await pg.wait_for_function("() => window.__app.match && window.__app.match.isTraining", timeout=15000)
        await pg.evaluate(WAITPLAY)
        r = await pg.evaluate("""async () => { const M = window.__app.match; return { n: M.dummies.length, panel: !!document.querySelector('.trn'), drills: M.drills.length, noScore: getComputedStyle(document.querySelector('.score-row')).display === 'none' }; }""")
        check('training starts with 3 dummies and a panel', r['n'] == 3 and r['panel'] and r['drills'] >= 14 and r['noScore'], r)
        # ブーストのタップ3回 → 「ブースト」ができる
        for i in range(3):
            await pg.evaluate("() => window.__app.match.player.intent.events.push({ type: 'tap' })")
            await pg.wait_for_timeout(700)
        try:
            await pg.wait_for_function("() => window.__app.match.done.has ? window.__app.match.done.has('dash') : [...window.__app.match.done].includes('dash')", timeout=6000)
        except Exception:
            pass
        dn = await pg.evaluate("() => [...window.__app.match.done]")
        check('drill: 3 boosts → done', 'dash' in dn, dn)
        # 1体にする・反撃にする
        await pg.click('.trn .tgl')
        await pg.click('.trn .num button[data-n="1"]')
        await pg.click('.trn .beh button[data-k="weak"]')
        r = await pg.evaluate("() => { const M = window.__app.match; return { n: M.dummies.length, k: M.dummies[0].cpuKey, rows: document.querySelectorAll('.team-col.right .mem').length, inScene: M.punchers.length }; }")
        check('switch to 1 dummy that fights back (よわよわ)', r['n'] == 1 and r['k'] == 'weak' and r['rows'] == 1 and r['inScene'] == 2, r)
        # サンドバッグをたおす → 同じ場所にもどる（止まるにしてから）
        await pg.click('.trn .beh button[data-k="stand"]')
        r = await pg.evaluate("""async () => { const M = window.__app.match, P = M.player, d = M.dummies[0];
          const a = d.anchor.clone(); d.hp = 1; P.pos.copy(d.pos).addScaledVector(d.forward, 2.0); P.lock = d; P.yaw = d.yaw + Math.PI; P.updateAxes();
          const t0 = performance.now(); while (d.alive && performance.now() - t0 < 4000) { P.pos.copy(d.pos).addScaledVector(d.forward, 2.0); await new Promise(r => setTimeout(r, 40)); }
          const died = !d.alive; P.pos.set(0, 200, 200); P.lock = null;
          const t1 = performance.now(); while (!d.alive && performance.now() - t1 < 4000) await new Promise(r => setTimeout(r, 30));
          return { died, back: d.alive, wait: Math.round(performance.now() - t1), dist: d.pos.distanceTo(a), ko: M.count.ko || 0, hp: d.hp === d.maxHp }; }""")
        check('dummy KO → back at its place soon, counted', r['died'] and r['back'] and r['dist'] < 4 and r['ko'] >= 1, r)
        # 無敵・待ち時間なし・SP満タン
        await pg.click('.trn .god')
        await pg.click('.trn .spfull')
        r = await pg.evaluate("""async () => { const M = window.__app.match, P = M.player; const hp0 = P.hp;
          M.combat.damage(M.dummies[0], P, 500, { kind: 'normal' }); P.ksCd = 5; P.omCd[0] = 9; P.sp = 0;
          await new Promise(r => setTimeout(r, 300)); return { hp: P.hp === hp0, ks: P.ksCd, om: P.omCd[0], sp: P.sp }; }""")
        check('god mode / no cooldowns / SP full', r['hp'] and r['ks'] == 0 and r['om'] == 0 and r['sp'] >= 0.999, r)
        # ステージのはしで「前に呼ぶ」→ サンドバッグは場外の見えない壁の内側に来る
        r = await pg.evaluate("""async () => { const M = window.__app.match, P = M.player, b = M.world.bounds;
          P.pos.set(-b.x + 1, 60, 0); P.vel.set(0, 0, 0); P.yaw = -Math.PI / 2; P.pitch = 0; P.updateAxes();
          document.querySelector('.trn .call').click(); await new Promise(r => setTimeout(r, 200));
          return { bx: b.x, xs: M.dummies.map(d => Math.round(d.anchor.x)), ok: M.dummies.every(d => d.anchor.x >= -b.x + 1 && d.anchor.x <= b.x - 1 && d.anchor.z >= b.zMin + 1 && d.anchor.z <= b.zMax - 1) }; }""")
        check('call dummies at the edge: they stay inside the arena', r['ok'], r)
        # 出る → ホーム、ランクの点は変わらない
        await pg.click('.trn .quit')
        await pg.wait_for_selector('.screen.home', timeout=8000)
        rp = await pg.evaluate("() => [window.__app.save.rp, window.__app.save.plays, !!window.__app.match]")
        check('leaving training: back home, no rank change, no result', rp == [50, 0, False], rp)
        check('no page errors (training)', not pg.errs, pg.errs[:3])
        await ctx.close()
        # 遠くから撃つキャラ（エブン）の訓練場：ダッシュ攻撃のメニューはなし・弾が当たると数える
        ctx, pg = await page(b, {**base, 'char': 'even'})
        await pg.click('.trainbtn')
        await pg.wait_for_function("() => window.__app.match && window.__app.match.isTraining", timeout=15000)
        await pg.evaluate(WAITPLAY)
        r = await pg.evaluate("""async () => { const M = window.__app.match, P = M.player, d = M.dummies[0];
          const ids = M.drills.map(x => x.id); P.lock = d;
          const t0 = performance.now(); while (performance.now() - t0 < 3500) { P.pos.copy(d.pos).addScaledVector(d.forward, 8); P.vel.set(0, 0, 0); await new Promise(r => setTimeout(r, 40)); }
          return { n: ids.length, dash: ids.includes('dashAtk'), hit: Math.floor(M.count.hit || 0), dmg: M.dmgTotal }; }""")
        check('training with a ranged character: 15 drills, shots count as hits', r['n'] == 15 and not r['dash'] and r['hit'] >= 2 and r['dmg'] > 0, r)
        check('no page errors (training, ranged)', not pg.errs, pg.errs[:3])
        await ctx.close()

        # ===== 5. ルールの説明 =====
        ctx, pg = await page(b, {**base, 'seenRules': {}})
        await pg.click('.rulebtn')
        await pg.wait_for_selector('.modal.rules', timeout=5000)
        tabs = await pg.evaluate("() => [...document.querySelectorAll('.modal.rules .rtabs button')].map(b => b.textContent)")
        await pg.click('.modal.rules .rtabs button[data-k="ball"]')
        txt = await pg.evaluate("() => document.querySelector('.modal.rules .rcont').innerText")
        check('rules modal: 3 tabs, ball rules mention the ring and 15 seconds', len(tabs) == 3 and 'リング' in txt and '15秒' in txt, (tabs, txt[:60]))
        await pg.click('.modal.rules .close')
        await pg.click('.battlebtn')
        await pg.wait_for_selector('.modal.rules .go', timeout=5000)
        # 試合の準備（3Dの組み立て）はテスト用のブラウザだと数十秒かかることがあるので、長めに待つ
        await pg.click('.modal.rules .go', timeout=120000)
        await pg.wait_for_function("() => window.__app.match && window.__app.match.phase !== 'result'", timeout=60000)
        gc = await pg.evaluate("() => !!document.querySelector('.goalcard')")
        check('first battle shows the rules, then starts; goal card shown', gc, gc)
        await pg.evaluate("() => { window.__app.endMatch(); window.__app.showHome(); }")
        await pg.click('.battlebtn', timeout=120000)
        await pg.wait_for_timeout(600)
        m2 = await pg.evaluate("() => [!!document.querySelector('.modal.rules'), !!window.__app.match]")
        check('second battle starts right away', m2 == [False, True], m2)
        await ctx.close()

        # ===== 6. パンチャー画面：キャラが一覧と説明のあいだに入る =====
        for (w, h) in [(390, 664), (393, 852), (375, 553)]:
            ctx, pg = await page(b, base, w, h, url='http://localhost:8812/')
            await pg.click('.tabs button[data-t="char"]')
            bad = []
            for cid in ['naot', 'even', 'tetsundo', 'toriki']:
                await pg.evaluate("(id) => [...document.querySelectorAll('.charlist button')].find(b => b.dataset.id === id).click()", cid)
                # カメラが止まるまで待つ（遅い画面ではゆっくり動く）
                await pg.wait_for_timeout(600)
                await pg.evaluate("""async () => { const L = window.__app.lobby; let a = [L.cd, L.cy], n = 0;
                  for (let i = 0; i < 80 && n < 4; i++) { await new Promise(r => setTimeout(r, 100)); const b = [L.cd, L.cy]; n = Math.abs(b[0] - a[0]) < 0.004 && Math.abs(b[1] - a[1]) < 0.004 ? n + 1 : 0; a = b; } }""")
                r = await pg.evaluate("""() => { const A = window.__app, L = A.lobby;
                  const cam = L.cam; cam.updateMatrixWorld(true);
                  const pr = (y) => { const v = new L.model.position.constructor(0, y, 0); v.project(cam); return (1 - v.y) / 2 * A.viewH; };
                  const top = pr(L.charTop - 0.1), feet = pr(-0.95);
                  const lb = document.querySelector('.charlist').getBoundingClientRect().bottom, it = document.querySelector('.info').getBoundingClientRect().top;
                  return { top: Math.round(top), feet: Math.round(feet), lb: Math.round(lb), it: Math.round(it) }; }""")
                if not (r['top'] >= r['lb'] - 2 and r['feet'] <= r['it'] + 2): bad.append((cid, r))
            check(f'char select {w}x{h}: head and feet between the list and the info', not bad, bad[:2])
            await ctx.close()

        # ===== 7. 操作 =====
        ctx, pg = await page(b, {**base, 'char': 'tora', 'diff': 'zero'})
        await pg.evaluate("() => window.__app.startMatch()")
        await pg.evaluate(WAITPLAY)
        G = '''(seq) => { const I = window.__app.input; let T = 1000; const sn = I.now; const se = I.enabled; I.now = () => T; I.enabled = true; I.events.length = 0; I.lookPX = I.lookPY = 0; I.scheme = 'two';
          const ev = (x, y, pid) => ({ pointerId: pid, clientX: x, clientY: y, preventDefault(){}, type: 'pointermove' }); let look = 0;
          for (const s of seq) { if (s[0] === 'down') I.onDown(Object.assign(ev(s[1], s[2], s[3]), { type: 'pointerdown' })); else if (s[0] === 'move') { T += s[4]; I.onMove(ev(s[1], s[2], s[3])); } else if (s[0] === 'up') { T += s[4]; I.onUp(Object.assign(ev(s[1], s[2], s[3]), { type: 'pointerup' })); } }
          look = I.lookPX; const evs = I.events.filter(e => e.type !== 'press').map(e => e.type + (e.look ? ':look' : '')); I.events.length = 0; I.now = sn; I.enabled = se; I.main = null; I.pointers.clear(); I.lookPX = I.lookPY = 0; return { evs, look }; }'''
        r = await pg.evaluate(G, [['down', 300, 500, 9], ['up', 301, 500, 9, 0.09]])
        check('right thumb: a still short touch is a tap (boost)', r['evs'] == ['tap:look'], r)
        r = await pg.evaluate(G, [['down', 300, 500, 9], ['move', 306, 500, 9, 0.05], ['move', 311, 500, 9, 0.05], ['up', 311, 500, 9, 0.02]])
        check('right thumb: a small 11px nudge is NOT a boost', r['evs'] == [], r)
        r1 = await pg.evaluate(G, [['down', 250, 500, 9]] + [['move', 250 + 10 * i, 500, 9, 0.03] for i in range(1, 9)] + [['up', 330, 500, 9, 0.02]])
        r2 = await pg.evaluate(G, [['down', 250, 500, 9]] + [['move', 250 + 10 * i, 500, 9, 0.004] for i in range(1, 9)] + [['up', 330, 500, 9, 0.02]])
        check('right thumb: a fast swipe turns more than a slow one (same 80px)', r2['look'] > r1['look'] * 1.3 and abs(r1['look'] - 80) < 1, (r1['look'], r2['look']))
        # 敵をタップ → ロックオン
        r = await pg.evaluate("""() => { const M = window.__app.match, P = M.player; for (const q of M.punchers) if (q.brain) q.brain.update = () => {};
          const t = M.punchers.find(q => q.team !== P.team && q.alive);
          P.pos.set(0, 62, 0); P.vel.set(0,0,0); P.yaw = 0; P.pitch = 0; P.updateAxes(); P.lock = null; t.pos.set(2, 62.5, 14);
          M.cam.update(P, 0.016, { snap: true }); M.camera.updateMatrixWorld(true);
          const v = t.pos.clone(); v.y += 0.3; v.project(M.camera); const x = (v.x * 0.5 + 0.5) * M.viewW, y = (-v.y * 0.5 + 0.5) * M.viewH;
          const hit = M.tapLock({ type: 'tap', look: true, x: x + 10, y: y - 8 }); const miss = M.tapLock({ type: 'tap', look: true, x: 20, y: 120 });
          return { hit: !!hit && hit.target === t, miss: miss === null }; }""")
        check('tap on an enemy → lock-on, tap on empty sky → boost', r['hit'] and r['miss'], r)
        # 右の親指で向きを変えてから右でタップ → 向きはそのまま（前は左で押したときの向きにもどっていた）
        await pg.evaluate("() => { const M = window.__app.match, P = M.player; P.pos.set(0, 62, 0); P.vel.set(0,0,0); P.yaw = 0; P.pitch = 0; P.updateAxes(); P.lock = null; P.state = 'hover'; P.boost = 6; }")
        await pg.mouse.move(90, 600); await pg.mouse.down(); await pg.wait_for_timeout(80); await pg.mouse.up()
        await pg.wait_for_timeout(300)
        await pg.mouse.move(250, 500); await pg.mouse.down()
        for i in range(1, 13):
            await pg.mouse.move(250 + i * 10, 500); await pg.wait_for_timeout(30)
        await pg.mouse.up()
        await pg.wait_for_timeout(250)
        y1 = await pg.evaluate("() => window.__app.match.player.yaw")
        await pg.mouse.move(300, 450); await pg.mouse.down(); await pg.wait_for_timeout(60); await pg.mouse.up()
        await pg.wait_for_timeout(350)
        r = await pg.evaluate("(y1) => { const P = window.__app.match.player; return { y1, y2: P.yaw, st: P.state }; }", y1)
        check('right-thumb tap after turning keeps the new direction', abs(r['y1']) > 0.3 and abs(r['y2'] - r['y1']) < 0.05 and r['st'] in ('dash', 'cruise'), r)
        # ロック中の敵をタップ → ロックは外れない（ふつうのタップ＝ダッシュ攻撃）
        r = await pg.evaluate("""() => { const M = window.__app.match, P = M.player; const t = M.punchers.find(q => q.team !== P.team && q.alive);
          P.pos.set(0, 62, 0); P.yaw = 0; P.pitch = 0; P.updateAxes(); t.pos.set(0, 62.3, 10); P.lock = t;
          M.cam.update(P, 0.016, { snap: true }); M.camera.updateMatrixWorld(true);
          const v = t.pos.clone(); v.y += 0.3; v.project(M.camera); const x = (v.x * 0.5 + 0.5) * M.viewW, y = (-v.y * 0.5 + 0.5) * M.viewH;
          const ev = M.tapLock({ type: 'tap', look: true, x, y }); P.lock = null; return { ev: ev ? ev.type : null }; }""")
        check('tap on the locked enemy stays a tap (dash attack), not unlock', r['ev'] is None, r)
        # 長押しで壁にぶつかる → 上へすべる（止まらない）
        r = await pg.evaluate("""async () => { const M = window.__app.match, P = M.player, W = M.world; const THREE = P.pos.constructor;
          // まわりで、前に壁のある場所をさがす
          let found = null;
          for (let i = 0; i < 400 && !found; i++) { const x = (Math.random() - 0.5) * 200, z = (Math.random() - 0.5) * 260, y = 6 + Math.random() * 40; const yaw = Math.random() * 6.28;
            const o = new THREE(x, y, z), d = new THREE(Math.sin(yaw), 0, Math.cos(yaw)); const h = W.raycast(o, d, 8); const up = W.raycast(o, new THREE(0, 1, 0), 30);
            if (h > 3 && h < 7 && up > 25) found = { o, yaw }; }
          if (!found) return { skip: true };
          P.pos.copy(found.o); P.vel.set(0, 0, 0); P.yaw = found.yaw; P.pitch = 0; P.updateAxes(); P.state = 'hover';
          const y0 = P.pos.y; const t0 = M.time;
          const I = window.__app.input; I.keys.add(' ');
          while (M.time - t0 < 2.5) await new Promise(r => setTimeout(r, 30));
          I.keys.delete(' ');
          return { rise: P.pos.y - y0, moved: P.pos.distanceTo(found.o) }; }""")
        check('holding forward into a wall slides up instead of stopping', r.get('skip') or r['rise'] > 3, r)
        # ステージのはしの見えない壁：上へはすべらない（横へすべる）
        r = await pg.evaluate("""async () => { const M = window.__app.match, P = M.player, b = M.world.bounds;
          P.pos.set(-b.x + 4, 60, 0); P.vel.set(0, 0, 0); P.yaw = -Math.PI / 2 + 0.4; P.pitch = 0; P.updateAxes(); P.state = 'hover';
          const y0 = P.pos.y, z0 = P.pos.z, t0 = M.time;
          const I = window.__app.input; I.keys.add(' ');
          while (M.time - t0 < 2.0) await new Promise(r => setTimeout(r, 30));
          I.keys.delete(' ');
          return { x: +P.pos.x.toFixed(1), edge: -b.x, rise: +(P.pos.y - y0).toFixed(2), side: +(P.pos.z - z0).toFixed(1) }; }""")
        check('at the arena edge: no climbing the invisible wall, slides sideways', r['x'] <= r['edge'] + 0.5 and r['rise'] < 1.0 and abs(r['side']) > 3, r)
        check('no page errors (controls)', not pg.errs, pg.errs[:3])
        await ctx.close()

        print('ALL PASS' if all(results) else 'SOME FAILED', sum(results), '/', len(results))
        await b.close()


asyncio.run(main())
