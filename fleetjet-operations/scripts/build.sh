#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

rm -rf dist
mkdir -p dist/server dist/client dist/.openai

cp worker/index.js dist/server/index.js
cp -R public/. dist/client/
cp .openai/hosting.json dist/.openai/hosting.json

echo "Built Sites bundle in dist/"
