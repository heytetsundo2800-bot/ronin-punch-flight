# v1.8：フレンドのオンライン表示と、部屋への招待（ブロスタのように）の通し確認
# 使い方：node tools/api/devserver.js --port 8813 を動かしてから python3 tools/invite_test.py
import asyncio, json, sys, time
from playwright.async_api import async_playwright

U = 'http://127.0.0.1:8813/'
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/claude-0/-home-claude/cb87e6ba-4022-5281-bc59-7be863cc9efb/scratchpad/v18'
results = []


def check(name, ok, info=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + ('  ' + str(info) if info != '' else ''), flush=True)


async def dev(b, name, char):
    ctx = await b.new_context(viewport={'width': 393, 'height': 852}, is_mobile=True, has_touch=True, device_scale_factor=2)
    save = {'name': name, 'tutorial': True, 'seenRules': {'scramble': 1, 'flag': 1, 'ball': 1}, 'char': char, 'mode': 'scramble', 'diff': 'easy', 'stage': 'sakura'}
    await ctx.add_init_script("localStorage.setItem('rpf_save_v1', JSON.stringify(%s)); localStorage.setItem('rpf_sound', JSON.stringify({sfx:0,bgm:0})); localStorage.setItem('rpf_a2hs_shown','true');" % json.dumps(save, ensure_ascii=False))
    pg = await ctx.new_page()
    pg.errs = []
    pg.on('pageerror', lambda e: pg.errs.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and pg.errs.append('console: ' + m.text))
    await pg.goto(U + '?norender=1')
    await pg.wait_for_selector('#boot', state='detached', timeout=30000)
    await pg.wait_for_selector('.screen.title', timeout=30000)
    await pg.mouse.click(196, 560)
    await pg.wait_for_selector('.screen.home', timeout=20000)
    await pg.wait_for_function("() => { try { const a = JSON.parse(localStorage.getItem('rpf_acct_v1')); return a && a.fc; } catch (e) { return false; } }", timeout=20000)
    return ctx, pg


async def poke(*pgs):
    for pg in pgs:
        await pg.evaluate("() => window.__app.net.pokePresence()")


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebRtcHideLocalIpsWithMdns'])
        ctxA, A = await dev(b, 'アキラ', 'tora')
        ctxB, B = await dev(b, 'ベニ', 'even')
        ctxC, C = await dev(b, 'チカ', 'yuka')  # フレンドではない人
        fcA = await A.evaluate("() => JSON.parse(localStorage.getItem('rpf_acct_v1')).fc")
        r = await B.evaluate("(c) => window.__app.net.addFriend(c)", fcA)
        check('B adds A as a friend', r and r.get('ok'), r)
        await A.evaluate("() => { window.__app.net.friendsCache = null; }")
        # ホーム：オンラインのフレンドの数
        await poke(B)
        await A.wait_for_timeout(600)
        await A.evaluate("() => window.__app.showHome()")
        for _ in range(4):
            await poke(A)
            await A.wait_for_timeout(900)
            sub = await A.inner_text('.home .onlsub')
            if 'オンライン' in sub:
                break
        check('home shows how many friends are online', 'フレンド 1人がオンライン' in sub, sub)
        await A.screenshot(path=f'{OUT}/inv_home.png')
        # A が部屋をつくる → フレンドを招待
        await A.click('.onlinebtn')
        await A.click('.make')
        await A.wait_for_selector('.room .code', timeout=20000)
        code = (await A.inner_text('.room .code')).strip()
        await A.wait_for_timeout(500)
        await A.click('.room .finvbtn')
        await A.wait_for_selector('.modal.finvm .frow', timeout=15000)
        await poke(A)
        await A.wait_for_timeout(1500)
        rows = await A.evaluate("() => [...document.querySelectorAll('.modal.finvm .frow')].map(r => [r.querySelector('.nm').childNodes[0].textContent, r.querySelector('.fst').textContent, r.querySelector('.send').disabled])")
        check('invite list shows the friend as online with an invite button', rows == [['ベニ', 'オンライン', False]], rows)
        await A.screenshot(path=f'{OUT}/inv_list.png')
        await A.click('.modal.finvm .send')
        await A.wait_for_timeout(700)
        toast = await A.evaluate("() => [...document.querySelectorAll('.toast')].map(t => t.innerText).join(' | ')")
        lbl = await A.inner_text('.modal.finvm .send')
        check('invite sent (toast + button says 送った)', 'ベニ さんに招待を送りました' in toast and lbl.strip() == '送った', (toast, lbl))
        await A.click('.modal.finvm .close')
        # B に招待がとどく → 参加する
        t0 = time.time()
        await poke(B)
        try:
            await B.wait_for_selector('.modal.invm', timeout=15000)
            got = True
        except Exception:
            got = False
        txt = await B.inner_text('.modal.invm') if got else ''
        check('friend gets "〇〇さんから招待" with the room', got and 'アキラ さんから招待' in txt and code in txt, txt.replace('\n', ' | ')[:120])
        await B.screenshot(path=f'{OUT}/inv_popup.png')
        await B.click('.modal.invm .join')
        try:
            await B.wait_for_selector('.room .code', timeout=120000)
            joined = (await B.inner_text('.room .code')).strip() == code
        except Exception:
            joined = False
        check('参加する → joins the inviter\'s room', joined)
        await A.wait_for_timeout(1500)
        names = await A.evaluate("() => [...document.querySelectorAll('.rslot .nm')].map(e => e.textContent)")
        check('host sees the friend in the room', any('ベニ' in n for n in names), names)
        # フレンドではない人には送れない・一覧にも出ない
        r = await C.evaluate("(code) => window.__app.net.call('inv', { to: JSON.parse(localStorage.getItem('rpf_acct_v1')).uid.replace(/./, 'z'), r: code })", code)
        check('non-friend cannot invite', r.get('ok') is not True, r)
        # 部屋にいる・対戦中のようす
        await poke(A, B)
        await B.wait_for_timeout(1000)
        await A.evaluate("() => window.__app.net.friendsCache = null")
        await A.click('.room .finvbtn')
        await A.wait_for_selector('.modal.finvm .frow', timeout=15000)
        await poke(A)
        await A.wait_for_timeout(1500)
        st = await A.evaluate("() => document.querySelector('.modal.finvm .frow .fst').textContent")
        check('friend in my room shows 部屋にいる', st == '部屋にいる', st)
        await A.click('.modal.finvm .close')
        # B が部屋を出て訓練場へ → 対戦中（練習中）
        await B.evaluate("() => { window.__app.leaveRoom(); window.__app.showHome(); window.__app.startTraining(); }")
        await B.wait_for_function("() => window.__app.match && window.__app.match.isTraining", timeout=20000)
        await poke(B)
        await B.wait_for_timeout(1200)
        await A.click('.room .finvbtn')
        await A.wait_for_selector('.modal.finvm .frow', timeout=15000)
        await poke(A)
        await A.wait_for_timeout(1500)
        st = await A.evaluate("() => document.querySelector('.modal.finvm .frow .fst').textContent")
        check('friend in a match/training shows 対戦中', st == '対戦中', st)
        await A.click('.modal.finvm .send')
        await A.wait_for_timeout(500)
        await A.click('.modal.finvm .close')
        # 訓練場にいる人には、すぐに見せる（参加すると練習をやめる）
        await poke(B)
        try:
            await B.wait_for_selector('.modal.invm', timeout=15000)
            t2 = await B.inner_text('.modal.invm')
        except Exception:
            t2 = ''
        check('invite during training shows at once (and says it ends practice)', '練習をやめて' in t2, t2.replace('\n', ' | ')[:120])
        await B.click('.modal.invm .later')
        # ランキングのフレンド：ようすの点
        await A.evaluate("() => { window.__app.leaveRoom(); window.__app.showHome(); }")
        await poke(B)
        await B.wait_for_timeout(800)
        await A.evaluate("() => window.__app.showRanking('f')")
        await A.wait_for_selector('.rkrow[data-u] .fst', timeout=15000)
        for _ in range(4):
            await poke(A)
            await A.wait_for_timeout(900)
            dot = await A.evaluate("() => { const d = document.querySelector('.rkrow[data-u] .fst'); return d ? [d.className, d.textContent] : null; }")
            if dot and dot[1] != 'オフライン':
                break
        check('friend tab shows the friend status dot', dot and dot[1] == '対戦中' and 'match' in dot[0], dot)
        await A.screenshot(path=f'{OUT}/inv_friendtab.png')
        errs = [e for e in A.errs + B.errs + C.errs if '429' not in e and '403' not in e and '400' not in e]
        check('no page errors', not errs, errs[:4])
        print(f'invite test: {sum(results)}/{len(results)} passed')
        await b.close()

asyncio.run(main())
