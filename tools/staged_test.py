"""The staged registry in the dev viewer (port 8766): the live page (config page_id) should take the new registry and
fetch every module without a warning. Used by publish_update.sh before the registry goes on chain."""
import asyncio, json, os
from playwright.async_api import async_playwright

PAGE = json.load(open(os.path.join(os.path.dirname(__file__), "..", "config.json")))["page_id"]


async def boot(b, url, match, who):
    errs = []
    pg = await (await b.new_context(viewport={"width": 480, "height": 270})).new_page()
    pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    pg.on("console", lambda m: errs.append(m.text[:200]) if m.type in ("error", "warning") else None)
    await pg.goto(url, timeout=180000, wait_until="commit")
    g = None
    for _ in range(900):
        for fr in pg.frames:
            try:
                if match in fr.url and await fr.evaluate("!!window.LWQGAME"): g = fr; break
            except Exception: pass
        if g: break
        await asyncio.sleep(0.3)
    if not g:
        print(who, "did not start;", errs[:4]); return
    rep = await g.evaluate("window.LWQ.get('$report')")
    reg = await g.evaluate("(() => { const r = window.LWQ.get('$registry'); return [r.version, r.loader || 1]; })()")
    print(who, "| registry used:", reg, "| engine:", [r for r in rep if r[0] == "engine"],
          "| others fetched:", [r[0] for r in rep if r[2] == "fetched" and r[0] != "engine"])
    print(who, "| warnings/errors:", [e for e in errs if "LWQ" in e or "rror" in e][:5] or "none")


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        await boot(b, f"http://127.0.0.1:8766/?page={PAGE}&as=dora", PAGE[:8], "live page")
        await b.close()

asyncio.run(main())
