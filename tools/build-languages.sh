#!/usr/bin/env bash
set -euo pipefail

output="${1:-_site}"
mkdir -p "$output"
output=$(cd "$output" && pwd)
source_dir=$(cd "$(dirname "$0")/.." && pwd)
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT

for language in eo en tr; do
  rm -rf "$stage/site"
  mkdir -p "$stage/site"
  cp -a "$source_dir/." "$stage/site/"
  rm -rf "$stage/site/.git" "$stage/site/_site" "$stage/site/.jekyll-cache"
  if [[ "$language" != eo ]]; then
    rm -rf "$stage/site/_posts" "$stage/site/_tabs"
    cp -a "$source_dir/i18n/$language/_posts" "$stage/site/_posts"
    cp -a "$source_dir/i18n/$language/_tabs" "$stage/site/_tabs"
    cp "$source_dir/i18n/$language/stories.yml" "$stage/site/_data/stories.yml"
  fi
  if [[ -d "$source_dir/deploy/data/posts/$language" ]]; then
    cp -a "$source_dir/deploy/data/posts/$language/." "$stage/site/_posts/"
  fi
  if [[ "$language" == tr ]]; then
    find "$source_dir/deploy/data/posts" -maxdepth 1 -name '*.md' -exec cp {} "$stage/site/_posts/" \; 2>/dev/null || true
  fi
  destination="$output"
  [[ "$language" == eo ]] || destination="$output/$language"
  bundle exec jekyll build --source "$stage/site" --destination "$destination" \
    --config "$stage/site/_config.yml,$stage/site/i18n/$language/config.yml"
done
