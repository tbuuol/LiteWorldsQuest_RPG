"""LiteWorldsQuest card cover: a night-blue field, a new longsword standing behind the name, a BETA ribbon
(the beta's card; --no-beta for the game's own card, without it).
Drawn at 4x and scaled down; square, with everything that matters inside the middle 16:9 band."""
import math, random, pathlib, sys
BETA = "--no-beta" not in sys.argv
DY = 0 if BETA else 18      # without the ribbon the name sits a little lower, in the middle
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops

D = pathlib.Path(__file__).parent
F = pathlib.Path("/tmp/claude-1002/-home-tbuuol/aaa0e62f-1436-43ba-8a15-bdb57c123359/scratchpad/teaser/fonts")
S = 2048
U = S / 512          # design in 512 units
u = lambda v: v * U


def vgrad(w, h, stops):
    """vertical gradient image from [(t, (r,g,b)), ...]"""
    im = Image.new("RGB", (1, h))
    for y in range(h):
        t = y / max(1, h - 1)
        for i in range(len(stops) - 1):
            if stops[i][0] <= t <= stops[i + 1][0]:
                a, b = stops[i], stops[i + 1]
                k = (t - a[0]) / (b[0] - a[0] or 1)
                im.putpixel((0, y), tuple(int(a[1][j] + (b[1][j] - a[1][j]) * k) for j in range(3)))
                break
    return im.resize((w, h))


def hgrad(w, h, stops):
    return vgrad(h, w, stops).rotate(90, expand=True).transpose(Image.FLIP_TOP_BOTTOM)


# ---- background: night blue, a silver-blue glow in the middle, a few stars, a vignette
bg = Image.new("RGB", (S, S), (6, 10, 22))
glow = Image.new("L", (S, S), 0)
ImageDraw.Draw(glow).ellipse([u(86), u(96), u(426), u(436)], fill=255)
glow = glow.filter(ImageFilter.GaussianBlur(u(70)))
bg = Image.composite(Image.new("RGB", (S, S), (40, 70, 128)), bg, glow)
rnd = random.Random(7)
st = ImageDraw.Draw(bg)
for _ in range(140):
    x, y, r = rnd.uniform(0, S), rnd.uniform(0, S), rnd.choice([1, 1, 1, 2, 2, 3]) * U * 0.45
    c = rnd.randint(120, 230)
    st.ellipse([x - r, y - r, x + r, y + r], fill=(c, c, min(255, c + 25)))
vig = Image.new("L", (S, S), 0)
ImageDraw.Draw(vig).ellipse([u(-60), u(-60), u(572), u(572)], fill=255)
vig = vig.filter(ImageFilter.GaussianBlur(u(60)))
bg = Image.composite(bg, Image.new("RGB", (S, S), (2, 3, 8)), vig)
img = bg.convert("RGBA")

# ---- the sword: a straight longsword, tip down
cx = S / 2
POM_Y, GRIP0, GRIP1, GUARD_Y, TIP_Y = 52, 72, 132, 140, 470
sw = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(sw)
# blade: tapers from 15 units wide at the guard to a point
bw0, bw1, taper = 15, 11, 420
blade = [(cx - u(bw0 / 2), u(GUARD_Y + 6)), (cx + u(bw0 / 2), u(GUARD_Y + 6)),
         (cx + u(bw1 / 2), u(taper)), (cx, u(TIP_Y)), (cx - u(bw1 / 2), u(taper))]
mask = Image.new("L", (S, S), 0); ImageDraw.Draw(mask).polygon(blade, fill=255)
steel = hgrad(S, S, [(0, (120, 132, 150)), (0.47, (236, 242, 250)), (0.5, (170, 182, 200)), (0.53, (225, 232, 244)), (1, (96, 108, 128))])
# horizontal gradient only across the blade's width: build it in that band
band = hgrad(int(u(bw0)), S, [(0, (110, 122, 142)), (0.42, (238, 244, 252)), (0.5, (150, 162, 182)), (0.58, (226, 234, 246)), (1, (88, 100, 122))])
steel = Image.new("RGB", (S, S)); steel.paste(band, (int(cx - u(bw0 / 2)), 0))
sw.paste(steel, (0, 0), mask)
# fuller: a dark groove down the middle, two thirds of the blade
d.line([(cx, u(GUARD_Y + 12)), (cx, u(360))], fill=(90, 102, 124, 255), width=int(u(2.2)))
d.line([(cx + u(1.6), u(GUARD_Y + 12)), (cx + u(1.6), u(360))], fill=(250, 252, 255, 160), width=int(u(0.8)))
# edge outline
d.line(blade + [blade[0]], fill=(30, 36, 50, 255), width=int(u(1.4)), joint="curve")

# guard: gold quillons curving slightly down, round ends
def gold_fill(poly_mask, box):
    x0, y0, x1, y1 = [int(v) for v in box]
    g = vgrad(max(1, x1 - x0), max(1, y1 - y0), [(0, (255, 236, 160)), (0.45, (232, 178, 64)), (1, (138, 86, 24))])
    layer = Image.new("RGB", (S, S)); layer.paste(g, (x0, y0))
    sw.paste(layer, (0, 0), poly_mask)

gm = Image.new("L", (S, S), 0); gd = ImageDraw.Draw(gm)
pts_top, pts_bot = [], []
for i in range(41):
    t = i / 40 * 2 - 1                      # -1..1 across
    x = cx + t * u(62)
    sag = (t * t) * u(9)
    th = u(7.5) * (1 - 0.35 * abs(t))
    pts_top.append((x, u(GUARD_Y - 4) + sag))
    pts_bot.append((x, u(GUARD_Y - 4) + sag + th))
gd.polygon(pts_top + pts_bot[::-1], fill=255)
for t in (-1, 1):
    ex, ey = cx + t * u(62), u(GUARD_Y - 4) + u(9) + u(2.5)
    gd.ellipse([ex - u(6), ey - u(6), ex + u(6), ey + u(6)], fill=255)
gd.polygon([(cx - u(12), u(GUARD_Y - 6)), (cx + u(12), u(GUARD_Y - 6)), (cx + u(8), u(GUARD_Y + 10)), (cx, u(GUARD_Y + 16)), (cx - u(8), u(GUARD_Y + 10))], fill=255)
gold_fill(gm, (cx - u(70), u(GUARD_Y - 12), cx + u(70), u(GUARD_Y + 18)))
edge = gm.filter(ImageFilter.FIND_EDGES).filter(ImageFilter.MaxFilter(5))
sw.paste((70, 40, 10, 255), (0, 0), edge)
# a small blue stone in the middle of the guard
gx, gy, gr = cx, u(GUARD_Y + 3), u(4.2)
d.ellipse([gx - gr, gy - gr, gx + gr, gy + gr], fill=(40, 110, 220, 255), outline=(20, 30, 60, 255), width=int(u(0.8)))
d.ellipse([gx - gr * 0.5, gy - gr * 0.65, gx - gr * 0.05, gy - gr * 0.2], fill=(200, 230, 255, 255))

# grip: dark leather wrapped in bands
gw = 9
d.rounded_rectangle([cx - u(gw / 2), u(GRIP0), cx + u(gw / 2), u(GRIP1)], radius=u(2.5), fill=(70, 38, 22, 255), outline=(25, 12, 6, 255), width=int(u(1)))
y = GRIP0 + 2
while y < GRIP1 - 2:
    d.line([(cx - u(gw / 2) + u(1), u(y + 4)), (cx + u(gw / 2) - u(1), u(y))], fill=(120, 72, 40, 255), width=int(u(2)))
    d.line([(cx - u(gw / 2) + u(1), u(y + 5.4)), (cx + u(gw / 2) - u(1), u(y + 1.4))], fill=(40, 20, 10, 255), width=int(u(0.7)))
    y += 6
# grip collars (gold rings top and bottom)
for yy in (GRIP0 - 1, GRIP1 - 2):
    rm = Image.new("L", (S, S), 0)
    ImageDraw.Draw(rm).rounded_rectangle([cx - u(7), u(yy), cx + u(7), u(yy + 5)], radius=u(2), fill=255)
    gold_fill(rm, (cx - u(7), u(yy), cx + u(7), u(yy + 5)))
# pommel: a gold disc with a blue stone
pm = Image.new("L", (S, S), 0)
ImageDraw.Draw(pm).ellipse([cx - u(13), u(POM_Y - 12), cx + u(13), u(POM_Y + 14)], fill=255)
gold_fill(pm, (cx - u(13), u(POM_Y - 12), cx + u(13), u(POM_Y + 14)))
sw.paste((70, 40, 10, 255), (0, 0), pm.filter(ImageFilter.FIND_EDGES).filter(ImageFilter.MaxFilter(5)))
pr = u(6.5); py = u(POM_Y + 1)
d.ellipse([cx - pr, py - pr, cx + pr, py + pr], fill=(40, 110, 220, 255), outline=(20, 30, 60, 255), width=int(u(1)))
d.ellipse([cx - pr * 0.55, py - pr * 0.7, cx - pr * 0.05, py - pr * 0.2], fill=(210, 235, 255, 255))

# the sword's soft light behind it
halo = sw.split()[3].filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(u(10)))
img.alpha_composite(Image.merge("RGBA", [Image.new("L", (S, S), 150), Image.new("L", (S, S), 190), Image.new("L", (S, S), 255), halo.point(lambda v: v * 0.55)]))
img.alpha_composite(sw)

# ---- the name
def gold_text(text, font, y, tracking=0):
    w = sum(font.getlength(ch) for ch in text) + tracking * (len(text) - 1)
    m = Image.new("L", (S, S), 0); md = ImageDraw.Draw(m)
    x = cx - w / 2
    for ch in text:
        md.text((x, y), ch, font=font, fill=255, anchor="ls"); x += font.getlength(ch) + tracking
    bbox = m.getbbox()
    # dark shadow plate behind the letters so the sword does not fight them
    plate = m.filter(ImageFilter.MaxFilter(int(u(5)) | 1)).filter(ImageFilter.GaussianBlur(u(7)))
    img.alpha_composite(Image.merge("RGBA", [Image.new("L", (S, S), 4)] * 3 + [plate.point(lambda v: min(255, v * 1.6))]))
    outline = m.filter(ImageFilter.MaxFilter(int(u(2.4)) | 1))
    img.alpha_composite(Image.merge("RGBA", [Image.new("L", (S, S), 40), Image.new("L", (S, S), 22), Image.new("L", (S, S), 6), outline]))
    g = vgrad(S, bbox[3] - bbox[1], [(0, (255, 244, 196)), (0.42, (246, 196, 84)), (0.58, (214, 150, 46)), (1, (150, 92, 26))])
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0)); layer.paste(g, (0, bbox[1]))
    layer.putalpha(m)
    img.alpha_composite(layer)
    return bbox

deco = ImageFont.truetype(str(F / "CinzelDecorative-Bold.ttf"), int(u(70)))
cin = ImageFont.truetype(str(F / "Cinzel.ttf"), int(u(30)))
try: cin.set_variation_by_axes([900])
except Exception: pass
gold_text("LiteWorlds", deco, u(236 + DY), tracking=u(-1))
gold_text("QUEST", ImageFont.truetype(str(F / "CinzelDecorative-Bold.ttf"), int(u(64))), u(306 + DY), tracking=u(10))

# ---- BETA ribbon: the game's own red badge colour, with notched ends
if BETA:
    rib = Image.new("RGBA", (S, S), (0, 0, 0, 0)); rd = ImageDraw.Draw(rib)
    RY0, RY1, RW = 330, 366, 92
    poly = [(cx - u(RW), u(RY0)), (cx + u(RW), u(RY0)), (cx + u(RW - 12), u((RY0 + RY1) / 2)), (cx + u(RW), u(RY1)),
            (cx - u(RW), u(RY1)), (cx - u(RW - 12), u((RY0 + RY1) / 2))]
    rm = Image.new("L", (S, S), 0); ImageDraw.Draw(rm).polygon(poly, fill=255)
    shadow = rm.filter(ImageFilter.GaussianBlur(u(5)))
    img.alpha_composite(Image.merge("RGBA", [Image.new("L", (S, S), 0)] * 3 + [shadow.point(lambda v: v * 0.7)]), (0, int(u(3))))
    red = vgrad(S, int(u(RY1 - RY0)), [(0, (220, 86, 60)), (0.5, (184, 64, 42)), (1, (128, 38, 24))])
    layer = Image.new("RGB", (S, S)); layer.paste(red, (0, int(u(RY0))))
    rib.paste(layer, (0, 0), rm)
    rd.line([(p[0], p[1]) for p in poly] + [poly[0]], fill=(240, 200, 120, 255), width=int(u(1.6)))
    bf = ImageFont.truetype(str(F / "Cinzel.ttf"), int(u(25)))
    try: bf.set_variation_by_axes([900])
    except Exception: pass
    txt, tr = "BETA", u(9)
    w = sum(bf.getlength(c) for c in txt) + tr * (len(txt) - 1)
    x = cx - w / 2
    for c in txt:
        rd.text((x, u(RY1 - 9)), c, font=bf, fill=(255, 246, 228, 255), anchor="ls"); x += bf.getlength(c) + tr
    img.alpha_composite(rib)

out = img.convert("RGB").resize((512, 512), Image.LANCZOS)
NAME = "lwq-beta-cover" if BETA else "lwq-cover"
out.save(D / f"{NAME}.png")
out.save(D / f"{NAME}.webp", quality=88, method=6)
# the 16:9 look the Apps page uses on a phone
out.crop((0, (512 - 288) // 2, 512, (512 + 288) // 2)).save(D / f"{NAME}-169.png")
print("ok")
