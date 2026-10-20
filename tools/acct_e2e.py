# アカウントの流れ：名前→自動登録→フレンド招待→試合→同期→ランキング→引き継ぎコード→別の端末で戻す
# 使い方：node tools/api/devserver.js --port 8813 を動かしてから python3 tools/acct_e2e.py
import asyncio, json
from playwright.async_api import async_playwright
U = 'http://127.0.0.1:8813/'
results = []
def check(name, ok, info=''):
    results.append(ok)
    print(('PASS ' if ok else 'FAIL ') + name + ('  ' + str(info) if info != '' else ''))

async def newdev(b, name):
    ctx = await b.new_context(viewport={'width': 393, 'height': 852}, is_mobile=True, has_touch=True)
    pg = await ctx.new_page()
    pg.errs = []
    pg.on('pageerror', lambda e: pg.errs.append(str(e)))
    await pg.goto(U + '?norender=1')
    await pg.wait_for_selector('#boot', state='detached', timeout=30000)
    await pg.wait_for_selector('.screen.title', timeout=30000)
    await pg.mouse.click(196, 600)
    await pg.wait_for_timeout(600)
    inp = await pg.query_selector('input')
    if inp and name:
        await inp.fill(name)
        await pg.click('.ok')
        await pg.wait_for_timeout(500)
        no = await pg.query_selector('.modal .no')
        if no: await no.click()
    for _ in range(30):
        await pg.wait_for_timeout(250)
        if await pg.evaluate("() => !!localStorage.getItem('rpf_acct_v1')"): break
    return ctx, pg

AUTH_FETCH = """async ([a, body]) => { const acct = a || JSON.parse(localStorage.getItem('rpf_acct_v1')); if (!acct) return {status: 0}; const r = await fetch('/api/rpf', {method:'POST', headers:{'Content-Type':'application/json', Authorization: 'Bearer ' + acct.uid + '.' + acct.token}, body: JSON.stringify(body)}); let j = null; try { j = await r.json(); } catch(e) {} return {status: r.status, j}; }"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        ctxA, A = await newdev(b, 'テツンド')
        acctA = await A.evaluate("() => JSON.parse(localStorage.getItem('rpf_acct_v1'))")
        check('A auto-registers after name', bool(acctA and acctA.get('uid')), acctA and acctA.get('fc'))
        ctxB, B = await newdev(b, 'トラ')
        acctB = await B.evaluate("() => JSON.parse(localStorage.getItem('rpf_acct_v1'))")
        check('B auto-registers', bool(acctB and acctB.get('uid')))
        # B opens A's invite link
        await B.goto(U + '?norender=1&f=' + acctA['fc'])
        await B.wait_for_selector('#boot', state='detached', timeout=30000)
        await B.wait_for_timeout(3000)
        fr = await A.evaluate(AUTH_FETCH, [None, {'a': 'rank', 't': 'f', 'wk': 'x'}])
        names = [x['n'] for x in (fr['j'] or {}).get('list', [])]
        check('invite link makes friends (A sees B)', 'トラ' in names, names)
        # A goes home (refresh friend cache) then plays
        await A.reload()
        await A.wait_for_selector('#boot', state='detached', timeout=30000)
        await A.wait_for_selector('.screen.title', timeout=30000)
        await A.mouse.click(196, 600)
        try:
            await A.wait_for_selector('.battlebtn', timeout=8000)
        except Exception:
            await A.screenshot(path='/tmp/claude-0/-home-claude/cb87e6ba-4022-5281-bc59-7be863cc9efb/scratchpad/shots/acct_fail.png')
            print('screen:', await A.evaluate("() => document.body.innerText.slice(0, 200)"))
        await A.wait_for_timeout(1500)
        await A.click('.battlebtn', force=True)
        await A.wait_for_function('window.__app.match && window.__app.match.phase === "play"', timeout=20000)
        mnames = await A.evaluate("() => window.__app.match.punchers.map(q => q.displayName + (q.friend ? '*' : ''))")
        check('friend appears as CPU in match', 'トラ*' in mnames, mnames)
        await A.evaluate("() => { const m = window.__app.match; const items = m.mode.field.items.slice(0, 20); for (const i of items) i.state = 'deposited'; m.mode.deposit[0].push(...items); m.timeLeft = 0.1; }")
        await A.wait_for_function('document.querySelector(".result")', timeout=30000)
        await A.wait_for_timeout(3000)
        me = await A.evaluate(AUTH_FETCH, [None, {'a': 'me'}])
        check('sync stored rank points', me['j'] and me['j'].get('rp', 0) > 0, me['j'])
        await A.click('.home')
        await A.wait_for_timeout(800)
        await A.click('.tabs button[data-t=rank]')
        await A.wait_for_timeout(2500)
        txt = await A.evaluate("() => document.querySelector('.screen').innerText.replace(/\\n+/g,' | ').slice(0, 200)")
        check('weekly ranking shows A', 'テツンド' in txt, txt[:120])
        # transfer code
        cr = await A.evaluate(AUTH_FETCH, [None, {'a': 'code'}])
        code = cr['j'] and cr['j'].get('code')
        check('transfer code issued', bool(code), code)
        # new phone C: name first (auto account), then restore
        ctxC, C = await newdev(b, 'しんきしゅ')
        acctC0 = await C.evaluate("() => JSON.parse(localStorage.getItem('rpf_acct_v1'))")
        await C.click('.tabs button[data-t=set]')
        await C.wait_for_timeout(2000)
        await C.click('.acct .restore')
        await C.wait_for_timeout(300)
        await C.fill('.modal input', code)
        await C.click('.modal .ok')
        await C.wait_for_timeout(3000)
        acctC = await C.evaluate("() => JSON.parse(localStorage.getItem('rpf_acct_v1'))")
        saveC = await C.evaluate("() => JSON.parse(localStorage.getItem('rpf_save_v1'))")
        check('C restored A account', acctC and acctC['uid'] == acctA['uid'])
        check('C got A progress (rp/plays)', saveC.get('rp', 0) > 0 and saveC.get('plays', 0) >= 1, (saveC.get('rp'), saveC.get('plays')))
        r = await A.evaluate(AUTH_FETCH, [acctA, {'a': 'me'}])
        check('old device A token rejected (401)', r['status'] == 401, r['status'])
        r2 = await C.evaluate(AUTH_FETCH, [acctC0, {'a': 'me'}])
        check('C throwaway account deleted (401)', r2['status'] == 401, r2['status'])
        r3 = await C.evaluate(AUTH_FETCH, [None, {'a': 'me'}])
        check('C new token works', r3['status'] == 200 and r3['j']['name'] == 'テツンド', r3['j'])
        rep = await B.evaluate("async () => { const r = await fetch('/api/rpf', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({a:'report', text:'テスト', info: window.__app.deviceInfo()})}); return r.json(); }")
        check('bug report accepted', rep.get('ok') is True, rep)
        errs = A.errs + B.errs + C.errs
        check('no page errors', not errs, errs[:3])
        print(f'account e2e: {sum(results)}/{len(results)} passed')
        await b.close()
asyncio.run(main())
