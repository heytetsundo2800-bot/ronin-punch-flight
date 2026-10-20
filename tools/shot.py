import sys, asyncio
from playwright.async_api import async_playwright
async def main(url, out, w, h, wait):
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        pg = await b.new_page(viewport={'width': w, 'height': h})
        logs = []
        pg.on('console', lambda m: logs.append(m.type + ': ' + m.text))
        pg.on('pageerror', lambda e: logs.append('PAGEERROR: ' + str(e)))
        await pg.goto(url)
        try:
            await pg.wait_for_function('window.__done === true', timeout=wait)
        except Exception as e:
            logs.append('timeout waiting __done')
        await pg.screenshot(path=out)
        for l in logs[:30]: print(l)
        await b.close()
url, out = sys.argv[1], sys.argv[2]
w = int(sys.argv[3]) if len(sys.argv) > 3 else 1200
h = int(sys.argv[4]) if len(sys.argv) > 4 else 800
asyncio.run(main(url, out, w, h, 30000))
