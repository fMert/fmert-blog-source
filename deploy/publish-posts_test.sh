#!/usr/bin/env bash
set -euo pipefail
umask 022

# Load only the writer; never run deployment commands from the publisher.
source <(sed -n '/^write_status() {$/,/^}$/p' "$(dirname "$0")/publish-posts.sh")
test_dir=$(mktemp -d)
trap 'rm -rf -- "$test_dir"' EXIT
STATUS="$test_dir/.publish-status"

assert_no_temps() {
  if compgen -G "$STATUS.tmp.*" > /dev/null; then
    echo 'Temporary status files left behind' >&2
    exit 1
  fi
}

printf 'another writer' > "$STATUS.tmp"
for writer in queued building; do
  (
    for ((i = 0; i < 50; i++)); do
      write_status "$writer" "2026-11-07-test.md" "$writer"
    done
  ) &
  if [[ $writer == queued ]]; then first=$!; else second=$!; fi
done
wait "$first"
wait "$second"
python3 - "$STATUS" <<'PY'
import json
import os
import sys

with open(sys.argv[1]) as file:
    status = json.load(file)
assert set(status) == {"state", "file", "message", "updated"}
assert status["state"] in {"queued", "building"}
assert status["message"] == status["state"]
assert status["file"] == "2026-11-07-test.md"
assert os.stat(sys.argv[1]).st_mode & 0o777 == 0o644
PY
[[ $(cat "$STATUS.tmp") == 'another writer' ]]
assert_no_temps

for failure in printf chmod mv mktemp; do
  (
    printf '{"old":true}\n' > "$STATUS"
    case $failure in
      printf) printf() { builtin printf '{"partial":'; return 23; } ;;
      chmod) chmod() { return 23; } ;;
      mv) mv() { return 23; } ;;
      mktemp) mktemp() { return 23; } ;;
    esac
    if write_status failed '' 'test'; then
      echo "Expected $failure failure" >&2
      exit 1
    else
      [[ $? == 23 ]]
    fi
    [[ $(cat "$STATUS") == '{"old":true}' ]]
    assert_no_temps
  )
done

(
  umask 077
  write_status queued '' 'private'
  [[ $(stat -c %a "$STATUS") == 600 ]]
)

rm -- "$STATUS"
mkdir -- "$STATUS"
printf 'original' > "$STATUS/original"
if write_status failed '' 'test'; then
  echo 'Expected rename failure for a directory target' >&2
  exit 1
fi
[[ $(cat "$STATUS/original") == original ]]
[[ $(find "$STATUS" -mindepth 1 -maxdepth 1 | wc -l) == 1 ]]
assert_no_temps
echo 'publish-posts atomic status checks passed'
