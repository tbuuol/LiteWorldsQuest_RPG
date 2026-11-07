#!/usr/bin/env python3
"""Build the LiteWorldsQuest page: the loader, every module and level baked into one HTML file.

    python3 build.py            -> dist/liteworldsquest.html   (the page to inscribe; plays on its own)
                                   dist/registry.json          (the registry the page carries)
                                   dist/release/modules/<name>.js|json (each module alone and minified, to inscribe)

config.json says which three.js inscription the page imports (the one ASHVALE already inscribed: no cost), each
module's version and interface, and, once they are inscribed, their ids. A module with an id can then be replaced
by inscribing a newer one and a newer registry, without a new page (the loader takes the newest registry by the
publisher named in "creator").
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent
#: esbuild, as one binary (no Node): tools/cache/ is not in git, so a machine without it builds unminified, and says so.
ESBUILD = ROOT / "tools" / "cache" / "esbuild-0.24.0" / "esbuild"


def minify(code: str, label: str) -> str:
    """What gets inscribed is paid for by the byte: comments, spaces and long local names cost about half of every
    module. esbuild shortens them (never property names, so modules still find each other's interfaces)."""
    if not ESBUILD.exists():
        print(f"build: no esbuild at {ESBUILD.relative_to(ROOT)}, {label} stays as it is", file=sys.stderr)
        return code
    run = subprocess.run([str(ESBUILD), "--minify", "--target=es2020", "--loader=js", "--log-level=error"],
                         input=code, capture_output=True, text=True, timeout=120)
    if run.returncode != 0:
        sys.exit(f"build: esbuild could not minify {label}: {run.stderr.strip()}")
    return run.stdout


#: zopfli writes gzip a few per cent smaller than zlib's best; it lives in the tools' venv (pip install zopfli)
VENV_PY = ROOT / "tools" / ".venv" / "bin" / "python"


def pack(data: bytes) -> bytes:
    """gzip, as small as it gets: zopfli when it is installed (here or in the tools' venv), else zlib at level 9.
    The browser unpacks either with DecompressionStream('gzip')."""
    try:
        import zopfli.gzip
        return zopfli.gzip.compress(data, numiterations=60)
    except ImportError:
        pass
    if VENV_PY.exists():
        run = subprocess.run([str(VENV_PY), "-I", "-c", "import sys, zopfli.gzip; sys.stdout.buffer.write("
                              "zopfli.gzip.compress(sys.stdin.buffer.read(), numiterations=60))"],
                             input=data, capture_output=True, timeout=600)
        if run.returncode == 0 and run.stdout:
            return run.stdout
    import gzip
    return gzip.compress(data, 9, mtime=0)


def build(release: bool = False) -> pathlib.Path:
    """release: the page to inscribe (dist/release/), naming only the assets that already have an inscription id;
    otherwise the dev page, whose assets the dev server serves beside it."""
    cfg = json.loads((ROOT / "config.json").read_text())
    page = (ROOT / "src/page.html").read_text()
    loader = (ROOT / "src/loader.js").read_text()

    registry = {"lwq": "registry", "version": cfg["registry_version"], "loader": 1, "modules": {
        "three": {"id": cfg["three_id"], "v": "0.160.0", "api": 160, "kind": "esm"}}}
    # the release's modules (minified, the ones to inscribe) apart from the dev build's, which every dev load rewrites
    out_dir = ROOT / "dist" / ("release/modules" if release else "modules")
    out_dir.mkdir(parents=True, exist_ok=True)
    scripts, bundle = [], []
    entry = lambda m: {k: v for k, v in (("id", m["id"]), ("gz", m.get("gz")), ("v", m["v"]), ("api", m["api"]),
                                         ("kind", m["kind"])) if k != "gz" or v}
    for name, m in cfg["modules"].items():
        code = (ROOT / m["file"]).read_text()
        if release:   # the dev page stays readable; what is inscribed is small
            code = minify(code, m["file"])
            (out_dir / f"{name}.js.gz").write_bytes(pack(code.encode()))   # this module alone, packed, for an update
        scripts.append(f"<script>\n{code}</script>")
        bundle.append({"n": name, "k": "js", "t": code})
        (out_dir / f"{name}.js").write_text(code)
        registry["modules"][name] = entry(m)
    registry["modules"]["levels"] = {}
    for name, m in cfg["levels"].items():
        data = json.loads((ROOT / m["file"]).read_text())
        assert data.get("lwq") == "module" and data.get("name") == f"level.{name}", m["file"]
        text = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
        scripts.append(f"<script>LWQ.defineData({text});</script>")
        bundle.append({"n": f"level.{name}", "k": "json", "t": text})
        (out_dir / f"level.{name}.json").write_text(text)
        if release:
            (out_dir / f"level.{name}.json.gz").write_bytes(pack(text.encode()))
        registry["modules"]["levels"][name] = entry(m)
    # The house: the game's own account, kept in the room by a machine, keeps the world when it is there (engine v10).
    # The dev viewer's ?as=house is one too, so it can be tried without the real account.
    registry["house"] = list(cfg.get("house") or []) + ([] if release else ["nDevhouse"])
    # A packed entry ("gz") can only be read by loader 2: such a registry says so, and loader-1 pages pass it by.
    if any("gz" in e for e in [*registry["modules"].values(), *registry["modules"]["levels"].values()]):
        registry["loader"] = 2
    # The release page carries no module itself: they all go into one gzip bundle, an inscription of its own, which
    # the page unpacks (loader 2). Until the bundle is inscribed its id is unknown, and the dev server stands in.
    packed = None
    if release:
        packed = ROOT / "dist" / "release" / "bundle.json.gz"
        packed.parent.mkdir(parents=True, exist_ok=True)
        packed.write_bytes(pack(json.dumps(bundle, separators=(",", ":"), ensure_ascii=False).encode()))
        scripts = []

    # Anything baked into a <script> must not close it early.
    for label, text in [("src/loader.js", loader)] + [(m["file"], (ROOT / m["file"]).read_text())
                                                       for m in [*cfg["modules"].values(), *cfg["levels"].values()]]:
        if "</script" in text.lower():
            sys.exit(f"{label} contains '</script': it would end its own script tag")
    body = "\n".join(scripts)
    # The real files (tools/assets.py): named in the registry, copied beside the page, never baked into it.
    import shutil
    man_path = ROOT / "assets" / "manifest.json"
    manifest = json.loads(man_path.read_text()) if man_path.exists() else {}
    ids = cfg.get("asset_ids", {})
    registry["modules"]["assets"] = {k: {"id": ids.get(k), "file": v["file"]} for k, v in manifest.items()
                                     if not release or ids.get(k)}
    (ROOT / "dist" / "assets").mkdir(parents=True, exist_ok=True)
    for v in manifest.values():
        shutil.copyfile(ROOT / "assets" / v["file"], ROOT / "dist" / "assets" / v["file"])

    if release:
        loader = minify(loader, "src/loader.js")
    html = (page.replace("/*@@LOADER@@*/", loader)
                .replace("/*@@MODULES@@*/", body)
                .replace("/*@@THREE_ID@@*/", cfg["three_id"])
                .replace("/*@@REGISTRY@@*/", json.dumps(registry, separators=(",", ":")))
                .replace("/*@@CREATORS@@*/", json.dumps(cfg.get("creators") or []))
                .replace("/*@@BUNDLE@@*/", json.dumps("/content/" + (cfg.get("bundle_id") or "release-bundle"))
                         if release else "null"))
    assert "@@" not in html, "a placeholder was left in the page"
    dist = ROOT / "dist" / ("release" if release else "")
    dist.mkdir(parents=True, exist_ok=True)
    (dist / "registry.json").write_text(json.dumps(registry, indent=1))
    target = dist / "liteworldsquest.html"
    target.write_text(html)
    budget(target, manifest, packed)
    return target


def build_beta() -> pathlib.Path:
    """The beta (tbuuol 2026-11-07): what the beta page (src/beta.html) fetches from /content/lwq-beta/ instead of the
    chain, so a new build is played without inscribing anything.

        dist/beta/site/registry.json            the registry, naming the bundle and the house
        dist/beta/site/bundle-<hash>.json.gz    every module and level, readable (not minified), gzip
        dist/beta/site/assets/<file>            the assets that have no inscription yet
        dist/beta/liteworldsquest-beta.html     the page to inscribe, once
    tools/beta_push.sh copies site/ to where pepecoinarcade.com's Caddy serves it."""
    import gzip
    import hashlib
    import shutil
    cfg = json.loads((ROOT / "config.json").read_text())
    site = ROOT / "dist" / "beta" / "site"
    if site.exists():
        shutil.rmtree(site)
    (site / "assets").mkdir(parents=True)
    registry = {"lwq": "registry", "version": cfg["registry_version"], "loader": 2, "beta": True, "modules": {
        "three": {"id": cfg["three_id"], "v": "0.160.0", "api": 160, "kind": "esm"}, "levels": {}}}
    bundle = []
    for name, m in cfg["modules"].items():
        bundle.append({"n": name, "k": "js", "t": (ROOT / m["file"]).read_text()})
        registry["modules"][name] = {"v": m["v"], "api": m["api"], "kind": m["kind"]}
    for name, m in cfg["levels"].items():
        data = json.loads((ROOT / m["file"]).read_text())
        bundle.append({"n": f"level.{name}", "k": "json", "t": json.dumps(data, separators=(",", ":"), ensure_ascii=False)})
        registry["modules"]["levels"][name] = {"v": m["v"], "api": m["api"], "kind": "json"}
    packed = gzip.compress(json.dumps(bundle, separators=(",", ":"), ensure_ascii=False).encode(), 6, mtime=0)
    registry["bundle"] = f"bundle-{hashlib.sha256(packed).hexdigest()[:12]}.json.gz"   # a new name, never a stale copy
    (site / registry["bundle"]).write_bytes(packed)
    man_path = ROOT / "assets" / "manifest.json"
    manifest = json.loads(man_path.read_text()) if man_path.exists() else {}
    ids = cfg.get("asset_ids", {})
    registry["modules"]["assets"] = {}
    for k, v in manifest.items():
        if not ids.get(k):
            shutil.copyfile(ROOT / "assets" / v["file"], site / "assets" / v["file"])
        registry["modules"]["assets"][k] = {"id": ids.get(k) or f"lwq-beta/assets/{v['file']}", "file": v["file"]}
    registry["house"] = list(cfg.get("house") or [])
    (site / "registry.json").write_text(json.dumps(registry, separators=(",", ":")))

    html = (ROOT / "src/beta.html").read_text()
    html = (html.replace("/*@@LOADER@@*/", minify((ROOT / "src/loader.js").read_text(), "src/loader.js"))
                .replace("/*@@THREE_ID@@*/", cfg["three_id"]))
    assert "@@" not in html, "a placeholder was left in the beta page"
    page = ROOT / "dist" / "beta" / "liteworldsquest-beta.html"
    page.write_text(html)
    print(f"beta: page {page.stat().st_size / 1024:.1f} KB, bundle {len(packed) / 1024:.0f} KB ({registry['bundle']})")
    return page


#: The "Hybrid" tier (decided 2026-10-21): the whole game, page and every file it brings, stays under this.
#: three.js is not counted: it is ASHVALE's inscription, shared at no cost.
BUDGET_MB = 5.0


def budget(page: pathlib.Path, manifest: dict, packed: pathlib.Path | None = None) -> None:
    files = sum(v["bytes"] for v in manifest.values())
    extra = packed.stat().st_size if packed else 0
    total = page.stat().st_size + extra + files
    line = (f"budget: page {page.stat().st_size / 1024:.1f} KB"
            + (f" + bundle {extra / 1024:.1f} KB" if packed else "")
            + f" + assets {files / 1024:.0f} KB = {total / 1048576:.2f} MB of {BUDGET_MB:.0f} MB")
    (ROOT / "dist" / "budget.txt").write_text(line + "\n")
    if total > BUDGET_MB * 1048576:
        sys.exit(line + "  -- OVER BUDGET")
    print(line)


if __name__ == "__main__":
    if "--beta" in sys.argv:
        build_beta()
        sys.exit(0)
    t = build(release="--release" in sys.argv)
    print(f"{t.relative_to(ROOT)}: {t.stat().st_size / 1024:.1f} KB")
