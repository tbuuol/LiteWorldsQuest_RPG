#!/usr/bin/env python3
"""Build the LiteWorldsQuest page: the loader, every module and level baked into one HTML file.

    python3 build.py            -> dist/liteworldsquest.html   (the page to inscribe; plays on its own)
                                   dist/registry.json          (the registry the page carries)
                                   dist/modules/<name>.js|json (each module alone, for inscribing it by itself later)

config.json says which three.js inscription the page imports (the one ASHVALE already inscribed: no cost), each
module's version and interface, and, once they are inscribed, their ids. A module with an id can then be replaced
by inscribing a newer one and a newer registry, without a new page (the loader takes the newest registry by the
publisher named in "creator").
"""
from __future__ import annotations

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent


def build(release: bool = False) -> pathlib.Path:
    """release: the page to inscribe (dist/release/), naming only the assets that already have an inscription id;
    otherwise the dev page, whose assets the dev server serves beside it."""
    cfg = json.loads((ROOT / "config.json").read_text())
    page = (ROOT / "src/page.html").read_text()
    loader = (ROOT / "src/loader.js").read_text()

    registry = {"lwq": "registry", "version": cfg["registry_version"], "loader": 1, "modules": {
        "three": {"id": cfg["three_id"], "v": "0.160.0", "api": 160, "kind": "esm"}}}
    out_dir = ROOT / "dist" / "modules"
    out_dir.mkdir(parents=True, exist_ok=True)
    scripts = []
    for name, m in cfg["modules"].items():
        code = (ROOT / m["file"]).read_text()
        scripts.append(f"<script>\n{code}</script>")
        (out_dir / f"{name}.js").write_text(code)
        registry["modules"][name] = {"id": m["id"], "v": m["v"], "api": m["api"], "kind": m["kind"]}
    registry["modules"]["levels"] = {}
    for name, m in cfg["levels"].items():
        data = json.loads((ROOT / m["file"]).read_text())
        assert data.get("lwq") == "module" and data.get("name") == f"level.{name}", m["file"]
        text = json.dumps(data, separators=(",", ":"))
        scripts.append(f"<script>LWQ.defineData({text});</script>")
        (out_dir / f"level.{name}.json").write_text(text)
        registry["modules"]["levels"][name] = {"id": m["id"], "v": m["v"], "api": m["api"], "kind": m["kind"]}

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

    html = (page.replace("/*@@LOADER@@*/", loader)
                .replace("/*@@MODULES@@*/", body)
                .replace("/*@@THREE_ID@@*/", cfg["three_id"])
                .replace("/*@@REGISTRY@@*/", json.dumps(registry, separators=(",", ":")))
                .replace("/*@@CREATORS@@*/", json.dumps(cfg.get("creators") or [])))
    assert "@@" not in html, "a placeholder was left in the page"
    dist = ROOT / "dist" / ("release" if release else "")
    dist.mkdir(parents=True, exist_ok=True)
    (dist / "registry.json").write_text(json.dumps(registry, indent=1))
    target = dist / "liteworldsquest.html"
    target.write_text(html)
    budget(target, manifest)
    return target


#: The "Hybrid" tier (decided 2026-10-21): the whole game, page and every file it brings, stays under this.
#: three.js is not counted: it is ASHVALE's inscription, shared at no cost.
BUDGET_MB = 5.0


def budget(page: pathlib.Path, manifest: dict) -> None:
    files = sum(v["bytes"] for v in manifest.values())
    total = page.stat().st_size + files
    line = (f"budget: page {page.stat().st_size / 1024:.0f} KB + assets {files / 1024:.0f} KB = "
            f"{total / 1048576:.2f} MB of {BUDGET_MB:.0f} MB")
    (ROOT / "dist" / "budget.txt").write_text(line + "\n")
    if total > BUDGET_MB * 1048576:
        sys.exit(line + "  -- OVER BUDGET")
    print(line)


if __name__ == "__main__":
    t = build(release="--release" in sys.argv)
    print(f"{t.relative_to(ROOT)}: {t.stat().st_size / 1024:.1f} KB")
