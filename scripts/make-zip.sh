#!/usr/bin/env bash
# Full project zip (source, tests, config, reports) — node_modules/dist/.env/secrets excluded.
# Usage: bash scripts/make-zip.sh [outdir]   → <outdir>/railbook-<shortsha>-<date>.zip
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-/home/user/releases}"
mkdir -p "$OUT"
SHA="$(git rev-parse --short HEAD 2>/dev/null || echo nogit)"
NAME="railbook-${SHA}-$(date +%Y%m%d-%H%M).zip"
rm -f "$OUT"/railbook-*.zip
zip -qr "$OUT/$NAME" . \
  -x "node_modules/*" "dist/*" ".git/*" ".env" ".env.*" "*.log" "coverage/*" \
     ".vite/*" ".cache/*" "*.zip" "bench-*.json" "LIGHTNING_BENCH_*.json"
echo "$OUT/$NAME ($(du -h "$OUT/$NAME" | cut -f1))"
