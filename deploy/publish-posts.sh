#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/opt/apps/fmert-blog
SOURCE_DIR="$APP_DIR/source"
POSTS_DIR="$SOURCE_DIR/deploy/data/posts"
TRIGGER="$POSTS_DIR/.publish-trigger"
STATUS="$POSTS_DIR/.publish-status"
COMPOSE=(docker compose --env-file "$SOURCE_DIR/deploy/.env" -f "$SOURCE_DIR/deploy/docker-compose.yml")

mkdir -p "$POSTS_DIR"
exec 9>/run/fmert-blog-deploy.lock
flock 9

write_status() {
  local state=$1 file=$2 message=$3 temporary
  temporary=$(mktemp "$STATUS.tmp.XXXXXX") || return
  if printf '{"state":"%s","file":"%s","message":"%s","updated":"%s"}\n' \
    "$state" "$file" "$message" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$temporary" &&
    chmod =rw -- "$temporary" &&
    mv -T -- "$temporary" "$STATUS"; then
    return 0
  else
    local result=$?
    rm -f -- "$temporary"
    return "$result"
  fi
}

if [[ ! -s "$TRIGGER" ]]; then
  exit 0
fi

post_file=$(head -n 1 "$TRIGGER" | tr -d '\r\n')
if [[ ! "$post_file" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9-]+\.md$ ]] ||
   { [[ ! -f "$POSTS_DIR/$post_file" ]] &&
     { [[ ! -f "$POSTS_DIR/eo/$post_file" ]] || [[ ! -f "$POSTS_DIR/en/$post_file" ]] || [[ ! -f "$POSTS_DIR/tr/$post_file" ]]; }; }; then
  write_status failed "" "Geçersiz yayın isteği"
  exit 1
fi

post_slug=${post_file%.md}
post_slug=${post_slug:11}
post_url="/posts/$post_slug/"
if [[ -f "$POSTS_DIR/$post_file" ]]; then
  post_url="/tr$post_url"
fi
post_urls=("$post_url")
if [[ ! -f "$POSTS_DIR/$post_file" ]]; then
  post_urls+=("/en$post_url" "/tr$post_url")
fi
rollback_image="fmert-blog:post-rollback-$$"
old_image=$(docker image inspect --format '{{.Id}}' fmert-blog:local 2>/dev/null || true)
if [[ -n "$old_image" ]]; then
  docker tag "$old_image" "$rollback_image"
fi

write_status building "$post_file" "Blog hazırlanıyor"
cd "$SOURCE_DIR"
if ! "${COMPOSE[@]}" build --pull blog; then
  write_status failed "$post_file" "Blog oluşturulamadı; mevcut site değişmeden kaldı"
  [[ -z "$old_image" ]] || docker image rm "$rollback_image" >/dev/null 2>&1 || true
  exit 1
fi

if ! "${COMPOSE[@]}" up -d --no-deps blog; then
  if [[ -n "$old_image" ]]; then
    docker tag "$rollback_image" fmert-blog:local
    "${COMPOSE[@]}" up -d --no-deps --force-recreate blog || true
  fi
  write_status failed "$post_file" "Yeni sürüm başlatılamadı; önceki sürüm korundu"
  exit 1
fi

published=false
for _ in {1..60}; do
  health=$(docker inspect --format '{{.State.Health.Status}}' fmert_blog 2>/dev/null || true)
  if [[ "$health" == healthy ]]; then
    published=true
    for url in "${post_urls[@]}"; do
      if ! curl --fail --silent "http://127.0.0.1:8080$url" >/dev/null; then
        published=false
        break
      fi
    done
    if [[ "$published" == true ]]; then break; fi
  fi
  sleep 2
done

if [[ "$published" != true ]]; then
  if [[ -n "$old_image" ]]; then
    docker tag "$rollback_image" fmert-blog:local
    "${COMPOSE[@]}" up -d --no-deps --force-recreate blog || true
  fi
  write_status failed "$post_file" "Sağlık kontrolü başarısız oldu; önceki sürüm geri yüklendi"
  exit 1
fi

write_status published "$post_file" "Yazı yayında"
[[ -z "$old_image" ]] || docker image rm "$rollback_image" >/dev/null 2>&1 || true
