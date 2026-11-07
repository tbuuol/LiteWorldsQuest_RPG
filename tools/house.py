#!/usr/bin/env python3
"""The house: LiteWorldsQuest's own account (@liteworldsquest) kept in the game's room by this machine, so the world
and the fight at the gate are kept by it rather than by a player (engine v10: the registry names the house).

    tools/.venv/bin/python -I tools/house.py          (systemd: ~/.config/systemd/user/lwq-house.service)
    tools/.venv/bin/python -I tools/house.py --beta   the beta's house (lwq-house-beta.service), see BETA below

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
import sys
import time

from playwright.async_api import async_playwright

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import house_store  # noqa: E402
import ltc_pay  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
SECRET = ROOT / ".publisher"
#: THE BETA (2026-11-07): the same account keeps the beta page's world (config.json "beta_page_id"), a game of its own
#: ("liteworldsquest-beta", so other rooms), with a browser, a log and a database of its own, and it starts again when
#: tools/beta_push.sh has put a new build up. It writes nobody when it is out: the beta is for testing.
BETA = "--beta" in sys.argv
_B = "-beta" if BETA else ""
BETA_REGISTRY = pathlib.Path("/var/www/lwq-beta/registry.json")
PROFILE = SECRET / f"house-browser{_B}"
LOG = SECRET / "log" / f"house{_B}.log"
NODE = "http://127.0.0.1:8420"
CHECK_EVERY, FRESH_EVERY = 30, 6 * 3600
#: out of the game this long, and the house writes to its keeper (tools/notify.py), once; and once more when it is back
ALERT_AFTER, ALERT_TO = 15 * 60, "banana"
PLAYERS = SECRET / f"{'beta-' if BETA else ''}players.json"          # the house's book of every player, kept here between starts and page versions
STORE = SECRET / f"{'beta-' if BETA else ''}players.sqlite"          # Etappe 4: the database a house in store mode asks (tools/house_store.py)
BACKUPS = SECRET / f"backups{_B}"
GOOD_FILE = SECRET / f"house{_B}.last_good"   # kept on disk, so a house that keeps crashing still gets reported
try:
    LAST_GOOD = float(GOOD_FILE.read_text())   # the last time the house was in the game, keeping it
except (OSError, ValueError):
    LAST_GOOD = time.time()
LAST_TROUBLE = ""


def log(*parts) -> None:
    global LAST_TROUBLE
    if parts and any(w in str(parts[0]) for w in ("error", "not ", "could not", "restarted", "gone", "did not")):
        LAST_TROUBLE = " ".join(str(p) for p in parts)[:200]
    LOG.parent.mkdir(parents=True, exist_ok=True)
    if LOG.exists() and LOG.stat().st_size > 2_000_000:   # keep it small: the last ~2 MB
        LOG.replace(LOG.with_suffix(".log.1"))
    with LOG.open("a") as f:
        f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + " ".join(str(p) for p in parts) + "\n")


def node_pid() -> int | None:
    """The arcade's web worker (`python -m arcade.web`, restarted by its parent on updates). When it restarts, the
    house's room link is gone without the page noticing (2026-10-23 18:10: the house thought itself online, alone, in
    a room nobody else was in), so a new worker means a fresh start."""
    for d in pathlib.Path("/proc").iterdir():
        if d.name.isdigit():
            try:
                args = (d / "cmdline").read_bytes().split(b"\0")
            except OSError:
                continue
            if b"-m" in args and b"arcade.web" in args:
                return int(d.name)
    return None


async def keep_players(frame) -> None:
    """The house's book of players onto the disk, when it has changed (written aside first, then put in place)."""
    try:
        dump = await frame.evaluate("window.LWQGAME.houseDump ? window.LWQGAME.houseDump() : ''")
    except Exception:   # noqa: BLE001 -- the next check tries again
        return
    if not dump or dump == "{}" or (PLAYERS.exists() and PLAYERS.read_text() == dump):
        return
    tmp = PLAYERS.with_suffix(".tmp")
    tmp.write_text(dump)
    tmp.replace(PLAYERS)


async def find_game(pg):
    """The game runs in the viewer's inner frame: the one that has LWQGAME."""
    for fr in pg.frames:
        try:
            if await fr.evaluate("!!window.LWQGAME"):
                return fr
        except Exception:
            pass
    return None


async def unlock(pg, password: str) -> None:
    """The wallet locks on every page load: unlock it on the page we are on. Clicked and typed from the page itself:
    under load Playwright waits for things to hold still, and on this busy machine they do not (2026-10-23)."""
    await asyncio.sleep(4)
    asked = await pg.evaluate("""() => { const b = document.getElementById('unlockbar-go') || [...document.querySelectorAll('button')]
        .find(x => x.textContent.trim() === 'Unlock' && x.offsetParent); if (!b || !b.offsetParent) return false; b.click(); return true; }""")
    if not asked:
        return
    await asyncio.sleep(1.5)
    typed = await pg.evaluate("""(pw) => { const i = [...document.querySelectorAll('input[type=password]')].find(x => x.offsetParent && !x.dataset.lwqAnswered);
        if (!i) return false; i.dataset.lwqAnswered = '1'; i.focus(); i.value = pw; i.dispatchEvent(new Event('input', {bubbles: true})); return true; }""", password)
    if typed:
        await pg.keyboard.press("Enter")
        await asyncio.sleep(5)


async def answer_password(pg, password: str) -> bool:
    """A password asked for on the page (the viewer's unlock sheet): typed in from the page itself."""
    return await pg.evaluate("""(pw) => { const i = [...document.querySelectorAll('input[type=password]')].find(x => x.offsetParent && !x.dataset.lwqAnswered);
        if (!i) return false; i.dataset.lwqAnswered = '1'; i.focus(); i.value = pw; i.dispatchEvent(new Event('input', {bubbles: true}));
        const f = i.closest('form'); const b = (f || i.closest('div,dialog,section') || document).querySelector('button[type=submit], button.primary');
        i.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true}));
        if (f && f.requestSubmit) f.requestSubmit(); else if (b) b.click();
        return true; }""", password)


async def wallet_access(pg, game: str, password: str) -> bool:
    """Wallet access on for our own card, on the Apps page. The page sets the switches from this browser's own
    record a moment after it loads (2026-10-23: the house read one too early, took it for off and clicked it OFF),
    so it waits for the switch to settle, clicks only when it is really off, and looks again afterwards."""
    await pg.goto(f"{NODE}/apps?sort=latest", timeout=120_000)
    switch = pg.locator(f'[data-access="{game}"] input[type=checkbox]')
    for _ in range(3):
        await unlock(pg, password)
        if not await switch.count():
            log("our card is not on the Apps page")
            return False
        if await switch.first.is_checked():
            return True
        await switch.first.scroll_into_view_if_needed()
        await switch.first.click()
        for _ in range(10):   # the sheet that asks, naming the publisher
            await asyncio.sleep(1)
            # the page has more than one such button (one of them hidden): only the one on screen counts
            allow = pg.get_by_role("button", name="Allow wallet access", exact=True).filter(visible=True)
            if await allow.count():
                if "@liteworldsquest" in await pg.inner_text("body"):   # only for our own app, published by the house
                    # clicked from the page itself: under load Playwright waits for the sheet to hold still, and it
                    # never quite does (2026-10-23); whether it took is looked at again below
                    await pg.evaluate("""() => { const b = [...document.querySelectorAll('button')].find(x =>
                        x.textContent.trim() === 'Allow wallet access' && x.offsetParent); if (b) b.click(); }""")
                    await asyncio.sleep(2)
                    log("wallet access asked for", game[:12])
                break
        await pg.reload(timeout=120_000)
    return await switch.count() > 0 and await switch.first.is_checked()


#: ONE HOUSE AT A TIME THROUGH THE DOOR (2026-10-28, live v17): three zones' browsers unlocking the same account on the
#: Apps page at once reloaded each other's pages ("execution context was destroyed", "our card is not on the Apps
#: page") and only Blockshire came up. Each zone waits for the one before it until its game is in its zone.
DOOR: asyncio.Lock | None = None


async def session(p, level: str = "") -> None:
    global DOOR
    DOOR = DOOR or asyncio.Lock()
    await DOOR.acquire()
    try:
        await _session(p, level)
    finally:
        if DOOR.locked() and getattr(DOOR, "held_by", None) == level:
            DOOR.held_by = None
            DOOR.release()


def let_in_next(level: str) -> None:
    if DOOR is not None and DOOR.locked() and getattr(DOOR, "held_by", None) == level:
        DOOR.held_by = None
        DOOR.release()


async def _session(p, level: str = "") -> None:
    DOOR.held_by = level
    cfg = json.loads((ROOT / "config.json").read_text())
    game = cfg["beta_page_id"] if BETA else cfg["page_id"]
    password = json.loads((SECRET / "arcade-account.json").read_text())["password"]
    store = frame = None
    # a copy per zone, so no two houses (and no other tool) fight over one profile
    profile = PROFILE if not level else PROFILE.with_name(f"house-browser-{level}")
    if not profile.exists():
        shutil.copytree(SECRET / "arcade-browser", profile, ignore=shutil.ignore_patterns("Singleton*"))
    ctx = await p.chromium.launch_persistent_context(
        str(profile), headless=True, viewport={"width": 320, "height": 180},
        # a window nobody looks at must not be slowed down: the house's frames are the fight's clock
        # THE PAGES HOST STRAIGHT FROM HERE, NOT THROUGH CLOUDFLARE (2026-10-29, v21): Cloudflare kept a 404 for a module
        # asked for before its pieces were confirmed (for sandboxed pages, Origin: null), so the house got the baked
        # engine 8 and the world stayed offline. The house asks this machine's Caddy instead, trusting only Cloudflare's
        # origin certificate that Caddy shows (by its key's hash), nothing else.
        args=["--host-resolver-rules=MAP pages.pepecoinarcade.com 127.0.0.1",
              "--ignore-certificate-errors-spki-list=rWK9EWAd2JSz2aW6Ui5GeaZ84p5BUdiCkguPheNH3iw=",
              "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio",
              "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
              "--disable-backgrounding-occluded-windows"])
    # THE WEBSITE, NOT THE DESKTOP OR THE PHONE'S HOME SCREEN (2026-10-29): since that day's arcade update a browser
    # goes to /desktop (wider than 640 px) or /home (the house's 320 px) unless "Website" is chosen under Themes, and
    # the house never reached the Apps page ("our card is not on the Apps page" from 20:16 on).
    await ctx.add_init_script("""try { localStorage.setItem('arcade.deskview', 'web');
                                       localStorage.setItem('arcade.phoneview', 'web'); } catch (e) {}""")
    try:
        pg = ctx.pages[0] if ctx.pages else await ctx.new_page()
        if not await wallet_access(pg, game, password):
            log("Wallet access could not be turned on; trying again")
            return
        # the game in a tab of its own: the Apps page reloads itself after an unlock or a switch, and that cut the way
        # to the game off (2026-10-23, "interrupted by another navigation to /apps")
        apps, pg = pg, await ctx.new_page()
        await apps.close()
        # straight to the game, not /play: since 2026-10-29 /play first measures the affiliated arcades and then moves
        # itself on to /full, and the house's look at the page in between died ("Execution context was destroyed").
        # The zone is reached by LWQGAME.travel below.
        await pg.goto(f"{NODE}/inscriptions/{game}/full", timeout=120_000)
        # JOINING SIGNS WHO YOU ARE, once a day, and only this tab remembers it: the viewer asks for the password
        # ("Join this game as you?") -- for another node too -- and the game gives up asking after 20 s (2026-10-23
        # evening). So every ask is answered while the game joins, and a game left alone after one is loaded again:
        # the signatures are kept in the tab by then.
        for load in range(4):
            answered = False
            for _ in range(60):
                await asyncio.sleep(1)
                asked = await pg.evaluate("() => { const i = [...document.querySelectorAll('input[type=password]')].find(x => x.offsetParent && !x.dataset.lwqAnswered); return i ? (i.closest('form,dialog,div') || document.body).innerText.slice(0, 120) : ''; }")
                if asked and await answer_password(pg, password):
                    answered = True
                    log("answered the viewer's ask:", " ".join(asked.split())[:100])
                frame = await find_game(pg)
                if frame and await frame.evaluate("window.LWQGAME.state.online"):
                    break
                if frame and not asked and any("Playing alone" in x for x in await frame.evaluate("window.LWQGAME.log()")):
                    break
            if frame and await frame.evaluate("window.LWQGAME.state.online"):
                break
            if not answered and load:
                break
            log("the game is alone; loading it again (" + str(load + 1) + ")")
            await pg.reload(timeout=120_000)
        frame = None
        for _ in range(600):
            frame = await find_game(pg)
            if frame:
                break
            await asyncio.sleep(1)
        if not frame:
            log("the game did not start; trying again")
            return
        # A ZONE'S HOUSE: the play page may not hand ?level= on to the game, so the house sends its game there itself,
        # as a portal does (the frame's own address, its viewer ticket kept)
        if level and await frame.evaluate("lv => !!(window.LWQGAME && window.LWQGAME.travel) && window.LWQGAME.level !== lv", level):
            # IN PLACE (engine 22, 2026-10-28): the game leaves its first room and plays the zone in the same page
            if not await frame.evaluate("lv => window.LWQGAME.travel(lv)", level):
                log("the game did not go to", level, "; trying again")
                return
        elif level and f"level={level}" not in frame.url:
            # LEAVE THE FIRST ROOM FIRST (2026-10-28, live): the room is held by the viewer, not the game, so a frame
            # that only moves on stays in it -- three houses sat in Blockshire as one member, all three answering a
            # player's fast lane, which flapped between 'direct' and 'room'. A portal leaves too (engine travel()).
            here = await frame.evaluate("(() => { try { return new URLSearchParams(location.search).get('level') || ''; } catch (e) { return ''; } })()")
            await frame.evaluate("room => window.parent.postMessage({ arcade: 'realtime', op: 'leave', room: room, seq: 900000001 }, '*')",
                                 "lwq." + (here or "blockshire"))
            await asyncio.sleep(2)
            await frame.evaluate("lv => { const q = new URLSearchParams(location.search); q.set('level', lv); location.search = '?' + q.toString(); }", level)
            frame = None
            for _ in range(300):
                await asyncio.sleep(1)
                frame = await find_game(pg)
                if frame and f"level={level}" in frame.url:
                    break
            if not frame or f"level={level}" not in frame.url:
                log("the game did not go to", level, "; trying again")
                return
        started = time.time()
        for _ in range(18):   # joining the room can take a while on a busy node: up to 90 s before judging
            await asyncio.sleep(5)
            if await frame.evaluate("window.LWQGAME.state.online"):
                break
        # A game that can ask for records one player at a time (Etappe 4) gets them from the database as players come;
        # an older one still gets every record at the start, from players.json.
        store = pay = None
        if await frame.evaluate("!!window.LWQGAME.houseStore"):
            store = house_store.Store(STORE)
            await frame.evaluate("window.LWQGAME.houseStore(true)")
            log("store mode:", store.count(), "players in", STORE.name)
            # THE BETA SELLS GENESIS' PLOTS FOR LITECOIN TESTNET (2026-11-07): tools/ltc_pay.py
            if BETA and await frame.evaluate("!!window.LWQGAME.housePay"):
                pay = ltc_pay.Pay(store)
                await frame.evaluate("window.LWQGAME.housePay(true)")
                log("plots for tLTC, paid to", pay.key["address"])
        elif PLAYERS.exists():   # every player's record, back into the house's book
            n = await frame.evaluate("json => window.LWQGAME.houseLoad ? window.LWQGAME.houseLoad(json) : 0", PLAYERS.read_text())
            log("players' records loaded:", n)
        let_in_next(level)   # in its zone: the next house may come through the door
        log("started:", await frame.evaluate("(() => { const s = window.LWQGAME.state; return {online: s.online, house: s.house, players: s.players, seq: s.world.seq, engine: (window.LWQ.get('$report').find(r => r[0] === 'engine') || [])[1]}; })()"))
        worker = node_pid()
        build = beta_build()
        while time.time() - started < FRESH_EVERY:
            if worker and node_pid() not in (None, worker):
                log("the arcade's web worker restarted; joining again")
                return
            if BETA and beta_build() != build:
                log("a new beta build:", beta_build(), "; starting again")
                return
            frame = await find_game(pg)
            if not frame:
                log("the game frame is gone; starting again")
                return
            s = await frame.evaluate("(() => { const s = window.LWQGAME.state; return {online: s.online, house: s.house, players: s.players, seq: s.world.seq}; })()")
            s["zone"] = level or "main"
            if not s["online"] or s["house"] != "me":
                log("not the house any more:", s, "; starting again")
                return
            global LAST_GOOD
            LAST_GOOD = time.time()
            if store is None:
                await keep_players(frame)
            else:
                day = store.daily(BACKUPS)
                if day:
                    log("the day's backup and fingerprint:", day)
            GOOD_FILE.write_text(str(LAST_GOOD))
            if int(time.time()) % 600 < CHECK_EVERY or s["players"]:
                s.update(await frame.evaluate("""({fps: window.LWQGAME.stats().fps, net: (document.querySelector('.lwq-tr') || {}).innerText,
                    frameMs: window.LWQGAME.stats().frameMs,
                    fight: window.LWQGAME.fight().filter(u => u.kind !== 'beast').map(u => u.id + ':' + u.state + ':' + u.hp).join(' '),
                    snap: window.LWQGAME.snapBytes ? window.LWQGAME.snapBytes() : null})"""))
                log("keeping the world:", s)
            # between the checks: the database every second (records asked for, records changed)
            for tick in range(CHECK_EVERY):
                if pay is not None:
                    try:
                        await ltc_pay.sync(frame, pay, tick)
                    except Exception as e:   # noqa: BLE001 -- the next second tries again
                        log("pay error:", repr(e)[:200])
                if store is not None:
                    try:
                        given, taken = await house_store.sync(frame, store, level)
                        if given or taken:
                            log("store: gave", given, "took", taken)
                    except Exception as e:   # noqa: BLE001 -- the next second tries again
                        log("store error:", repr(e)[:200])
                await asyncio.sleep(1)
        log("six hours: a fresh start")
    finally:
        if store is not None and frame is not None:   # what changed in the last second, before the tab goes
            try:
                await house_store.sync(frame, store, level)
            except Exception:   # noqa: BLE001 -- the tab may be gone already
                pass
        house_store.release(level)
        await ctx.close()


def beta_build() -> str:
    """The bundle the beta page would load now (tools/beta_push.sh writes the registry last)."""
    try:
        return json.loads(BETA_REGISTRY.read_text())["bundle"]
    except (OSError, ValueError, KeyError):
        return ""


async def tell_keeper(text: str) -> None:
    proc = await asyncio.create_subprocess_exec(sys.executable, "-I", str(ROOT / "tools" / "notify.py"), ALERT_TO, text,
                                                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
    out, _ = await proc.communicate()
    log("to @" + ALERT_TO + ":", text[:80], "->", out.decode(errors="replace").strip()[-120:])


async def watchdog() -> None:
    """Out of the game for ALERT_AFTER: a message to the keeper, once; back in: one more."""
    alerted = False
    while True:
        await asyncio.sleep(60)
        out_for = time.time() - LAST_GOOD
        if not alerted and out_for > ALERT_AFTER:
            alerted = True
            since = time.strftime("%H:%M", time.localtime(LAST_GOOD))
            await tell_keeper(f"LiteWorldsQuest house: out of the game since {since} ({int(out_for // 60)} min), "
                              f"trying again by itself. Last trouble: {LAST_TROUBLE or 'none logged'}")
        elif alerted and out_for < CHECK_EVERY * 3:
            alerted = False
            await tell_keeper("LiteWorldsQuest house: back in the game, keeping the world again.")


async def keep(p, level: str) -> None:
    """One zone's house, for ever: each level has a room of its own (lwq.<level>), so each needs its own house. They
    share the database (players.sqlite): a player who leaves one zone is handed back, and the next zone's house asks
    for them."""
    while True:
        try:
            await session(p, level)
        except Exception as e:   # noqa: BLE001 -- whatever it was, the house comes back
            log("error", f"[{level or 'main'}]:", repr(e)[:300])
        await asyncio.sleep(15)


async def main() -> None:
    #: the zones to keep: config.json "house_levels" (e.g. ["blockshire", "beach", "pirateship"]); an empty name is
    #: the page's own first level. A page that knows no other levels keeps the one house it always had.
    levels = [""] if BETA else json.loads((ROOT / "config.json").read_text()).get("house_levels") or [""]
    log("house starting:", ", ".join(levels) or "the page's own level")
    if not BETA:
        asyncio.get_running_loop().create_task(watchdog())
    async with async_playwright() as p:
        await asyncio.gather(*(keep(p, lv) for lv in levels))


if __name__ == "__main__":
    asyncio.run(main())
