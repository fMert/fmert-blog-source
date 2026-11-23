import { t, applyI18n } from './admin-i18n.js';

const languages = ['eo', 'en', 'tr'];
const root = document.documentElement;
const byId = (id) => document.getElementById(id);
const query = (selector, scope = document) => scope.querySelector(selector);
const all = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const preference = new URLSearchParams(location.search).get('lang');

function stored(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function remember(key, value) {
  try { localStorage.setItem(key, value); } catch { /* Storage can be disabled. */ }
}

let uiLanguage = [preference, stored('fmert-admin-lang'), root.lang].find(value => languages.includes(value)) ?? 'eo';
const tr = (key, vars) => t(uiLanguage, key, vars);
const systemTheme = matchMedia('(prefers-color-scheme: dark)');

function syncTheme() {
  const saved = stored('fmert-theme');
  if (saved === 'light' || saved === 'dark') root.dataset.mode = saved;
  else delete root.dataset.mode;
}

syncTheme();
window.addEventListener('storage', (event) => {
  if (event.key === 'fmert-theme' || event.key === null) syncTheme();
});
byId('theme-toggle').addEventListener('click', () => {
  const active = root.dataset.mode ?? (systemTheme.matches ? 'dark' : 'light');
  root.dataset.mode = active === 'light' ? 'dark' : 'light';
  remember('fmert-theme', root.dataset.mode);
});

const languageListeners = [];
function switchLanguage(lang) {
  uiLanguage = lang;
  root.lang = lang;
  remember('fmert-admin-lang', lang);
  applyI18n(lang);
  for (const button of all('[data-ui-lang]')) button.setAttribute('aria-pressed', button.dataset.uiLang === lang);
  for (const listener of languageListeners) listener();
}

for (const button of all('[data-ui-lang]')) {
  button.addEventListener('click', () => {
    const url = new URL(location.href);
    if (url.searchParams.has('lang')) {
      url.searchParams.delete('lang');
      history.replaceState(null, '', url);
    }
    switchLanguage(button.dataset.uiLang);
  });
}
switchLanguage(uiLanguage);

function el(tag, content, className) {
  const element = document.createElement(tag);
  if (content != null) element.textContent = content;
  if (className) element.className = className;
  return element;
}

function safeUrl(value) {
  if (!value) return '';
  try {
    const parsed = new URL(value, location.href);
    return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : '';
  } catch { return ''; }
}

function link(text, url) {
  const safe = safeUrl(url);
  if (!safe) return el('span', text);
  const anchor = el('a', text);
  anchor.href = safe;
  anchor.target = '_blank';
  anchor.rel = 'noopener';
  return anchor;
}

function labeled(element, key) {
  element.dataset.i18n = key;
  element.textContent = tr(key);
  return element;
}

function action(key, callback, className) {
  const button = labeled(el('button', null, className), key);
  button.type = 'button';
  button.addEventListener('click', callback);
  return button;
}

function tabset(tablist, change, initial) {
  const buttons = all('[role="tab"]', tablist);
  function select(button) {
    for (const item of buttons) {
      const active = item === button;
      item.setAttribute('aria-selected', active);
      item.tabIndex = active ? 0 : -1;
      byId(item.getAttribute('aria-controls')).hidden = !active;
    }
    change(button);
  }
  buttons.forEach((button, index) => {
    button.addEventListener('click', () => select(button));
    button.addEventListener('keydown', (event) => {
      const target = {
        ArrowLeft: buttons.at(index - 1),
        ArrowRight: buttons[(index + 1) % buttons.length],
        Home: buttons[0],
        End: buttons.at(-1)
      }[event.key];
      if (!target) return;
      event.preventDefault();
      target.focus();
      select(target);
    });
  });
  if (initial) select(initial);
  return select;
}

const expired = byId('session-expired');
async function request(path, body) {
  const init = { cache: 'no-store' };
  if (body !== undefined) {
    init.method = 'POST';
    if (body instanceof FormData) init.body = body;
    else {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
  }
  const response = await fetch('/stories-api' + path, init);
  if (response.status === 401) {
    expired.hidden = false;
    throw Object.assign(new Error(tr('sessionExpired')), { status: 401 });
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || result == null || result.ok === false) {
    throw new Error(result?.error?.message ?? result?.error ?? result?.message ?? tr('requestFailed'));
  }
  expired.hidden = true;
  return result;
}

function feedback(id) {
  const region = byId(id);
  let state = {};
  function render() {
    const { key, kind, vars, urls, message } = state;
    region.classList.toggle('error', kind === 'error');
    region.classList.toggle('success', kind === 'success');
    region.textContent = key ? tr(key, vars) : (message ?? '');
    for (const language of languages) {
      if (urls?.[language]) region.append(' ', link(language.toUpperCase(), urls[language]));
    }
    region.hidden = !region.textContent;
  }
  languageListeners.push(render);
  return (key, kind, vars, urls, message) => {
    state = { key, kind, vars, urls, message };
    render();
  };
}

function errorFeedback(show, error) {
  if (error.status === 401) show();
  else show(null, 'error', null, null, error.message);
}

function holdControls(form) {
  const controls = [...form.elements].filter(control => control.matches(':enabled') && 'disabled' in control);
  for (const control of controls) control.disabled = true;
  return () => { for (const control of controls) control.disabled = false; };
}

function localized(entries, language) {
  return [entries[language], ...languages.map(code => entries[code])].find(entry => entry?.text?.trim()) ?? {};
}

function languageBadges(codes) {
  return languages.filter(code => codes.includes(code)).map(code => el('span', code.toUpperCase(), 'pill'));
}

function setCompletion(button, complete) {
  button.toggleAttribute('data-complete', complete);
  button.setAttribute('aria-description', tr(complete ? 'translationPresent' : 'translationMissing'));
}

function pill(key, positive = false) {
  return labeled(el('span', null, positive ? 'pill success' : 'pill'), key);
}

function rowActions(edit, remove, show, isBusy) {
  const actions = el('div', null, 'item-actions');
  const editButton = action('edit', edit);
  const open = action('delete', () => {
    confirmation.hidden = false;
    open.hidden = true;
    cancel.focus();
  }, 'danger');
  const confirmation = el('div', null, 'confirmation');
  confirmation.hidden = true;
  const cancel = action('cancel', () => {
    confirmation.hidden = true;
    open.hidden = false;
    open.focus();
  });
  const confirm = action('delete', async () => {
    if (isBusy()) return;
    confirm.disabled = true;
    cancel.disabled = true;
    try { await remove(); }
    catch (error) { errorFeedback(show, error); }
    finally { confirm.disabled = false; cancel.disabled = false; }
  }, 'danger');
  confirmation.append(labeled(el('span'), 'confirmDelete'), confirm, cancel);
  actions.append(editButton, open, confirmation);
  return actions;
}

function dayLabel(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(+date)) return value || '—';
  return new Intl.DateTimeFormat(uiLanguage, { dateStyle: 'medium', timeZone: 'Etc/GMT-3' }).format(date);
}

function countLabel(value) {
  return new Intl.NumberFormat(uiLanguage).format(value);
}

function initStories() {
  const form = byId('story-form');
  const list = byId('story-list');
  const field = (name) => form.elements.namedItem(name);
  const show = feedback('story-feedback');
  const translationFields = ['title', 'text', 'subtext', 'link_label'];
  const photo = field('image');
  const dropzone = photo.closest('label');
  const translations = Object.fromEntries(all('[data-translation]', form).map(panel => [panel.dataset.translation, panel]));
  const translation = (language) => Object.fromEntries(translationFields.map(name => [
    name, query(`[name="${name}"]`, translations[language])
  ]));
  const canvas = byId('story-preview');
  const previewImage = byId('story-preview-image');
  const previewLink = byId('story-preview-link');
  let language = 'eo';
  let original = null;
  let file = null;
  let blob = '';
  let stories = [];
  let likesByStory = new Map();
  let busy = false;
  let loaded = false;

  function values() {
    const isLink = field('type').value === 'link';
    return Object.fromEntries(languages.map(code => [code, Object.fromEntries(
      Object.entries(translation(code)).map(([name, input]) => [
        name, name === 'link_label' && !isLink ? '' : input.value.trim()
      ])
    )]));
  }

  function storyEntries(story) {
    const entries = story.translations;
    return entries ? { ...entries, eo: entries.eo ?? story } : { tr: story };
  }

  function photoUrl(story) {
    const href = safeUrl(story?.image);
    if (!href || !story.updated) return href;
    const url = new URL(href);
    url.searchParams.set('v', story.updated);
    return url.href;
  }

  function storyLink(value) {
    if (/[\u0000-\u0020\\]/.test(value) || !/^(?:https?:\/\/|\/(?!\/))/i.test(value)) return '';
    return safeUrl(value);
  }

  function storyPreview() {
    const type = field('type').value;
    const entries = values();
    const sample = localized(entries, language);
    canvas.style.background = type === 'image' ? '' : field('bg').value.trim();
    const src = type === 'image' ? blob || photoUrl(original) : '';
    previewImage.hidden = !src;
    if (src && previewImage.getAttribute('src') !== src) previewImage.src = src;
    if (!src) previewImage.removeAttribute('src');
    for (const [id, value] of [
      ['story-preview-title', sample.title],
      ['story-preview-text', sample.text || tr('previewStoryText')],
      ['story-preview-subtext', sample.subtext]
    ]) {
      const element = byId(id);
      element.textContent = value ?? '';
      element.hidden = !value;
    }
    const href = type === 'link' ? storyLink(field('link').value.trim()) : '';
    previewLink.hidden = !href;
    if (href) previewLink.href = href;
    else previewLink.removeAttribute('href');
    previewLink.textContent = sample.link_label || tr('openArticle');
    for (const [code, entry] of Object.entries(entries)) {
      setCompletion(byId('story-tab-' + code), Boolean(entry.text));
    }
  }

  const selectLanguage = tabset(query('[role="tablist"]', form), (button) => {
    language = button.dataset.contentLang;
    storyPreview();
  });

  function updateStoryType() {
    for (const section of all('[data-story-types]', form)) {
      const enabled = section.dataset.storyTypes.split(' ').includes(field('type').value);
      section.hidden = !enabled;
      for (const input of all('input, button', section)) input.disabled = !enabled;
    }
  }

  function updateCounters() {
    for (const input of all('[data-limit]', form)) {
      const count = Array.from(input.value).length;
      const output = query('output', input.closest('label'));
      output.value = `${count} / ${input.dataset.limit}`;
      output.toggleAttribute('data-over', count > Number(input.dataset.limit));
    }
  }

  function setPhoto(value) {
    if (blob) URL.revokeObjectURL(blob);
    file = value;
    blob = file ? URL.createObjectURL(file) : '';
    const name = byId('photo-name');
    name.textContent = file?.name ?? '';
    name.hidden = !file;
    storyPreview();
  }

  function selectStory(story = null) {
    if (busy) return;
    original = story;
    form.reset();
    setPhoto(null);
    field('type').value = story?.type ?? 'text';
    field('bg').value = story?.bg ?? '';
    field('link').value = story?.link ?? '';
    const entries = story ? storyEntries(story) : {};
    for (const code of languages) {
      for (const [name, input] of Object.entries(translation(code))) input.value = entries[code]?.[name] ?? '';
    }
    byId('story-editing').hidden = !story;
    byId('story-heading').hidden = Boolean(story);
    updateStoryType();
    updateCounters();
    updateSwatches();
    selectLanguage(byId('story-tab-' + (languages.find(code => entries[code]?.text) ?? uiLanguage)));
    show();
    if (story) {
      field('type').focus();
      form.scrollIntoView({ block: 'nearest' });
    }
  }

  const swatchButtons = all('[data-swatch]', form);
  const swatchColor = button => getComputedStyle(button).backgroundColor;
  function updateSwatches() {
    const style = document.createElement('span').style;
    style.backgroundColor = field('bg').value.trim();
    for (const button of swatchButtons) button.setAttribute('aria-pressed', swatchColor(button) === style.backgroundColor);
  }
  for (const button of swatchButtons) {
    button.addEventListener('click', () => {
      field('bg').value = swatchColor(button);
      updateSwatches();
      storyPreview();
    });
  }

  form.addEventListener('input', () => {
    updateStoryType();
    updateCounters();
    updateSwatches();
    storyPreview();
  });
  byId('cancel-story').addEventListener('click', () => selectStory());
  photo.addEventListener('change', () => setPhoto(photo.files[0] ?? null));
  dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropzone.dataset.dragging = '';
  });
  dropzone.addEventListener('dragleave', () => delete dropzone.dataset.dragging);
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    delete dropzone.dataset.dragging;
    if (busy || !event.dataTransfer.files.length) return;
    photo.value = '';
    setPhoto(event.dataTransfer.files[0]);
  });

  function renderList() {
    if (!loaded) return;
    list.replaceChildren();
    for (const story of stories) {
      const entries = storyEntries(story);
      const sample = localized(entries, uiLanguage);
      const row = el('article', null, 'item-row story-row');
      const thumb = el('span', null, 'story-thumb');
      const src = photoUrl(story);
      if (src) {
        const img = el('img');
        img.alt = '';
        img.src = src;
        img.loading = 'lazy';
        thumb.append(img);
      } else thumb.style.background = story.bg ?? '';
      const body = el('div');
      const title = el('strong', sample.title || sample.text || story.text, 'item-title');
      title.title = title.textContent;
      const meta = el('div', null, 'item-meta');
      const active = Date.now() - Date.parse(story.posted) < 86_400_000;
      meta.append(pill(active ? 'active' : 'archived', active),
        ...languageBadges(languages.filter(code => entries[code]?.text?.trim())),
        el('span', tr('likesCount', { count: countLabel(story.likeCount ?? story.likes ?? likesByStory.get(story.id) ?? 0) }), 'muted'));
      body.append(title, meta, rowActions(() => selectStory(story), async () => {
        busy = true;
        try {
          await request('/delete', { id: story.id });
          stories = stories.filter(item => item.id !== story.id);
          busy = false;
          if (original?.id === story.id) selectStory();
          renderList();
        } finally { busy = false; }
      }, show, () => busy));
      row.append(thumb, body);
      list.append(row);
    }
    if (!stories.length) list.append(labeled(el('p', null, 'muted'), 'noStories'));
  }

  async function load() {
    try {
      list.replaceChildren(labeled(el('p', null, 'muted'), 'loading'));
      const result = await request('/admin/stories');
      stories = result.stories ?? result;
      loaded = true;
      renderList();
      return true;
    } catch (error) {
      list.replaceChildren();
      errorFeedback(show, error);
      return false;
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const translations = values();
    const type = field('type').value;
    const bg = type === 'image' ? '' : field('bg').value.trim();
    const link = type === 'link' ? field('link').value.trim() : '';
    if (!languages.some(code => translations[code].text)) return show('storyTextRequired', 'error');
    for (const code of languages) {
      const over = Object.entries(translation(code)).find(([name, input]) =>
        Array.from(translations[code][name]).length > Number(input.dataset.limit));
      if (over) {
        selectLanguage(byId('story-tab-' + code));
        over[1].focus();
        return show('lengthExceeded', 'error', { language: code.toUpperCase() });
      }
    }
    if (type === 'image' && !file && !original?.image) return show('photoRequired', 'error');
    if (type === 'link' && !storyLink(link)) return show('invalidLink', 'error');

    let data = { id: original?.id, type, bg, link, translations };
    if (type === 'image' && file) {
      const multipart = new FormData();
      for (const [key, value] of Object.entries(data)) {
        if (value != null) multipart.append(key, key === 'translations' ? JSON.stringify(value) : value);
      }
      multipart.append('image', file);
      data = multipart;
    }

    busy = true;
    const release = holdControls(form);
    let saved = false;
    show('saving');
    try {
      const { story } = await request('', data);
      const prior = stories.find(item => item.id === story.id);
      const entries = story.translations ?? translations;
      stories = [{
        likeCount: prior?.likeCount ?? prior?.likes, ...story,
        translations: { ...entries, eo: entries.eo ?? translations.eo }
      }, ...stories.filter(item => item.id !== story.id)]
        .sort((left, right) => right.posted.localeCompare(left.posted));
      loaded = saved = true;
    } catch (error) {
      errorFeedback(show, error);
    } finally {
      busy = false;
      release();
      if (saved) {
        selectStory();
        renderList();
        show('storySaved', 'success');
      }
    }
  });

  selectStory();
  languageListeners.push(() => { storyPreview(); renderList(); });
  return {
    load,
    updateLikes(summary) {
      likesByStory = new Map();
      for (const { kind, id } of summary.likes.items) {
        if (kind === 'story') likesByStory.set(id, (likesByStory.get(id) ?? 0) + 1);
      }
      renderList();
    }
  };
}

function initPosts() {
  const form = byId('post-form');
  const editor = byId('post-markdown');
  const preview = byId('post-preview');
  const imageButton = byId('upload-image');
  const imagePicker = byId('post-image');
  const list = byId('post-list');
  const filter = byId('post-filter');
  const field = name => form.elements.namedItem(name);
  const titleInput = code => query('input[name="title"]', byId('post-lang-' + code));
  const show = feedback('post-feedback');
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const markdown = new window.marked.Marked({ gfm: true });
  markdown.use({
    renderer: {
      html({ text }) {
        return escape(text);
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const url = safeUrl(href);
        return url ? `<a href="${escape(url)}" title="${escape(title)}" target="_blank" rel="noopener">${text}</a>` : text;
      },
      image({ href, title, text }) {
        const url = safeUrl(href);
        return url ? `<img src="${escape(url)}" alt="${escape(text)}" title="${escape(title)}" loading="lazy">` : escape(text);
      }
    }
  });
  let post;
  let language = 'eo';
  let mode = 'write';
  let posts = [];
  let loaded = false;
  let busy = false;
  let metadataId = 0;
  let metadataTimer;
  let imageSelection;

  function renderPreview() {
    if (mode !== 'preview') return;
    const entry = post.translations[language];
    preview.replaceChildren();
    if (entry.title) preview.append(el('h1', entry.title));
    if (entry.body.trim()) {
      const prose = el('div');
      prose.innerHTML = markdown.parse(entry.body);
      preview.append(prose);
    } else preview.append(labeled(el('p', null, 'muted'), 'previewPostText'));
  }

  function renderLanguage() {
    const entry = post.translations[language];
    editor.value = entry.body;
    editor.lang = preview.lang = language;
    field('category').value = entry.category;
    field('tags').value = entry.tags;
    renderPreview();
  }

  const selectLanguage = tabset(query('[role="tablist"]', form), (button) => {
    language = button.dataset.contentLang;
    renderLanguage();
  });

  function completion() {
    for (const code of languages) {
      const entry = post.translations[code];
      setCompletion(byId('post-tab-' + code), Boolean(entry.title.trim() && entry.body.trim()));
    }
  }

  function setMode(next) {
    mode = next;
    for (const button of all('[data-editor-mode]', form)) button.setAttribute('aria-pressed', button.dataset.editorMode === mode);
    byId('markdown-edit').hidden = byId('markdown-tools').hidden = mode !== 'write';
    preview.hidden = mode !== 'preview';
    renderPreview();
  }

  for (const button of all('[data-editor-mode]', form)) {
    button.addEventListener('click', () => setMode(button.dataset.editorMode));
  }

  function updateHeading() {
    labeled(byId('post-heading'), post.originalSlug ? 'editingPost' : 'newPost');
    labeled(query('button[value="published"]', form), post.status === 'published' ? 'updatePublished' : 'publish');
  }

  function localPublishDate(value) {
    if (!value) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value + 'T00:00';
    const time = Date.parse(value);
    return Number.isFinite(time) ? new Date(time + 3 * 3_600_000).toISOString().slice(0, 23) : '';
  }

  function selectPost(value = {}) {
    ++metadataId;
    clearTimeout(metadataTimer);
    form.reset();
    field('slug').value = value.slug ?? '';
    field('date').value = localPublishDate(value.date);
    field('pin').checked = Boolean(value.pin);
    post = {
      originalSlug: value.slug ?? '',
      status: value.status ?? 'draft',
      date: value.date ?? '',
      dateInput: field('date').value,
      slugTouched: Boolean(value.slug),
      translations: Object.fromEntries(languages.map(code => {
        const item = value.translations?.[code];
        const entry = {
          title: item?.title ?? '', body: item?.body ?? '',
          category: item?.categories?.join(', ') || item?.category || '',
          tags: item?.tags?.join(', ') ?? '',
          categoryTouched: Boolean(item?.categories?.length || item?.category),
          tagsTouched: Array.isArray(item?.tags)
        };
        titleInput(code).value = entry.title;
        return [code, entry];
      }))
    };
    updateHeading();
    selectLanguage(byId('post-tab-' + (post.translations[uiLanguage].title ? uiLanguage
      : languages.find(code => post.translations[code].title) ?? uiLanguage)));
    completion();
    setMode('write');
    show();
  }

  function scheduleMetadata() {
    const id = ++metadataId;
    clearTimeout(metadataTimer);
    const input = Object.fromEntries(languages.map(code => {
      const { title, body } = post.translations[code];
      return [code, { title, body }];
    }));
    if (!Object.values(input).some(entry => entry.title.trim() || entry.body.trim())) return;
    metadataTimer = setTimeout(async () => {
      try {
        const result = await request('/posts/metadata', input);
        if (id !== metadataId) return;
        const suggestions = result.metadata ?? result;
        if (!post.slugTouched) field('slug').value = suggestions.slug ?? '';
        for (const code of languages) {
          const entry = post.translations[code];
          if (!entry.categoryTouched) entry.category = suggestions.category?.[code] ?? '';
          if (!entry.tagsTouched) entry.tags = suggestions.tags?.[code]?.join(', ') ?? '';
        }
        field('category').value = post.translations[language].category;
        field('tags').value = post.translations[language].tags;
      } catch (error) {
        if (id === metadataId && !expired.hidden) show();
      }
    }, 280);
  }

  function editorChanged() {
    post.translations[language].body = editor.value;
    completion();
    renderPreview();
    scheduleMetadata();
  }

  editor.addEventListener('input', editorChanged);
  for (const code of languages) {
    titleInput(code).addEventListener('input', () => {
      post.translations[code].title = titleInput(code).value;
      completion();
      renderPreview();
      scheduleMetadata();
    });
  }
  field('slug').addEventListener('input', () => {
    post.slugTouched = true;
  });
  for (const name of ['category', 'tags']) {
    field(name).addEventListener('input', () => {
      post.translations[language][name] = field(name).value;
      post.translations[language][name + 'Touched'] = true;
    });
  }

  const formats = {
    bold: text => '**' + text + '**',
    italic: text => '*' + text + '*',
    heading: text => '## ' + text,
    formatLink: text => '[' + text + '](https://)',
    code: text => '\x60\x60\x60\n' + text + '\n\x60\x60\x60',
    quote: text => '> ' + text.replaceAll('\n', '\n> '),
    list: text => '- ' + text.replaceAll('\n', '\n- ')
  };
  for (const button of all('[data-format]', form)) {
    button.addEventListener('click', () => {
      const { value, selectionStart, selectionEnd } = editor;
      let inserted = formats[button.dataset.format](value.slice(selectionStart, selectionEnd));
      if (['heading', 'code', 'quote', 'list'].includes(button.dataset.format)) {
        if (selectionStart > 0 && value[selectionStart - 1] !== '\n') inserted = '\n' + inserted;
        if (selectionEnd < value.length && value[selectionEnd] !== '\n') inserted += '\n';
      }
      editor.setRangeText(inserted, selectionStart, selectionEnd, 'end');
      editor.focus();
      editorChanged();
    });
  }

  function lockEditor() {
    busy = true;
    const release = holdControls(form);
    return () => {
      busy = false;
      release();
    };
  }

  imageButton.addEventListener('click', () => {
    imageSelection = [editor.selectionStart, editor.selectionEnd];
    imagePicker.click();
  });
  imagePicker.addEventListener('change', async () => {
    const file = imagePicker.files[0];
    imagePicker.value = '';
    if (!file || busy) return;
    const data = new FormData();
    data.append('file', file);
    const unlock = lockEditor();
    show('uploading');
    try {
      const { url } = await request('/media', data);
      if (!safeUrl(url)) throw new Error(tr('requestFailed'));
      const alt = file.name.replace(/\.[^.]+$/, '').replace(/[\\[\]]/g, '\\$&');
      const destination = url.replace(/[()\s]/g, char => char === '(' ? '%28' : char === ')' ? '%29' : '%20');
      editor.setRangeText(`![${alt}](${destination})`, ...imageSelection, 'end');
      editorChanged();
      show();
    } catch (error) {
      errorFeedback(show, error);
    } finally {
      unlock();
      editor.focus();
    }
  });

  function renderList() {
    if (!loaded) return;
    list.replaceChildren();
    for (const item of posts) {
      if (filter.value !== 'all' && filter.value !== item.status) continue;
      const row = el('article', null, 'item-row');
      const title = item.titles?.[uiLanguage] ?? Object.values(item.titles ?? {})[0] ?? item.slug;
      row.append(el('strong', title, 'item-title'));
      const meta = el('div', null, 'item-meta');
      const date = el('time', dayLabel(item.date), 'muted');
      if (item.date) date.dateTime = item.date;
      meta.append(pill(item.status === 'published' ? 'published' : 'draft', item.status === 'published'),
        ...languageBadges(item.languages ?? []), date);
      const actions = rowActions(async () => {
        if (busy) return;
        const unlock = lockEditor();
        show('loading');
        try {
          const result = await request('/posts/' + encodeURIComponent(item.slug));
          selectPost(result.post ?? result);
          form.scrollIntoView({ block: 'nearest' });
        } catch (error) { errorFeedback(show, error); }
        finally { unlock(); }
      }, async () => {
        const unlock = lockEditor();
        try {
          await request('/posts/delete', { slug: item.slug });
          posts = posts.filter(other => other.slug !== item.slug);
          if (post.originalSlug === item.slug) selectPost();
          renderList();
        } finally { unlock(); }
      }, show, () => busy);
      row.append(meta, actions);
      list.append(row);
    }
    if (!list.childElementCount) list.append(labeled(el('p', null, 'muted'), 'noPosts'));
  }

  async function load() {
    try {
      list.replaceChildren(labeled(el('p', null, 'muted'), 'loading'));
      const result = await request('/posts');
      posts = result.posts ?? result;
      loaded = true;
      renderList();
      return true;
    } catch (error) {
      if (!loaded) list.replaceChildren();
      errorFeedback(show, error);
      return false;
    }
  }

  filter.addEventListener('change', renderList);
  byId('new-post').addEventListener('click', () => {
    if (busy) return;
    selectPost();
    titleInput(language).focus();
    form.scrollIntoView({ block: 'nearest' });
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const status = event.submitter?.value ?? 'draft';
    const originalSlug = post.originalSlug;
    const data = {
      slug: post.slugTouched ? field('slug').value.trim() : '', originalSlug, status,
      date: post.dateInput === field('date').value ? post.date : field('date').value,
      pin: field('pin').checked,
      translations: Object.fromEntries(languages.map(code => {
        const { title, body, category, tags, categoryTouched, tagsTouched } = post.translations[code];
        return [code, {
          title, body,
          ...(categoryTouched ? { category } : {}),
          ...(tagsTouched ? { tags: tags.split(',').map(value => value.trim()).filter(Boolean) } : {})
        }];
      }))
    };
    ++metadataId;
    clearTimeout(metadataTimer);
    const unlock = lockEditor();
    show('saving');
    try {
      const started = performance.now();
      const result = await request('/posts', data);
      const { post: saved, urls } = result;
      const ms = result.buildMs ?? Math.round(performance.now() - started);
      post.originalSlug = saved.slug;
      post.status = saved.status;
      post.slugTouched = true;
      post.date = saved.date;
      post.dateInput = field('date').value;
      field('slug').value = saved.slug;
      for (const [code, item] of Object.entries(saved.translations)) {
        const entry = post.translations[code];
        if (!entry.categoryTouched) entry.category = item.categories?.join(', ') || item.category || '';
        if (!entry.tagsTouched) entry.tags = item.tags?.join(', ') ?? '';
      }
      field('category').value = post.translations[language].category;
      field('tags').value = post.translations[language].tags;
      updateHeading();
      show(status === 'published' ? 'publishedIn' : 'draftSaved', 'success', { ms }, urls);
      const codes = Object.keys(saved.translations);
      posts = posts.filter(item => item.slug !== originalSlug && item.slug !== saved.slug);
      posts.unshift({ ...saved, titles: Object.fromEntries(codes.map(code => [code, saved.translations[code].title])), languages: codes });
      loaded = true;
      renderList();
    } catch (error) { errorFeedback(show, error); }
    finally { unlock(); }
  });

  selectPost();
  languageListeners.push(() => { renderList(); renderPreview(); completion(); });
  return load;
}

function initAnalytics(onSummary) {
  const show = feedback('analytics-feedback');
  const content = byId('analytics-content');
  let summary;
  let pending;

  function timeLabel(value) {
    const date = new Date(value);
    if (!value || Number.isNaN(+date)) return value || '—';
    return new Intl.DateTimeFormat(uiLanguage, {
      dateStyle: 'medium', timeStyle: 'short', timeZone: 'Etc/GMT-3'
    }).format(date);
  }

  function breakdown(id, items, linked = false) {
    const list = byId(id);
    const rows = items.map(({ name, count }) => {
      const row = el('div');
      const label = el('dt');
      label.append(linked ? link(name, name) : name);
      row.append(label, el('dd', countLabel(count)));
      return row;
    });
    if (!rows.length) {
      const row = el('div');
      row.append(labeled(el('dt', null, 'muted'), 'noData'), el('dd', '—'));
      rows.push(row);
    }
    list.replaceChildren(...rows);
  }

  function table(id, headings, rows) {
    const container = byId(id);
    if (!rows.length) {
      container.replaceChildren(labeled(el('p', null, 'muted'), 'noData'));
      return;
    }
    const grid = el('table');
    grid.setAttribute('aria-labelledby', container.previousElementSibling.id);
    const heading = grid.createTHead().insertRow();
    for (const key of headings) {
      const cell = labeled(el('th'), key);
      cell.scope = 'col';
      heading.append(cell);
    }
    const body = grid.createTBody();
    for (const values of rows) {
      const row = body.insertRow();
      for (const value of values) row.insertCell().append(value || '—');
    }
    container.replaceChildren(grid);
  }

  function chart(series) {
    const container = byId('daily-chart');
    if (!series.length) {
      container.replaceChildren(labeled(el('p', null, 'muted'), 'noData'));
      return;
    }
    function svg(tag, attributes = {}) {
      const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
      return element;
    }
    const width = series.length * 20;
    const height = 130;
    const baseline = height - 1;
    const max = Math.max(1, ...series.map(day => day.views));
    const bars = svg('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': tr('dailyViews') });
    bars.append(svg('line', { x1: 0, x2: width, y1: baseline, y2: baseline, class: 'chart-baseline' }));
    series.forEach(({ date, views }, index) => {
      const x = index * 20;
      const barHeight = views / max * (baseline - 8);
      const column = svg('g', { class: 'chart-column' });
      const title = svg('title');
      title.textContent = `${dayLabel(date)} — ${countLabel(views)}`;
      column.append(title, svg('rect', { x: x + 3, y: baseline - barHeight, width: 14, height: barHeight, rx: 2, class: 'chart-bar' }),
        svg('rect', { x, y: 0, width: 20, height, class: 'chart-hit' }));
      bars.append(column);
    });
    const dates = el('div', null, 'chart-labels');
    dates.append(el('span', dayLabel(series[0].date)), el('span', dayLabel(series.at(-1).date)));
    container.replaceChildren(bars, dates);
  }

  function visitUrl(path) {
    return path?.startsWith('/') && !path.startsWith('//') ? path : '';
  }

  function likeUrl(item) {
    if (item.url) return item.url;
    const page = visitUrl(item.page);
    if (item.kind === 'story') {
      const home = /^\/(?:en\/|tr\/)?$/.exec(page.split(/[?#]/)[0])?.[0] ?? '/';
      return home + '#stories';
    }
    const path = page.replace(/^\/(?:en|tr)(?=\/)/, '').split(/[?#]/)[0];
    return path === item.id ? page.split(/[?#]/)[0] : item.id;
  }

  function deviceLabel(row) {
    return [row.device, row.browser].filter(Boolean).join(' / ');
  }

  function render() {
    if (!summary) return;
    const { totals, dailySeries, topPages, referrers, devices, browsers, recentVisits, likes } = summary;
    for (const [key, value] of Object.entries({
      pageViews: totals.views, uniqueIPs: totals.uniqueIps, todayViews: totals.todayViews, totalLikes: totals.totalLikes
    })) query(`[data-kpi="${key}"]`, content).textContent = countLabel(value ?? 0);
    chart(dailySeries);
    breakdown('top-pages', topPages, true);
    breakdown('referrers', referrers);
    breakdown('devices', devices);
    breakdown('browsers', browsers);
    table('recent-visits', ['time', 'page', 'referrer', 'deviceBrowser', 'ip'], recentVisits.map(row => [
      timeLabel(row.at), link(row.path || '—', visitUrl(row.path)), row.referrer, deviceLabel(row), row.ip
    ]));
    table('recent-likes', ['time', 'content', 'kind', 'ip', 'page', 'deviceBrowser', 'referrer'], likes.items.map(row => [
      timeLabel(row.at), link(row.title || row.id, likeUrl(row)), labeled(el('span'), row.kind === 'story' ? 'story' : 'post'),
      row.ip, link(row.page || '—', visitUrl(row.page)), deviceLabel(row), row.referrer
    ]));
    content.hidden = false;
  }

  languageListeners.push(render);
  return (foreground = true) => {
    if (foreground && !summary) show('loading');
    if (!pending) {
      pending = request('/analytics/summary').then(result => {
        summary = result;
        onSummary(result);
        show();
        render();
      }).catch(error => {
        if (foreground || !byId('analytics').hidden) errorFeedback(show, error);
      }).finally(() => { pending = null; });
    }
    return pending;
  };
}

if (expired) {
  const stories = initStories();
  const posts = initPosts();
  const refreshAnalytics = initAnalytics(stories.updateLikes);
  const sections = { stories: stories.load, posts, analytics: refreshAnalytics };
  const requestedTab = new URLSearchParams(location.search).get('tab');
  const started = new Set();
  tabset(query('.studio-tabs'), (button) => {
    const section = button.getAttribute('aria-controls');
    if (section === 'analytics' || !started.has(section)) {
      started.add(section);
      sections[section]().then((loaded) => {
        if (loaded === false) started.delete(section);
        if (section === 'stories' && loaded) refreshAnalytics(false);
      });
    }
  }, byId('tab-' + (Object.hasOwn(sections, requestedTab) ? requestedTab : 'stories')));
}
