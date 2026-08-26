#!/usr/bin/env bash
set -euo pipefail

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
dist_root="$project_root/dist"
client_root="$dist_root/client"

rm -rf "$dist_root"
mkdir -p "$dist_root/server" "$dist_root/.openai" "$client_root"

cp "$project_root/worker/index.js" "$dist_root/server/index.js"
cp "$project_root/.openai/hosting.json" "$dist_root/.openai/hosting.json"

for file in "$project_root"/*.html "$project_root"/*.txt "$project_root"/*.xml; do
  [ -e "$file" ] || continue
  cp "$file" "$client_root/"
done

if [ -d "$project_root/assets" ]; then
  cp -R "$project_root/assets" "$client_root/assets"
fi

echo "Built $dist_root"
