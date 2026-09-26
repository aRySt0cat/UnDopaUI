#!/bin/sh
# Builds dist/UnDopaUI.zip for a GitHub release.
# Users install the release by loading it unpacked, so the dev-only reload
# helper (src/background.js) is left out of the package.
set -eu
cd "$(dirname "$0")/.."

rm -rf dist
mkdir -p dist/UnDopaUI
cp -R icons popup src dist/UnDopaUI/
rm dist/UnDopaUI/src/background.js
node -e '
  const m = JSON.parse(require("fs").readFileSync("manifest.json", "utf8"));
  delete m.background;
  process.stdout.write(JSON.stringify(m, null, 2) + "\n");
' > dist/UnDopaUI/manifest.json

# Files sit at the zip root, so unzipping on macOS or Windows yields one
# "UnDopaUI" folder with manifest.json directly inside.
(cd dist/UnDopaUI && zip -qrX ../UnDopaUI.zip . -x '.*')
echo "dist/UnDopaUI.zip ($(node -p 'require("./manifest.json").version'))"
