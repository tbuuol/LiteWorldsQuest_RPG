# usage: tools/publish_update.sh <registry version> <file:configpath> ...   e.g. lwq-art-v3.js.gz:modules.art
# Inscribes the given dist/release files as the publisher key, waits until the node serves them byte for byte, tests the
# staged registry against the live page in the dev viewer (port 8766 must run), then inscribes the registry, waits until
# it is listed, restarts the house and records the ids in config.json. Scratch files go to .publisher/work.
# NOWAIT=1 (tbuuol 2026-10-28): the modules one after the other, then the registry at once -- no waiting until they are
# served, no staged test; only the registry is waited for. ONLY_REGISTRY=1: the modules in .publisher/work/upd_ids are
# inscribed already, only the registry is left.
set -u
R=$(cd "$(dirname "$0")/.." && pwd); M=$R/.publisher/work; mkdir -p $M
P=/var/lib/arcade/.dogecoinarcade; V=$1; shift
: > $M/upd_txids; [ -n "${ONLY_REGISTRY:-}" ] || : > $M/upd_ids
[ -n "${ONLY_REGISTRY:-}" ] && set --
for pair in "$@"; do f=${pair%%:*}; key=${pair#*:}
  (cd $P/src && timeout 3000 $P/venv/bin/arcade-publish -testnet --key $R/.publisher/publish.key --datadir /var/lib/arcade/.pepecoin-testnet --journal $R/.publisher/journal --type application/gzip --name $f $R/dist/release/$f > $R/.publisher/log/$f.log 2>&1); echo "$f exit $?"
  id=$(python3 -c "import json;s=open('$R/.publisher/log/$f.log').read();print(json.loads(s[s.index('{'):])['id'])") || exit 1
  python3 -c "import json;s=open('$R/.publisher/log/$f.log').read();print(' '.join(json.loads(s[s.index('{'):])['txids']))" >> $M/upd_txids
  echo "$f $key $id" | tee -a $M/upd_ids
done
cd $R; [ -s $M/upd_txids ] && timeout 200 python3 tools/relay_mempool.py $(cat $M/upd_txids) 2>&1 | grep -v refused | tail -1
python3 - <<P
import json
p='$R/config.json'; c=json.load(open(p))
for line in open('$M/upd_ids'):
    f, key, i = line.split()
    d = c
    for k in key.split('.'): d = d[k]
    d['gz'] = i
c['registry_version'] = $V
open(p,'w').write(json.dumps(c,indent=2)+'\n')
P
python3 build.py --release | tail -1
if [ -z "${NOWAIT:-}" ]; then
for i in $(seq 1 110); do ok=1; while read f key id; do c=$(curl -s -m 30 -o $M/served_$f -w "%{http_code}" http://127.0.0.1:8420/content/$id); [ "$c" = 200 ] && cmp -s $M/served_$f $R/dist/release/$f || ok=0; done < $M/upd_ids; [ $ok = 1 ] && break; sleep 30; done
[ $ok = 1 ] && echo "all served, identical" || { echo "not all served"; exit 1; }
cp $R/dev/fakechain/listing.json $M/listing.bak.upd
python3 -c "
import json
r=json.load(open('$R/dist/release/registry.json'))
json.dump([{'id':'staged-registry','creator':'nb6X4wxqMGq93oE477CiwCvYZYevxTg9R7','json':r}], open('$R/dev/fakechain/listing.json','w'))"
(LD_LIBRARY_PATH=$R/tools/cache/libroot/usr/lib/x86_64-linux-gnu timeout 1100 $R/tools/.venv/bin/python -I $R/tools/staged_test.py 2>&1 | tail -3 | cut -c1-300 | tee $M/upd_test.txt)
cp $M/listing.bak.upd $R/dev/fakechain/listing.json
grep -q "registry used: \[$V, 2\]" $M/upd_test.txt && grep -q "warnings/errors: none" $M/upd_test.txt || { echo "staged test did not pass: registry v$V NOT published"; exit 1; }
fi
python3 -c "import json;print(json.dumps(json.load(open('$R/dist/release/registry.json')),separators=(',',':')),end='')" > $R/dist/release/registry-v$V.min.json
(cd $P/src && timeout 2000 $P/venv/bin/arcade-publish -testnet --key $R/.publisher/publish.key --datadir /var/lib/arcade/.pepecoin-testnet --journal $R/.publisher/journal --type application/json --name registry-v$V.json --json "$(cat $R/dist/release/registry-v$V.min.json)" $R/dist/release/registry-v$V.min.json > $R/.publisher/log/registry-v$V.log 2>&1); echo "registry exit $?"
RID=$(python3 -c "import json;s=open('$R/.publisher/log/registry-v$V.log').read();print(json.loads(s[s.index('{'):])['id'])"); echo "registry ID $RID"
cd $R && timeout 200 python3 tools/relay_mempool.py $(python3 -c "import json;s=open('$R/.publisher/log/registry-v$V.log').read();print(' '.join(json.loads(s[s.index('{'):])['txids']))") 2>&1 | grep -v refused | tail -1
for i in $(seq 1 110); do v=$(curl -s -m 20 "http://127.0.0.1:8420/r/inscriptions?creator=nb6X4wxqMGq93oE477CiwCvYZYevxTg9R7&limit=300" | python3 -c "import json,sys
try: L=json.load(sys.stdin)
except Exception: L=[]
print(max([p['json']['version'] for p in L if isinstance(p.get('json'),dict) and p['json'].get('lwq')=='registry'] or [0]))" 2>/dev/null); [ "$v" = "$V" ] && { echo "registry v$V listed"; systemctl --user restart lwq-house.service; echo "house restarted"
  python3 -c "
import json
p='$R/config.json'; c=json.load(open(p)); c['registry_ids']['$V']='$RID (publisher, loader 2)'
open(p,'w').write(json.dumps(c,indent=2)+'\n')"; exit 0; }; sleep 30; done; echo "not listed yet"
