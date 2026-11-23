#!/usr/bin/env bash
# Legacy systemd post-publisher hook (kept as a safe no-op).
# Post publishing now runs atomically inside fmert_story_admin (~150ms)
# without rebuilding Docker images or requiring a host systemd worker.
set -euo pipefail
exit 0
