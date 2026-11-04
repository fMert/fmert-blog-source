#!/usr/bin/env bash
set -euo pipefail

source_dir=$(cd "$(dirname "$0")/.." && pwd)
host=127.0.0.1
production=false

help() {
  echo "Usage: bash tools/run.sh [-H HOST] [-p]"
  echo "  -H, --host        Host to bind to (default: 127.0.0.1)"
  echo "  -p, --production  Build in production mode"
}

while (($#)); do
  case "$1" in
    -H | --host) host="$2"; shift 2 ;;
    -p | --production) production=true; shift ;;
    -h | --help) help; exit 0 ;;
    *) help; exit 1 ;;
  esac
done

cd "$source_dir"
if $production; then export JEKYLL_ENV=production; fi
bash tools/build-languages.sh _site
python3 -m http.server 4000 --bind "$host" --directory _site
