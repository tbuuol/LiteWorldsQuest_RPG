#!/usr/bin/env python3
"""The house: LiteWorldsQuest's own account (@liteworldsquest) kept in the game's room by this machine, so the world
and the fight at the gate are kept by it rather than by a player (engine v10: the registry names the house).

    tools/.venv/bin/python -I tools/house.py          (systemd: ~/.config/systemd/user/lwq-house.service)

A headless browser with its own copy of the account's browser profile (.publisher/house-browser, made from
.publisher/arcade-browser the first time) unlocks the wallet, makes sure Wallet access is on for the current card
(config.json "page_id"), opens Play and stays. Every 30 s it checks that the game still runs, is online and is the
house; if not, or every 6 hours, it starts again. The engine draws nothing in the house. Log: .publisher/log/house.log.
"""
from __future__ import annotations

import asyncio
import json
import pathlib
import shutil
import time

from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
SECRET = ROOT / ".publisher"
PROFILE = SECRET / "house-browser"
LOG = SECRET / "log" / "house.log"
NODE = "http://127.0.0.1:8420"
CHECK_EVERY, FRESH_EVERY = 30, 6 * 3600


def log(*parts) -> None:
    LOG.parent.mkdir(parents=True, exist_ok=True)
    if LOG.exists() and LOG.stat().st_size > 2_000_000:   # keep it small: the last ~2 MB
        LOG.replace(LOG.with_suffix(".log.1"))
    with LOG.open("a") as f:
        f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + " ".join(str(p) for p in parts) + "\n")


async def find_game(pg):
    """The game runs in the viewer's inner frame: the one that has LWQGAME."""
    for fr in pg.frames:
        try:
            if await fr.evaluate("!!window.LWQGAME"):
                return fr
        except Exception:
            pass
    return None


async def session(p) -> None:
    cfg = json.loads((ROOT / "config.json").read_text())
    game = cfg["page_id"]
    password = json.loads((SECRET / "arcade-account.json").read_text())["password"]
    if not PROFILE.exists():   # a copy, so the house never fights other tools over the same profile
        shutil.copytree(SECRET / "arcade-browser", PROFILE, ignore=shutil.ignore_patterns("Singleton*"))
    ctx = await p.chromium.launch_persistent_context(
        str(PROFILE), headless=True, viewport={"width": 320, "height": 180},
        # a window nobody looks at must not be slowed down: the house's frames are the fight's clock
        args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio",
              "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
              "--disable-backgrounding-occluded-windows"])
    try:
        pg = ctx.pages[0] if ctx.pages else await ctx.new_page()
        await pg.goto(f"{NODE}/games?sort=latest", timeout=120_000)
        await asyncio.sleep(4)
        if await pg.get_by_text("Unlock", exact=True).count():
            await pg.get_by_text("Unlock", exact=True).first.click()
            await asyncio.sleep(1.5)
            box = pg.locator("input[type=password]:visible")
            if await box.count():
                await box.first.fill(password)
                await pg.keyboard.press("Enter")
                await asyncio.sleep(5)
        switch = pg.locator(f'[data-access="{game}"] input[type=checkbox]')
        if await switch.count() and not await switch.first.is_checked():
            await switch.first.click()
            await asyncio.sleep(1.5)
            sheet = await pg.inner_text("body")
            allow = pg.get_by_role("button", name="Allow wallet access", exact=True)
            if "@liteworldsquest" in sheet and await allow.count():   # only for our own game, published by the house
                await allow.first.click()
                log("wallet access turned on for", game[:12])
        await pg.goto(f"{NODE}/play/{game}", timeout=120_000)
        frame = None
        for _ in range(600):
            frame = await find_game(pg)
            if frame:
                break
            await asyncio.sleep(1)
        if not frame:
            log("the game did not start; trying again")
            return
        started = time.time()
        await asyncio.sleep(20)
        log("started:", await frame.evaluate("(() => { const s = window.LWQGAME.state; return {online: s.online, house: s.house, players: s.players, seq: s.world.seq, engine: (window.LWQ.get('$report').find(r => r[0] === 'engine') || [])[1]}; })()"))
        while time.time() - started < FRESH_EVERY:
            frame = await find_game(pg)
            if not frame:
                log("the game frame is gone; starting again")
                return
            s = await frame.evaluate("(() => { const s = window.LWQGAME.state; return {online: s.online, house: s.house, players: s.players, seq: s.world.seq}; })()")
            if not s["online"] or s["house"] != "me":
                log("not the house any more:", s, "; starting again")
                return
            if int(time.time()) % 600 < CHECK_EVERY or s["players"]:
                s.update(await frame.evaluate("({fps: window.LWQGAME.stats().fps, net: (document.querySelector('.lwq-tr') || {}).innerText})"))
                log("keeping the world:", s)
            await asyncio.sleep(CHECK_EVERY)
        log("six hours: a fresh start")
    finally:
        await ctx.close()


async def main() -> None:
    log("house starting")
    async with async_playwright() as p:
        while True:
            try:
                await session(p)
            except Exception as e:   # noqa: BLE001 -- whatever it was, the house comes back
                log("error:", repr(e)[:300])
            await asyncio.sleep(15)


if __name__ == "__main__":
    asyncio.run(main())
