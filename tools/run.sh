#!/usr/bin/env bash
set -euo pipefail

source_dir=$(cd "$(dirname "$0")/.." && pwd)
cd "$source_dir"
exec node src/server/dev.mjs "$@"
