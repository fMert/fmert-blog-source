import { escapeHtml } from './markdown.mjs';
import { LANGUAGES, SITE_META, slugifyTerm } from './content.mjs';

function iconSvg(name) {
  const icons = {
    search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    sun: '<svg class="icon-sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>',
    moon: '<svg class="icon-moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>',
    menu: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    close: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    prev: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
    next: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
    pause: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>',
    arrowUpRight: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10"/></svg>',
    arrowLeft: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>',
    github: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C6.48 2 2 6.58 2 12.26c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49 0-.24-.01-1.05-.01-1.9-2.78.62-3.37-1.22-3.37-1.22-.45-1.19-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.36-2.22-.26-4.56-1.14-4.56-5.08 0-1.12.39-2.04 1.03-2.76-.1-.26-.45-1.31.1-2.73 0 0 .84-.28 2.75 1.05a9.3 9.3 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.42.2 2.47.1 2.73.64.72 1.03 1.64 1.03 2.76 0 3.95-2.34 4.82-4.57 5.07.36.32.68.94.68 1.9 0 1.37-.01 2.48-.01 2.82 0 .27.18.6.69.49A10.27 10.27 0 0 0 22 12.26C22 6.58 17.52 2 12 2Z"/></svg>',
    mail: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
    rss: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1" fill="currentColor"/></svg>'
  };
  return icons[name] || '';
}

function buildLangTargets(canonicalPath, currentLangKey, availablePostSlugsByLang, postSlug, isTaxonomy) {
  return LANGUAGES.map((l) => {
    let href = `${l.baseurl}${canonicalPath}`;
    if (isTaxonomy) {
      href = l.key === currentLangKey ? `${l.baseurl}${canonicalPath}` : `${l.baseurl}/archives/`;
    } else if (postSlug && availablePostSlugsByLang?.[l.key] && !availablePostSlugsByLang[l.key].has(postSlug)) {
      href = `${l.baseurl}/`;
    }
    return { ...l, href };
  });
}

function renderClientI18nPayload(ui) {
  return JSON.stringify({
    lang: ui.lang_code,
    stories: ui.stories,
    story_count_live: ui.story_count_live,
    story_count_archive: ui.story_count_archive,
    last_story: ui.last_story,
    just_now: ui.just_now,
    minutes_ago: ui.minutes_ago,
    hours_ago: ui.hours_ago,
    days_ago: ui.days_ago,
    story_archive: ui.story_archive,
    story_photo: ui.story_photo,
    story_text: ui.story_text,
    story_link: ui.story_link,
    story_open: ui.story_open,
    story_last_badge: ui.story_last_badge,
    story_previous: ui.story_previous,
    story_next: ui.story_next,
    story_pause: ui.story_pause,
    story_resume: ui.story_resume,
    story_close: ui.story_close,
    story_like: ui.story_like,
    like: ui.like,
    liked: ui.liked,
    unlike: ui.unlike,
    like_count: ui.like_count,
    like_notice: ui.like_notice,
    like_load_failed: ui.like_load_failed,
    like_saved: ui.like_saved,
    like_removed: ui.like_removed,
    like_save_failed: ui.like_save_failed,
    post_like: ui.post_like,
    search_empty: ui.search_empty,
    search_no_results: ui.search_no_results,
    read_time: ui.read_time
  }).replace(/</g, '\\u003c');
}

export function renderBaseLayout({
  bundle,
  title,
  description,
  canonicalPath,
  activeNav = '',
  bodyHtml,
  extraHead = '',
  extraScripts = '',
  isHome = false,
  isPost = false,
  isWide = false,
  isTaxonomy = false,
  postSlug = '',
  ogImage = SITE_META.avatar,
  ogType = 'website',
  jsonLd = null,
  availablePostSlugsByLang = null
}) {
  const { lang, ui } = bundle;
  const fullTitle = isHome ? `${SITE_META.title}` : `${title} — ${SITE_META.title}`;
  const fullUrl = `${SITE_META.url}${lang.baseurl}${canonicalPath}`;
  const absImage = ogImage.startsWith('http') ? ogImage : `${SITE_META.url}${ogImage}`;
  const langTargets = buildLangTargets(canonicalPath, lang.key, availablePostSlugsByLang, postSlug, isTaxonomy);

  const hreflangLinks = isTaxonomy
    ? ''
    : langTargets
        .map((l) => `<link rel="alternate" hreflang="${escapeHtml(l.key)}" href="${SITE_META.url}${escapeHtml(l.href)}">`)
        .join('\n  ');

  const homeHref = `${lang.baseurl}/`;
  const archiveHref = `${lang.baseurl}/archives/`;
  const aboutHref = `${lang.baseurl}/about/`;
  const feedHref = `${lang.baseurl}/feed.xml`;
  const searchJsonHref = `${lang.baseurl}/search.json`;

  const jsonLdTag = jsonLd
    ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`
    : '';

  return `<!doctype html>
<html lang="${escapeHtml(lang.htmlLang)}" data-lang="${escapeHtml(lang.key)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(fullTitle)}</title>
  <meta name="description" content="${escapeHtml(description || bundle.config.description)}">
  <meta name="author" content="${escapeHtml(SITE_META.author.name)}">
  <link rel="canonical" href="${escapeHtml(fullUrl)}">
  ${hreflangLinks}
  <link rel="alternate" type="application/atom+xml" title="${escapeHtml(SITE_META.title)}" href="${escapeHtml(feedHref)}">
  <meta property="og:title" content="${escapeHtml(fullTitle)}">
  <meta property="og:description" content="${escapeHtml(description || bundle.config.description)}">
  <meta property="og:type" content="${escapeHtml(ogType)}">
  <meta property="og:url" content="${escapeHtml(fullUrl)}">
  <meta property="og:image" content="${escapeHtml(absImage)}">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${escapeHtml(fullTitle)}">
  <meta name="twitter:description" content="${escapeHtml(description || bundle.config.description)}">
  <link rel="icon" type="image/svg+xml" href="/assets/img/favicons/favicon.svg">
  <link rel="icon" type="image/png" sizes="96x96" href="/assets/img/favicons/favicon-96x96.png">
  <link rel="apple-touch-icon" href="/assets/img/favicons/apple-touch-icon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&family=JetBrains+Mono:wght@400;500&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;0,8..60,700;1,8..60,400&display=swap" rel="stylesheet">
  <script>
    (function () {
      try {
        var saved = localStorage.getItem('fmert-theme');
        if (saved === 'light' || saved === 'dark') {
          document.documentElement.setAttribute('data-mode', saved);
        }
      } catch (e) {}
    })();
  </script>
  <link rel="stylesheet" href="/assets/css/main.css">
  ${isPost ? `<meta name="fmert-post-id" content="${escapeHtml(canonicalPath)}">` : ''}
  <meta name="fmert-search-url" content="${escapeHtml(searchJsonHref)}">
  ${extraHead}
  ${jsonLdTag}
  <script>window.FmertI18n = ${renderClientI18nPayload(ui)};</script>
  <script defer src="/assets/js/site.js"></script>
  <script defer src="/assets/js/analytics.js"></script>
  <script defer src="/assets/js/likes.js"></script>
  ${extraScripts}
</head>
<body class="${isWide ? 'layout-wide' : 'layout-standard'}">
  <a class="skip-link" href="#main-content">${escapeHtml(ui.skip_to_content)}</a>

  <header class="site-header">
    <div class="header-inner">
      <a class="brand" href="${escapeHtml(homeHref)}">${escapeHtml(SITE_META.shortTitle)}</a>

      <nav class="site-nav" aria-label="Primary">
        <a href="${escapeHtml(homeHref)}"${activeNav === 'writing' ? ' aria-current="page"' : ''}>${escapeHtml(ui.nav_writing)}</a>
        <a href="${escapeHtml(archiveHref)}"${activeNav === 'archive' ? ' aria-current="page"' : ''}>${escapeHtml(ui.nav_archive)}</a>
        <a href="${escapeHtml(aboutHref)}"${activeNav === 'about' ? ' aria-current="page"' : ''}>${escapeHtml(ui.nav_about)}</a>
      </nav>

      <div class="header-controls">
        <button type="button" class="icon-btn search-trigger" id="search-open" aria-label="${escapeHtml(ui.search)}" title="${escapeHtml(ui.search)} (⌘K / /)">
          ${iconSvg('search')}
          <kbd class="search-kbd" aria-hidden="true">/</kbd>
        </button>

        <button type="button" class="icon-btn theme-toggle" id="theme-toggle" aria-label="${escapeHtml(ui.theme_toggle)}" title="${escapeHtml(ui.theme_toggle)}">
          ${iconSvg('sun')}
          ${iconSvg('moon')}
        </button>

        <nav class="lang-switch" aria-label="${escapeHtml(ui.language_label)}">
          ${langTargets
            .map(
              (l) =>
                `<a href="${escapeHtml(l.href)}" hreflang="${escapeHtml(l.key)}" aria-label="${escapeHtml(l.nativeName)}"${l.key === lang.key ? ' aria-current="page"' : ''}>${escapeHtml(l.label)}</a>`
            )
            .join('')}
        </nav>

        <button type="button" class="icon-btn mobile-menu-btn" id="mobile-menu-toggle" aria-expanded="false" aria-controls="mobile-nav" aria-label="${escapeHtml(ui.menu_toggle)}">
          ${iconSvg('menu')}
        </button>
      </div>
    </div>

    <div class="mobile-nav" id="mobile-nav" hidden>
      <nav aria-label="Mobile navigation">
        <a href="${escapeHtml(homeHref)}"${activeNav === 'writing' ? ' aria-current="page"' : ''}>${escapeHtml(ui.nav_writing)}</a>
        <a href="${escapeHtml(archiveHref)}"${activeNav === 'archive' ? ' aria-current="page"' : ''}>${escapeHtml(ui.nav_archive)}</a>
        <a href="${escapeHtml(aboutHref)}"${activeNav === 'about' ? ' aria-current="page"' : ''}>${escapeHtml(ui.nav_about)}</a>
      </nav>
    </div>
  </header>

  <main id="main-content" class="site-main">
    ${bodyHtml}
  </main>

  <footer class="site-footer">
    <div class="footer-inner">
      <div class="footer-links">
        <a href="${escapeHtml(SITE_META.github)}" target="_blank" rel="noopener noreferrer">${iconSvg('github')}<span>GitHub</span></a>
        <a href="mailto:${escapeHtml(SITE_META.email)}">${iconSvg('mail')}<span>${escapeHtml(ui.email)}</span></a>
        <a href="${escapeHtml(feedHref)}">${iconSvg('rss')}<span>RSS</span></a>
      </div>
      <p class="footer-note">${escapeHtml(ui.no_facebook)}</p>
    </div>
  </footer>

  <div class="search-modal" id="search-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(ui.search)}" hidden>
    <div class="search-backdrop" data-search-close></div>
    <div class="search-panel">
      <div class="search-input-wrap">
        ${iconSvg('search')}
        <input type="search" id="search-input" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(ui.search_placeholder)}" aria-label="${escapeHtml(ui.search)}">
        <button type="button" class="search-close-btn" data-search-close aria-label="${escapeHtml(ui.search_close)}">${iconSvg('close')}</button>
      </div>
      <div class="search-results" id="search-results" role="listbox">
        <p class="search-status">${escapeHtml(ui.search_empty)}</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export function renderStoriesSection(bundle) {
  const { ui, stories } = bundle;
  const fallbackCards = stories
    .map((story) => {
      const previewStyle = story.image
        ? `background-image:url('${escapeHtml(story.image)}')`
        : story.bg
          ? `background:${escapeHtml(story.bg)}`
          : '';
      return `
      <button
        type="button"
        class="story-card"
        hidden
        data-id="${escapeHtml(story.id)}"
        data-type="${escapeHtml(story.type)}"
        data-posted="${escapeHtml(story.posted)}"
        data-text="${escapeHtml(story.text)}"
        ${story.subtext ? `data-subtext="${escapeHtml(story.subtext)}"` : ''}
        ${story.image ? `data-image="${escapeHtml(story.image)}"` : ''}
        ${story.bg ? `data-bg="${escapeHtml(story.bg)}"` : ''}
        ${story.link ? `data-link="${escapeHtml(story.link)}" data-link-label="${escapeHtml(story.link_label || ui.story_open)}"` : ''}
      >
        <span class="story-ring">
          <span class="story-preview" style="${previewStyle}">
            <span class="story-scrim"></span>
            <span class="story-badge"></span>
            <span class="story-title">${escapeHtml(story.title || story.text)}</span>
          </span>
        </span>
        <span class="story-time"></span>
      </button>`;
    })
    .join('');

  return `
  <section id="stories" class="stories-section" aria-label="${escapeHtml(ui.stories)}" hidden>
    <div class="section-head">
      <h2 class="section-title">${escapeHtml(ui.stories)}</h2>
      <span class="stories-count"></span>
    </div>
    <div class="stories-row">${fallbackCards}</div>
  </section>

  <div id="story-viewer" class="story-viewer" role="dialog" aria-modal="true" aria-label="${escapeHtml(ui.stories)}" hidden>
    <button type="button" class="sv-nav sv-prev" aria-label="${escapeHtml(ui.story_previous)}">${iconSvg('prev')}</button>

    <div class="sv-canvas">
      <div class="sv-img" hidden></div>
      <div class="sv-img-scrim" hidden></div>

      <div class="sv-progress" aria-hidden="true"></div>

      <div class="sv-header">
        <img class="sv-avatar" src="${escapeHtml(SITE_META.avatar)}" width="36" height="36" alt="">
        <div class="sv-user">
          <div class="sv-name">fmert</div>
          <div class="sv-time"></div>
        </div>
        <span class="sv-expired-badge" hidden>${escapeHtml(ui.story_last_badge)}</span>
        <button type="button" class="sv-icon-btn sv-pause" aria-label="${escapeHtml(ui.story_pause)}">${iconSvg('pause')}</button>
        <button type="button" class="sv-icon-btn sv-close" aria-label="${escapeHtml(ui.story_close)}">${iconSvg('close')}</button>
      </div>

      <div class="sv-tap sv-tap-left" aria-hidden="true"></div>
      <div class="sv-tap sv-tap-right" aria-hidden="true"></div>

      <div class="sv-content">
        <p class="sv-text"></p>
        <p class="sv-subtext" hidden></p>
      </div>

      <div class="sv-footer">
        <div class="sv-cta" hidden>
          <a class="sv-cta-link" href="#"><span></span>${iconSvg('arrowUpRight')}</a>
        </div>
        <div class="sv-likes" aria-label="${escapeHtml(ui.story_like)}"></div>
      </div>
    </div>

    <button type="button" class="sv-nav sv-next" aria-label="${escapeHtml(ui.story_next)}">${iconSvg('next')}</button>
  </div>`;
}

export function renderHomePage(bundle, availablePostSlugsByLang) {
  const { lang, ui, posts } = bundle;
  const projectLinks = [
    { name: 'Queyntisen', href: `${lang.baseurl}/posts/queyntisen-obsidian-alternatifi/` },
    { name: 'Aria', href: `${lang.baseurl}/posts/aria/` },
    { name: 'Aksaray 68', href: `${lang.baseurl}/projects/aksaray-kirmizi-araba/` }
  ];

  const postItems = posts
    .map((post) => {
      const cat = post.categories[0]
        ? `<span class="post-cat">${escapeHtml(post.categories[0])}</span>`
        : '';
      const pin = post.pin
        ? `<span class="post-pin">${escapeHtml(ui.pinned_label)}</span>`
        : '';
      const readTime = escapeHtml((ui.read_time || '{count} min').replace('{count}', String(post.readingMinutes)));
      return `
      <article class="post-row">
        <a class="post-row-link" href="${escapeHtml(post.url)}">
          <div class="post-row-top">
            <h3 class="post-row-title">${escapeHtml(post.title)}</h3>
            ${pin}
          </div>
          <p class="post-row-excerpt">${escapeHtml(post.excerpt)}</p>
          <div class="post-row-meta">
            <time datetime="${escapeHtml(post.dateIso)}">${escapeHtml(post.dateFormatted)}</time>
            ${cat}
            <span class="post-readtime">${readTime}</span>
          </div>
        </a>
      </article>`;
    })
    .join('');

  const bodyHtml = `
    <section class="intro-block">
      <div class="intro-identity">
        <img class="intro-avatar" src="${escapeHtml(SITE_META.avatar)}" width="64" height="64" alt="${escapeHtml(ui.profile_photo)}">
        <div>
          <h1 class="intro-name">${escapeHtml(SITE_META.title)}</h1>
          <p class="intro-bio">${escapeHtml(ui.hero_bio)}</p>
        </div>
      </div>
      <div class="intro-projects">
        <span class="intro-projects-label">${escapeHtml(ui.hero_building)}</span>
        <div class="intro-project-links">
          ${projectLinks.map((p) => `<a class="project-chip" href="${escapeHtml(p.href)}">${escapeHtml(p.name)}</a>`).join('')}
        </div>
      </div>
    </section>

    ${renderStoriesSection(bundle)}

    <section class="writing-section" aria-label="${escapeHtml(ui.writing_heading)}">
      <div class="section-head">
        <h2 class="section-title">${escapeHtml(ui.writing_heading)}</h2>
        <a class="section-link" href="${escapeHtml(lang.baseurl)}/archives/">${escapeHtml(ui.nav_archive)}</a>
      </div>
      <div class="post-list">
        ${postItems}
      </div>
    </section>`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${SITE_META.url}/#website`,
        url: `${SITE_META.url}${lang.baseurl}/`,
        name: SITE_META.title,
        alternateName: SITE_META.author.alternateName,
        description: bundle.config.description,
        inLanguage: lang.htmlLang,
        author: { '@id': `${SITE_META.url}/#person` }
      },
      {
        '@type': 'Person',
        '@id': `${SITE_META.url}/#person`,
        name: SITE_META.author.name,
        alternateName: SITE_META.author.alternateName,
        url: `${SITE_META.url}/`,
        image: `${SITE_META.url}${SITE_META.avatar}`,
        sameAs: [SITE_META.github]
      }
    ]
  };

  return renderBaseLayout({
    bundle,
    title: SITE_META.title,
    description: bundle.config.description,
    canonicalPath: '/',
    activeNav: 'writing',
    bodyHtml,
    isHome: true,
    extraScripts: '<script defer src="/assets/js/stories.js"></script>',
    jsonLd,
    availablePostSlugsByLang
  });
}

export function renderPostPage(bundle, post, prevPost, nextPost, availablePostSlugsByLang) {
  const { lang, ui } = bundle;
  const hasToc = post.toc && post.headings.length >= 2;
  const readTime = (ui.read_time || '{count} min').replace('{count}', String(post.readingMinutes));

  const tocHtml = hasToc
    ? `
    <aside class="post-toc" aria-label="${escapeHtml(ui.toc_heading)}">
      <div class="toc-sticky">
        <h2 class="toc-title">${escapeHtml(ui.toc_heading)}</h2>
        <ol class="toc-list">
          ${post.headings
            .map(
              (h) =>
                `<li class="toc-item toc-depth-${h.depth}"><a href="#${escapeHtml(h.id)}">${escapeHtml(h.text)}</a></li>`
            )
            .join('')}
        </ol>
      </div>
    </aside>`
    : '';

  const categoryLinks = post.categories
    .map(
      (cat) =>
        `<a class="meta-category" href="${escapeHtml(lang.baseurl)}/categories/${encodeURIComponent(slugifyTerm(cat))}/">${escapeHtml(cat)}</a>`
    )
    .join('');

  const tagLinks = post.tags.length
    ? `<div class="post-tags">${post.tags
        .map(
          (tag) =>
            `<a class="tag-pill" href="${escapeHtml(lang.baseurl)}/tags/${encodeURIComponent(slugifyTerm(tag))}/">#${escapeHtml(tag)}</a>`
        )
        .join('')}</div>`
    : '';

  const coverHtml = post.image
    ? `<figure class="post-cover"><img src="${escapeHtml(post.image.path)}" alt="${escapeHtml(post.image.alt)}" decoding="async"></figure>`
    : '';

  const navHtml = prevPost || nextPost
    ? `<nav class="post-pager" aria-label="Post navigation">
        <div class="pager-slot pager-prev">
          ${
            prevPost
              ? `<span class="pager-label">${escapeHtml(ui.previous_post)}</span><a href="${escapeHtml(prevPost.url)}">${escapeHtml(prevPost.title)}</a>`
              : ''
          }
        </div>
        <div class="pager-slot pager-next">
          ${
            nextPost
              ? `<span class="pager-label">${escapeHtml(ui.next_post)}</span><a href="${escapeHtml(nextPost.url)}">${escapeHtml(nextPost.title)}</a>`
              : ''
          }
        </div>
      </nav>`
    : '';

  const bodyHtml = `
    <div class="post-shell${hasToc ? ' has-toc' : ''}">
      <article class="post-article">
        <a class="back-link" href="${escapeHtml(lang.baseurl)}/">${iconSvg('arrowLeft')}<span>${escapeHtml(ui.back_to_writing)}</span></a>

        <header class="post-header">
          <h1 class="post-title">${escapeHtml(post.title)}</h1>
          <div class="post-meta-bar">
            <time datetime="${escapeHtml(post.dateIso)}">${escapeHtml(post.dateFormatted)}</time>
            ${categoryLinks}
            <span>${escapeHtml(readTime)}</span>
          </div>
        </header>

        ${coverHtml}

        <div class="prose">
          ${post.html}
        </div>

        <footer class="post-footer">
          <div id="post-likes-mount" class="post-likes-slot" data-post-id="${escapeHtml(post.canonicalPath)}"></div>
          ${tagLinks}
          ${navHtml}
        </footer>
      </article>
      ${tocHtml}
    </div>`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.description,
    datePublished: post.dateIso,
    inLanguage: lang.htmlLang,
    url: `${SITE_META.url}${post.url}`,
    author: {
      '@type': 'Person',
      name: SITE_META.author.name,
      url: `${SITE_META.url}/about/`
    }
  };

  return renderBaseLayout({
    bundle,
    title: post.seoTitle || post.title,
    description: post.description,
    canonicalPath: post.canonicalPath,
    activeNav: 'writing',
    bodyHtml,
    isPost: true,
    isWide: hasToc,
    postSlug: post.slug,
    ogType: 'article',
    ogImage: post.image?.path || SITE_META.avatar,
    jsonLd,
    availablePostSlugsByLang
  });
}

export function renderAboutPage(bundle, availablePostSlugsByLang) {
  const { lang, ui, about } = bundle;

  const bodyHtml = `
    <article class="page-article">
      <header class="page-header">
        <div class="about-lead">
          <img class="about-avatar" src="${escapeHtml(SITE_META.avatar)}" width="72" height="72" alt="${escapeHtml(ui.profile_photo)}">
          <div>
            <h1 class="page-title">${escapeHtml(about.title)}</h1>
            <p class="page-subtitle">${escapeHtml(bundle.config.tagline)}</p>
          </div>
        </div>
      </header>
      <div class="prose">
        ${about.html}
      </div>
    </article>`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    url: `${SITE_META.url}${lang.baseurl}/about/`,
    name: about.seoTitle,
    description: about.description,
    inLanguage: lang.htmlLang,
    mainEntity: {
      '@type': 'Person',
      name: SITE_META.author.name,
      alternateName: SITE_META.author.alternateName,
      url: `${SITE_META.url}/`,
      image: `${SITE_META.url}${SITE_META.avatar}`,
      sameAs: [SITE_META.github]
    }
  };

  return renderBaseLayout({
    bundle,
    title: about.seoTitle,
    description: about.description,
    canonicalPath: '/about/',
    activeNav: 'about',
    bodyHtml,
    jsonLd,
    availablePostSlugsByLang
  });
}

export function renderArchivesPage(bundle, availablePostSlugsByLang) {
  const { ui, posts, categories } = bundle;
  const byYear = new Map();
  for (const post of posts) {
    if (!byYear.has(post.year)) byYear.set(post.year, []);
    byYear.get(post.year).push(post);
  }
  const years = Array.from(byYear.entries()).sort((a, b) => b[0] - a[0]);

  const filterButtons = categories.length > 1
    ? `<div class="archive-filters" role="group" aria-label="Filter by topic">
        <button type="button" class="filter-chip is-active" data-filter="all">${escapeHtml(ui.all_topics)}</button>
        ${categories
          .map(
            (c) =>
              `<button type="button" class="filter-chip" data-filter="${escapeHtml(c.slug)}">${escapeHtml(c.name)} <span class="chip-count">${c.posts.length}</span></button>`
          )
          .join('')}
      </div>`
    : '';

  const yearGroups = years
    .map(
      ([year, yearPosts]) => `
      <section class="archive-year-group" data-archive-group>
        <h2 class="archive-year">${year}</h2>
        <ul class="archive-list">
          ${yearPosts
            .map((post) => {
              const catSlugs = post.categories.map((c) => slugifyTerm(c)).join(',');
              const catLabel = post.categories[0]
                ? `<span class="archive-cat">${escapeHtml(post.categories[0])}</span>`
                : '';
              return `
              <li class="archive-item" data-categories="${escapeHtml(catSlugs)}">
                <a href="${escapeHtml(post.url)}">
                  <time datetime="${escapeHtml(post.dateIso)}">${escapeHtml(post.monthDay)}</time>
                  <span class="archive-title">${escapeHtml(post.title)}</span>
                  ${catLabel}
                </a>
              </li>`;
            })
            .join('')}
        </ul>
      </section>`
    )
    .join('');

  const bodyHtml = `
    <section class="page-article">
      <header class="page-header">
        <h1 class="page-title">${escapeHtml(ui.nav_archive)}</h1>
        <p class="page-subtitle">${escapeHtml(ui.archive_subtitle)}</p>
      </header>
      ${filterButtons}
      <div class="archive-timeline">
        ${yearGroups}
      </div>
    </section>`;

  return renderBaseLayout({
    bundle,
    title: ui.nav_archive,
    description: ui.archive_subtitle,
    canonicalPath: '/archives/',
    activeNav: 'archive',
    bodyHtml,
    availablePostSlugsByLang
  });
}

export function renderTaxonomyIndexPage(bundle, kind) {
  const { lang, ui, categories, tags } = bundle;
  const isCategory = kind === 'categories';
  const items = isCategory ? categories : tags;
  const heading = isCategory ? (ui.nav_archive || 'Categories') : '#Tags';
  const canonicalPath = isCategory ? '/categories/' : '/tags/';

  const listHtml = items
    .map((item) => {
      const countText = item.posts.length === 1
        ? ui.post_count_one
        : (ui.posts_count || '{count} posts').replace('{count}', String(item.posts.length));
      const href = `${lang.baseurl}/${kind}/${encodeURIComponent(item.slug)}/`;
      return `<a class="taxonomy-card" href="${escapeHtml(href)}"><span class="taxonomy-name">${isCategory ? '' : '#'}${escapeHtml(item.name)}</span><span class="taxonomy-count">${escapeHtml(countText)}</span></a>`;
    })
    .join('');

  const bodyHtml = `
    <section class="page-article">
      <header class="page-header">
        <a class="back-link" href="${escapeHtml(lang.baseurl)}/archives/">${iconSvg('arrowLeft')}<span>${escapeHtml(ui.nav_archive)}</span></a>
        <h1 class="page-title">${escapeHtml(heading)}</h1>
      </header>
      <div class="taxonomy-grid">${listHtml}</div>
    </section>`;

  return renderBaseLayout({
    bundle,
    title: heading,
    description: ui.archive_subtitle,
    canonicalPath,
    activeNav: 'archive',
    bodyHtml,
    isTaxonomy: true
  });
}

export function renderTaxonomyDetailPage(bundle, kind, item) {
  const { lang, ui } = bundle;
  const isCategory = kind === 'categories';
  const heading = isCategory
    ? (ui.category_heading || 'Category: {name}').replace('{name}', item.name)
    : (ui.tag_heading || 'Tag: #{name}').replace('{name}', item.name);
  const canonicalPath = `/${kind}/${item.slug}/`;

  const listHtml = item.posts
    .map(
      (post) => `
      <li class="archive-item">
        <a href="${escapeHtml(post.url)}">
          <time datetime="${escapeHtml(post.dateIso)}">${escapeHtml(post.dateFormatted)}</time>
          <span class="archive-title">${escapeHtml(post.title)}</span>
        </a>
      </li>`
    )
    .join('');

  const bodyHtml = `
    <section class="page-article">
      <header class="page-header">
        <a class="back-link" href="${escapeHtml(lang.baseurl)}/archives/">${iconSvg('arrowLeft')}<span>${escapeHtml(ui.nav_archive)}</span></a>
        <h1 class="page-title">${escapeHtml(heading)}</h1>
      </header>
      <ul class="archive-list">${listHtml}</ul>
    </section>`;

  return renderBaseLayout({
    bundle,
    title: heading,
    description: heading,
    canonicalPath,
    activeNav: 'archive',
    bodyHtml,
    isTaxonomy: true
  });
}

export function renderNotFoundPage(bundle) {
  const { lang, ui } = bundle;
  const bodyHtml = `
    <section class="not-found">
      <p class="not-found-code">404</p>
      <h1 class="page-title">${escapeHtml(ui.not_found_title)}</h1>
      <p class="page-subtitle">${escapeHtml(ui.not_found_text)}</p>
      <a class="btn-primary" href="${escapeHtml(lang.baseurl)}/">${escapeHtml(ui.not_found_home)}</a>
    </section>`;

  return renderBaseLayout({
    bundle,
    title: ui.not_found_title,
    description: ui.not_found_text,
    canonicalPath: '/404.html',
    bodyHtml
  });
}

export function renderResetPage(bundle) {
  const { lang, ui } = bundle;
  return `<!doctype html>
<html lang="${escapeHtml(lang.htmlLang)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex, follow">
  <title>${escapeHtml(ui.reset_title)}</title>
</head>
<body style="font-family:system-ui,sans-serif;padding:2rem;color:#111827;background:#f8f9fb;">
  <p>${escapeHtml(ui.reset_text)}</p>
  <script>
    Promise.all([
      navigator.serviceWorker
        ? navigator.serviceWorker.getRegistrations().then(function (regs) {
            return Promise.all(regs.map(function (r) { return r.unregister(); }));
          })
        : Promise.resolve(),
      window.caches
        ? caches.keys().then(function (names) {
            return Promise.all(names.map(function (n) { return caches.delete(n); }));
          })
        : Promise.resolve()
    ]).then(function () {
      location.replace('${escapeHtml(lang.baseurl)}/?fresh=' + Date.now());
    });
  </script>
</body>
</html>`;
}

export function renderSelfUnregisterSw() {
  return `self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { return caches.delete(k); }));
    }).then(function () {
      return self.registration.unregister();
    })
  );
});
`;
}

export function renderAtomFeed(bundle) {
  const { lang, posts } = bundle;
  const feedUrl = `${SITE_META.url}${lang.baseurl}/feed.xml`;
  const siteUrl = `${SITE_META.url}${lang.baseurl}/`;
  const updated = posts[0]?.dateIso || new Date().toISOString();

  const entries = posts
    .slice(0, 20)
    .map(
      (post) => `  <entry>
    <title>${escapeHtml(post.title)}</title>
    <link href="${SITE_META.url}${escapeHtml(post.url)}" rel="alternate" type="text/html"/>
    <id>${SITE_META.url}${escapeHtml(post.url)}</id>
    <published>${escapeHtml(post.dateIso)}</published>
    <updated>${escapeHtml(post.dateIso)}</updated>
    <summary>${escapeHtml(post.excerpt)}</summary>
    <content type="html">${escapeHtml(post.html)}</content>
  </entry>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${escapeHtml(lang.htmlLang)}">
  <title>${escapeHtml(SITE_META.title)}</title>
  <subtitle>${escapeHtml(bundle.config.description)}</subtitle>
  <link href="${escapeHtml(feedUrl)}" rel="self" type="application/atom+xml"/>
  <link href="${escapeHtml(siteUrl)}" rel="alternate" type="text/html"/>
  <id>${escapeHtml(siteUrl)}</id>
  <updated>${escapeHtml(updated)}</updated>
  <author>
    <name>${escapeHtml(SITE_META.author.name)}</name>
    <uri>${SITE_META.url}/about/</uri>
  </author>
${entries}
</feed>`;
}

export function renderSitemap(urls) {
  const rows = urls
    .map((u) => `  <url><loc>${escapeHtml(u.loc)}</loc>${u.lastmod ? `<lastmod>${escapeHtml(u.lastmod)}</lastmod>` : ''}</url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${rows}
</urlset>`;
}

export function renderAksarayProjectPage(bundle) {
  const { lang, project: t } = bundle;
  const homeHref = `${lang.baseurl}/`;

  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang.htmlLang)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(t.page_title)} — 2026</title>
<meta name="description" content="${escapeHtml(t.subtitle)}">
<link rel="alternate" hreflang="eo" href="https://fmert.me/projects/aksaray-kirmizi-araba/">
<link rel="alternate" hreflang="en" href="https://fmert.me/en/projects/aksaray-kirmizi-araba/">
<link rel="alternate" hreflang="tr" href="https://fmert.me/tr/projects/aksaray-kirmizi-araba/">
<link rel="icon" type="image/svg+xml" href="/assets/img/favicons/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&family=Fraunces:opsz,wght@9..144,400;9..144,700;9..144,900&display=swap" rel="stylesheet">
<script defer src="/assets/js/analytics.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --bg: #0a0e1a;
    --grid: rgba(220, 38, 38, 0.08);
    --ink: #e5e7eb;
    --muted: #8b93a6;
    --red: #dc2626;
    --red-glow: #ef4444;
    --accent: #fbbf24;
    --line: rgba(229, 231, 235, 0.14);
  }
  html, body {
    background: var(--bg);
    color: var(--ink);
    font-family: 'JetBrains Mono', monospace;
    min-height: 100%;
    width: 100%;
  }
  body::before {
    content: '';
    position: fixed;
    inset: 0;
    background-image:
      linear-gradient(var(--grid) 1px, transparent 1px),
      linear-gradient(90deg, var(--grid) 1px, transparent 1px);
    background-size: 32px 32px;
    pointer-events: none;
    z-index: 0;
  }
  .container {
    position: relative;
    z-index: 1;
    min-height: 100svh;
    width: 100%;
    max-width: 1220px;
    margin: 0 auto;
    padding: 20px 28px 28px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .topbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
    font-size: 11px;
    letter-spacing: 0.12em;
    color: var(--muted);
    padding-bottom: 12px;
    border-bottom: 1px solid var(--line);
  }
  .topbar-left { display: flex; align-items: center; gap: 14px; }
  .home-back {
    color: var(--ink);
    text-decoration: none;
    padding: 4px 8px;
    border: 1px solid var(--line);
    border-radius: 5px;
    transition: border-color .15s ease;
  }
  .home-back:hover { border-color: var(--red); }
  .topbar .dot {
    display: inline-block;
    width: 7px; height: 7px;
    background: var(--red);
    border-radius: 50%;
    margin-right: 8px;
  }
  .project-languages { display: flex; gap: 6px; }
  .project-languages a {
    color: var(--muted);
    text-decoration: none;
    padding: 4px 8px;
    border-radius: 4px;
    border: 1px solid transparent;
    font-size: 11px;
  }
  .project-languages a[aria-current="page"], .project-languages a:hover {
    color: var(--ink);
    border-color: var(--accent);
  }
  .study-id {
    font-size: 11px;
    letter-spacing: 0.16em;
    color: var(--red);
    margin-bottom: 8px;
  }
  h1 {
    font-family: 'Fraunces', serif;
    font-weight: 900;
    font-size: clamp(2rem, 4.4vw, 3.5rem);
    line-height: 1;
    letter-spacing: -0.03em;
    margin-bottom: 10px;
  }
  h1 .accent { font-style: italic; color: var(--red); font-weight: 400; }
  .subtitle { font-size: 13px; color: var(--muted); max-width: 70ch; line-height: 1.6; }
  .stat-grid {
    display: grid;
    grid-template-columns: 1.3fr 1fr;
    gap: 36px;
    align-items: center;
    padding: 24px 0;
    border-top: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
    flex: 1;
  }
  .big-stat .label { font-size: 11px; letter-spacing: 0.18em; color: var(--muted); margin-bottom: 8px; }
  .big-number {
    font-family: 'Fraunces', serif;
    font-size: clamp(5rem, 12vw, 9.5rem);
    font-weight: 900;
    line-height: 0.9;
    letter-spacing: -0.04em;
    color: var(--red);
  }
  .big-number sup { font-size: 0.35em; color: var(--ink); vertical-align: top; margin-left: 6px; font-weight: 400; }
  .big-description { margin-top: 14px; font-size: 13px; line-height: 1.6; color: var(--ink); max-width: 40ch; }
  .big-description strong { color: var(--accent); font-weight: 500; }
  .viz-label {
    font-size: 11px;
    letter-spacing: 0.15em;
    color: var(--muted);
    margin-bottom: 10px;
    display: flex;
    justify-content: space-between;
  }
  .car-grid {
    display: grid;
    grid-template-columns: repeat(10, 1fr);
    gap: 5px;
    max-width: 360px;
    margin: 0 auto;
  }
  .car {
    aspect-ratio: 1;
    background: rgba(220, 38, 38, 0.2);
    border: 1px solid rgba(220, 38, 38, 0.4);
    border-radius: 3px;
  }
  .car.electric {
    background: var(--accent);
    border-color: var(--accent);
    position: relative;
  }
  .car.electric::after {
    content: '⚡';
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    color: #0a0e1a;
    font-weight: 700;
  }
  .legend {
    display: flex;
    gap: 18px;
    margin-top: 12px;
    font-size: 11px;
    color: var(--muted);
    justify-content: center;
  }
  .legend-item { display: flex; align-items: center; gap: 6px; }
  .legend-swatch { width: 10px; height: 10px; border-radius: 2px; }
  .swatch-red { background: rgba(220, 38, 38, 0.45); border: 1px solid rgba(220, 38, 38, 0.65); }
  .swatch-electric { background: var(--accent); }
  .bottom-section { display: grid; grid-template-columns: 2fr 1.3fr; gap: 28px; }
  .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
  .metric { padding-top: 10px; border-top: 2px solid var(--red); }
  .metric .key { font-size: 10px; letter-spacing: 0.14em; color: var(--muted); margin-bottom: 6px; }
  .metric .val { font-family: 'Fraunces', serif; font-size: 1.7rem; font-weight: 700; color: var(--ink); line-height: 1; margin-bottom: 6px; }
  .metric .desc { font-size: 11px; color: var(--muted); line-height: 1.45; }
  .methodology { padding-top: 10px; border-top: 2px solid var(--line); }
  .methodology .h { font-size: 11px; letter-spacing: 0.16em; color: var(--red); margin-bottom: 6px; }
  .methodology .p { font-size: 12px; line-height: 1.6; color: var(--ink); }
  footer {
    padding-top: 14px;
    border-top: 1px solid var(--line);
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
    font-size: 11px;
    color: var(--muted);
  }
  .researchers .lbl { color: var(--red); margin-right: 10px; }
  .researchers .name { color: var(--ink); }
  .stamp { display: flex; align-items: center; gap: 10px; }
  .stamp .seal { border: 1px solid var(--red); padding: 4px 9px; color: var(--red); border-radius: 3px; }
  @media (max-width: 820px) {
    .container { padding: 16px 18px 24px; }
    .stat-grid, .bottom-section { grid-template-columns: 1fr; }
    .metrics { grid-template-columns: repeat(2, 1fr); }
  }
</style>
</head>
<body>
<div class="container">
  <div class="topbar">
    <div class="topbar-left">
      <a class="home-back" href="${escapeHtml(homeHref)}">fmert.me</a>
      <span><span class="dot"></span>${escapeHtml(t.field_data)} / Aksaray</span>
    </div>
    <span>${escapeHtml(t.report_number)}</span>
    <nav class="project-languages" aria-label="${escapeHtml(t.language_label)}">
      <a href="/projects/aksaray-kirmizi-araba/" hreflang="eo"${lang.key === 'eo' ? ' aria-current="page"' : ''}>EO</a>
      <a href="/en/projects/aksaray-kirmizi-araba/" hreflang="en"${lang.key === 'en' ? ' aria-current="page"' : ''}>EN</a>
      <a href="/tr/projects/aksaray-kirmizi-araba/" hreflang="tr"${lang.key === 'tr' ? ' aria-current="page"' : ''}>TR</a>
    </nav>
  </div>
  <header>
    <div class="study-id">${escapeHtml(t.study_id)}</div>
    <h1>${escapeHtml(t.heading_before)} <span class="accent">${escapeHtml(t.heading_accent)}</span> ${escapeHtml(t.heading_after)}</h1>
    <p class="subtitle">${escapeHtml(t.subtitle)}</p>
  </header>
  <section class="stat-grid">
    <div class="big-stat">
      <div class="label">${escapeHtml(t.key_finding)}</div>
      <div class="big-number">10<sup>%</sup></div>
      <p class="big-description">${escapeHtml(t.finding_before)} <strong>${escapeHtml(t.finding_strong)}</strong> ${escapeHtml(t.finding_after)}</p>
    </div>
    <div>
      <div class="viz-label">
        <span>n = 100 ${escapeHtml(t.units)}</span>
        <span>${escapeHtml(t.scale)} 1:1</span>
      </div>
      <div class="car-grid" id="carGrid"></div>
      <div class="legend">
        <div class="legend-item"><div class="legend-swatch swatch-red"></div><span>${escapeHtml(t.combustion)} (90)</span></div>
        <div class="legend-item"><div class="legend-swatch swatch-electric"></div><span>${escapeHtml(t.electric)} (10)</span></div>
      </div>
    </div>
  </section>
  <section class="bottom-section">
    <div class="metrics">
      <div class="metric"><div class="key">${escapeHtml(t.sample)}</div><div class="val">100</div><div class="desc">${escapeHtml(t.sample_description)}</div></div>
      <div class="metric"><div class="key">${escapeHtml(t.electric)}</div><div class="val">10</div><div class="desc">${escapeHtml(t.electric_description)}</div></div>
      <div class="metric"><div class="key">${escapeHtml(t.ratio)}</div><div class="val">0.10</div><div class="desc">${escapeHtml(t.ratio_description)}</div></div>
      <div class="metric"><div class="key">${escapeHtml(t.location)}</div><div class="val">68</div><div class="desc">${escapeHtml(t.location_description)}</div></div>
    </div>
    <div class="methodology">
      <div class="h">${escapeHtml(t.method)}</div>
      <div class="p">${escapeHtml(t.method_description)}</div>
    </div>
  </section>
  <footer>
    <div class="researchers">
      <span class="lbl">${escapeHtml(t.researchers)}</span>
      <span class="name">Furkan Mert Bağcı</span>, <span class="name">Ahmet Enes Kaymak</span>
    </div>
    <div class="stamp">Aksaray 2026 <span class="seal">${escapeHtml(t.verified)}</span></div>
  </footer>
</div>
<script>
  (function () {
    var grid = document.getElementById('carGrid');
    var electric = new Set([4, 17, 23, 38, 46, 52, 67, 74, 83, 95]);
    for (var i = 0; i < 100; i++) {
      var cell = document.createElement('div');
      cell.className = 'car' + (electric.has(i) ? ' electric' : '');
      grid.appendChild(cell);
    }
  })();
</script>
</body>
</html>`;
}
