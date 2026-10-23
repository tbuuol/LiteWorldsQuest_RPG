#!/usr/bin/env python3
"""Send an arcade message (end to end sealed, a testnet transaction) from @liteworldsquest to someone.

    tools/.venv/bin/python -I tools/notify.py banana "the house is offline since 18:10"

Used by tools/house.py when the house has been out of the game too long (tbuuol 2026-10-23: "it may send me an
in-game message to @banana"). Its own copy of the account's browser profile (.publisher/notify-browser), so it
still works when the house's browser is the thing that is stuck. P test only: it refuses otherwise.
"""
from __future__ import annotations

import asyncio
import json
import pathlib
import shutil
import sys

from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
SECRET = ROOT / ".publisher"
PROFILE = SECRET / "notify-browser"
NODE = "http://127.0.0.1:8420"


async def send(to: str, text: str) -> str:
    password = json.loads((SECRET / "arcade-account.json").read_text())["password"]
    if not PROFILE.exists():
        shutil.copytree(SECRET / "arcade-browser", PROFILE, ignore=shutil.ignore_patterns("Singleton*"))
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(str(PROFILE), headless=True, args=["--mute-audio"])
        try:
            pg = ctx.pages[0] if ctx.pages else await ctx.new_page()
            await pg.goto(f"{NODE}/messages", timeout=120_000)
            await asyncio.sleep(4)
            # unlocked from the page itself (Playwright's own clicks wait for a stillness a busy machine never has)
            if await pg.evaluate("""() => { const b = document.getElementById('unlockbar-go') || [...document.querySelectorAll('button')]
                .find(x => x.textContent.trim() === 'Unlock' && x.offsetParent); if (!b || !b.offsetParent) return false; b.click(); return true; }"""):
                await asyncio.sleep(1.5)
                await pg.evaluate("""(pw) => { const i = [...document.querySelectorAll('input[type=password]')].find(x => x.offsetParent);
                    if (i) { i.focus(); i.value = pw; i.dispatchEvent(new Event('input', {bubbles: true})); } }""", password)
                await pg.keyboard.press("Enter")
                await asyncio.sleep(5)
            return await pg.evaluate("""async ([to, text]) => {
                const wallet = await import('/wallet.js'), mail = await import('/messaging.js');
                const acct = await (await fetch('/account')).json();
                const chain = (acct.chains || []).find(c => c.network === 'test');
                if (!chain || chain.mainnet) throw new Error('no P test chain');
                const keys = await wallet.opened({network: 'test', version: chain.version});
                if (!keys || !keys.phrase) throw new Error('the wallet did not open');
                const me = await mail.identity(keys.phrase);
                await mail.write(keys, me, to, text);
                return 'sent to @' + to;
            }""", [to.lstrip("@"), text])
        finally:
            await ctx.close()


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    print(asyncio.run(send(sys.argv[1], sys.argv[2])))
