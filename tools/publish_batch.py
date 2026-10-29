#!/usr/bin/env python3
"""Everything of an update in one go (tbuuol 2026-10-28: "Warte nicht auf einzelne Bestätigungen! Schreibe alles
zusammen ein"). arcade-publish puts one file on the chain per run, and a file of several pieces waits one block for
its own split before its pieces can go -- an update of five files and a registry waited six blocks. Here:

  1. ONE split for every piece of every file AND of the registry (whose size is known before the ids are: an id is
     always 64 hex digits, so it is planned with stand-ins);
  2. one block;
  3. every piece of every file at once; then the registry, built with the real ids, from its outputs of the same
     split -- no second wait.

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
from arcade.publish import Key, Publisher, build, payload_outputs, _rpc, PublishError   # noqa: E402
from arcade.config import TESTNET                                    # noqa: E402
from arcade.txbuild import p2pkh_script                              # noqa: E402

PUB = ROOT / ".publisher"
NODE = "http://127.0.0.1:8420"
CREATOR = "nb6X4wxqMGq93oE477CiwCvYZYevxTg9R7"
STANDIN = "0" * 64


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

        # 1. one split for all
        if not J["split"] or pub._confirmations(J["split"]) is None:
            outputs, layout, at = [], {}, 0
            for it in everything:
                piece = inscribelib.piece_size(it["plan"])
                layout[it["name"]] = {"at": at, "n": it["plan"].chunks, "piece": piece}
                outputs += [(piece, p2pkh_script(address))] * it["plan"].chunks
                at += it["plan"].chunks
            unsigned = build(address, pub.coins.unspent(), outputs, pub.rate, f"one split for the update to registry v{V}")
            total_fee = unsigned.fee + sum(o[0] for o in outputs)
            say(f"{len(everything)} files, {at} pieces, one split; it and the pieces cost about {total_fee / fees.COIN:.4f}")
            for it in everything:
                say(f"  {it['name']}: {it['plan'].chunks} piece(s)")
            if args.dry:
                return 0
            J["layout"] = layout
            J["pieces"] = {}
            J["split"] = pub._send(unsigned)
            save()
            say("split:", J["split"])
        say("waiting one block for the split …")
        pub.wait_for(J["split"])
        say("the split is in a block")

        def send_pieces(name: str, pl) -> str:
            lay, done = J["layout"][name], J["pieces"].setdefault(name, {})
            if lay["n"] != pl.chunks:
                raise PublishError(f"{name}: planned {lay['n']} pieces, now {pl.chunks}")
            for n, body in enumerate(pl.payloads):
                if str(n) in done:
                    continue
                coin = {"txid": J["split"], "vout": lay["at"] + n, "value": lay["piece"], "address": address}
                outs = payload_outputs(params, address, key.pubkey, body)
                unsigned = funding.build_one(params, address, coin, outs, pub.rate, f"piece {n + 1} of {pl.chunks} of {name}")
                done[str(n)] = pub._send(unsigned)
                save()
            return done["0"]

        # 2. every file's pieces, all at once
        ids = {}
        for it in items:
            ids[it["path"]] = J["ids"].get(it["path"]) or send_pieces(it["name"], it["plan"])
            J["ids"][it["path"]] = ids[it["path"]]
            save()
            say(f"{it['name']} -> {ids[it['path']]}")
        # 3. the registry with the real ids, from the same split
        real = registry_bytes(V, ids)
        if len(real) != len(standin):
            raise PublishError("the registry changed size with the real ids; publish it with publish_update.sh")
        rplan = inscribelib.plan(real, "application/json", real.decode(), inscription_id=bytes.fromhex(rtag))
        (ROOT / f"dist/release/registry-v{V}.min.json").write_bytes(real)
        rid = send_pieces(reg_name, rplan)
        say("registry", V, "->", rid)
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
