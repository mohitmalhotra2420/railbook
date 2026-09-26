#!/usr/bin/env bash
# Round-29 (standing instruction): round ke end me pura project ek zip me.
# Structure wahi jo pehle tha:
#   railbook-full/{railbook/, android-app/, apks/, previews/, docs/, host-scripts/, START-HERE.md}
# Chalane ka tarika:  bash tools/build-full-zip.sh
set -euo pipefail

REPO=${REPO:-/home/user/work/railbook}
ANDROID=${ANDROID:-/home/user/work/app/android-app}
RBDIR=${RBDIR:-/home/user/RailBook}
OUT=${OUT:-$RBDIR/RailBook-FULL-2026-09-26.zip}

STAGE=$(mktemp -d /tmp/rbfull.XXXXXX)
DEST="$STAGE/railbook-full"
mkdir -p "$DEST/railbook" "$DEST/docs" "$DEST/host-scripts"

# repo source — .git history bhi saath (taaki naye workspace me continue kar sakein), par credentials nahi
tar -C "$REPO" \
  --exclude=node_modules --exclude=dist --exclude=.env --exclude=.env.local \
  --exclude='.git/config' --exclude='.git/credentials' --exclude='.git-credentials' --exclude=.netrc \
  --exclude='*.log' --exclude=.vite --exclude=coverage --exclude=tmpscripts --exclude=.arena \
  -cf - . | tar -C "$DEST/railbook" -xf -

cp -a "$ANDROID" "$DEST/android-app"
cp -a "$RBDIR/APKs" "$DEST/apks"
cp -a "$RBDIR/previews" "$DEST/previews"
cp -a "$RBDIR/docs/." "$DEST/docs/"
cp "$REPO/START-HERE.md" "$DEST/START-HERE.md"
cp /home/user/apk-build-v1*.sh "$DEST/host-scripts/" 2>/dev/null || true

rm -f "$OUT"
( cd "$STAGE" && zip -qr "$OUT" railbook-full )

echo "zip: $OUT"
stat -c '%s bytes' "$OUT"
echo "files: $(unzip -l "$OUT" | tail -1 | awk '{print $2}')"
unzip -l "$OUT" | awk '{print $4}' | grep -v '^$' | cut -d/ -f1-2 | sort -u | head -12
unzip -l "$OUT" | grep -c "railbook-full/railbook/src/" | sed 's/^/repo src entries: /'
rm -rf "$STAGE"
