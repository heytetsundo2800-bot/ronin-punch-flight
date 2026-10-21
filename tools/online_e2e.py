# オンライン対戦の通し確認：部屋をつくる → コードで入る → 試合 → 攻撃・KO・結果 → 部屋にもどる → もう1試合
# 使い方：node tools/api/devserver.js --port 8813 を動かしてから python3 tools/online_e2e.py
import asyncio, json, sys, time
from playwright.async_api import async_playwright

U = 'http://127.0.0.1:8813/'
OUT = '/tmp/claude-0/-home-claude/cb87e6ba-4022-5281-bc59-7be863cc9efb/scratchpad/shots'
MODE = sys.argv[1] if len(sys.argv) > 1 else 'scramble'
STAGE = sys.argv[2] if len(sys.argv) > 2 else 'sakura'
results = []


def check(name, ok, info=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + ('  ' + str(info) if info != '' else ''), flush=True)


async def dev(b, name, char, extra=''):
    ctx = await b.new_context(viewport={'width': 393, 'height': 852}, is_mobile=True, has_touch=True)
    save = {'name': name, 'tutorial': True, 'char': char, 'mode': MODE, 'diff': 'easy', 'stage': STAGE}
    await ctx.add_init_script("localStorage.setItem('rpf_save_v1', JSON.stringify(%s)); window.__rpfNetDebug = true;" % json.dumps(save, ensure_ascii=False))
    pg = await ctx.new_page()
    pg.errs = []
    pg.logs = []
    pg.on('console', lambda m: pg.logs.append(m.text[:200]))
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
        ctxA, A = await dev(b, 'ホストさん', 'tora')
        await A.wait_for_selector('.onlinebtn', timeout=15000)
        await A.click('.onlinebtn')
        await A.click('.make')
        await A.wait_for_selector('.room .code', timeout=15000)
        code = (await A.inner_text('.room .code')).strip()
        check('host made a room', len(code) == 5 and code.isdigit(), code)
        # 招待リンクで入る
        ctxB, B = await dev(b, 'ゲストくん', 'even', '&room=' + code)
        try:
            await B.wait_for_selector('.room .code', timeout=45000)
            ok = True
        except Exception:
            ok = False
            await B.screenshot(path=f'{OUT}/online_join_fail.png')
            print('B screen:', (await B.evaluate("() => document.body.innerText"))[:300])
        check('guest joined with invite link', ok)
        if not ok:
            print('errors', A.errs[:5], B.errs[:5])
            return
        await A.wait_for_timeout(1200)
        names = await A.evaluate("() => [...document.querySelectorAll('.rslot .nm')].map(e => e.textContent)")
        if 'ゲストくん' not in names:
            print('A roomlog:', await A.evaluate("() => window.__app.room.log"))
            print('B roomlog:', await B.evaluate("() => window.__app.lastRoomLog"))
            print('A logs:', [l for l in A.logs if 'room' in l][-12:])
            print('B logs:', [l for l in B.logs if 'room' in l][-12:])
            print('B screen:', (await B.evaluate("() => document.body.innerText"))[:200])
        check('host lobby shows both', 'ホストさん' in names and 'ゲストくん' in names, names)
        bteam = await A.evaluate("() => window.__app.room.state.members.map(m => m.name + ':' + m.team)")
        check('guest put on the other team', 'ゲストくん:1' in bteam, bteam)
        # ゲストがキャラを変える
        await B.click('.charrow button[data-id=aomachi]')
        # 重い環境では届くまで少しかかるので、5秒まで待つ
        for _ in range(25):
            await A.wait_for_timeout(200)
            ch = await A.evaluate("() => window.__app.room.state.members.find(m => m.name === 'ゲストくん').char")
            if ch == 'aomachi':
                break
        check('guest character change reaches host', ch == 'aomachi', ch)
        # 3人目
        ctxC, C = await dev(b, 'みっつめ', 'tora')
        await C.wait_for_selector('.onlinebtn', timeout=15000)
        await C.click('.onlinebtn')
        await C.fill('.code', code)
        await C.click('.join')
        try:
            await C.wait_for_selector('.room .code', timeout=45000)
            okc = True
        except Exception:
            okc = False
            print('A logs:', [l for l in A.logs if 'room' in l][-12:])
            print('C logs:', [l for l in C.logs if 'room' in l][-12:])
            print('C screen:', (await C.evaluate("() => document.body.innerText"))[:200])
        check('third player joined by typing the code', okc)
        await A.wait_for_timeout(1000)
        n = await A.evaluate("() => window.__app.room.state.members.length")
        check('three members', n == 3, n)
        if n != 3:
            for nm, pg in (('A', A), ('B', B), ('C', C)):
                print(nm, 'roomlog:', await pg.evaluate("() => (window.__app.room && window.__app.room.log) || window.__app.lastRoomLog"))
        await A.click(f'.stg button[data-k="{STAGE}"]')
        await A.wait_for_timeout(900)
        gtxt = await B.evaluate("() => (document.querySelector('.ropts') || document.body).innerText")
        check('guest lobby shows the stage', ('サクラ浮島' if STAGE == 'sakura' else 'キャンパス') in gtxt, gtxt.replace('\n', ' | ')[:120])
        await A.screenshot(path=f'{OUT}/online_lobby.png')
        # スタート
        await A.click('.start')
        for pg in (A, B, C):
            await pg.wait_for_function("() => window.__app.match && window.__app.match.phase === 'play'", timeout=40000)
        check('all three reached play', True)
        sids = [await pg.evaluate("() => window.__app.match.stage.id") for pg in (A, B, C)]
        check('everyone plays on the same stage', sids[0] == sids[1] == sids[2] == STAGE, sids)
        info = await B.evaluate("() => { const m = window.__app.match; return {n: m.punchers.length, me: m.player.displayName, team: m.player.team, client: !!m.netClient, humans: m.punchers.filter(p => p.human).map(p => p.displayName)} }")
        check('guest is a client with 8 punchers', info['n'] == 8 and info['client'] and info['me'] == 'ゲストくん', info)
        # 位置が同じか（ホストのキャラ：ホストの本当の位置とゲストに見えている位置）
        await A.evaluate("() => { const P = window.__app.match.player; P.pos.set(0, 40, -60); P.vel.set(0,0,0); P.state = 'hover'; }")
        await A.wait_for_timeout(1200)
        d = await B.evaluate("() => { const m = window.__app.match; const h = m.punchers.find(p => p.displayName === 'ホストさん'); return h.pos.distanceTo({x:0, y:40, z:-60}); }")
        check('guest sees host position', d < 1.5, round(d, 2))
        # ゲストが飛ぶ → ホストに見える
        await B.evaluate("() => { const P = window.__app.match.player; P.pos.set(10, 45, 0); P.vel.set(0,0,0); P.state='hover'; P.yaw = 0; P.pitch = 0; const I = window.__app.input; I._s = I.sample; I.sample = function(){ this._s(); this.hold = true; this.stickX = 0; this.stickY = 0; }; }")
        await B.wait_for_timeout(1500)
        await B.evaluate("() => { const I = window.__app.input; I.sample = I._s; }")
        g = await B.evaluate("() => { const P = window.__app.match.player; return [P.pos.x, P.pos.y, P.pos.z, P.state]; }")
        await A.wait_for_timeout(400)
        h = await A.evaluate("() => { const p = window.__app.match.punchers.find(p => p.displayName === 'ゲストくん'); return [p.pos.x, p.pos.y, p.pos.z, p.state, !!p.remote]; }")
        dist = ((g[0] - h[0]) ** 2 + (g[1] - h[1]) ** 2 + (g[2] - h[2]) ** 2) ** 0.5
        check('guest flew forward', g[2] > 4, g)
        check('host sees guest where guest is (remote-driven)', dist < 3 and h[4], (round(dist, 2), h))
        # ディスクのモンスター：ホストが使う → ゲストの画面にも出て、技を出して消える
        # （弾がすぐ何かに当たって消えないように、ひらけた空へ出てから使う）
        await A.evaluate("() => { const P = window.__app.match.player; P.pos.set(-60, 80, -40); P.vel.set(0, 0, 0); P.yaw = Math.PI / 2; P.lock = null; P.state = 'hover'; P.stunT = 0; P.hurtT = 0; P.charge = null; P.diskLock = 0; P.invuln = 3; P.omamori[0] = 'akahon'; P.omCd[0] = 0; P.useOmamori(0); }")
        seen = None
        acted = False
        for _ in range(40):
            await B.wait_for_timeout(100)
            r = await B.evaluate("() => { const m = window.__app.match; const hp = m.punchers.find(p => p.displayName === 'ホストさん'); const s = m.fx.summons.get(hp); return s ? s.phase + ':' + s.g.userData.id : ''; }")
            if r and not seen:
                seen = r
            if r.startswith('act'):
                acted = True
                break
        check('guest sees the host summon a monster', bool(seen) and seen.endswith('drake'), seen)
        check('guest sees the monster attack', acted)
        # その弾（ホストの弾）がゲストの画面に見える
        hshot = None
        for _ in range(60):
            await B.wait_for_timeout(100)
            hshot = await B.evaluate("() => { const m = window.__app.match; for (const q of m.projs.values()) if (!q.mine && q.mesh && q.mesh.visible) return true; return false; }")
            if hshot:
                break
        check("guest sees the host's shot", hshot)
        # ゲストが使う → ホストの画面に出る（自分の画面では二重に出ない）
        # （デッキはホストが持っているものを使う。ゲストの1枚目のモンスター）
        want = await A.evaluate("() => { const m = window.__app.match; const gp = m.punchers.find(p => p.displayName === 'ゲストくん'); return gp.omamori[0]; }")
        await B.evaluate("() => { const P = window.__app.match.player; P.state = 'hover'; P.charge = null; P.diskLock = 0; P.omCd[0] = 0; P.useOmamori(0); }")
        mine = await B.evaluate("() => { const m = window.__app.match; const s = m.fx.summons.get(m.player); return s ? s.om.id : ''; }")
        check('guest sees its own monster at once', mine == want, (mine, want))
        seenH = None
        for _ in range(30):
            await A.wait_for_timeout(100)
            seenH = await A.evaluate("() => { const m = window.__app.match; const gp = m.punchers.find(p => p.displayName === 'ゲストくん'); const s = m.fx.summons.get(gp); return s ? s.om.id : ''; }")
            if seenH:
                break
        check('host sees the guest summon the same monster', seenH == want, (seenH, want))
        # テスト用の画面は遅く、試合の時間が実際の時間よりゆっくり進むので、消えるまで待つ
        left = None
        for _ in range(60):
            await B.wait_for_timeout(250)
            left = await B.evaluate("() => { const m = window.__app.match; const hp = m.punchers.find(p => p.displayName === 'ホストさん'); return [m.fx.summons.has(hp) || m.fx.leaving.some(s => s.p === hp), m.fx.summons.has(m.player) || m.fx.leaving.some(s => s.p === m.player)]; }")
            if left == [False, False]:
                break
        check('monsters go away on the guest screen', left == [False, False], left)
        # ゲストの弾：自分の弾は「いま」の時刻で表示するので、届いたらすぐ見える
        await A.evaluate("() => { const m = window.__app.match; const gp = m.punchers.find(p => p.displayName === 'ゲストくん'); gp.omamori[1] = 'akahon'; gp.omCd[1] = 0; }")
        await B.evaluate("() => { const P = window.__app.match.player; P.pos.set(60, 80, -40); P.vel.set(0, 0, 0); P.yaw = -Math.PI / 2; P.lock = null; P.omamori[1] = 'akahon'; P.omCd[1] = 0; P.state = 'hover'; P.charge = null; P.diskLock = 0; P.useOmamori(1); }")
        own = None
        for _ in range(100):
            await B.wait_for_timeout(100)
            own = await B.evaluate("() => { const m = window.__app.match; for (const q of m.projs.values()) if (q.mine) return { vis: !!(q.mesh && q.mesh.visible), d: q.mesh ? +q.mesh.position.distanceTo(m.player.pos).toFixed(1) : -1 }; return null; }")
            if own and own['vis']:
                break
        check('guest sees its own shot at once', bool(own) and own['vis'], own)
        # ゲストの攻撃がホストで当たる：敵のCPUのそばへ
        hit = await B.evaluate("""async () => {
            const m = window.__app.match; const P = m.player;
            const e = m.punchers.find(p => p.team !== P.team && p.cpu && p.alive);
            P.pos.copy(e.pos).add({x: 0, y: 0, z: -3}); P.vel.set(0,0,0); P.state = 'hover';
            return e.netId;
        }""")
        await A.evaluate("(id) => { const e = window.__app.match.punchers[id]; e.brain = null; e.intent.hold = false; e.intent.stickX = 0; e.intent.stickY = 0; e.vel.set(0,0,0); e.invuln = 0; window.__hp0 = e.hp; }", hit)
        # 敵をその場に止めておき、ゲストを近くに置きつづける（ホスト側）
        for i in range(10):
            await A.evaluate("(id) => { const e = window.__app.match.punchers[id]; e.vel.set(0,0,0); e.intent.events.length = 0; }", hit)
            await B.evaluate("(id) => { const m = window.__app.match; const P = m.player; const e = m.punchers[id]; P.pos.copy(e.pos).add({x:0,y:0,z:-2.4}); P.vel.set(0,0,0); P.yaw = 0; P.lock = e; }", hit)
            await B.wait_for_timeout(250)
        hp = await A.evaluate("(id) => [window.__hp0, window.__app.match.punchers[id].hp]", hit)
        check('guest punches damage the CPU on host', hp[1] < hp[0], hp)
        await A.wait_for_timeout(400)
        hpB = await B.evaluate("(id) => window.__app.match.punchers[id].hp", hit)
        check('guest sees the damage too', abs(hpB - hp[1]) < 400, (hpB, hp[1]))
        st = await B.evaluate("() => window.__app.match.player.stats.hits")
        # ゲストのスキル（お守り）→ ホストで発動
        om0 = await A.evaluate("() => window.__app.match.punchers.find(p => p.displayName === 'ゲストくん').stats.om")
        om1 = om0
        for attempt in range(3):
            await B.evaluate("() => { const P = window.__app.match.player; P.omCd = P.omCd.map(() => 0); P.diskLock = 0; P.stunT = 0; P.hurtT = 0; P.charge = null; P.state = 'hover'; P.lock = null; P.pos.set(0, 60, 0); P.intent.events.push({type: 'skill', slot: 0}); }")
            try:
                await A.wait_for_function("(o) => window.__app.match.punchers.find(p => p.displayName === 'ゲストくん').stats.om > o", arg=om0, timeout=6000)
            except Exception:
                pass
            om1 = await A.evaluate("() => window.__app.match.punchers.find(p => p.displayName === 'ゲストくん').stats.om")
            if om1 > om0:
                break
        check('guest omamori fires on host', om1 > om0, (om0, om1))
        # ゲストがやられる → 復活
        gid = await B.evaluate("() => window.__app.match.player.netId")
        await A.evaluate("(gid) => { const m = window.__app.match; const v = m.punchers[gid]; v.invuln = 0; v.hp = 1; const k = m.punchers.find(p => p.team !== v.team); m.combat.damage(k, v, 500, {kind: 'normal'}); }", gid)
        await B.wait_for_timeout(1500)
        dead = await B.evaluate("() => { const P = window.__app.match.player; return [P.alive, P.state, !document.querySelector('.deadbox').classList.contains('hidden')]; }")
        check('guest sees own KO', dead[0] is False and dead[2], dead)
        try:
            await B.wait_for_function("() => window.__app.match.player.alive", timeout=25000)
        except Exception:
            pass
        alive = await B.evaluate("() => { const P = window.__app.match.player; const b = window.__app.match.stage.bases[P.team]; return [P.alive, P.pos.distanceTo(b.respawn[P.slot % b.respawn.length])]; }")
        check('guest respawns at base', alive[0] and alive[1] < 6, alive)
        try:
            await A.wait_for_function("(gid) => { const p = window.__app.match.punchers[gid]; return p.alive && p.netIn && p.netIn.life === p.life; }", arg=gid, timeout=10000)
        except Exception:
            pass
        hv = await A.evaluate("(gid) => { const p = window.__app.match.punchers[gid]; const n = window.__app.match.player; return [p.alive, p.life, p.netIn && p.netIn.life]; }", gid)
        check('host accepts guest after respawn (life matches)', hv[0] and hv[1] == hv[2], hv)
        # スペシャル
        await A.evaluate("(gid) => { window.__app.match.punchers[gid].sp = 1; }", gid)
        await B.wait_for_timeout(600)
        await B.wait_for_function("() => window.__app.match.player.sp >= 1", timeout=10000)
        await B.evaluate("() => { const P = window.__app.match.player; P.intent.events.push({type: 'special'}); }")
        try:
            await A.wait_for_function("(gid) => window.__app.match.punchers[gid].stats.sp >= 1", arg=gid, timeout=8000)
        except Exception:
            pass
        sp = await A.evaluate("(gid) => { const p = window.__app.match.punchers[gid]; return [p.sp, p.stats.sp, p.state]; }", gid)
        check('guest special runs on host', sp[1] >= 1, sp)
        sps = await B.evaluate("() => window.__app.match.player.state")
        # スタンプ：3人目（ホストと同じ青チーム）→ ホストに見える、赤チームのゲストには見えない
        await C.evaluate("() => window.__app.match.sendStamp(0)")
        await A.wait_for_timeout(1200)
        cid = await C.evaluate("() => window.__app.match.player.netId")
        sa = await A.evaluate("(cid) => { const t = window.__app.match.hud.tags.get(window.__app.match.punchers[cid]); return t ? [t.sayT > 0, t.say.textContent] : null; }", cid)
        sb = await B.evaluate("(cid) => { const t = window.__app.match.hud.tags.get(window.__app.match.punchers[cid]); return t ? t.sayT > 0 : false; }", cid)
        check('team stamp reaches teammate only', sa and sa[0] and sa[1] == 'ナイス！' and not sb, (sa, sb))
        await A.screenshot(path=f'{OUT}/online_host.png')
        await B.screenshot(path=f'{OUT}/online_guest.png')
        # 終わらせる
        await A.evaluate("() => { window.__app.match.timeLeft = 0.2; }")
        for pg in (A, B, C):
            await pg.wait_for_selector('.screen.result', timeout=25000)
        txt = await B.inner_text('.screen.result')
        check('guest result screen (online buttons)', '部屋にもどる' in txt and 'ゲストくん' in txt, txt.replace('\n', ' | ')[:160])
        sA = await A.evaluate("() => [...document.querySelectorAll('.result .dia span')].map(e => e.textContent)")
        sB = await B.evaluate("() => [...document.querySelectorAll('.result .dia span')].map(e => e.textContent)")
        check('same score on both screens', sA == sB, (sA, sB))
        # 部屋にもどって、もう1試合
        for pg in (B, A, C):
            await pg.click('.result .again', force=True)
        try:
            await A.wait_for_selector('.room .start', timeout=15000)
        except Exception:
            print('A screen:', (await A.evaluate("() => document.body.innerText"))[:300])
            print('A modal:', await A.evaluate("() => [...document.querySelectorAll('.modal')].map(m => m.innerText)"))
            print('A errs:', A.errs[:5], 'B errs:', B.errs[:5])
            print('A screens:', await A.evaluate("() => [...document.querySelectorAll('#screens > *')].map(e => e.className)"))
            raise
        await A.wait_for_timeout(800)
        await A.click('.start')
        for pg in (A, B, C):
            await pg.wait_for_function("() => window.__app.match && window.__app.match.phase === 'play'", timeout=40000)
        check('second match started for all', True)
        # 3人目が抜ける → CPUに
        await C.evaluate("() => { window.__app.leaveRoom(); window.__app.endMatch(); window.__app.showHome(); }")
        await A.wait_for_timeout(2500)
        cpu = await A.evaluate("() => window.__app.match.punchers.filter(p => p.displayName.includes('(CPU)')).length")
        check('leaver replaced by CPU', cpu == 1, cpu)
        # ホストが部屋をとじる → ゲストはホームへ
        await A.evaluate("() => { window.__app.leaveRoom(); window.__app.endMatch(); window.__app.showHome(); }")
        try:
            await B.wait_for_selector('.screen.home', timeout=15000)
            back = True
        except Exception:
            back = False
        check('guest returns home when host closes', back)
        errs = [e for e in A.errs + B.errs + C.errs if '429' not in e]  # 429 はテストで登録しすぎたときの回数制限
        check('no page errors', not errs, errs[:5])
        print(f'online e2e ({MODE}, {STAGE}): {sum(results)}/{len(results)} passed')
        await b.close()

asyncio.run(main())
