#!/usr/bin/env python3
"""Everything of an update in one go (tbuuol 2026-10-28: "Warte nicht auf einzelne Bestätigungen! Schreibe alles
zusammen ein"). arcade-publish puts one file on the chain per run, and a file of several pieces waits one block for
its own split before its pieces can go -- an update of five files and a registry waited six blocks. Here:

  1. the pieces of every file AND of the registry (whose size is known before the ids are: an id is always 64 hex
     digits, so it is planned with stand-ins) packed into packages of at most 95 kB, each with a split of its own
     paid from coins of its own that are in a block already (tbuuol 2026-10-31: "Updates größer als 95kB kannst du ja
     auch in 95kB chunks einschreiben"): the relay carries ~101 kB under one unconfirmed transaction, so every package
     goes at once, no block waited for. Too few such coins: one split for all, and one block;
  2. every piece of every file at once; then the registry, built with the real ids, once every module is served.

The same building blocks as arcade-publish (arcade.publish: Key, Publisher, build, payload_outputs; arcade.inscribe:
plan, piece_size; arcade.funding: build_one), used as they are; the arcade's code is not changed. What went out is
written to .publisher/journal/batch-<registry version>.json after every send, so a run that stops is picked up again
with the same command and nothing is paid twice.

    tools/publish_batch.py 20 lwq-engine-v25.js.gz:modules.engine lwq-world-v2.json.gz:levels.world
    tools/publish_batch.py 20 ... --dry          plan and price it, send nothing

Afterwards, as publish_update.sh: the ids into config.json, the registry listed, the house restarted."""
from __future__ import annotations

import argparse
import json
import pathlib
import secrets
import subprocess
import sys
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
ARCADE = pathlib.Path("/var/lib/arcade/.dogecoinarcade")
sys.path.insert(0, str(ARCADE / "src"))

from arcade import fees, funding                                     # noqa: E402
from arcade import inscribe as inscribelib                           # noqa: E402
from arcade.publish import Key, Publisher, build, payload_outputs, _rpc, _txid_of, PublishError   # noqa: E402
from arcade.config import TESTNET                                    # noqa: E402
from arcade.txbuild import p2pkh_script                              # noqa: E402

PUB = ROOT / ".publisher"
NODE = "http://127.0.0.1:8420"
CREATOR = "nb6X4wxqMGq93oE477CiwCvYZYevxTg9R7"
STANDIN = "0" * 64
#: What the chain's relay carries under one unconfirmed transaction, itself and all its descendants: about 101 kB
#: (arcade/accountparts.py). An update whose split and pieces stay below this (with room to spare) goes out at once;
#: a bigger one waits one block for its split, then sends every piece (tbuuol 2026-10-29: "kleine sofort, große nach
#: den Regeln").
PACKAGE_MAX = 95_000
#: Where players' pages fetch the modules from. A page that finds the new registry but not yet its modules falls back
#: to the copies baked into it -- an old engine (2026-10-29, v21: the house came up with engine 8 and the world stayed
#: offline): the registry goes out only once every one of these serves every module, byte for byte.
#: Cloudflare in front of pages.pepecoinarcade.com refuses Python-urllib (403, 2026-10-31): the check asks as a browser
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) lwq-publish"}
SERVED_BY = ["http://127.0.0.1:8420", "https://pages.dogecoinarcade.com"]
#: Looked at and told, not waited for (tbuuol 2026-11-01: "dogecoinarcade.com ist der Main Server"): pepecoinarcade.com
#: is a node of its own behind Cloudflare, which kept a 404 for v23's modules for hours.
ALSO_SHOWN = ["https://pages.pepecoinarcade.com"]


def say(*parts) -> None:
    print(time.strftime("%H:%M:%S"), *parts, flush=True)


def set_key(cfg: dict, path: str, value: str) -> None:
    d = cfg
    for k in path.split("."):
        d = d[k]
    d["gz"] = value


def registry_bytes(version: int, ids: dict[str, str]) -> bytes:
    """config.json with these ids and this registry version, built: the registry the page reads, minified."""
    cfg = json.loads((ROOT / "config.json").read_text())
    for path, i in ids.items():
        set_key(cfg, path, i)
    cfg["registry_version"] = version
    (ROOT / "config.json").write_text(json.dumps(cfg, indent=2) + "\n")
    subprocess.run(["python3", "build.py", "--release"], cwd=ROOT, check=True,
                   stdout=subprocess.DEVNULL)
    reg = json.loads((ROOT / "dist/release/registry.json").read_text())
    return json.dumps(reg, separators=(",", ":")).encode()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("version", type=int, help="the registry version this update makes")
    ap.add_argument("files", nargs="+", help="name:configpath, the name a file in dist/release")
    ap.add_argument("--dry", action="store_true", help="plan and price, send nothing")
    args = ap.parse_args()
    V = args.version
    files = [(f.split(":", 1)[0], f.split(":", 1)[1]) for f in args.files]
    jpath = PUB / "journal" / f"batch-{V}.json"
    J = json.loads(jpath.read_text()) if jpath.exists() else {"version": V, "tags": {}, "split": "", "layout": {}, "pieces": {}, "ids": {}}
    def save():
        if not args.dry:
            jpath.parent.mkdir(parents=True, exist_ok=True)
            jpath.write_text(json.dumps(J, indent=1))

    # what each file is, and its plan (the same tag on every run: the same bytes)
    items = []
    for name, path in files:
        body = (ROOT / "dist/release" / name).read_bytes()
        tag = J["tags"].setdefault(name, secrets.token_bytes(8).hex())
        pl = inscribelib.plan(body, "application/gzip", "", inscription_id=bytes.fromhex(tag))
        items.append({"name": name, "path": path, "plan": pl})
    # the registry, planned with stand-in ids (the same length as the real ones)
    reg_name = f"registry-v{V}.json"
    kept = (ROOT / "config.json").read_text()   # the stand-ins never stay in config.json
    try:
        standin = registry_bytes(V, {path: STANDIN for _, path in files})
    finally:
        (ROOT / "config.json").write_text(kept)
    rtag = J["tags"].setdefault(reg_name, secrets.token_bytes(8).hex())
    rplan = inscribelib.plan(standin, "application/json", standin.decode(), inscription_id=bytes.fromhex(rtag))
    everything = items + [{"name": reg_name, "path": None, "plan": rplan}]

    params = TESTNET
    key = Key.from_file(PUB / "publish.key")
    class A:   # what _rpc reads
        rpc_url = None; datadir = "/var/lib/arcade/.pepecoin-testnet"; rpc_user = rpc_password = rpc_cookie = None
    with _rpc(A, params) as rpc:
        pub = Publisher(rpc, params, key, PUB / "journal", say=lambda s: say(s))
        pub.coins.watch()
        address = pub.address

        def sign(unsigned):
            sigs = [key.sign(bytes.fromhex(h)).hex() for h in unsigned.sighashes]
            raw = funding.assemble(unsigned, sigs, key.pubkey)
            return raw, _txid_of(raw)

        def send(raw, unsigned, txid):
            got = str(rpc.call("sendrawtransaction", raw))
            if got != txid:
                raise PublishError(f"the node named {got} for a transaction signed as {txid}")
            pub.coins.note(unsigned, got)
            return got

        # 1. the splits: every piece's size (signed against a stand-in coin), the pieces packed into packages of at most
        # PACKAGE_MAX, a split for each paid from confirmed coins no other split uses (a split paid with another's
        # unconfirmed change would hang under it, and the relay would count both packages as one)
        if J.get("split") and not J.get("splits"):   # a journal from before the packages
            J["splits"] = [J["split"]]
            for name, lay in J["layout"].items():
                lay["spots"] = [[0, lay["at"] + n] for n in range(lay["n"])]
        if not J.get("splits") or any(pub._confirmations(t) is None for t in J["splits"]):
            sizes = {}
            for it in everything:
                piece = inscribelib.piece_size(it["plan"])
                sizes[it["name"]] = (piece, [])
                for body in it["plan"].payloads:
                    coin = {"txid": STANDIN, "vout": 0, "value": piece, "address": address}
                    un = funding.build_one(params, address, coin, payload_outputs(params, address, key.pubkey, body), pub.rate, "its size")
                    sizes[it["name"]][1].append(len(sign(un)[0]) // 2)
            packs, cur, cur_b = [], [], 0
            for it in everything:
                for n, b in enumerate(sizes[it["name"]][1]):
                    if cur and cur_b + b + 34 > PACKAGE_MAX - 600:   # (600: a split's own inputs and change)
                        packs.append(cur)
                        cur, cur_b = [], 0
                    cur.append((it["name"], n))
                    cur_b += b + 34
            packs.append(cur)
            def fund(packs, pool):
                """[(unsigned split, [(name, n), ...])] or None when the coins do not stretch to a split each"""
                out = []
                for pk in packs:
                    outputs = [(sizes[name][0], p2pkh_script(address)) for name, n in pk]
                    try:
                        un = build(address, pool, outputs, pub.rate, f"split {len(out) + 1} of {len(packs)} for the update to registry v{V}")
                    except Exception:   # noqa: BLE001 -- not enough
                        return None
                    used = {(c["txid"], c["vout"]) for c in un.inputs}
                    pool = [c for c in pool if (c["txid"], c["vout"]) not in used]
                    out.append((un, pk))
                return out
            plan_ = fund(packs, list(pub.coins.confirmed())) if len(packs) > 1 else None
            if plan_ is None:   # one split for all (and one block, if it is big)
                packs = [[(it["name"], n) for it in everything for n in range(it["plan"].chunks)]]
                plan_ = fund(packs, pub.coins.unspent())
                if plan_ is None:
                    raise PublishError("not enough coins for the update")
            total = sum(un.fee + sum(o[0] for o in un.outputs[:len(pk)]) for un, pk in plan_)
            npieces = sum(len(pk) for _, pk in plan_)
            say(f"{len(everything)} files, {npieces} pieces, {len(plan_)} split(s); they and the pieces cost about {total / fees.COIN:.4f}")
            for it in everything:
                say(f"  {it['name']}: {it['plan'].chunks} piece(s)")
            for k, (un, pk) in enumerate(plan_):
                say(f"  package {k + 1}: {len(pk)} pieces, about {(sum(sizes[name][1][n] for name, n in pk) + 600) // 1000} kB")
            if args.dry:
                return 0
            J["splits"], J["pieces"], J["layout"], J["split_bytes"] = [], {}, {}, []
            for it in everything:
                J["layout"][it["name"]] = {"n": it["plan"].chunks, "piece": sizes[it["name"]][0], "spots": [None] * it["plan"].chunks}
            for k, (un, pk) in enumerate(plan_):
                for vout, (name, n) in enumerate(pk):
                    J["layout"][name]["spots"][n] = [k, vout]
                raw, txid = sign(un)
                J["split_bytes"].append(len(raw) // 2)
                J["splits"].append(send(raw, un, txid))
                save()
                say(f"split {k + 1}:", J["splits"][-1])

        def prepare(name: str, pl) -> list:
            """Every piece of a file signed, not sent yet: [(n, raw, txid, unsigned)]; a piece sent before keeps its txid."""
            lay, done = J["layout"][name], J["pieces"].setdefault(name, {})
            if lay["n"] != pl.chunks:
                raise PublishError(f"{name}: planned {lay['n']} pieces, now {pl.chunks}")
            out = []
            for n, body in enumerate(pl.payloads):
                if str(n) in done:
                    out.append((n, None, done[str(n)], None))
                    continue
                k, vout = lay["spots"][n]
                coin = {"txid": J["splits"][k], "vout": vout, "value": lay["piece"], "address": address}
                outs = payload_outputs(params, address, key.pubkey, body)
                unsigned = funding.build_one(params, address, coin, outs, pub.rate, f"piece {n + 1} of {pl.chunks} of {name}")
                raw, txid = sign(unsigned)
                out.append((n, raw, txid, unsigned))
            return out

        # 2. every piece signed: the files', then the registry's with the files' ids (a piece's id is its txid)
        ready, ids = {}, {}
        for it in items:
            ready[it["name"]] = prepare(it["name"], it["plan"])
            ids[it["path"]] = ready[it["name"]][0][2]
        real = registry_bytes(V, ids)
        if len(real) != len(standin):
            raise PublishError("the registry changed size with the real ids; publish it with publish_update.sh")
        rplan = inscribelib.plan(real, "application/json", real.decode(), inscription_id=bytes.fromhex(rtag))
        (ROOT / f"dist/release/registry-v{V}.min.json").write_bytes(real)
        ready[reg_name] = prepare(reg_name, rplan)
        # 3. each package at once if it fits under its unconfirmed split (it does, but for the one-split fallback); else
        # after that split's block
        byk = {}
        for name, pieces in ready.items():
            for n, raw, _, _ in pieces:
                if raw:
                    k = J["layout"][name]["spots"][n][0]
                    byk[k] = byk.get(k, 0) + len(raw) // 2
        sb = J.get("split_bytes") or []
        sb = sb if isinstance(sb, list) else [sb]
        for k, b in byk.items():
            package = b + (sb[k] if k < len(sb) else 0)
            if package > PACKAGE_MAX and pub._confirmations(J["splits"][k]) < 1:
                say(f"package {k + 1} is {package // 1000} kB, more than the {PACKAGE_MAX // 1000} kB the relay carries under an unconfirmed split: waiting one block …")
                pub.wait_for(J["splits"][k])
                say(f"split {k + 1} is in a block")
            else:
                say(f"package {k + 1} is {package // 1000} kB: its pieces go now")
        def send_all(name):
            done = J["pieces"].setdefault(name, {})
            for n, raw, txid, unsigned in ready[name]:
                if str(n) in done:
                    continue
                try:
                    done[str(n)] = send(raw, unsigned, txid)
                except Exception as e:   # noqa: BLE001
                    # the relay weighs a piece by its signature checks too, so a package of bytes under the limit can
                    # still be too much under its unconfirmed split (2026-11-01): then its split's block, and on
                    if "too-long-mempool-chain" not in str(e):
                        raise
                    k = J["layout"][name]["spots"][n][0]
                    say(f"{name}: the relay carries no more under split {k + 1} for now; waiting for its block …")
                    pub.wait_for(J["splits"][k])
                    say(f"split {k + 1} is in a block")
                    done[str(n)] = send(raw, unsigned, txid)
                save()
            say(f"{name} -> {done['0']}")
        for it in items:
            send_all(it["name"])
        # 4. the registry only once the players' pages can fetch every module (else they fall back to old ones)
        want = {it["name"]: (ROOT / "dist/release" / it["name"]).read_bytes() for it in items}
        t0 = time.time()
        while True:
            missing = []
            for name in want:
                for host in SERVED_BY:
                    # Cloudflare keeps a 404 it was asked for too early (for minutes, no-store or not: 2026-11-01), and
                    # players then get the old modules: a host behind it is asked only once this node serves the file
                    if host != SERVED_BY[0] and f"{name}@{SERVED_BY[0]}" in missing:
                        missing.append(f"{name}@{host}"); continue
                    try:
                        with urllib.request.urlopen(urllib.request.Request(f"{host}/content/{J['pieces'][name]['0']}", headers=UA), timeout=30) as r:
                            if r.read() != want[name]:
                                missing.append(f"{name}@{host} (other bytes)")
                    except Exception:   # noqa: BLE001 -- not there yet
                        missing.append(f"{name}@{host}")
            if not missing:
                for name in want:
                    for host in ALSO_SHOWN:
                        try:
                            with urllib.request.urlopen(urllib.request.Request(f"{host}/content/{J['pieces'][name]['0']}", headers=UA), timeout=30) as r:
                                ok = r.read() == want[name]
                        except Exception:   # noqa: BLE001
                            ok = False
                        if not ok:
                            say(f"(not yet at {host.split('//')[1]}: {name})")
                say("every module is served by this node and the main server")
                break
            if time.time() - t0 > 3600:
                raise PublishError("modules still not served after an hour: " + ", ".join(missing) + " -- run again to resume")
            say(f"waiting for {len(missing)} to be served: " + ", ".join(m.split('@')[0] + '@' + m.split('@')[1].split('//')[-1] for m in missing[:4]))
            time.sleep(30)
        send_all(reg_name)
        for it in items:
            J["ids"][it["path"]] = ids[it["path"]]
        save()
        rid = J["pieces"][reg_name]["0"]
        txids = [t for d in J["pieces"].values() for t in d.values()]

    subprocess.run(["timeout", "200", "python3", "tools/relay_mempool.py", *txids], cwd=ROOT,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(110):   # until the node lists it; then the house takes it up
        try:
            with urllib.request.urlopen(f"{NODE}/r/inscriptions?creator={CREATOR}&limit=300", timeout=20) as r:
                listed = json.load(r)
            v = max([p["json"]["version"] for p in listed if isinstance(p.get("json"), dict) and p["json"].get("lwq") == "registry"] or [0])
        except Exception:   # noqa: BLE001 -- a busy node answers next time
            v = 0
        if v >= V:
            say(f"registry v{V} listed")
            subprocess.run(["systemctl", "--user", "restart", "lwq-house.service"])
            say("house restarted")
            cfg = json.loads((ROOT / "config.json").read_text())
            cfg["registry_ids"][str(V)] = f"{rid} (publisher, loader 2, batch)"
            (ROOT / "config.json").write_text(json.dumps(cfg, indent=2) + "\n")
            return 0
        time.sleep(30)
    say("not listed yet")
    return 1


if __name__ == "__main__":
    sys.exit(main())
