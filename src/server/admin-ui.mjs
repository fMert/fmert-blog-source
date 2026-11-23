import { readFile } from 'node:fs/promises';
import { t } from './admin-static/admin-i18n.js';

const languages = ['eo', 'en', 'tr'];
const swatches = ['navy', 'forest', 'rust', 'slate', 'teal', 'charcoal'];
const browserMarkdown = new URL('./lib/marked.umd.js', import.meta.resolve('marked/package.json'));
const assetRoot = '/stories-admin/assets/';
const mime = new Map([
  ['admin.css', 'text/css; charset=utf-8'],
  ['admin.js', 'text/javascript; charset=utf-8'],
  ['admin-i18n.js', 'text/javascript; charset=utf-8']
]);

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
));

export function renderAdminPage({ authenticated, lang, loginError }) {
  lang = languages.includes(lang) ? lang : 'eo';
  const label = (key) => escapeHtml(t(lang, key));
  const text = (key, tag = 'span') => `<${tag} data-i18n="${key}">${label(key)}</${tag}>`;
  const aria = (key) => `data-i18n-aria-label="${key}" aria-label="${label(key)}"`;
  const button = (key, attributes = '') => `<button type="button" data-i18n="${key}" ${attributes}>${label(key)}</button>`;
  const options = (pairs) => pairs.map(([value, key]) => (
    `<option value="${value}" data-i18n="${key}">${label(key)}</option>`
  )).join('');

  function contentTabs(group) {
    return `<div class="tabs content-tabs" role="tablist" ${aria('contentLanguage')}>${languages.map((language, index) => `
      <button type="button" role="tab" id="${group}-tab-${language}" data-content-lang="${language}"
        aria-controls="${group}-lang-${language}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}">
        ${language.toUpperCase()}<span class="completion" aria-hidden="true"></span>
      </button>`).join('')}</div>`;
  }

  function languagePanel(group, language, fields) {
    return `<div class="fields" role="tabpanel" id="${group}-lang-${language}" aria-labelledby="${group}-tab-${language}"
      data-translation="${language}" lang="${language}" ${language === 'eo' ? '' : 'hidden'}>${fields}</div>`;
  }

  function storyField(name, key, limit, multiline = false) {
    return `<label class="field" ${name === 'link_label' ? 'data-story-types="link" hidden' : ''}>
      <span class="field-heading">${text(key)}<output class="counter">0 / ${limit}</output></span>
      ${multiline ? `<textarea name="${name}" rows="${name === 'text' ? 4 : 2}" data-limit="${limit}"></textarea>`
        : `<input name="${name}" data-limit="${limit}">`}
    </label>`;
  }

  const preferences = `<div class="preferences">
    <div class="language-switch" role="group" ${aria('language')}>${languages.map((language) => (
      `<button type="button" data-ui-lang="${language}" lang="${language}" aria-pressed="${lang === language}">${language.toUpperCase()}</button>`
    )).join('')}</div>
    <button type="button" id="theme-toggle" class="icon-button" ${aria('theme')} data-i18n-title="theme" title="${label('theme')}">
      <svg class="sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11 1.5 1.5M5 19l1.5-1.5m11-11L19 5"/></svg>
      <svg class="moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.9 13.4A9 9 0 0 1 10.6 3.1 9 9 0 1 0 20.9 13.4Z"/></svg>
    </button>
  </div>`;

  const login = `<main class="login">
    <div class="card login-card">
      <div class="login-header"><span class="wordmark">fmert.me Studio</span>${preferences}</div>
      <h1 data-i18n="signIn">${label('signIn')}</h1>
      ${loginError ? `<p class="notice error" role="alert">${text('loginError')}</p>` : ''}
      <form class="fields" action="/stories-login" method="post">
        <label class="field">${text('password')}<input type="password" name="password" autocomplete="current-password" required></label>
        <button class="primary" data-i18n="signIn">${label('signIn')}</button>
      </form>
      <a class="back-link" href="/" data-i18n="back">${label('back')}</a>
    </div>
  </main>`;

  const studio = `<header class="top-bar"><div class="top-inner">
    <a class="wordmark" href="/">fmert.me <span>Studio</span></a>
    <nav class="tabs studio-tabs" role="tablist" ${aria('studioTabs')}>
      ${['stories', 'posts', 'analytics'].map((key, index) => button(key,
        `id="tab-${key}" role="tab" aria-controls="${key}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}"`)).join('')}
    </nav>
    <div class="top-actions">${preferences}
      <form action="/stories-logout" method="post"><button data-i18n="signOut">${label('signOut')}</button></form>
    </div>
  </div></header>
  <main class="workspace">
    ${text('studio', 'h1')}
    <div id="session-expired" class="notice error" role="alert" hidden>
      ${text('sessionExpired')} <a href="/stories-admin" target="_blank" rel="noopener" data-i18n="signInAgain">${label('signInAgain')}</a>
    </div>
    <section id="stories" role="tabpanel" aria-labelledby="tab-stories">
      <div class="story-workspace">
        <form id="story-form" class="card fields" action="/stories-api" method="post">
          <h2 id="story-heading" data-i18n="newStory">${label('newStory')}</h2>
          <div id="story-editing" class="section-heading notice" hidden>
            ${text('editingStory', 'h2')}${button('cancel', 'id="cancel-story"')}
          </div>
          <label class="field">${text('storyType')}<select name="type">${options([['text', 'text'], ['image', 'image'], ['link', 'link']])}</select></label>
          <fieldset class="fields" data-story-types="text link">
            <legend>${text('background')}</legend>
            <div class="swatches">${swatches.map((name) => `
              <button type="button" data-swatch="${name}" ${aria(name)} data-i18n-title="${name}"
                title="${label(name)}" aria-pressed="false"></button>`).join('')}</div>
            <label class="field">${text('customBackground')}<input name="bg" class="mono"></label>
          </fieldset>
          <label class="dropzone" data-story-types="image" hidden>
            ${text('dropPhoto')}<input type="file" name="image" accept="image/jpeg,image/png,image/gif,image/webp">
            <span id="photo-name" class="muted" hidden></span>
          </label>
          <label class="field" data-story-types="link" hidden>${text('linkUrl')}<input name="link" inputmode="url"></label>
          ${contentTabs('story')}
          ${languages.map((language) => languagePanel('story', language, [
            storyField('title', 'storyTitle', 120),
            storyField('text', 'storyText', 1000, true),
            storyField('subtext', 'storySubtext', 1000, true),
            storyField('link_label', 'linkLabel', 80)
          ].join(''))).join('')}
          <p class="muted help" data-i18n="storyLanguages">${label('storyLanguages')}</p>
          <div class="action-bar"><button class="primary" data-i18n="saveStory">${label('saveStory')}</button>
            <div id="story-feedback" class="feedback" role="status"></div>
          </div>
        </form>
        <div class="fields">
          <section class="card preview-card">
            <h2 data-i18n="preview">${label('preview')}</h2>
            <div id="story-preview" class="story-canvas">
              <img id="story-preview-image" alt="" hidden>
              <div class="canvas-content">
                <h3 id="story-preview-title" hidden></h3>
                <p id="story-preview-text"></p>
                <p id="story-preview-subtext" class="canvas-subtext" hidden></p>
                <a id="story-preview-link" target="_blank" rel="noopener" hidden></a>
              </div>
            </div>
          </section>
          <section class="card" id="existing-stories">
            <h2 data-i18n="existingStories">${label('existingStories')}</h2>
            <div id="story-list" class="item-list" aria-live="polite"></div>
          </section>
        </div>
      </div>
    </section>
    <section id="posts" role="tabpanel" aria-labelledby="tab-posts" hidden>
      <div class="posts-workspace">
        <aside class="card fields">
          <div class="section-heading"><h2 data-i18n="posts">${label('posts')}</h2>
            ${button('newPost', 'id="new-post" class="primary"')}</div>
          <select id="post-filter" ${aria('filterPosts')}>${options([['all', 'all'], ['published', 'published'], ['draft', 'drafts']])}</select>
          <div id="post-list" class="item-list" aria-live="polite"></div>
        </aside>
        <form id="post-form" class="card fields" action="/stories-api/posts" method="post" novalidate>
          <h2 id="post-heading" data-i18n="newPost">${label('newPost')}</h2>
          ${contentTabs('post')}
          ${languages.map((language) => languagePanel('post', language,
            `<label class="field">${text('title')}<input name="title"></label>`)).join('')}
          <div class="section-heading editor-heading">
            <div class="tabs editor-tabs" role="group" ${aria('editorMode')}>
              ${button('write', 'data-editor-mode="write" aria-pressed="true"')}${button('preview', 'data-editor-mode="preview" aria-pressed="false"')}
            </div>
            <div id="markdown-tools" class="toolbar" role="group" ${aria('formatting')}>
              ${['bold', 'italic', 'heading', 'formatLink', 'code', 'quote', 'list'].map((key) => button(key, `data-format="${key}"`)).join('')}
              ${button('uploadImage', 'id="upload-image"')}
              <input type="file" id="post-image" accept="image/jpeg,image/png,image/gif,image/webp" hidden>
            </div>
          </div>
          <label id="markdown-edit" class="field">${text('markdown')}<textarea id="post-markdown" class="mono" rows="17" lang="eo"></textarea></label>
          <div class="markdown-preview prose" id="post-preview" lang="eo" hidden></div>
          <details class="metadata">
            <summary>${text('metadata')}</summary>
            <div class="metadata-fields fields">
              <label class="field">${text('slug')}<input name="slug" class="mono" spellcheck="false"></label>
              <label class="field">${text('date')}<input name="date" type="datetime-local" step="1"></label>
              <label class="checkbox"><input type="checkbox" name="pin">${text('pin')}</label>
              <label class="field">${text('category')}<input name="category"></label>
              <label class="field">${text('tags')}<input name="tags"></label>
            </div>
          </details>
          <div class="action-bar">
            <button name="status" value="draft" data-i18n="saveDraft">${label('saveDraft')}</button>
            <button name="status" value="published" class="primary" data-i18n="publish">${label('publish')}</button>
            <div id="post-feedback" class="feedback" role="status"></div>
          </div>
        </form>
      </div>
    </section>
    <section id="analytics" class="fields" role="tabpanel" aria-labelledby="tab-analytics" hidden>
      <div id="analytics-feedback" class="feedback" role="status" hidden></div>
      <div id="analytics-content" class="fields" hidden>
        <dl class="kpis">${['pageViews', 'uniqueIPs', 'todayViews', 'totalLikes'].map((key) => (
          `<div class="card"><dt data-i18n="${key}">${label(key)}</dt><dd data-kpi="${key}"></dd></div>`
        )).join('')}</dl>
        <section class="card"><h2 data-i18n="dailyViews">${label('dailyViews')}</h2><div id="daily-chart"></div></section>
        <div class="analytics-breakdowns">
          <section class="card"><h2 data-i18n="topPages">${label('topPages')}</h2><dl class="breakdown" id="top-pages"></dl></section>
          <section class="card"><h2 data-i18n="referrers">${label('referrers')}</h2><dl class="breakdown" id="referrers"></dl></section>
        </div>
        <section class="card"><h2 data-i18n="devicesBrowsers">${label('devicesBrowsers')}</h2>
          <div class="analytics-breakdowns">
            <div><h3 data-i18n="devices">${label('devices')}</h3><dl class="breakdown" id="devices"></dl></div>
            <div><h3 data-i18n="browsers">${label('browsers')}</h3><dl class="breakdown" id="browsers"></dl></div>
          </div>
        </section>
        <section class="card"><h2 id="recent-visits-heading" data-i18n="recentVisits">${label('recentVisits')}</h2><div class="table-scroll" id="recent-visits"></div></section>
        <section class="card"><h2 id="recent-likes-heading" data-i18n="likes">${label('likes')}</h2><div class="table-scroll" id="recent-likes"></div></section>
      </div>
    </section>
  </main>`;

  return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title data-i18n="studio">${label('studio')}</title>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&amp;family=JetBrains+Mono:wght@400;500&amp;family=Source+Serif+4:wght@400;600;700&amp;display=swap">
  <link rel="stylesheet" href="${assetRoot}admin.css">
  <script type="module" src="${assetRoot}admin-i18n.js"></script>
  <script type="module" src="${assetRoot}admin.js"></script>
</head>
<body>${authenticated ? studio : login}</body>
</html>`;
}

export async function serveAdminStatic(req, res, filename) {
  if (!mime.has(filename)) {
    res.writeHead(404).end();
    return;
  }
  let source = await readFile(new URL(`./admin-static/${filename}`, import.meta.url));
  if (filename === 'admin.js') {
    const parser = await readFile(browserMarkdown, 'utf8');
    source = Buffer.concat([Buffer.from(parser.replace(/\/\/# sourceMappingURL=.*$/, '')), Buffer.from('\n'), source]);
  }
  const headers = { 'Content-Type': mime.get(filename), 'Cache-Control': 'no-cache' };
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : source);
}
