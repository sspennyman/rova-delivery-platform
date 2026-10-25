#!/bin/bash
set -euo pipefail
RIVO_IOS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RIVO_CHECK_DIR="$(mktemp -d -t rivo-ios-check)"
xcrun swiftc -parse-as-library "$RIVO_IOS_DIR"/Core/*.swift "$RIVO_IOS_DIR/Checks/CoreSmoke.swift" -lsqlite3 -o "$RIVO_CHECK_DIR/rivo-core-check"
"$RIVO_CHECK_DIR/rivo-core-check"
# Keep the uniquely named executable available for inspection; no user files are removed.
