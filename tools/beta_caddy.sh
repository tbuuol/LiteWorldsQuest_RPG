#!/bin/sh
# usage: sudo sh tools/beta_caddy.sh        (once; needs root)
# The beta (2026-11-07): pages.pepecoinarcade.com serves /content/lwq-beta/... from /var/www/lwq-beta, never cached
# (Cloudflare passes no-store by), before everything else goes on to the arcade node as before. The folder belongs to
# tbuuol, so tools/beta_push.sh needs no root. The Caddyfile is copied aside first and only reloaded once it validates.
set -eu
CF=/etc/caddy/Caddyfile
OWNER=${SUDO_USER:-tbuuol}
mkdir -p /var/www/lwq-beta
chown "$OWNER":"$OWNER" /var/www/lwq-beta
chmod 755 /var/www/lwq-beta
if grep -q "lwq-beta" "$CF"; then echo "the Caddyfile has the beta already"; else
  cp "$CF" "$CF.bak-$(date +%Y%m%d-%H%M%S)"
  NEW=$(mktemp /etc/caddy/Caddyfile.beta-XXXXXX)
  python3 - "$CF" "$NEW" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
anchor = "pages.pepecoinarcade.com {\n\timport cf_origin\n"
assert anchor in s, "pages.pepecoinarcade.com block not found as expected"
block = ("\t# LiteWorldsQuest beta (2026-11-07): the game the beta page fetches, from this machine, never cached\n"
         "\t@lwqbeta path /content/lwq-beta/*\n"
         "\thandle @lwqbeta {\n"
         "\t\turi strip_prefix /content/lwq-beta\n"
         "\t\troot * /var/www/lwq-beta\n"
         "\t\theader Cache-Control \"no-store\"\n"
         "\t\theader Access-Control-Allow-Origin \"*\"\n"
         "\t\tfile_server\n"
         "\t}\n")
open(sys.argv[2], "w").write(s.replace(anchor, anchor + block, 1))
PY
  # the new file is checked before it takes the old one's place: a mistake leaves Caddy as it was
  caddy validate --config "$NEW" --adapter caddyfile || { rm -f "$NEW"; echo "not valid: nothing changed"; exit 1; }
  chmod --reference="$CF" "$NEW"; chown --reference="$CF" "$NEW"
  mv "$NEW" "$CF"
fi
# the Caddyfile says "admin off", so there is no reload (it needs the admin API): a restart, about a second
systemctl restart caddy
echo "done: /content/lwq-beta/ on pages.pepecoinarcade.com serves /var/www/lwq-beta"
