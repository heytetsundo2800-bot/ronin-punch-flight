# 操作のテスト
# A：指の動き → 操作の種類（時計を止めて正確にためす）
# B：操作 → キャラの動き（ゲームを実際に動かす）
# C：本物のタッチで、ひととおり動くか
import sys, asyncio, json
from playwright.async_api import async_playwright
OUT = '/tmp/claude-0/-home-claude/cb87e6ba-4022-5281-bc59-7be863cc9efb/scratchpad/shots'
URL = 'http://localhost:8812/?norender=1'
results = []
def check(name, ok, info=''):
    results.append((name, ok, info))
    print(('PASS ' if ok else 'FAIL ') + name + ('  ' + str(info) if info != '' else ''))

GESTURE_JS = '''(seq) => {
  const I = window.__app.input; let T = 1000;
  const saveNow = I.now; const saveEn = I.enabled; const saveScheme = I.scheme; I.now = () => T;
  I.enabled = true; I.events.length = 0; I.lastFlick = null; I.lookPX = I.lookPY = 0;
  const out = [];
  const ev = (x, y, pid) => ({ pointerId: pid == null ? 7 : pid, clientX: x, clientY: y, preventDefault(){}, type: 'pointermove' });
  for (const s of seq) {
    if (s[0] === 'scheme') { I.scheme = s[1]; }
    else if (s[0] === 'down') { I.onDown(Object.assign(ev(s[1], s[2], s[4]), {type:'pointerdown'})); }
    else if (s[0] === 'move') { T += s[3]; I.onMove(ev(s[1], s[2], s[4])); }
    else if (s[0] === 'wait') { T += s[1]; }
    else if (s[0] === 'sample') { I.sample(); out.push({hold: I.hold, sx: +I.stickX.toFixed(2), sy: +I.stickY.toFixed(2), lx: +I.lookX.toFixed(4), ly: +I.lookY.toFixed(4), looking: I.looking()}); }
    else if (s[0] === 'up') { T += s[3] || 0; I.onUp(Object.assign(ev(s[1], s[2], s[4]), {type:'pointerup'})); }
  }
  const evs = I.events.filter(e => e.type !== 'press').map(e => e.type + (e.dir ? ':' + e.dir.x + ',' + e.dir.y : ''));
  I.events.length = 0; I.now = saveNow; I.enabled = saveEn; I.scheme = saveScheme; I.main = null; I.pointers.clear(); I.lookPX = I.lookPY = 0;
  return { evs, out };
}'''

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width': 393, 'height': 852}, device_scale_factor=1, is_mobile=True, has_touch=True, user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')
        pg = await ctx.new_page()
        logs = []
        pg.on('pageerror', lambda e: logs.append('PAGEERROR: ' + str(e)))
        await pg.add_init_script("localStorage.setItem('rpf_save_v1', JSON.stringify({name:'テスト', tutorial:true, seenRules:{scramble:1,flag:1,ball:1}, char:'tora', mode:'scramble', diff:'easy', stage:'sakura'}))")
        await pg.goto(URL)
        await pg.wait_for_timeout(1500)
        await pg.mouse.click(196, 600)
        await pg.wait_for_timeout(800)
        await pg.click('.battlebtn', force=True)
        await pg.wait_for_function('window.__app.match && window.__app.match.phase === "play"', timeout=20000)
        await pg.evaluate('''() => { const m = window.__app.match; for (const q of m.punchers) if (q.brain) { q.brain.update = () => {}; } m.noTimer = true; }''')
        G0 = lambda seq: pg.evaluate(GESTURE_JS, seq)
        G = lambda seq: G0([['scheme', 'one']] + seq)  # 片手（画面のどこでも）
        G2 = lambda seq: G0([['scheme', 'two']] + seq)  # 両手（左＝移動・右＝視点）
        # ===== A：指の動きの見分け（片手：画面のどこでも） =====
        r = await G([['down', 200, 500], ['up', 201, 501, 0.08]])
        check('A tap (80ms, still) -> tap', r['evs'] == ['tap'], r['evs'])
        r = await G([['down', 200, 500], ['wait', 0.25], ['sample'], ['up', 200, 500, 0.3]])
        check('A long press -> hold, no event on release', r['out'][0]['hold'] and r['evs'] == [], r)
        r = await G([['down', 200, 500], ['move', 215, 500, 0.05], ['move', 240, 500, 0.05], ['sample'], ['move', 260, 500, 0.2], ['sample'], ['up', 260, 500, 0.3]])
        check('A quick swipe -> look (no hold), stick right', (not r['out'][0]['hold']) and r['out'][1]['sx'] > 0.3 and not r['out'][1]['hold'], r['out'])
        check('A slow swipe release -> no flick', r['evs'] == [], r['evs'])
        r = await G([['down', 200, 500], ['wait', 0.25], ['sample'], ['move', 250, 500, 0.15], ['sample'], ['up', 250, 500, 0.3]])
        check('A hold then drag -> fly + steer', r['out'][0]['hold'] and r['out'][1]['hold'] and r['out'][1]['sx'] > 0.3, r['out'])
        for name, dx, dy, want in [('right', 70, 0, 'flick:1,0'), ('left', -70, 0, 'flick:-1,0'), ('up', 0, -70, 'flick:0,-1'), ('down', 0, 70, 'flick:0,1'), ('up-right', 55, -55, 'flick:0.707,-0.707')]:
            r = await G([['down', 200, 500], ['move', 200 + dx * 0.4, 500 + dy * 0.4, 0.04], ['move', 200 + dx, 500 + dy, 0.05], ['up', 200 + dx, 500 + dy, 0.03]])
            check('A flick ' + name, r['evs'] == [want], r['evs'])
        r = await G([['down', 200, 500], ['move', 200, 470, 0.04], ['move', 200, 440, 0.04], ['move', 200, 470, 0.04], ['move', 200, 520, 0.04], ['up', 200, 525, 0.02]])
        check('A V gesture -> uturn', r['evs'] == ['uturn'], r['evs'])
        r = await G([['down', 200, 500], ['move', 200, 440, 0.05], ['up', 200, 430, 0.03], ['wait', 0.15], ['down', 200, 500], ['move', 200, 560, 0.05], ['up', 200, 570, 0.03]])
        check('A up flick then down flick -> flick + uturn', r['evs'] == ['flick:0,-1', 'uturn'], r['evs'])
        r = await G([['down', 200, 500], ['move', 200, 440, 0.05], ['up', 200, 430, 0.03], ['wait', 0.8], ['down', 200, 500], ['move', 200, 560, 0.05], ['up', 200, 570, 0.03]])
        check('A two flicks far apart -> two flicks', r['evs'] == ['flick:0,-1', 'flick:0,1'], r['evs'])
        r = await G([['down', 200, 500], ['wait', 0.25], ['move', 210, 500, 0.4], ['up', 210, 500, 0.1]])
        check('A long hold release -> nothing', r['evs'] == [], r['evs'])
        # ===== A2：両手（左の親指＝移動、右の親指＝視点） =====
        sc = await pg.evaluate('() => window.__app.input.scheme')
        check('A2 default scheme is two-thumb', sc == 'two', sc)
        r = await G2([['down', 100, 500], ['up', 101, 501, 0.08]])
        check('A2 left tap -> tap', r['evs'] == ['tap'], r['evs'])
        r = await G2([['down', 100, 500], ['wait', 0.25], ['sample'], ['up', 100, 500, 0.3]])
        check('A2 left long press -> hold', r['out'][0]['hold'] and r['evs'] == [], r)
        r = await G2([['down', 100, 500], ['wait', 0.25], ['sample'], ['move', 150, 500, 0.15], ['move', 150, 450, 0.15], ['sample'], ['up', 150, 450, 0.3]])
        check('A2 left hold then drag -> still flies, no steering (accelerator only)', r['out'][1]['hold'] and r['out'][1]['sx'] == 0 and r['out'][1]['sy'] == 0, r['out'])
        r = await G2([['down', 100, 500], ['move', 116, 500, 0.05], ['wait', 0.4], ['sample'], ['up', 116, 500, 0.1]])
        check('A2 left: thumb slips at press, keeps holding -> flies', r['out'][0]['hold'] and r['out'][0]['sx'] == 0, r['out'])
        r = await G2([['down', 100, 500], ['move', 128, 500, 0.04], ['move', 170, 500, 0.05], ['up', 170, 500, 0.03]])
        check('A2 left flick right -> flick', r['evs'] == ['flick:1,0'], r['evs'])
        r = await G2([['down', 100, 500], ['move', 100, 470, 0.04], ['move', 100, 440, 0.04], ['move', 100, 470, 0.04], ['move', 100, 520, 0.04], ['up', 100, 525, 0.02]])
        check('A2 left V gesture -> uturn', r['evs'] == ['uturn'], r['evs'])
        r = await G2([['down', 300, 500], ['move', 320, 500, 0.016], ['sample'], ['move', 360, 500, 0.016], ['sample'], ['sample'], ['up', 360, 500, 0.2]])
        o = r['out']
        check('A2 right drag -> look right (no hold, no stick)', (not o[0]['hold']) and o[0]['lx'] > 0.1 and o[1]['lx'] > 0.25 and o[0]['sx'] == 0 and o[0]['looking'], o)
        check('A2 look is per-frame (no drift when finger stops)', o[2]['lx'] == 0, o[2])
        check('A2 right drag -> no tap/flick on release', r['evs'] == [], r['evs'])
        r = await G2([['down', 300, 500], ['move', 300, 460, 0.016], ['sample'], ['up', 300, 460, 0.2]])
        check('A2 right drag up -> look up', r['out'][0]['ly'] > 0.2 and abs(r['out'][0]['lx']) < 0.001, r['out'])
        r = await G2([['down', 300, 500], ['up', 301, 500, 0.08]])
        check('A2 right quick tap -> tap (boost)', r['evs'] == ['tap'], r['evs'])
        r = await G2([['down', 300, 500], ['move', 330, 500, 0.03], ['move', 380, 500, 0.03], ['up', 380, 500, 0.02]])
        check('A2 right fast swipe -> no flick', r['evs'] == [], r['evs'])
        r = await G2([['down', 100, 600, 0, 1], ['wait', 0.25], ['down', 300, 500, 0, 2], ['move', 340, 500, 0.016, 2], ['sample'], ['up', 340, 500, 0.1, 2], ['up', 100, 600, 0.1, 1]])
        check('A2 left hold + right drag at once -> fly and look', r['out'][0]['hold'] and r['out'][0]['lx'] > 0.2 and r['evs'] == [], r)
        r = await G2([['down', 300, 500, 0, 2], ['down', 100, 600, 0, 1], ['wait', 0.25], ['sample'], ['up', 100, 600, 0.1, 1], ['up', 300, 500, 0.1, 2]])
        check('A2 right first, then left -> left still flies', r['out'][0]['hold'], r['out'])
        r = await G2([['down', 100, 600, 0, 1], ['wait', 0.25], ['down', 300, 500, 0, 2], ['up', 100, 600, 0.1, 1], ['sample'], ['up', 300, 500, 0.1, 2]])
        check('A2 lifting left while right stays -> stop flying (right never becomes stick)', (not r['out'][0]['hold']) and r['out'][0]['sx'] == 0, r['out'])
        r = await G([['down', 300, 500], ['wait', 0.25], ['sample'], ['up', 300, 500, 0.3]])
        check('A one-hand scheme: right half long press still flies', r['out'][0]['hold'], r['out'])
        # ===== B：キャラの動き =====
        async def st():
            return await pg.evaluate('''() => { const p = window.__app.match.player; return {state: p.state, yaw: p.yaw, pitch: p.pitch, x: p.pos.x, y: p.pos.y, z: p.pos.z, sp: p.vel.length(), boost: p.boost, ground: p.ground, lock: p.lock ? p.lock.def.id : null, inv: p.invuln}; }''')
        async def ev(e):
            await pg.evaluate('(e) => window.__app.match.player.intent.events.push(e)', e)
        async def put(x, y, z):
            await pg.evaluate('([x,y,z]) => { const p = window.__app.match.player; p.pos.set(x,y,z); p.vel.set(0,0,0); p.state="hover"; p.stunT=0; p.hurtT=0; p.dash=null; p.boost=6; }', [x, y, z])
        # 指を右へ（スティック右）→ 画面の中で右へ向く／左へ → 左へ（止まっているときも飛んでいるときも）
        TURN = '''([sx, hold]) => new Promise((res) => {
          const m = window.__app.match, P = m.player, I = window.__app.input, V = P.pos.constructor;
          P.pos.set(0, 50, -40); P.vel.set(0, 0, 0); P.state = 'hover'; P.yaw = 0.3; P.pitch = 0; P.lock = null; P.updateAxes();
          const camR = new V(1, 0, 0).applyQuaternion(m.camera.quaternion); camR.y = 0; camR.normalize();
          I._s = I.sample; I.sample = function () { this._s(); this.hold = hold; this.stickX = sx; this.stickY = 0; };
          setTimeout(() => { I.sample = I._s; const f = new V(Math.sin(P.yaw), 0, Math.cos(P.yaw)); res(+f.dot(camR).toFixed(2)); }, 500);
        })'''
        for name, sx, hold, sign in [('stopped right', 1, False, 1), ('stopped left', -1, False, -1), ('flying right', 0.8, True, 1), ('flying left', -0.8, True, -1)]:
            await pg.evaluate('() => { const P = window.__app.match.player; P.yaw = 0.3; P.updateAxes(); }')
            await pg.wait_for_timeout(450)
            d = await pg.evaluate(TURN, [sx, hold])
            check('B stick ' + name + ' -> turns that way on screen', d * sign > 0.15, d)
        # 右の親指（両手）：なぞった向きへ画面の中で向く。カメラは指にぴったりついてくる
        LOOK = '''([lx, ly, hold, tight]) => new Promise((res) => {
          const m = window.__app.match, P = m.player, I = window.__app.input, V = P.pos.constructor;
          P.pos.set(0, 50, -40); P.vel.set(0, 0, 0); P.state = 'hover'; P.yaw = 0.3; P.pitch = 0; P.lock = null; P.updateAxes();
          m.cam.yaw = P.yaw; m.cam.pitch = 0;
          const camR = new V(1, 0, 0).applyQuaternion(m.camera.quaternion); camR.y = 0; camR.normalize();
          const p0 = P.pitch;
          let lagMax = 0;
          I._s = I.sample; I._lk = I.looking;
          I.looking = () => tight;
          I.sample = function () { this._s(); this.hold = hold; this.stickX = 0; this.stickY = 0; this.lookX = lx; this.lookY = ly; };
          const iv = setInterval(() => { let d = P.yaw - m.cam.yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; lagMax = Math.max(lagMax, Math.abs(d)); }, 16);
          setTimeout(() => { clearInterval(iv); I.sample = I._s; I.looking = I._lk; const f = new V(Math.sin(P.yaw), 0, Math.cos(P.yaw)); res({ side: +f.dot(camR).toFixed(2), dp: +(P.pitch - p0).toFixed(3), lag: +lagMax.toFixed(3) }); }, 450);
        })'''
        for name, lx, hold, sign in [('stopped right', 0.05, False, 1), ('stopped left', -0.05, False, -1), ('flying right', 0.05, True, 1), ('flying left', -0.05, True, -1)]:
            await pg.evaluate('() => { const P = window.__app.match.player; P.yaw = 0.3; P.updateAxes(); }')
            await pg.wait_for_timeout(450)
            d = await pg.evaluate(LOOK, [lx, 0, hold, True])
            check('B2 right-thumb look ' + name + ' -> turns that way on screen', d['side'] * sign > 0.15, d)
        await pg.wait_for_timeout(300)
        d = await pg.evaluate(LOOK, [0, 0.03, False, True])
        check('B2 right-thumb drag up -> looks up', d['dp'] > 0.1, d)
        await pg.evaluate('() => { const P = window.__app.match.player; P.pitch = 0; P.updateAxes(); }')
        await pg.wait_for_timeout(450)
        dl = await pg.evaluate(LOOK, [0.06, 0, False, False])
        await pg.wait_for_timeout(450)
        dt_ = await pg.evaluate(LOOK, [0.06, 0, False, True])
        check('B2 camera follows tighter while right thumb is down', dt_['lag'] < dl['lag'] * 0.6, (dt_['lag'], dl['lag']))
        await put(0, 50, -40)
        await pg.wait_for_timeout(200)
        s0 = await st()
        await ev({'type': 'tap'})
        await pg.wait_for_timeout(120)
        s1 = await st()
        check('B tap -> dash', s1['state'] == 'dash', s1['state'])
        check('B dash uses 1 boost', abs(s1['boost'] - (s0['boost'] - 1)) < 0.15, round(s1['boost'], 2))
        # 遅い環境ではゲームの時間がゆっくり進むので、状態が変わるまで待つ（最大2秒）
        for _ in range(20):
            await pg.wait_for_timeout(100)
            s2 = await st()
            if s2['state'] != 'dash':
                break
        check('B after dash -> cruise (keeps flying)', s2['state'] == 'cruise' and s2['sp'] > 10, (s2['state'], round(s2['sp'], 1)))
        await ev({'type': 'flick', 'dir': {'x': 0, 'y': 1}})
        await pg.wait_for_timeout(450)
        s3 = await st()
        check('B down flick while flying -> brake to stop', s3['sp'] < 2.5, (s3['state'], round(s3['sp'], 2)))
        await put(0, 50, -40)
        await pg.wait_for_timeout(150)
        s4 = await st()
        await ev({'type': 'flick', 'dir': {'x': 1, 'y': 0}})
        # 次のフレームで受けとる（重い環境ではフレームの間が長いので、少し待つ）
        for _ in range(20):
            await pg.wait_for_timeout(30)
            s5 = await st()
            if s5['state'] == 'step':
                break
        check('B side flick stopped -> step', s5['state'] == 'step', s5['state'])
        await pg.wait_for_timeout(400)
        s6 = await st()
        moved = ((s6['x'] - s4['x']) ** 2 + (s6['z'] - s4['z']) ** 2) ** 0.5
        dyaw = abs((s6['yaw'] - s4['yaw'] + 3.14159) % 6.28318 - 3.14159)
        check('B step moves ~3-8m sideways, keeps facing', 2.5 < moved < 9 and dyaw < 0.05, (round(moved, 2), round(dyaw, 3)))
        await put(0, 50, -40)
        await pg.wait_for_timeout(150)
        s7 = await st()
        await ev({'type': 'flick', 'dir': {'x': 0, 'y': -1}})
        await pg.wait_for_timeout(400)
        s8 = await st()
        check('B up flick stopped -> rise', s8['y'] - s7['y'] > 2, round(s8['y'] - s7['y'], 2))
        await put(0, 50, -40)
        await pg.wait_for_timeout(150)
        s9 = await st()
        await ev({'type': 'flick', 'dir': {'x': 0, 'y': 1}})
        await pg.wait_for_timeout(400)
        s10 = await st()
        back = (s10['x'] - s9['x']) * -__import__('math').sin(s9['yaw']) + (s10['z'] - s9['z']) * -__import__('math').cos(s9['yaw'])
        check('B down flick stopped -> backstep', back > 2.5 and abs(s10['y'] - s9['y']) < 1.0, (round(back, 2), round(s10['y'] - s9['y'], 2)))
        await put(0, 50, -40)
        await pg.wait_for_timeout(150)
        s11 = await st()
        await ev({'type': 'uturn'})
        await pg.wait_for_timeout(450)
        # 遅い環境ではゲームの時間がゆっくり進むので、反転が終わるまで待つ（最大2秒）
        for _ in range(20):
            s12 = await st()
            if s12['state'] != 'uturn':
                break
            await pg.wait_for_timeout(100)
        dy = (s12['yaw'] - s11['yaw'] + 3.14159) % 6.28318 - 3.14159
        check('B uturn -> 180 degrees', abs(abs(dy) - 3.14159) < 0.12, round(dy, 3))
        await put(0, 50, -40)
        await ev({'type': 'tap'})
        await pg.wait_for_timeout(300)
        await ev({'type': 'flick', 'dir': {'x': -1, 'y': 0}})
        await pg.wait_for_timeout(60)
        s13 = await st()
        check('B side flick while flying -> barrel roll', s13['state'] == 'roll', s13['state'])
        for _ in range(15):
            await pg.wait_for_timeout(150)
            s14 = await st()
            if s14['state'] != 'roll': break
        check('B after roll keeps flying', s14['sp'] > 10 and s14['state'] in ('cruise', 'fly'), (s14['state'], round(s14['sp'], 1)))
        # ダッシュの溜め中に上フリック → キャンセルしてゲージが戻る
        await put(0, 50, -40)
        await pg.wait_for_timeout(100)
        await pg.evaluate('''() => { const p = window.__app.match.player; p.intent.events.push({type:'tap'}); p.intent.events.push({type:'flick', dir:{x:0,y:-1}}); }''')
        await pg.wait_for_timeout(100)
        s15 = await st()
        check('B flick during dash windup cancels (no boost used)', s15['boost'] > 5.9, round(s15['boost'], 2))
        # 壁キック：柱に向かってダッシュ
        await pg.evaluate('''() => { const p = window.__app.match.player; p.pos.set(88, 20, -60); p.yaw = Math.PI; p.pitch = 0; p.updateAxes(); p.vel.set(0,0,0); p.state='hover'; p.boost=6; }''')
        await pg.wait_for_timeout(100)
        await ev({'type': 'tap'})
        await pg.wait_for_timeout(500)
        wk = await pg.evaluate('() => { const p = window.__app.match.player; return {yaw: p.yaw, z: p.pos.z, state: p.state}; }')
        check('B dash into wall -> wall kick (turns back)', abs(abs(((wk['yaw'] - 3.14159) + 3.14159) % 6.28318 - 3.14159)) > 1.5 or wk['z'] < -60, wk)
        # 地面でブーストが早く回復
        await pg.evaluate('''() => { const m = window.__app.match, p = m.player; p.pos.set(0, 27, -96); p.vel.set(0,-1,0); p.boost = 1; p.state = 'hover'; window.__t0 = m.time; }''')
        # ゲームの中の時間で1.2秒待つ（遅い環境でもくらべられるように）
        await pg.wait_for_function('() => window.__app.match.time - window.__t0 >= 1.2', timeout=8000)
        s16 = await st()
        check('B ground recharges boost fast (~2/s)', s16['ground'] and s16['boost'] > 2.4, (s16['ground'], round(s16['boost'], 2)))
        # 地面で長押し → 走る（高さはそのまま）
        y0 = s16['y']
        await pg.evaluate('() => { const p = window.__app.match.player; p.pitch = 0; p.intent.hold = true; window.__holdHack = setInterval(() => { p.intent.hold = true; }, 5); }')
        await pg.evaluate('() => { const I = window.__app.input; I._sample = I.sample; I.sample = function(){ this._sample(); this.hold = true; }; }')
        await pg.wait_for_timeout(800)
        s17 = await st()
        await pg.evaluate('() => { const I = window.__app.input; I.sample = I._sample; clearInterval(window.__holdHack); }')
        check('B hold on ground -> run along ground', s17['ground'] and abs(s17['y'] - y0) < 0.6 and s17['sp'] > 8, (s17['ground'], round(s17['y'] - y0, 2), round(s17['sp'], 1)))
        # ===== C：本物のタッチ =====
        cdp = await ctx.new_cdp_session(pg)
        async def touch(t, pts):
            await cdp.send('Input.dispatchTouchEvent', {'type': t, 'touchPoints': [{'x': x, 'y': y, 'id': i} for i, (x, y) in enumerate(pts)]})
        await put(0, 50, -40)
        await pg.wait_for_timeout(300)
        await touch('touchStart', [(300, 560)])
        await touch('touchEnd', [])
        await pg.wait_for_timeout(100)
        s = await st()
        check('C real tap (right half) -> dash', s['state'] in ('dash', 'cruise'), s['state'])
        await pg.wait_for_timeout(600)
        await put(0, 50, -40)
        await pg.wait_for_timeout(200)
        await touch('touchStart', [(100, 560)])
        await touch('touchEnd', [])
        await pg.wait_for_timeout(100)
        s = await st()
        check('C real tap (left half) -> dash', s['state'] in ('dash', 'cruise'), s['state'])
        await pg.wait_for_timeout(600)
        await touch('touchStart', [(100, 560)])
        await pg.wait_for_timeout(400)
        s = await st()
        check('C real long press (left) -> fly', s['state'] == 'fly', s['state'])
        await touch('touchEnd', [])
        await pg.wait_for_timeout(600)
        s = await st()
        check('C real release -> stop', s['sp'] < 3, round(s['sp'], 2))
        # 両手：左の親指で飛びながら、右の親指でなぞって右を向く
        await put(0, 50, -40)
        await pg.wait_for_timeout(200)
        await touch('touchStart', [(100, 600)])
        await pg.wait_for_timeout(400)
        s0 = await st()
        await touch('touchStart', [(100, 600), (300, 500)])
        for i in range(1, 7):
            await touch('touchMove', [(100, 600), (300 + i * 10, 500)])
            await pg.wait_for_timeout(16)
        await pg.wait_for_timeout(150)
        s1 = await st()
        dyaw = (s1['yaw'] - s0['yaw'] + 3.14159) % 6.28318 - 3.14159
        check('C real two thumbs: left holds = flying', s1['state'] == 'fly', s1['state'])
        check('C real two thumbs: right drag 60px -> turns right ~0.45rad', -0.7 < dyaw < -0.25, round(dyaw, 3))
        await touch('touchEnd', [])
        await pg.wait_for_timeout(500)
        await put(0, 50, -40)
        await pg.wait_for_timeout(200)
        await touch('touchStart', [(300, 500)])
        await pg.wait_for_timeout(400)
        s = await st()
        check('C real right-half long press -> does not fly', s['state'] == 'hover' and s['sp'] < 3, (s['state'], round(s['sp'], 2)))
        await touch('touchEnd', [])
        await pg.wait_for_timeout(200)
        # ロックオンとパンチ
        await pg.evaluate('''() => { const m = window.__app.match, p = m.player; const e = m.punchers.find(q => q.team !== p.team); p.pos.set(0, 45, 0); p.vel.set(0,0,0); p.state='hover'; p.yaw = 0; e.pos.set(0, 45, 8); e.vel.set(0,0,0); e.state='hover'; e.hp = e.maxHp; window.__enemy = e; e.update = function(dt){ this.animate(dt); }; }''')
        await pg.wait_for_timeout(400)
        btn = await pg.query_selector('.lockbtn:not(.hidden)')
        check('C lock icon appears for near enemy', btn is not None)
        if btn:
            bb = await btn.bounding_box()
            await touch('touchStart', [(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2)])
            await touch('touchEnd', [])
            await pg.wait_for_timeout(200)
            s = await st()
            check('C tap icon -> locked', s['lock'] is not None, s['lock'])
            await touch('touchStart', [(100, 560)])
            await pg.wait_for_timeout(1500)
            await touch('touchEnd', [])
            hp = await pg.evaluate('() => window.__enemy.hp / window.__enemy.maxHp')
            check('C auto punch damages locked enemy', hp < 0.97, round(hp, 3))
        await pg.evaluate('() => { const p = window.__app.match.player; p.omCd = p.omCd.map(()=>0); p.ksCd = 0; p.stunT = 0; p.hurtT = 0; p.charge = null; p.diskLock = 0; }')
        slot = await pg.query_selector('.deck .slot')
        bb = await slot.bounding_box()
        cx, cy = bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2
        await touch('touchStart', [(cx, cy)])
        await touch('touchMove', [(cx, cy - 20)])
        await touch('touchMove', [(cx, cy - 40)])
        await touch('touchEnd', [])
        await pg.wait_for_timeout(150)
        ch = await pg.evaluate('() => { const p = window.__app.match.player; return {charge: !!p.charge, cd: +p.omCd[0].toFixed(1), om: p.stats.om}; }')
        check('C up-flick on omamori -> skill', ch['charge'] or ch['cd'] > 0 or ch['om'] > 0, ch)
        await pg.wait_for_timeout(1500)
        await pg.evaluate('() => { const p = window.__app.match.player; p.elemCd = 0; p.omCd = p.omCd.map(()=>0); p.charge = null; p.diskLock = 0; }')
        e0 = await pg.evaluate('() => window.__app.match.player.elem')
        slots = await pg.query_selector_all('.deck .slot')
        bb = await slots[3].bounding_box()
        cx, cy = bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2
        await touch('touchStart', [(cx, cy)])
        await touch('touchMove', [(cx, cy + 20)])
        await touch('touchMove', [(cx, cy + 40)])
        await touch('touchEnd', [])
        await pg.wait_for_timeout(150)
        e1 = await pg.evaluate('() => window.__app.match.player.elem')
        check('C down-flick on omamori -> element changes', e1 != e0, (e0, e1))
        await pg.evaluate('() => { const p = window.__app.match.player; p.sp = 1; p.stunT = 0; p.hurtT = 0; p.charge = null; }')
        sp = await pg.query_selector('.spbtn')
        bb = await sp.bounding_box()
        await touch('touchStart', [(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2)])
        await touch('touchEnd', [])
        await pg.wait_for_timeout(150)
        spst = await pg.evaluate('() => { const p = window.__app.match.player; return {sp: p.sp, n: p.stats.sp}; }')
        check('C SP button -> special', spst['n'] >= 1, spst)
        for l in logs[:20]: print(l)
        n_ok = sum(1 for r in results if r[1])
        print(f'controls: {n_ok}/{len(results)} passed')
        await b.close()
asyncio.run(main())
