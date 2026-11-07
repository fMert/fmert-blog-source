#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR=${SOURCE_DIR:-/opt/apps/fmert-blog/source}
POSTS_DIR="$SOURCE_DIR/deploy/data/posts"
TRIGGER="$POSTS_DIR/.publish-trigger"
JOBS="$POSTS_DIR/.publish-jobs"
COMPOSE=(docker compose --env-file "$SOURCE_DIR/deploy/.env" -f "$SOURCE_DIR/deploy/docker-compose.yml")

mkdir -p "$JOBS"
exec 9>"${DEPLOY_LOCK:-/run/fmert-blog-deploy.lock}"
flock 9

write_status() {
  local state=$1 file=$2 message=$3 temporary
  temporary=$(mktemp "$STATUS.tmp.XXXXXX") || return
  if printf '{"id":"%s","state":"%s","file":"%s","message":"%s","updated":"%s"}\n' \
    "$publish_id" "$state" "$file" "$message" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$temporary" &&
    chmod =rw -- "$temporary" &&
    mv -T -- "$temporary" "$STATUS"; then
    return 0
  else
    local result=$?
    rm -f -- "$temporary"
    return "$result"
  fi
}

wait_for_blog() {
  local health ready url attempt
  for attempt in {1..60}; do
    if health=$(docker inspect --format '{{.State.Health.Status}}' fmert_blog 2>/dev/null) &&
       [[ "$health" == healthy ]]; then
      ready=true
      for url in "$@"; do
        if ! curl --fail --silent "http://127.0.0.1:8080$url" >/dev/null; then
          ready=false
          break
        fi
      done
      if [[ "$ready" == true ]]; then return 0; fi
    fi
    sleep 2
  done
  return 1
}

rollback_post() {
  local reason=$1 success=$2 error
  if [[ -z "$old_image" ]]; then
    write_status failed "$post_file" "$reason; geri dönülemedi: önceki imaj yok"
    return 0
  fi
  if ! docker tag "$rollback_image" fmert-blog:local; then
    error="geri dönüş imajı etiketlenemedi"
  elif ! "${COMPOSE[@]}" up -d --no-deps --force-recreate blog; then
    error="geri dönüş başlatılamadı"
  # The previous release may not contain the post being published.
  elif ! wait_for_blog /; then
    error="önceki sürümün sağlık kontrolü başarısız oldu"
  else
    write_status failed "$post_file" "$reason; $success"
    return 0
  fi
  write_status failed "$post_file" "$reason; $error; kurtarma imajı: $rollback_image"
}

publish_post() {
  post_file=$(head -n 1 "$request" | tr -d '\r\n')
  if [[ ! "$post_file" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9-]+\.md$ ]] ||
     { [[ ! -f "$POSTS_DIR/$post_file" ]] &&
       { [[ ! -f "$POSTS_DIR/eo/$post_file" ]] || [[ ! -f "$POSTS_DIR/en/$post_file" ]] || [[ ! -f "$POSTS_DIR/tr/$post_file" ]]; }; }; then
    write_status failed "" "Geçersiz yayın isteği"
    return 0
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
  rollback_image="fmert-blog:post-rollback-$publish_id"
  old_image=$(docker image inspect --format '{{.Id}}' fmert-blog:local 2>/dev/null || true)
  if [[ -n "$old_image" ]]; then
    if ! docker tag "$old_image" "$rollback_image"; then
      write_status failed "$post_file" "Kurtarma imajı etiketlenemedi; yayın başlatılmadı"
      return 0
    fi
  fi

  write_status building "$post_file" "Blog hazırlanıyor"
  cd "$SOURCE_DIR"
  if ! "${COMPOSE[@]}" build --pull blog; then
    write_status failed "$post_file" "Blog oluşturulamadı; mevcut site değişmeden kaldı"
    [[ -z "$old_image" ]] || docker image rm "$rollback_image" >/dev/null 2>&1 || true
    return 0
  fi

  if ! "${COMPOSE[@]}" up -d --no-deps blog; then
    rollback_post "Yeni sürüm başlatılamadı" "önceki sürüm korundu"
    return 0
  fi

  if ! wait_for_blog "${post_urls[@]}"; then
    rollback_post "Sağlık kontrolü başarısız oldu" "önceki sürüm geri yüklendi"
    return 0
  fi

  write_status published "$post_file" "Yazı yayında"
  [[ -z "$old_image" ]] || docker image rm "$rollback_image" >/dev/null 2>&1 || true
}

shopt -s nullglob
while true; do
  # Claim legacy triggers without deleting a newer trigger written during a build.
  if [[ -f "$TRIGGER" ]]; then
    # Legacy filenames cannot identify attempts; conservatively consume once.
    publish_id=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
    mkdir -- "$JOBS/$publish_id"
    mv -T -- "$TRIGGER" "$JOBS/$publish_id/request"
  fi
  requests=("$JOBS"/*/request)
  ((${#requests[@]})) || break
  for request in "${requests[@]}"; do
    job=${request%/request}
    publish_id=${job##*/}
    [[ "$publish_id" =~ ^[0-9a-f]{32}$ ]] || { echo "Invalid publish ID: $publish_id" >&2; exit 1; }
    STATUS="$job/status"
    # A crash after the terminal status write must not publish the request again.
    if ! grep -Eq '"state":"(published|failed)"' "$STATUS" 2>/dev/null; then
      publish_post
    fi
    rm -- "$request"
  done
  # Re-scan after every batch; requests arriving during a build stay durable.
done
