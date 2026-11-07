#!/usr/bin/env bash
set -euo pipefail
umask 022

# Load only the writer; never run deployment commands from the publisher.
source <(sed -n '/^write_status() {$/,/^}$/p' "$(dirname "$0")/publish-posts.sh")
test_dir=$(mktemp -d)
trap 'rm -rf -- "$test_dir"' EXIT
STATUS="$test_dir/.publish-status"
publish_id=0123456789abcdef0123456789abcdef

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
assert set(status) == {"id", "state", "file", "message", "updated"}
assert status["id"] == "0123456789abcdef0123456789abcdef"
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

# Exercise the real worker with isolated data, lock, Docker and HTTP commands.
python3 - "$(realpath "$(dirname "$0")/publish-posts.sh")" "$test_dir" <<'PY'
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

script, root = sys.argv[1], Path(sys.argv[2])
source = root / 'source'
posts = source / 'deploy/data/posts'
jobs = posts / '.publish-jobs'
bin_dir = root / 'bin'
control = root / 'control'
for path in (jobs, bin_dir, control):
    path.mkdir(parents=True)
(bin_dir / 'docker').write_text('''#!/usr/bin/env python3
import json, os, signal, sys, time
from pathlib import Path
c = Path(os.environ['PUBLISH_TEST_CONTROL'])
a = sys.argv[1:]
scenario = json.loads((c / 'scenario').read_text()) if (c / 'scenario').exists() else {}
with (c / 'calls').open('a') as f: f.write(json.dumps(a) + '\\n')
if a[:2] == ['image', 'inspect']:
    if scenario.get('no_old_image'): sys.exit(1)
    print('old-image')
elif a[0] == 'inspect':
    phase = (c / 'running').read_text()
    print('unhealthy' if scenario.get(phase) == 'health' else 'healthy')
    if scenario.get(phase) == 'inspect': sys.exit(1)
elif a[0] == 'tag':
    phase = 'rollback' if a[-1] == 'fmert-blog:local' else 'backup'
    if scenario.get(phase) == 'tag': sys.exit(1)
elif 'up' in a:
    phase = 'rollback' if '--force-recreate' in a else 'new'
    (c / 'running').write_text(phase)
    if scenario.get(phase) == 'up': sys.exit(1)
elif 'build' in a:
    with (c / 'builds').open('a') as f: f.write('build\\n')
    if (c / 'interrupt').exists():
        (c / 'interrupt').unlink()
        os.kill(os.getppid(), signal.SIGKILL)
    if (c / 'pause').exists():
        (c / 'ready').touch()
        until = time.monotonic() + 10
        while (c / 'pause').exists():
            if time.monotonic() > until: sys.exit(2)
            time.sleep(.01)
    if (c / 'fail').exists():
        (c / 'fail').unlink()
        sys.exit(1)
''')
(bin_dir / 'curl').write_text('''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
c = Path(os.environ['PUBLISH_TEST_CONTROL'])
scenario = json.loads((c / 'scenario').read_text()) if (c / 'scenario').exists() else {}
phase = (c / 'running').read_text()
with (c / 'http').open('a') as f: f.write(phase + ' ' + sys.argv[-1] + '\\n')
# The new post does not exist on the previous release.
sys.exit(1 if scenario.get(phase) == 'http' or
         (phase == 'rollback' and sys.argv[-1] != 'http://127.0.0.1:8080/') else 0)
''')
(bin_dir / 'sleep').write_text('#!/bin/sh\nexit 0\n')
for command in bin_dir.iterdir():
    command.chmod(0o755)
env = dict(os.environ, SOURCE_DIR=str(source), DEPLOY_LOCK=str(root / 'deploy.lock'),
           PUBLISH_TEST_CONTROL=str(control), PATH=str(bin_dir) + ':' + os.environ['PATH'])

def enqueue(number, filename='2026-11-07-example.md', state='queued'):
    ident = f'{number:032x}'
    for language in ('eo', 'en', 'tr'):
        folder = posts / language
        folder.mkdir(exist_ok=True)
        (folder / filename).touch()
    staging = posts / f'.publish-request-{ident}'
    staging.mkdir()
    (staging / 'request').write_text(filename + '\n')
    (staging / 'status').write_text(json.dumps(dict(id=ident, state=state, file=filename), separators=(',', ':')))
    staging.rename(jobs / ident)
    return jobs / ident

def status(job, expected):
    value = json.loads((job / 'status').read_text())
    assert value['id'] == job.name and value['state'] == expected, value
    return (job / 'status').read_bytes()

def run():
    subprocess.run(['bash', script], env=env, check=True, timeout=10)

def builds():
    return len((control / 'builds').read_text().splitlines())

# B arrives while A builds; the same process must consume both distinct IDs,
# even when they refer to the same filename.
a = enqueue(1)
(control / 'pause').touch()
worker = subprocess.Popen(['bash', script], env=env)
try:
    until = time.monotonic() + 5
    while not (control / 'ready').exists():
        assert worker.poll() is None and time.monotonic() < until, 'worker did not start'
        time.sleep(.01)
    status(a, 'building')
    b = enqueue(2)
    status(b, 'queued')
    (control / 'pause').unlink()
    assert worker.wait(timeout=10) == 0
finally:
    if worker.poll() is None:
        worker.kill()
        worker.wait()
original = status(a, 'published')
status(b, 'published')
assert builds() == 2
assert not list(jobs.glob('*/request'))

# A failure is terminal for that attempt, but does not block the next request.
failure = enqueue(3)
following = enqueue(4, '2026-11-07-next.md')
(control / 'fail').touch()
run()
failed_result = status(failure, 'failed')
status(following, 'published')
retry = enqueue(5)
run()
status(retry, 'published')
assert (failure / 'status').read_bytes() == failed_result
assert (a / 'status').read_bytes() == original

# Kill the actual worker during a build: its request must survive and resume.
interrupted = enqueue(6)
(control / 'interrupt').touch()
result = subprocess.run(['bash', script], env=env, timeout=10)
assert result.returncode == -signal.SIGKILL
status(interrupted, 'building')
assert (interrupted / 'request').is_file()
run()
status(interrupted, 'published')
assert not (interrupted / 'request').exists()

# A crash between final status and trigger removal must not repeat the build.
finished = enqueue(7, state='published')
count = builds()
run()
assert builds() == count and not (finished / 'request').exists()

# Old triggers remain consumable, including a repeated filename with stale
# global status; malformed and empty triggers are consumed without building.
legacy = posts / '.publish-trigger'
(posts / '.publish-status').write_text('{"state":"published","file":"2026-11-07-example.md"}')
legacy.write_text('2026-11-07-example.md\n')
run()
assert builds() == count + 1 and not legacy.exists()
count = builds()
for value in ('../outside.md\n', ''):
    before = set(jobs.iterdir())
    legacy.write_text(value)
    run()
    imported, = set(jobs.iterdir()) - before
    status(imported, 'failed')
    assert not legacy.exists() and builds() == count
assert not list(jobs.glob('*/request'))
print('publish-posts queue, retry, restart and legacy checks passed')

# Check both rollback entry points, HTTP failures, and every recovery outcome.
number = 100
for new in ('up', 'health', 'http', ''):
    for rollback in ('', 'up', 'health', 'http', 'inspect', 'tag', 'missing') if new else ('', 'missing'):
        number += 1
        (control / 'scenario').write_text(json.dumps(dict(
            new=new, rollback=rollback, no_old_image=rollback == 'missing')))
        (control / 'calls').write_text('')
        (control / 'http').write_text('')
        job = enqueue(number)
        run()
        status(job, 'failed' if new else 'published')
        result = json.loads((job / 'status').read_text())
        assert set(result) == {'id', 'state', 'file', 'message', 'updated'}, result
        assert result['file'] == '2026-11-07-example.md', result
        calls = [json.loads(line) for line in (control / 'calls').read_text().splitlines()]
        recovery = [call for call in calls if '--force-recreate' in call]
        removed = [call for call in calls if call[:2] == ['image', 'rm']]
        tag = 'fmert-blog:post-rollback-' + job.name
        if new:
            reason = 'Yeni sürüm başlatılamadı' if new == 'up' else 'Sağlık kontrolü başarısız oldu'
            assert result['message'].startswith(reason + '; '), result
            assert not removed, calls
            assert len(recovery) == (0 if rollback in ('tag', 'missing') else 1), calls
            if not rollback:
                expected = 'önceki sürüm korundu' if new == 'up' else 'önceki sürüm geri yüklendi'
                assert result['message'] == reason + '; ' + expected, result
                assert 'rollback http://127.0.0.1:8080/\n' in (control / 'http').read_text()
            else:
                expected = {'up': 'geri dönüş başlatılamadı', 'tag': 'geri dönüş imajı etiketlenemedi',
                            'health': 'önceki sürümün sağlık kontrolü başarısız oldu',
                            'http': 'önceki sürümün sağlık kontrolü başarısız oldu',
                            'inspect': 'önceki sürümün sağlık kontrolü başarısız oldu',
                            'missing': 'geri dönülemedi: önceki imaj yok'}[rollback]
                suffix = '' if rollback == 'missing' else '; kurtarma imajı: ' + tag
                assert result['message'] == reason + '; ' + expected + suffix, result
        else:
            assert result['message'] == 'Yazı yayında' and not recovery, result
            assert removed == ([] if rollback == 'missing' else [['image', 'rm', tag]]), calls
            assert (control / 'http').read_text().splitlines() == [
                'new http://127.0.0.1:8080' + prefix + '/posts/example/' for prefix in ('', '/en', '/tr')]
        assert not (job / 'request').exists()

# A failed backup must stop before build; later jobs must not overwrite a
# recovery tag left by an earlier failed rollback in the same worker process.
(control / 'scenario').write_text('{"backup":"tag"}')
backup = enqueue(200)
count = builds()
run()
status(backup, 'failed')
assert builds() == count
assert json.loads((backup / 'status').read_text())['message'] == 'Kurtarma imajı etiketlenemedi; yayın başlatılmadı'
(control / 'scenario').write_text('{"new":"up","rollback":"up"}')
(control / 'calls').write_text('')
first, second = enqueue(201), enqueue(202)
run()
calls = [json.loads(line) for line in (control / 'calls').read_text().splitlines()]
assert [call[-1] for call in calls if call[:2] == ['tag', 'old-image']] == [
    'fmert-blog:post-rollback-' + job.name for job in (first, second)]
assert not any(call[:2] == ['image', 'rm'] for call in calls)
for job in (first, second):
    status(job, 'failed')
assert not list(jobs.glob('*/request'))
print('publish-posts rollback, health, missing image and successful publish checks passed')
PY
