#!/usr/bin/env python3
"""Fetch, shrink and record LiteWorldsQuest's real assets (the "Hybrid" tier: a few real files, the rest is code).

    tools/.venv/bin/python tools/assets.py          -> assets/  (the files the game ships)
                                                     assets/manifest.json  (name -> file, bytes, licence, source)

Only CC0 sources, because whatever is inscribed is given away for good:
  Poly Haven  (https://polyhaven.com, CC0)          PBR textures: colour at 1024 px, normal map at 512 px, as WebP
  Kenney      (https://kenney.nl, CC0)               Blocky Characters 2.0: one model and animations every
                                                     character shares, and a small texture per character
The downloads stay in tools/cache/, so a rebuild asks nobody again. build.py adds the bytes up against the budget.
"""
from __future__ import annotations

import io
import json
import pathlib
import struct
import urllib.request
import zipfile

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / "tools" / "cache"
OUT = ROOT / "assets"
UA = "LiteWorldsQuest-prototype/0.1 (game asset fetch)"

TEXTURES = {   # our name: (Poly Haven id, what it is for)
    "grass":   ("leafy_grass", "the ground"),
    "dirt":    ("park_dirt", "paths and the village square"),
    "timber":  ("weathered_peeling_timber", "log walls"),
    "planks":  ("brown_planks_03", "floors, doors, crates, carts"),
    "thatch":  ("thatch_roof_angled", "thatched roofs, haystacks"),
    "stone":   ("castle_wall_slates", "footings, the well, the fire ring, walls"),
    "bark":    ("bark_brown_02", "tree trunks, posts, logs"),
    "tiles":   ("clay_roof_tiles_02", "tiled roofs (Weida)"),
    "plaster": ("clay_plaster", "plastered walls (Weida)"),
}
KENNEY_ZIP = "https://kenney.nl/media/pages/assets/blocky-characters/8369c0cf30-1749547469/kenney_blocky-characters_20.zip"
ANIMS = ["idle", "walk", "sprint", "sit", "pick-up", "emote-yes", "emote-no", "interact-right", "attack-melee-right", "die"]
CHARACTERS = "abcefikmnp"   # the looks that belong in a village (art.PEOPLE); robots, suits and ninjas stay home


def fetch(url: str, name: str) -> bytes:
    path = CACHE / name
    if path.exists():
        return path.read_bytes()
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=180) as r:
        body = r.read()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    return body


def webp(img: Image.Image, size: int, quality: int) -> bytes:
    img = img.convert("RGB").resize((size, size), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=quality, method=6)
    return buf.getvalue()


def textures(manifest: dict):
    index = json.loads(fetch("https://api.polyhaven.com/assets?t=textures", "ph_textures.json"))
    for name, (ph, use) in TEXTURES.items():
        files = json.loads(fetch(f"https://api.polyhaven.com/files/{ph}", f"ph/{ph}.json"))
        # colour at quality 68: on chain every byte costs twice (2026-10-21: 2.7 MB came to ~650 coins), and photographed
        # ground and walls hide WebP's artefacts well
        for part, key, size, q in (("color", "Diffuse", 1024, 68), ("normal", "nor_gl", 512, 85)):
            url = files[key]["1k"]["jpg"]["url"]
            src = Image.open(io.BytesIO(fetch(url, f"ph/{ph}_{key}_1k.jpg")))
            data = webp(src, size, q)
            fname = f"{name}-{part}.webp"
            (OUT / fname).write_bytes(data)
            manifest[f"tex.{name}.{part}"] = {"file": fname, "bytes": len(data), "licence": "CC0",
                                             "source": f"Poly Haven: {index.get(ph, {}).get('name', ph)} ({ph})",
                                             "use": use}
        print(f"  {name:8s} {ph}")


def slim_glb(glb: bytes, keep: list[str]) -> bytes:
    """The Kenney model without its picture (each character's comes on its own), without tangents (no normal map on
    people) and with only the animations the game plays; the binary chunk is rebuilt with what is still used."""
    jlen = struct.unpack("<I", glb[12:16])[0]
    j = json.loads(glb[20:20 + jlen])
    blen = struct.unpack("<I", glb[20 + jlen:24 + jlen])[0]
    bin_ = glb[28 + jlen:28 + jlen + blen]
    j["animations"] = [a for a in j.get("animations", []) if a.get("name") in keep]
    for m in j["meshes"]:
        for p in m["primitives"]:
            p["attributes"].pop("TANGENT", None)
    for k in ("images", "textures", "samplers"):
        j.pop(k, None)
    for m in j.get("materials", []):
        m.pop("extensions", None)
        m["pbrMetallicRoughness"] = {"metallicFactor": 0, "roughnessFactor": 0.8}
    j["extensionsUsed"] = [e for e in j.get("extensionsUsed", []) if e not in ("KHR_materials_unlit", "KHR_texture_transform")]
    used = set()
    for m in j["meshes"]:
        for p in m["primitives"]:
            used.update(p["attributes"].values())
            if "indices" in p:
                used.add(p["indices"])
    for a in j["animations"]:
        for s in a["samplers"]:
            used.update((s["input"], s["output"]))
    old_acc = j["accessors"]
    acc_map, new_acc, views, out = {}, [], [], bytearray()
    for i in sorted(used):
        a = dict(old_acc[i])
        v = j["bufferViews"][a["bufferView"]]
        comp = {5126: 4, 5125: 4, 5123: 2, 5121: 1}[a["componentType"]]
        n = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[a["type"]]
        start = v.get("byteOffset", 0) + a.get("byteOffset", 0)
        stride = v.get("byteStride", comp * n)
        chunk = b"".join(bin_[start + k * stride:start + k * stride + comp * n] for k in range(a["count"]))
        while len(out) % 4:
            out.append(0)
        views.append({"buffer": 0, "byteOffset": len(out), "byteLength": len(chunk)})
        out += chunk
        a["bufferView"] = len(views) - 1
        a.pop("byteOffset", None)
        acc_map[i] = len(new_acc)
        new_acc.append(a)
    j["accessors"], j["bufferViews"] = new_acc, views
    j["buffers"] = [{"byteLength": len(out)}]
    for m in j["meshes"]:
        for p in m["primitives"]:
            p["attributes"] = {k: acc_map[v] for k, v in p["attributes"].items()}
            if "indices" in p:
                p["indices"] = acc_map[p["indices"]]
    for a in j["animations"]:
        for s in a["samplers"]:
            s["input"], s["output"] = acc_map[s["input"]], acc_map[s["output"]]
    js = json.dumps(j, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    while len(out) % 4:
        out.append(0)
    body = struct.pack("<I4s", len(js), b"JSON") + js + struct.pack("<I4s", len(out), b"BIN\0") + bytes(out)
    return struct.pack("<4sII", b"glTF", 2, 12 + len(body)) + body


def characters(manifest: dict):
    z = zipfile.ZipFile(io.BytesIO(fetch(KENNEY_ZIP, "kenney/blocky.zip")))
    glb = z.read("Models/GLB format/character-a.glb")
    slim = slim_glb(glb, ANIMS)
    (OUT / "person.glb").write_bytes(slim)
    manifest["model.person"] = {"file": "person.glb", "bytes": len(slim), "licence": "CC0",
                                "source": "Kenney: Blocky Characters 2.0 (character-a geometry and animations)",
                                "use": "every villager and every player", "animations": ANIMS}
    print(f"  person.glb  {len(glb) / 1024:.0f} KB -> {len(slim) / 1024:.0f} KB")
    for c in CHARACTERS:
        png = z.read(f"Models/GLB format/Textures/texture-{c}.png")
        img = Image.open(io.BytesIO(png))
        buf = io.BytesIO()
        img.save(buf, "PNG", optimize=True)
        data = buf.getvalue() if len(buf.getvalue()) < len(png) else png
        (OUT / f"person-{c}.png").write_bytes(data)
        manifest[f"tex.person.{c}"] = {"file": f"person-{c}.png", "bytes": len(data), "licence": "CC0",
                                       "source": f"Kenney: Blocky Characters 2.0 (texture-{c})", "use": "a look"}


def main():
    OUT.mkdir(exist_ok=True)
    manifest = {}
    print("textures (Poly Haven, CC0)")
    textures(manifest)
    print("characters (Kenney, CC0)")
    characters(manifest)
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1))
    total = sum(v["bytes"] for v in manifest.values())
    print(f"{len(manifest)} files, {total / 1024:.0f} KB")


if __name__ == "__main__":
    main()
