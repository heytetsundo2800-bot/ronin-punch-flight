# v1.5 の仲間18人：全員を試合に出して、CPUにまかせて早送り。エラーがないか・技とスペシャルが出るかを見る
#   python3 tools/kits_test.py            … 3試合で18人全員
#   python3 tools/kits_test.py syn        … 相性（カップル・町田・ゆかのキック）の確認
import sys, asyncio, json
from playwright.async_api import async_playwright

URL = 'http://localhost:8812/?norender=1'
ALL = ['tora', 'even', 'aomachi', 'tetsundo', 'naot', 'toriki', 'koudai', 'mana', 'shouta', 'ayana', 'hayata', 'takanobu', 'kouta', 'masashi', 'kousei', 'chijiwa', 'minori', 'yuka']


async def start(b, me, friends, mode='scramble', sim=6, logs=None):
    ctx = await b.new_context(viewport={'width': 393, 'height': 852}, device_scale_factor=1, is_mobile=True, has_touch=True)
    pg = await ctx.new_page()
    pg.on('pageerror', lambda e: logs.append('PAGEERROR: ' + str(e)))
    pg.on('console', lambda m: logs.append(m.type + ': ' + m.text) if m.type == 'error' and '404' not in m.text and 'Failed to load' not in m.text else None)
    await pg.add_init_script("localStorage.setItem('rpf_save_v1', JSON.stringify({name:'テスト', tutorial:true, seenRules:{scramble:1,flag:1,ball:1}, char:'%s', mode:'%s', diff:'hard', stage:'sakura'}))" % (me, mode))
    await pg.goto(URL)
    await pg.wait_for_timeout(1200)
    await pg.mouse.click(196, 600)
    await pg.wait_for_timeout(900)
    # 決まった組み合わせで出す（テスト用のしかけ：app.testTeams）。friends は [味方3人, 敵4人]
    await pg.evaluate('(t) => { window.__app.testTeams = t; }', [[me] + friends[0:3], friends[3:7]])
    await pg.click('.battlebtn', force=True)
    await pg.wait_for_function('window.__app.match && window.__app.match.phase === "play"', timeout=25000)
    await pg.evaluate('''(sim) => { const app = window.__app; const m = app.match; const P = m.player; const B = m.punchers.find(q => q.brain).brain.constructor; P.brain = new B(P, m, 'dropper'); app.input.enabled = false; app.simSpeed = sim; }''', sim)
    return ctx, pg


async def run_all(b):
    ok = True
    groups = [ALL[0:8], ALL[8:16], ALL[16:18] + ALL[0:6]]
    seen = {}
    for g in groups:
        logs = []
        ctx, pg = await start(b, g[0], g[1:], logs=logs)
        # 1試合ぶん（早送り）
        for i in range(40):
            await pg.wait_for_timeout(2000)
            st = await pg.evaluate('''() => { const m = window.__app.match; return m ? m.phase : 'none'; }''')
            if st in ('result', 'none'):
                break
        rep = await pg.evaluate('''() => { const m = window.__app.match; if (!m) return null; return m.punchers.map(p => ({ id: p.def.id, team: p.team, ks: p.stats.ks, sp: p.stats.sp, ko: p.stats.ko, dmg: Math.round(p.stats.dmg), syn: (p.syn && p.syn.tags) || [] })); }''')
        print('group', g)
        if rep:
            for r in rep:
                print('  ', json.dumps(r, ensure_ascii=False))
                s = seen.setdefault(r['id'], {'ks': 0, 'sp': 0, 'dmg': 0})
                s['ks'] += r['ks']
                s['sp'] += r['sp']
                s['dmg'] += r['dmg']
        for l in logs[:12]:
            print('   LOG', l)
        if logs:
            ok = False
        await ctx.close()
    print('--- 18人のまとめ（スキル回数・スペシャル回数・ダメージ）')
    for c in ALL:
        s = seen.get(c)
        print('  ', c, s)
        if not s or s['ks'] == 0:
            print('   !! スキルが一度も出ていない:', c)
            ok = False
    return ok


async def run_syn(b):
    ok = True
    # A：カップル2組（てつんど×みのり・エブン×ゆか）＋ゆかのキック、敵にしょうた×あやな
    logs = []
    ctx, pg = await start(b, 'tetsundo', ['minori', 'even', 'yuka', 'koudai', 'shouta', 'ayana', 'kousei'], sim=3, logs=logs)
    info = await pg.evaluate(SYN_INFO)
    print('A', json.dumps(info, ensure_ascii=False))
    names = [x['name'] for x in info['syn']]
    ok &= 'てつんど×みのり' in names and 'エブン×ゆか' in names and 'しょうた×あやな' in names and info['kicks'] == 1 and info['badges'] == 6
    # エブンのHPがゆかのキックで半分になるか（すぐ蹴るようにして見る）
    hp = await pg.evaluate("""() => { const m = window.__app.match; const e = m.punchers.find(p => p.def.id === 'even'); m.kicks.forEach(k => k.t = 0.05); e.hp = e.maxHp; e.invuln = 0; return e.hp; }""")
    await pg.wait_for_timeout(700)
    hp2 = await pg.evaluate("""() => { const m = window.__app.match; const e = m.punchers.find(p => p.def.id === 'even'); return [e.hp, e.hasMod('happy'), m.kicks[0].t]; }""")
    print('  even hp', hp, '->', hp2)
    ok &= bool(hp) and hp2[0] <= hp * 0.6 and hp2[1] and hp2[2] > 8
    # 無敵のあいだは蹴らない（1秒待つ）
    w = await pg.evaluate("""() => { const m = window.__app.match; const e = m.punchers.find(p => p.def.id === 'even'); m.kicks.forEach(k => k.t = 0.05); e.hp = e.maxHp; e.invuln = 3; return e.hp; }""")
    await pg.wait_for_timeout(500)
    w2 = await pg.evaluate("""() => { const m = window.__app.match; const e = m.punchers.find(p => p.def.id === 'even'); return [e.hp, +m.kicks[0].t.toFixed(2)]; }""")
    print('  invulnerable even', w, '->', w2)
    ok &= w2[0] == w and w2[1] <= 1
    await pg.wait_for_timeout(1500)
    toasts = await pg.evaluate("() => [...document.querySelectorAll('.synfeed .syn')].map(e => e.textContent)")
    print('  toasts', toasts)
    for l in logs[:12]:
        print('   LOG', l)
    ok &= not logs
    await ctx.close()
    # B：町田ブラザーズ（ドラ・エブン・ナオT・トリキ）
    logs = []
    ctx, pg = await start(b, 'tora', ['even', 'naot', 'toriki', 'mana', 'koudai', 'hayata', 'masashi'], sim=3, logs=logs)
    info = await pg.evaluate(SYN_INFO)
    print('B', json.dumps(info, ensure_ascii=False))
    names = [x['name'] for x in info['syn']]
    ok &= '町田ブラザーズ' in names and 'コーダイ×まな' in names
    ok &= all(p[3] >= 0.15 for p in info['p'] if p[1] == 0)
    for l in logs[:12]:
        print('   LOG', l)
    ok &= not logs
    await ctx.close()
    # C：コーダイとまなが敵どうし（2人とも少し弱くなる・知らせは1回だけ）
    logs = []
    ctx, pg = await start(b, 'koudai', ['hayata', 'masashi', 'kouta', 'mana', 'chijiwa', 'kousei', 'shouta'], sim=3, logs=logs)
    info = await pg.evaluate(SYN_INFO)
    print('C', json.dumps(info, ensure_ascii=False))
    bad = [x for x in info['syn'] if x.get('bad')]
    ok &= len(bad) == 1 and [p[3] for p in info['p'] if p[0] in ('koudai', 'mana')] == [-0.1, -0.1]
    for l in logs[:12]:
        print('   LOG', l)
    ok &= not logs
    await ctx.close()
    return bool(ok)


SYN_INFO = """() => { const m = window.__app.match; return { syn: m.synergies, p: m.punchers.map(p => [p.def.id, p.team, p.syn.tags.join('/'), +p.modAtk.toFixed(2), +p.modDef.toFixed(2)]), kicks: (m.kicks || []).length, badges: document.querySelectorAll('.mem .synb').length }; }"""


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        if len(sys.argv) > 1 and sys.argv[1] == 'syn':
            print('syn ok:', await run_syn(b))
        else:
            print('kits ok:', await run_all(b))
        await b.close()


asyncio.run(main())
