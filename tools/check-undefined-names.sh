#!/usr/bin/env bash
# R58 gate (29 Sep 2026): "search ke baad blank page" wale bug ka permanent guard.
#
# User screenshot: chat me jawab aane par poora app khaali ho gaya. Wajah — render ke waqt ek
# undefined naam (`onOpenPlanPage` BlockView ke props me destructure hona reh gaya tha):
# `ReferenceError` → React ne tree unmount kar diya → blank screen.
#
# Frontend `tsc` me purane type-noise (TS2322/2339/18047…) padi hui hai, isliye poora tsc gate nahi
# hai — par *undefined name* (TS2304 "Cannot find name", TS2552 "Cannot find name … did you mean")
# hamesha asli runtime crash hota hai. Sirf wahi block karte hain.
set -uo pipefail
cd "$(dirname "$0")/.."
out=$(node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit 2>&1 || true)
bad=$(printf '%s\n' "$out" | grep -E "error TS(2304|2552)" || true)
if [ -n "$bad" ]; then
  echo "❌ Undefined name mila — ye runtime par BLANK SCREEN deta hai (R58 ka bug). Pehle fix karo:"
  printf '%s\n' "$bad"
  exit 1
fi
echo "✅ undefined-name gate PASS (TS2304/TS2552 = 0)"
