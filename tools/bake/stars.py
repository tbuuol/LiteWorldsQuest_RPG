#!/usr/bin/env python3
"""stars.py <bsc5.dat(.gz)> <out-dir> -- the real night sky for LiteWorldsQuest: the Yale Bright Star Catalogue (5th
revised edition, Hoffleit & Warren 1991; public domain, http://tdc-www.harvard.edu/catalogs/bsc5.html), every star the
eye can see (to about magnitude 6.5), baked to stars.bin:
  per star 6 bytes: u16 right ascension (0..65535 = 0..360 deg), i16 declination (32767 = +90 deg),
                    u8 visual magnitude ((V + 2) * 25), i8 colour index B-V * 60
J2000 positions; sorted brightest first."""
import gzip, json, math, os, struct, sys
src, out = sys.argv[1], sys.argv[2]
op = gzip.open if src.endswith('.gz') else open
stars = []
with op(src, 'rt', encoding='latin-1') as f:
    for line in f:
        try:
            rah, ram, ras = int(line[75:77]), int(line[77:79]), float(line[79:83])
            sgn = -1 if line[83] == '-' else 1
            ded, dem, des = int(line[84:86]), int(line[86:88]), int(line[88:90])
            v = float(line[102:107])
        except ValueError:
            continue   # a few entries (novae, non-stellar) have no position or magnitude
        try: bv = float(line[109:114])
        except ValueError: bv = 0.6
        ra = (rah + ram / 60 + ras / 3600) * 15
        dec = sgn * (ded + dem / 60 + des / 3600)
        stars.append((v, ra, dec, bv))
stars.sort()
os.makedirs(out, exist_ok=True)
with open(os.path.join(out, 'stars.bin'), 'wb') as f:
    for v, ra, dec, bv in stars:
        f.write(struct.pack('<HhBb', round(ra / 360 * 65535) % 65536, round(dec / 90 * 32767),
                            max(0, min(255, round((v + 2) * 25))), max(-127, min(127, round(bv * 60)))))
json.dump({'stars': {'file': 'stars.bin', 'count': len(stars), 'record': 'u16 ra (65536 = 360 deg), i16 dec (32767 = 90 deg), u8 (V+2)*25, i8 (B-V)*60',
           'source': 'Yale Bright Star Catalogue, 5th rev. ed. (public domain)', 'tool': 'tools/bake/stars.py'}},
          open(os.path.join(out, 'sky.json'), 'w'), indent=1)
print(len(stars), 'stars; brightest', stars[0][:3], 'faintest', stars[-1][0])
