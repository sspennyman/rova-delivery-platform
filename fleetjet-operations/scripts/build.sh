#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

rm -rf dist
mkdir -p dist/server dist/client dist/.openai

cp worker/index.js dist/server/index.js
cp -R public/. dist/client/
cp .openai/hosting.json dist/.openai/hosting.json
if [[ -d .openai/drizzle ]]; then
  cp -R .openai/drizzle dist/.openai/drizzle
fi

echo "Built Sites bundle in dist/"
