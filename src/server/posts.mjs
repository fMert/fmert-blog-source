import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { atomicWriteFile, atomicWriteJson, httpError, readDir, readJsonStrict, removeFile } from './storage.mjs';
import { codePointLength } from './stories.mjs';

const languages = ['eo', 'en', 'tr'];
const slugPattern = /^[a-z0-9][a-z0-9-]{0,79}$/;
const mdPattern = /^(?:\d{4}-\d{2}-\d{2}-)?(.+)\.md$/;
const normalize = text => text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replaceAll('ı', 'i')
  .replace(/[^a-z0-9]+/g, ' ').trim();
const matchWord = (text, word) => text.includes(' ' + word + ' ');

const categoryRules = [
  [['Esploro', 'Research', 'Araştırma'], 'esploro esplorado research analysis analytics statistics arastirma analiz istatistik veri gozlem saha oran bulgu'],
  [['Projekto', 'Project', 'Proje'], 'projekto project release application proje uygulama gelistirdim surum yayinladim queyntisen aria'],
  [['Programado', 'Software', 'Yazılım'], 'programado software coding programming yazilim kod python linux terminal terminalo api android kotlin github llm'],
  [['Ĝenerala', 'General', 'Genel'], ''],
];

const tagRules = [
  [['artefarita-inteligenteco', 'artificial-intelligence', 'yapay-zeka'], ['artefarita inteligenteco', 'artificial intelligence', 'yapay zeka', 'llm', 'openai', 'ollama']],
  [['malferma-fonto', 'open-source', 'acik-kaynak'], ['malferma fonto', 'open source', 'acik kaynak', 'github']],
  [['python', 'python', 'python'], ['python']],
  [['linux', 'linux', 'linux'], ['linux']],
  [['android', 'android', 'android'], ['android', 'kotlin']],
  [['terminalo', 'terminal', 'terminal'], ['terminalo', 'terminal', 'command line', 'komut satiri']],
  [['markdown', 'markdown', 'markdown'], ['markdown', 'obsidian']],
  [['esploro', 'research', 'arastirma'], ['esploro', 'research', 'analysis', 'arastirma', 'analiz', 'veri']],
  [['edukado', 'education', 'egitim'], ['edukado', 'education', 'student', 'egitim', 'ogrenci', 'sinav']],
  [['queyntisen', 'queyntisen', 'queyntisen'], ['queyntisen']],
  [['aria', 'aria', 'aria'], ['aria']],
];
const byLanguage = values => Object.fromEntries(languages.map((lang, index) => [lang, values[index]]));

export function inferMetadata({ eo, en, tr } = {}) {
  const entries = [eo, en, tr];
  const titles = entries.map(entry => normalize(typeof entry?.title === 'string' ? entry.title : ''));
  const pad = text => ' ' + text + ' ';
  const texts = entries.map((entry, index) => pad(titles[index] + ' ' + normalize(typeof entry?.body === 'string' ? entry.body : '')));
  const fullTitle = pad(titles.join(' '));
  const fullText = texts.join(' ');
  const score = words => words ? words.split(' ').reduce((sum, word) =>
    sum + Number(matchWord(fullText, word)) + 2 * Number(matchWord(fullTitle, word)), 0) : 0;
  let category = categoryRules.find(([, words], index) => index < 2 &&
    words.split(' ').some(word => matchWord(fullTitle, word)));
  category ??= categoryRules.map(rule => [score(rule[1]), rule]).sort((a, b) => b[0] - a[0])
    .find(([points]) => points > 0)?.[1] ?? categoryRules.at(-1);
  const tags = texts.map((text, index) => tagRules.filter(([, words]) =>
    words.some(word => matchWord(text.trim() ? text : fullText, word))).slice(0, 6).map(([names]) => names[index]));
  const slug = (titles.find(Boolean) || 'yazi').replaceAll(' ', '-').slice(0, 80).replace(/-+$/, '');
  return { slug, category: byLanguage(category[0]), tags: byLanguage(tags) };
}

function validateSlug(slug) {
  if (typeof slug !== 'string' || !slugPattern.test(slug)) throw httpError(400, 'Invalid post slug');
  return slug;
}

function dateOnly(value) {
  if (value instanceof Date && !Number.isNaN(+value)) return value.toISOString().slice(0, 10);
  if (typeof value !== 'string') return '';
  const day = /^(\d{4}-\d{2}-\d{2})(?:$|[T ])/.exec(value)?.[1];
  if (!day) return '';
  const parsed = new Date(day + 'T00:00:00Z');
  return Number.isNaN(+parsed) || parsed.toISOString().slice(0, 10) !== day ? '' : day;
}

function validDate(value) {
  if (value instanceof Date && !Number.isNaN(+value)) return value.toISOString();
  if (!dateOnly(value)) return '';
  if (value.length === 10) return value;
  let date = value.trim().replace(' ', 'T').replace(/\s+([+-]\d{2})(\d{2})$/, '$1:$2');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(date)) date += '+03:00';
  return Number.isNaN(Date.parse(date)) ? '' : date;
}

function stringList(value) {
  if (Array.isArray(value)) return value.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean);
  return typeof value === 'string' ? stringList(value.split(',')) : [];
}

function summarize(post) {
  const { slug, filename, status, date, pin, translations } = post;
  const available = languages.filter(lang => translations[lang]?.title && translations[lang]?.body);
  const collect = fn => Object.fromEntries(available.map(lang => [lang, fn(translations[lang], lang)]));
  return {
    slug, filename, status, date, pin, languages: available,
    titles: collect(item => item.title), categories: collect(item => item.categories ?? stringList(item.category)),
    tags: collect(item => item.tags ?? []),
    urls: status === 'published' ? collect((_, lang) => (lang === 'eo' ? '' : '/' + lang) + '/posts/' + slug + '/') : {},
  };
}

function validateTranslations(input) {
  const translations = {};
  for (const lang of languages) {
    const entry = input?.[lang];
    if (entry == null) continue;
    if (typeof entry !== 'object' || Array.isArray(entry)) throw httpError(400, 'Invalid translation');
    const { title = '', body = '' } = entry;
    if (typeof title !== 'string' || typeof body !== 'string' ||
        codePointLength(title.trim()) > 200 || codePointLength(body) > 200000) {
      throw httpError(400, 'Post title or body exceeds its limit or is invalid');
    }
    if (title.trim() && body.trim()) translations[lang] = { ...entry, title: title.trim(), body };
  }
  if (!Object.keys(translations).length) throw httpError(400, 'Title and body are required in at least one language');
  const metadata = inferMetadata(translations);
  for (const [lang, entry] of Object.entries(translations)) {
    const { title, body } = entry;
    const categories = stringList(entry.categories ?? entry.category);
    const tags = entry.tags == null ? metadata.tags[lang] : stringList(entry.tags);
    const category = categories[0] || metadata.category[lang];
    translations[lang] = { title, body, category, categories: categories.length ? categories : [category], tags };
  }
  return { translations, metadata };
}

export function createPostsService({ config, lock, triggerBuild }) {
  const root = path.join(config.dataDir, 'posts');
  const drafts = path.join(root, '.drafts');
  const managed = [...languages.map(lang => [path.join(root, lang), lang]), [root, 'tr']];
  const draftPath = slug => path.join(drafts, slug + '.json');

  async function inventory(dirs = managed) {
    const entries = await Promise.all(dirs.map(async ([dir, lang]) => (await readDir(dir)).flatMap(entry => {
      const slug = mdPattern.exec(entry.name)?.[1];
      return entry.isFile() && !entry.name.startsWith('.') && slug
        ? [{ slug, lang, filename: entry.name, file: path.join(dir, entry.name) }] : [];
    })));
    return entries.flat().sort((a, b) => b.filename.localeCompare(a.filename));
  }

  async function readPosts() {
    const posts = new Map();
    for (const { slug, filename, file, lang } of await inventory()) {
      try {
        const raw = await fs.readFile(file, 'utf8');
        const { data, content } = matter(raw, { engines: { yaml: string => yaml.load(string, { schema: yaml.JSON_SCHEMA }) } });
        if (typeof data?.title !== 'string' || !data.title.trim() || !content.trim()) throw new Error('Missing post title or body');
        const categories = stringList(data.categories ?? data.category);
        const translation = { title: data.title, body: content.replace(/^\r?\n|\r?\n$/g, ''), category: categories[0] || '', categories, tags: stringList(data.tags ?? data.tag) };
        let post = posts.get(slug);
        if (!post) {
          post = { slug, filename, status: 'published', date: validDate(data.date) || dateOnly(filename.slice(0, 10)), pin: Boolean(data.pin), translations: {} };
          posts.set(slug, post);
        }
        post.translations[lang] ??= translation;
      } catch (error) {
        console.warn(`Skipping post ${file}:`, error.message);
      }
    }
    for (const entry of await readDir(drafts)) {
      const slug = entry.name.endsWith('.json') && entry.name.slice(0, -5);
      if (!entry.isFile() || !slugPattern.test(slug || '')) continue;
      try {
        const draft = await readJsonStrict(draftPath(slug));
        if (!draft || draft.slug !== slug || !dateOnly(draft.date)) throw new Error('Invalid draft');
        const { translations } = validateTranslations(draft.translations);
        posts.set(slug, { ...draft, slug, status: 'draft', translations });
      } catch (error) {
        console.warn(`Skipping draft ${entry.name}:`, error.message);
      }
    }
    return posts;
  }

  function listPosts() {
    return lock.withLock('posts', async () => [...(await readPosts()).values()]
      .sort((a, b) => a.status.localeCompare(b.status) || b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug))
      .map(summarize));
  }

  function getPost(slug) {
    validateSlug(slug);
    return lock.withLock('posts', async () => {
      const post = (await readPosts()).get(slug);
      if (!post) throw httpError(404, 'Post not found');
      return post;
    });
  }

  async function snapshot(files) {
    const result = new Map();
    for (const file of files) {
      try {
        result.set(file, await fs.readFile(file));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        result.set(file, null);
      }
    }
    return result;
  }

  async function transact(files, mutate) {
    const before = await snapshot(files);
    try {
      return await mutate();
    } catch (error) {
      const results = await Promise.allSettled([...before].map(([file, data]) =>
        data === null ? removeFile(file) : atomicWriteFile(file, data)));
      for (const result of results) {
        if (result.status === 'rejected') console.error('Could not restore post file:', result.reason);
      }
      throw httpError(500, error.message || 'Could not save post');
    }
  }

  function savePost(payload) {
    const { status } = payload;
    if (status !== 'draft' && status !== 'published') throw httpError(400, 'Invalid post status');
    const { translations, metadata } = validateTranslations(payload.translations);
    const slug = validateSlug(payload.slug === '' || payload.slug == null ? metadata.slug : payload.slug);
    const originalSlug = payload.originalSlug ? validateSlug(payload.originalSlug) : '';
    if (payload.pin != null && typeof payload.pin !== 'boolean') throw httpError(400, 'Invalid pin value');
    const pin = payload.pin ?? false;
    const date = payload.date ? validDate(payload.date) : new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (!date) throw httpError(400, 'Invalid post date');
    const filename = dateOnly(date) + '-' + slug + '.md';
    const post = { slug, filename, status, date, pin, translations };
    return lock.withLock('posts', async () => {
      const files = await inventory();
      const draftEntries = await readDir(drafts);
      const exists = key => files.some(item => item.slug === key) || draftEntries.some(entry => entry.name === key + '.json');
      if (originalSlug && !exists(originalSlug)) throw httpError(404, 'Post not found');
      if (slug !== originalSlug && exists(slug)) throw httpError(409, 'Post slug already exists');
      const i18nDir = path.join(config.sourceDir, 'i18n');
      const repo = [[path.join(config.sourceDir, '_posts')], ...(await readDir(i18nDir))
        .filter(entry => entry.isDirectory()).map(entry => [path.join(i18nDir, entry.name, '_posts')])];
      if ((await inventory(repo)).some(item => item.slug === slug)) throw httpError(409, 'Post slug already exists in source');

      const oldFiles = files.filter(item => item.slug === originalSlug || item.slug === slug).map(item => item.file);
      const oldDrafts = new Set([draftPath(slug)]);
      if (originalSlug) oldDrafts.add(draftPath(originalSlug));
      const writes = new Map(status === 'published' ? Object.entries(translations).map(([lang, entry]) => [
        path.join(root, lang, filename),
        '---\n' + yaml.dump({
          title: entry.title, date, categories: entry.categories, tags: entry.tags,
          pin, render_with_liquid: false,
        }, { lineWidth: -1 }) + '---\n\n' + entry.body + '\n',
      ]) : []);
      const affected = new Set([...oldFiles, ...oldDrafts, ...writes.keys()]);
      return transact(affected, async () => {
        if (status === 'draft') await atomicWriteJson(draftPath(slug), post);
        for (const [file, content] of writes) await atomicWriteFile(file, content);
        for (const file of oldFiles) if (!writes.has(file)) await removeFile(file);
        for (const file of oldDrafts) if (status !== 'draft' || file !== draftPath(slug)) await removeFile(file);
        const start = performance.now();
        if (status === 'published' || oldFiles.length) await triggerBuild();
        const buildMs = status === 'published' ? Math.round(performance.now() - start) : 0;
        return status === 'published' ? { ok: true, post, urls: summarize(post).urls, buildMs } : { ok: true, post, buildMs };
      });
    });
  }

  function deletePost(slug) {
    validateSlug(slug);
    return lock.withLock('posts', async () => {
      const files = (await inventory()).filter(item => item.slug === slug).map(item => item.file);
      const affected = [...files, draftPath(slug)];
      return transact(affected, async () => {
        for (const file of affected) await removeFile(file);
        if (files.length) await triggerBuild();
        return { ok: true };
      });
    });
  }

  return { inferMetadata, listPosts, getPost, savePost, deletePost };
}
