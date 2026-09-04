#!/bin/bash
# Post-reset validation runner — RailCore daily quota 00:00 IST (18:30 UTC) par reset hota hai.
# Yeh script wait karti hai, phir FULL strict suite + prod trace suite chala kar
# workspace mein logs likhti hai. Target epoch: 1788546600 = 2026-09-04T18:30:00Z (+30s buffer).
TARGET_EPOCH=1788546630
cd /home/user/railbook

echo "[$(date -u)] Waiting for RailCore daily quota reset (target epoch $TARGET_EPOCH)..."
while [ "$(date -u +%s)" -lt "$TARGET_EPOCH" ]; do
  sleep 60
done
echo "[$(date -u)] Reset window reached. Probing RailCore quota..."

# Probe loop — jab tak day-remaining > 0 na ho, 2-min intervals par retry (max 15 attempts).
for i in $(seq 1 15); do
  REM=$(node --input-type=module -e '
    import { readFileSync } from "fs";
    const key = readFileSync(".env", "utf8").match(/RAILCORE_API_KEY=(\S+)/)[1];
    const r = await fetch("https://ir.railcore.tech/v1/stations/search?q=ASR", { headers: { "X-RailCore-Key": key, Accept: "application/json" } });
    console.log(r.headers.get("x-railcore-ratelimit-day-remaining") ?? "null");
  ' 2>/dev/null)
  echo "[$(date -u)] Probe $i: day-remaining=$REM"
  if [ "$REM" != "null" ] && [ "$REM" != "0" ] && [ -n "$REM" ]; then
    break
  fi
  sleep 120
done

echo "[$(date -u)] Running FULL strict adversarial validation..."
npx tsx scripts/final-adversarial-validation.mts > FINAL_VALIDATION_POST_RESET.log 2>&1
STRICT_EXIT=$?
echo "[$(date -u)] Strict exit=$STRICT_EXIT"

echo "[$(date -u)] Running prod trace suite..."
node scripts/prod-tool-trace.mjs https://railbook-three.vercel.app > PROD_TRACE_POST_RESET.log 2>&1
PROD_EXIT=$?
echo "[$(date -u)] Prod trace exit=$PROD_EXIT"

grep -E "FINAL ADVERSARIAL VALIDATION:|Real NVIDIA|Real RailCore|HTTP by host" FINAL_VALIDATION_POST_RESET.log | tail -5 > POST_RESET_SUMMARY.txt
grep -E "TOOL-CALLING TEST SUITE" PROD_TRACE_POST_RESET.log >> POST_RESET_SUMMARY.txt
echo "strict_exit=$STRICT_EXIT prod_exit=$PROD_EXIT" >> POST_RESET_SUMMARY.txt
date -u > POST_RESET_DONE.marker
echo "[$(date -u)] DONE. Summary: POST_RESET_SUMMARY.txt"
