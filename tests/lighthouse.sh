#!/usr/bin/env bash
# Porównanie Lighthouse przed/po migracji. Wymaga: npx lighthouse
# Użycie: ./lighthouse.sh http://localhost:3000 http://localhost:8080
set -euo pipefail
OLD="${1:-http://localhost:3000}"
NEW="${2:-http://localhost:8080}"
mkdir -p report/lighthouse

# Strony reprezentujące każdy szablon — nie ma sensu mierzyć wszystkich 14.
# Po jednej reprezentatywnej stronie na szablon — mierzenie wszystkich nie ma sensu.
mapfile -t ROUTES < <(node -e "JSON.parse(require('fs').readFileSync('routes.json','utf8')).slice(0,5).forEach(r=>console.log(r))")

run() {
  local base="$1" label="$2" route="$3"
  local slug; slug=$(echo "$route" | sed 's#^/##; s#/$##; s#/#__#g'); slug="${slug:-home}"
  npx lighthouse "${base}${route}" \
    --only-categories=performance,accessibility,seo,best-practices \
    --preset=desktop --form-factor=mobile --screenEmulation.mobile \
    --output=json --output-path="report/lighthouse/${label}__${slug}.json" \
    --chrome-flags="--headless --no-sandbox" --quiet
}

for route in "${ROUTES[@]}"; do
  echo "== ${route}"
  run "$OLD" old "$route"
  run "$NEW" new "$route"
done

node -e '
const fs=require("fs"),path="report/lighthouse";
const files=fs.readdirSync(path).filter(f=>f.startsWith("old__"));
let fail=0;
console.log("\nStrona".padEnd(42)+"kategoria      stara  nowa   Δ");
for(const f of files){
  const slug=f.slice(5);
  const o=JSON.parse(fs.readFileSync(`${path}/${f}`));
  if(!fs.existsSync(`${path}/new__${slug}`)){console.log(`${slug} — brak pomiaru nowej wersji`);fail++;continue;}
  const n=JSON.parse(fs.readFileSync(`${path}/new__${slug}`));
  for(const c of ["performance","accessibility","seo","best-practices"]){
    const a=Math.round(o.categories[c].score*100), b=Math.round(n.categories[c].score*100), d=b-a;
    // Tolerancja 2 pkt — Lighthouse sam w sobie ma rozrzut między przebiegami.
    const bad=d<-2; if(bad)fail++;
    console.log(slug.replace(".json","").padEnd(42)+c.padEnd(15)+String(a).padEnd(7)+String(b).padEnd(7)+(d>0?"+":"")+d+(bad?"  ← REGRESJA":""));
  }
}
console.log(fail?`\n${fail} regresji`:"\nBrak regresji wydajności");
process.exit(fail?1:0);
'
