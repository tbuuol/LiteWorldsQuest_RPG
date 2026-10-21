#!/bin/bash
# Live progress of tools/publish_assets.py: one line whenever an inscription is done, and what is on its way.
# Ends by itself once every asset in the manifest has an id.
cd "$(dirname "$0")/.." || exit 1
total=$(python3 -c "import json; print(len(json.load(open('assets/manifest.json'))))")
last=-1; lastfile=""
while true; do
  done_=$(python3 -c "import json; print(len(json.load(open('config.json')).get('asset_ids', {})))")
  now=$(pgrep -fa "arcade-publish" | grep -o -- "--name [^ ]*" | head -1 | cut -d' ' -f2)
  if [ "$done_" != "$last" ]; then
    echo "$(date +%H:%M)  Inschreibung $done_ von $total fertig"
    last=$done_
  fi
  if [ -n "$now" ] && [ "$now" != "$lastfile" ]; then
    echo "$(date +%H:%M)    … läuft gerade: $now (Inschreibung $((done_ + 1)) von $total)"
    lastfile=$now
  fi
  if [ "$done_" -ge "$total" ]; then echo "$(date +%H:%M)  Alle $total Inschreibungen fertig."; exit 0; fi
  sleep 15
done
