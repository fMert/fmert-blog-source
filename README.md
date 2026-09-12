# fmert.me — Source Code

This repository contains the source code and content for my already-live blog, **[fmert.me](https://fmert.me)**.

The production site is independently hosted and deployed on my personal VPS — **it is not hosted on GitHub Pages**. GitHub is used here for source control and build/test automation only.

Personal blog of **Furkan Mert Bağcı** — posts about my projects (Queyntisen, Aria), software, and the occasional field research. Built with [Jekyll](https://jekyllrb.com/) and the [Chirpy](https://github.com/cotes2020/jekyll-theme-chirpy) theme.

**Live site:** <https://fmert.me>

## What's customized

- **Violet reskin** — the entire theme is recolored through CSS custom properties in `assets/css/jekyll-theme-chirpy.scss`. Both light and dark modes work; the theme's own toggle is untouched.
- **Stories** — an Instagram-style "Hikayeler" row on the homepage with a fullscreen viewer (progress bars, auto-advance, tap zones, keyboard navigation). Vanilla JS, no dependencies.
- **Content studio** — the password-protected `/stories-admin` panel has Stories, Posts, and Analytics tabs. Posts can be written in Markdown with a live preview; dates, slugs, categories, and tags are generated automatically without an external AI API.
- **First-party analytics** — the Analytics tab shows the last 30 days of page views, distinct IPs, popular pages, device/browser categories, referrer domains, and recent visits. Data starts when the tracker is deployed; it is stored in the persistent `deploy/data/analytics/` directory and older daily files are removed when the dashboard is opened. Do Not Track and Global Privacy Control are respected. Counts exclude browsers that block or disable the tracker; IPs do not identify individuals.
- **Likes** — stories and post pages have a like/unlike button and a public count. The Analytics tab shows every current like with its timestamp, content, IP, page, device/browser category, and referrer domain. These are snapshots of the like request, not a person's browsing history. Only the authenticated admin can see these details. Likes and their snapshots persist in `deploy/data/likes/` until undone; their retention is separate from the 30-day page-view window. A signed, first-party, HttpOnly cookie remembers likes for one year and is created on the first like. Clearing cookies or using another browser allows another like; this is not an identity system. The like button remains usable when passive analytics are disabled by DNT/GPC.

The like service validates content against live stories and Jekyll's generated
`/like-targets.json`. Rebuild both `blog` and `stories` containers to enable it.
`BLOG_ORIGIN` defaults to the internal `http://blog:8080`; set it to your Jekyll
server when running the Go service locally. The like cookie requires HTTPS.
`TRUST_PROXY_HEADERS=true` is set only in the deployment where Caddy is the
entrypoint and the Go service's published port is bound to loopback. Do not expose
that port directly to the internet with this setting enabled.

Abuse protection limits `/stories-login` to 5 attempts per IP and 100 attempts
across all IPs per 15 minutes. Analytics submissions are limited to 60 per IP
and 600 across all IPs per minute, and require a matching `Origin` header.
Throttled requests return HTTP 429 with `Retry-After`. These request limits reset
when the service restarts. Analytics log files have an additional 10 MiB daily
and 100 MiB total storage budget, checked against the files on disk so restarting
cannot bypass it. When a storage budget is full, new analytics submissions return
HTTP 503 until space is available; existing records are not deleted by this check.
Page-view counts can therefore omit traffic above these limits, and accepted
requests are still not proof of a human visit.

## Stories

New stories are published from the Stories tab of the password-protected `/stories-admin` page.
The companion service in `story-admin/` stores its JSON and uploads in the
mounted `deploy/data/` directory; story content is therefore kept across image
rebuilds and is never committed. The Jekyll data below is an offline fallback.

Fallback stories live in [`_data/stories.yml`](_data/stories.yml). Their format is:

```yaml
- id: my-story            # unique, used for seen-state
  type: image             # image | text | link
  image: /assets/img/example.jpg   # type: image
  bg: "linear-gradient(...)"       # type: text | link
  title: "Short card caption"      # optional, falls back to text
  text: "Main story text"
  subtext: "Smaller line below"    # optional
  link: /posts/some-post/          # type: link
  link_label: "Yazıyı oku"         # type: link
  posted: 2026-07-11 18:00:00 +0300
```

Rules enforced client-side in `assets/js/stories.js`:

- A story is visible for **24 hours** after `posted`.
- When nothing is fresh, only the newest story stays, shown dimmed as **"Son hikaye"** — until a newer one is published.
- Viewed stories get a grey ring, persisted in `localStorage`.
- No live or fallback stories hides the section entirely.

Implementation: `_includes/stories.html` (markup), `assets/js/stories.js` (logic), the `/* ----- Stories ----- */` section of `assets/css/jekyll-theme-chirpy.scss` (styles), and `_layouts/home.html` (Chirpy home layout override that inserts the row above the post list).

The production Docker and Caddy configuration lives in `deploy/`. Create
`deploy/.env` containing `STORY_PASSWORD=...`, then run:

```bash
cd deploy
docker compose up -d --build
```

> Note: story images are CSS backgrounds rather than `<img>` tags, because Chirpy's `refactor-content.html` rewrites raw `<img>` markup in layout content.

## Publishing posts from the admin

The Posts tab in `/stories-admin` saves Markdown drafts in the browser and
publishes completed posts into the persistent, Git-ignored
`deploy/data/posts/` directory. The production path unit watches for new posts
and runs `deploy/publish-posts.sh`, which rebuilds only the blog container,
checks the new post URL, and keeps the previous image available for rollback.
Panel-created posts therefore survive regular Git deployments without being
committed to the repository.

## Running locally

```bash
bundle install
bash tools/run.sh          # serves at http://127.0.0.1:4000 with live reload
```

Or a one-off production build:

```bash
JEKYLL_ENV=production bundle exec jekyll build   # output in _site/
```

Requires Ruby ≥ 3.1.

## Deployment

Pushing to `main` runs the build checks. The VPS timer pulls `main` and runs
`deploy/update-blog.sh`; Caddy routes the static blog and content studio. Post
publishing is handled separately by `fmert-blog-post-publish.path`.

## License

The source code is open source under the [MIT License](LICENSE). Blog content © Furkan Mert Bağcı. The project is based on the MIT-licensed [Chirpy starter](https://github.com/cotes2020/chirpy-starter).
