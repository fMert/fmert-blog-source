#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/opt/apps/fmert-blog
SOURCE_DIR="$APP_DIR/source"
exec 9>/run/fmert-blog-deploy.lock
flock 9
cd "$SOURCE_DIR"
git fetch --prune origin main
REMOTE_REVISION=$(git rev-parse origin/main)
DEPLOYED_REVISION=$(cat "$APP_DIR/.deployed-revision" 2>/dev/null || true)

healthy() {
  [[ $(docker inspect --format '{{.State.Health.Status}}' "$1" 2>/dev/null || true) == healthy ]]
}

if [[ "$REMOTE_REVISION" == "$DEPLOYED_REVISION" ]] && healthy fmert_blog && healthy fmert_story_admin; then
  exit 0
fi

git checkout main
git reset --hard origin/main
git submodule sync --recursive
git submodule update --init --recursive

# Caddy is shared with other applications on this server. Its system-wide
# configuration is managed separately; this updater only deploys the blog.
docker compose --env-file deploy/.env -f deploy/docker-compose.yml build --pull
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --remove-orphans

for _ in {1..30}; do
  if healthy fmert_blog && healthy fmert_story_admin &&
     curl --fail --silent --show-error --max-time 5 http://127.0.0.1:8080/ >/dev/null &&
     curl --fail --silent --show-error --max-time 5 http://127.0.0.1:8081/health >/dev/null; then
    printf '%s\n' "$REMOTE_REVISION" > "$APP_DIR/.deployed-revision"
    exit 0
  fi
  sleep 2
done

echo 'Blog containers did not become healthy' >&2
exit 1
