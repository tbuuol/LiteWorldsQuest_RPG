#!/usr/bin/env python3
"""Inscribe every asset in assets/manifest.json that has no inscription yet, one after another, on P test.

    python3 tools/publish_assets.py

Uses the arcade's own arcade-publish with the publisher key (.publisher/publish.key). Each id is written to
config.json ("asset_ids") the moment its inscription is out, and arcade-publish journals every piece, so a run that
stops (or is stopped) is simply started again: done files are skipped, a half-done one is finished, nothing is paid
twice. A log of each file goes to .publisher/log/.
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ARCADE = pathlib.Path("/var/lib/arcade/.dogecoinarcade")
TYPES = {".webp": "image/webp", ".png": "image/png", ".glb": "model/gltf-binary"}


def main() -> int:
    manifest = json.loads((ROOT / "assets" / "manifest.json").read_text())
    (ROOT / ".publisher" / "log").mkdir(parents=True, exist_ok=True)
    todo = [k for k in manifest if not json.loads((ROOT / "config.json").read_text()).get("asset_ids", {}).get(k)]
    print(f"{len(todo)} of {len(manifest)} assets to inscribe", flush=True)
    for n, name in enumerate(todo, 1):
        f = ROOT / "assets" / manifest[name]["file"]
        cmd = [str(ARCADE / "venv/bin/arcade-publish"), "-testnet", "--key", str(ROOT / ".publisher/publish.key"),
               "--datadir", "/var/lib/arcade/.pepecoin-testnet", "--journal", str(ROOT / ".publisher/journal"),
               "--type", TYPES[f.suffix], "--name", f.name, str(f)]
        run = subprocess.run(cmd, cwd=ARCADE / "src", capture_output=True, text=True, timeout=3600)
        (ROOT / ".publisher" / "log" / f"{f.name}.log").write_text(run.stdout + run.stderr)
        out = run.stdout[run.stdout.find("{"):] if "{" in run.stdout else ""
        try:
            ident = json.loads(out)["id"]
        except Exception:
            print(f"[{n}/{len(todo)}] {f.name}: FAILED -- {(run.stderr or run.stdout).strip()[-300:]}", flush=True)
            return 1
        # hand the pieces to every peer once more: a burst can lose some on the way to the miner (2026-10-21)
        subprocess.run([sys.executable, str(ROOT / "tools/relay_mempool.py"), *json.loads(out)["txids"]],
                       capture_output=True, timeout=300)
        cfg = json.loads((ROOT / "config.json").read_text())   # re-read: written after every file
        cfg.setdefault("asset_ids", {})[name] = ident
        (ROOT / "config.json").write_text(json.dumps(cfg, indent=2) + "\n")
        print(f"[{n}/{len(todo)}] {f.name}: {ident}", flush=True)
    print("all assets inscribed", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
