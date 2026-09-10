#!/usr/bin/env bash
# One-shot release (user rule 2026-09-08: har deploy = GitHub + Render + full zip with fresh build).
#   bash scripts/release.sh "commit message"
# Steps: typecheck(server) → tests → build → commit → push origin main → Render deploy (poll till live)
#        → prod smoke (/api/ai-ping) → zip (source + fresh dist/) → releases/
set -euo pipefail
cd "$(dirname "$0")/.."
MSG="${1:-release $(date +%F-%H%M)}"
SVC="${RENDER_SERVICE_ID:-srv-dae34rqd0e5s73evgjsg}"
PROD="${PROD_URL:-https://railbook-gegs.onrender.com}"
OUT="${ZIP_OUT:-/home/user/releases}"

set -a; [ -f .env ] && . ./.env; set +a
: "${RENDER_API_KEY:?RENDER_API_KEY missing (.env)}"

echo "▶ typecheck"; npx tsc --noEmit -p tsconfig.server.json
# Round-18f: client gate — undefined names (TS2304/TS2552) are runtime crashes (React render → blank reply). Never ship those.
if npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "error TS(2304|2552)" ; then echo "✗ client has undefined names"; exit 1; fi
echo "▶ tests";     npx vitest run 2>&1 | grep -E "Test Files|Tests " || { echo "tests failed"; exit 1; }
echo "▶ build";     npm run build 2>&1 | tail -1

echo "▶ commit"
git add -A
if git diff --cached --quiet; then echo "  (nothing to commit)"; else
  git -c user.name="${GIT_AUTHOR_NAME:-RailBook Agent}" -c user.email="${GIT_AUTHOR_EMAIL:-agent@railbook.local}" commit -q -m "$MSG"
fi
SHA="$(git rev-parse --short HEAD)"

echo "▶ push origin main ($SHA)"
if [ -n "${GITHUB_TOKEN:-}" ]; then
  git push -q "https://${GITHUB_TOKEN}@github.com/mohitmalhotra2420/railbook.git" main
else
  git push -q origin main
fi

echo "▶ render deploy"
curl -s -X POST -H "Authorization: Bearer $RENDER_API_KEY" -H "content-type: application/json" \
  -d '{"clearCache":"do_not_clear"}' "https://api.render.com/v1/services/$SVC/deploys" >/dev/null
for i in $(seq 1 60); do
  ST="$(curl -s -H "Authorization: Bearer $RENDER_API_KEY" "https://api.render.com/v1/services/$SVC/deploys?limit=1" \
        | python3 -c "import sys,json; d=json.load(sys.stdin)[0]['deploy']; print(d['status'], d['commit']['id'][:7])")"
  case "$ST" in
    live*)   echo "  $ST"; break;;
    *fail*|*cancel*) echo "  DEPLOY FAILED: $ST"; exit 1;;
  esac
  sleep 15
done
[[ "$ST" == live\ $SHA* ]] || { echo "  WARNING: live commit != $SHA ($ST)"; }

echo "▶ prod smoke"
curl -s --max-time 60 "$PROD/api/ai-ping" | head -c 160; echo

echo "▶ zip (source + fresh dist)"
mkdir -p "$OUT"
NAME="railbook-${SHA}-$(date +%Y%m%d-%H%M).zip"
rm -f "$OUT"/railbook-*.zip
zip -qr "$OUT/$NAME" . \
  -x "node_modules/*" ".git/*" ".env" ".env.*" "*.log" "coverage/*" ".vite/*" ".cache/*" "*.zip" \
     "bench-*.json" "LIGHTNING_BENCH_*.json"
echo "  $OUT/$NAME ($(du -h "$OUT/$NAME" | cut -f1)) — dist/ included ($(ls dist | wc -l) entries)"
echo "✔ released $SHA"
