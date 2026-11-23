# fmert.me — Source Code

Source code and content for **[fmert.me](https://fmert.me)**, the personal software journal of **Furkan Mert Bağcı (fMert)**.

Self-hosted on a personal VPS behind Caddy and Docker Compose.

## Architecture

- **Bespoke Editorial Frontend (`src/builder/`, `src/assets/`)** — Lightweight, dependency-minimal static site generator built on Node.js (`marked`, `gray-matter`, `highlight.js`, `js-yaml` — all MIT/BSD-3-Clause). Builds Esperanto (`/`), English (`/en/`), and Turkish (`/tr/`) in ~150 ms with build-time syntax highlighting, sticky table of contents, instant `⌘K` / `/` search, unified topic-filtered archives, Atom feeds, sitemap, and light/dark modes.
- **Stories** — Homepage story strip with 24-hour active window, latest-story archive fallback, seen rings, and a 60fps darkroom fullscreen viewer with keyboard, tap, hold-to-pause, and swipe gestures.
- **Content Studio & API (`src/server/`)** — Password-protected `/stories-admin` studio with:
  - **Stories**: Create, edit, and delete text, image, or link stories with live 9:16 preview, Unicode code-point validation, strict image header verification, and automatic media + like cleanup.
  - **Posts**: Create, edit, delete, and save server-side drafts (drafts never leak into live builds). Supports 1, 2, or all 3 languages, live Markdown preview, direct image upload into `/story-media/`, full-text metadata inference, and **instant atomic site rebuilds (~150 ms)** via symlinked releases — no Docker rebuilds or systemd path triggers required.
  - **First-party Analytics & Likes**: Respects Do Not Track and Global Privacy Control. Stores 30-day rolling daily JSONL logs with automatic background pruning, 10 MiB daily / 100 MiB total storage caps, and persistent per-item like counts backed by signed HttpOnly cookies.

## Running Locally

Requires Node.js ≥ 20.

```bash
npm install
npm run dev        # builds site + runs static files & /stories-admin at http://127.0.0.1:4000
```

Default local admin password is `dev` (override with `STORY_PASSWORD=...`).

### Build & Test

```bash
npm run build      # outputs static multilingual site to _site/
npm test           # runs static builder, internal link integrity, and backend integration tests
```

## Production Deployment

Production runs two hardened Docker containers defined in `deploy/docker-compose.yml`:

- `fmert_story_admin` (`127.0.0.1:8081`): Node.js 22 Alpine server handling `/stories-*`, `/story-media/*`, `/health`, and atomic static site builds into the shared `site_dist` volume.
- `fmert_blog` (`127.0.0.1:8080`): Nginx serving `/srv/site/current` read-only from the shared volume.

Create `deploy/.env` with `STORY_PASSWORD=...`, then run:

```bash
cd deploy
docker compose up -d --build
```

Caddy routes `/stories-*` and `/story-media/*` to `localhost:8081` and all other requests to `localhost:8080`. Persistent stories, media, posts, drafts, likes, and analytics remain stored in `deploy/data/`.

## License

Source code is licensed under the [MIT License](LICENSE). Blog content © Furkan Mert Bağcı.
