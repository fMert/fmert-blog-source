#!/usr/bin/env bash
set -euo pipefail

output="${1:-_site}"
source_dir=$(cd "$(dirname "$0")/.." && pwd)
cd "$source_dir"
node src/builder/build.mjs "$output"
