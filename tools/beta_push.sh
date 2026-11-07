#!/bin/sh
# usage: tools/beta_push.sh
# The beta (2026-11-07): build the game as the beta page fetches it (build.py --beta) and put it where
# pepecoinarcade.com's Caddy serves /content/lwq-beta/ (tools/beta_caddy.sh set that up). The next load of the beta
# page plays it; nothing is inscribed. The beta's house reloads by itself when the bundle changes (house.py --beta).
set -eu
R=$(cd "$(dirname "$0")/.." && pwd)
WWW=${LWQ_BETA_WWW:-/var/www/lwq-beta}
python3 "$R/build.py" --beta
[ -w "$WWW" ] || { echo "$WWW is not there or not writable: run sudo sh tools/beta_caddy.sh once"; exit 1; }
# the registry last, so no page finds a registry whose bundle is not there yet
rsync -a --exclude registry.json "$R/dist/beta/site/" "$WWW/"
cp "$R/dist/beta/site/registry.json" "$WWW/registry.json.tmp" && mv "$WWW/registry.json.tmp" "$WWW/registry.json"
# bundles of older builds: a page that is starting may still want the last one, so the newest three stay
ls -t "$WWW"/bundle-*.json.gz 2>/dev/null | tail -n +4 | xargs -r rm -f
code=$(curl -s -o /dev/null -w "%{http_code}" --resolve pages.pepecoinarcade.com:443:127.0.0.1 -k \
  "https://pages.pepecoinarcade.com/content/lwq-beta/registry.json?t=$(date +%s)")
echo "beta pushed: $(python3 -c "import json;print(json.load(open('$WWW/registry.json'))['bundle'])"), Caddy says $code"
