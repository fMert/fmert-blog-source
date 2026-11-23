import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { renderMarkdown } from './markdown.mjs';

export const LANGUAGES = [
  { key: 'eo', uiKey: 'eo', htmlLang: 'eo', baseurl: '', label: 'EO', nativeName: 'Esperanto' },
  { key: 'en', uiKey: 'en', htmlLang: 'en', baseurl: '/en', label: 'EN', nativeName: 'English' },
  { key: 'tr', uiKey: 'tr-TR', htmlLang: 'tr', baseurl: '/tr', label: 'TR', nativeName: 'Türkçe' }
];

export const SITE_META = {
  title: 'Furkan Mert Bağcı',
  shortTitle: 'fmert.me',
  url: 'https://fmert.me',
  email: 'fmertbagci@proton.me',
  github: 'https://github.com/fMert',
  githubUsername: 'fMert',
  avatar: '/assets/img/avatar.jpg',
  author: {
    name: 'Furkan Mert Bağcı',
    alternateName: 'fMert'
  }
};

export function slugifyTerm(str = '') {
  return String(str)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[/?#%&"'<>\\]+/g, '');
}

export function formatDate(dateObj, months) {
  const d = dateObj instanceof Date && !Number.isNaN(dateObj.getTime()) ? dateObj : new Date();
  const istanbul = new Date(d.getTime() + 3 * 60 * 60 * 1000);
  const day = istanbul.getUTCDate();
  const month = months[istanbul.getUTCMonth()] || String(istanbul.getUTCMonth() + 1);
  const year = istanbul.getUTCFullYear();
  return `${day} ${month} ${year}`;
}

export function formatMonthDay(dateObj, months) {
  const d = dateObj instanceof Date && !Number.isNaN(dateObj.getTime()) ? dateObj : new Date();
  const istanbul = new Date(d.getTime() + 3 * 60 * 60 * 1000);
  const day = String(istanbul.getUTCDate()).padStart(2, '0');
  const month = months[istanbul.getUTCMonth()] || String(istanbul.getUTCMonth() + 1);
  return `${day} ${month}`;
}

export function getIstanbulYear(dateObj) {
  const d = dateObj instanceof Date && !Number.isNaN(dateObj.getTime()) ? dateObj : new Date();
  return new Date(d.getTime() + 3 * 60 * 60 * 1000).getUTCFullYear();
}

export function parsePostDate(rawDate, filename) {
  if (rawDate instanceof Date && !Number.isNaN(rawDate.getTime())) {
    return rawDate;
  }
  if (typeof rawDate === 'string' && rawDate.trim()) {
    const normalized = rawDate.trim().replace(' ', 'T').replace(/\s+([+-]\d{2})(\d{2})$/, '$1:$2');
    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})-/);
  if (match) {
    const parsed = new Date(`${match[1]}T12:00:00+03:00`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

export function extractSlugFromFilename(filename) {
  const base = filename.replace(/\.md$/i, '');
  const match = base.match(/^\d{4}-\d{2}-\d{2}-(.+)$/);
  return match ? match[1] : base;
}

async function readYamlFile(filePath, fallback = {}) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return yaml.load(raw) ?? fallback;
  } catch {
    return fallback;
  }
}

async function listMarkdownFiles(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith('.md') && !e.name.startsWith('.'))
      .map((e) => path.join(dirPath, e.name));
  } catch {
    return [];
  }
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return value.split(',').map((v) => v.trim()).filter(Boolean);
  }
  return [];
}

function normalizeImagePath(src, mediaSubpath) {
  if (!src) return '';
  if (/^https?:\/\//i.test(src) || src.startsWith('data:')) return src;
  if (mediaSubpath) {
    return `${mediaSubpath}/${src}`.replace(/\/+/g, '/');
  }
  return src.startsWith('/') ? src : `/${src}`;
}

export async function loadSiteData(sourceDir, dataDir) {
  const uiData = await readYamlFile(path.join(sourceDir, '_data/ui.yml'), {});
  const projectData = await readYamlFile(path.join(sourceDir, '_data/project.yml'), {});

  const langConfigs = {};
  for (const lang of LANGUAGES) {
    langConfigs[lang.key] = await readYamlFile(
      path.join(sourceDir, 'i18n', lang.key, 'config.yml'),
      {}
    );
  }

  const languageBundles = {};
  const availablePostSlugsByLang = {};

  for (const lang of LANGUAGES) {
    const ui = uiData[lang.uiKey] || uiData.en || {};
    const cfg = langConfigs[lang.key] || {};

    // Collect post markdown files from repo + persistent DATA_DIR
    const repoPostsDir = lang.key === 'eo'
      ? path.join(sourceDir, '_posts')
      : path.join(sourceDir, 'i18n', lang.key, '_posts');
    const managedPostsDir = path.join(dataDir, 'posts', lang.key);

    const fileMap = new Map();
    for (const filePath of await listMarkdownFiles(repoPostsDir)) {
      fileMap.set(path.basename(filePath), filePath);
    }
    for (const filePath of await listMarkdownFiles(managedPostsDir)) {
      fileMap.set(path.basename(filePath), filePath);
    }
    // Legacy single-language Turkish posts in deploy/data/posts/*.md
    if (lang.key === 'tr') {
      for (const filePath of await listMarkdownFiles(path.join(dataDir, 'posts'))) {
        fileMap.set(path.basename(filePath), filePath);
      }
    }

    const posts = [];
    for (const [filename, filePath] of fileMap.entries()) {
      let raw;
      try {
        raw = await fs.readFile(filePath, 'utf8');
      } catch {
        continue;
      }
      const parsed = matter(raw);
      const fm = parsed.data || {};
      if (fm.hidden === true || fm.published === false) continue;

      const slug = extractSlugFromFilename(filename);
      const date = parsePostDate(fm.date, filename);
      const rendered = renderMarkdown(parsed.content, {
        copyLabel: ui.copy_code || 'Copy',
        copiedLabel: ui.code_copied || 'Copied'
      });

      const categories = normalizeStringList(fm.categories || fm.category);
      const tags = normalizeStringList(fm.tags || fm.tag);
      const canonicalPath = `/posts/${slug}/`;
      const url = `${lang.baseurl}${canonicalPath}`;

      let coverImage = null;
      if (fm.image) {
        const imgSrc = typeof fm.image === 'string' ? fm.image : fm.image.path;
        const imgAlt = typeof fm.image === 'object' ? fm.image.alt : '';
        if (imgSrc) {
          coverImage = {
            path: normalizeImagePath(imgSrc, fm.media_subpath),
            alt: imgAlt || fm.title || slug
          };
        }
      }

      posts.push({
        slug,
        filename,
        title: String(fm.title || slug),
        seoTitle: fm.seo_title ? String(fm.seo_title) : String(fm.title || slug),
        description: fm.description ? String(fm.description) : rendered.excerpt,
        date,
        dateIso: date.toISOString(),
        dateFormatted: formatDate(date, ui.months || []),
        monthDay: formatMonthDay(date, ui.months || []),
        year: getIstanbulYear(date),
        categories,
        tags,
        pin: Boolean(fm.pin),
        toc: fm.toc !== false,
        canonicalPath,
        url,
        image: coverImage,
        html: rendered.html,
        headings: rendered.headings,
        words: rendered.words,
        readingMinutes: rendered.readingMinutes,
        excerpt: fm.description ? String(fm.description) : rendered.excerpt,
        plainText: rendered.plainText
      });
    }

    // Sort: pinned first, then newest date first
    posts.sort((a, b) => {
      if (a.pin !== b.pin) return a.pin ? -1 : 1;
      return b.date.getTime() - a.date.getTime();
    });

    availablePostSlugsByLang[lang.key] = new Set(posts.map((p) => p.slug));

    // About page
    const aboutPath = lang.key === 'eo'
      ? path.join(sourceDir, '_tabs/about.md')
      : path.join(sourceDir, 'i18n', lang.key, '_tabs/about.md');
    const aboutRaw = await fs.readFile(aboutPath, 'utf8').catch(() => '');
    const aboutParsed = matter(aboutRaw);
    const aboutRendered = renderMarkdown(aboutParsed.content, {
      copyLabel: ui.copy_code || 'Copy',
      copiedLabel: ui.code_copied || 'Copied'
    });
    const about = {
      title: ui.nav_about || aboutParsed.data.title || 'About',
      seoTitle: aboutParsed.data.seo_title || ui.nav_about || 'About',
      description: aboutParsed.data.description || cfg.description || '',
      html: aboutRendered.html
    };

    // Fallback stories YAML
    const storiesPath = lang.key === 'eo'
      ? path.join(sourceDir, '_data/stories.yml')
      : path.join(sourceDir, 'i18n', lang.key, 'stories.yml');
    const storiesRaw = await readYamlFile(storiesPath, []);
    const stories = Array.isArray(storiesRaw)
      ? storiesRaw.map((s) => ({
          id: String(s.id || ''),
          type: String(s.type || 'text'),
          image: s.image ? String(s.image) : '',
          bg: s.bg ? String(s.bg) : '',
          title: s.title ? String(s.title) : '',
          text: String(s.text || ''),
          subtext: s.subtext ? String(s.subtext) : '',
          link: s.link
            ? (String(s.link).startsWith('/') && lang.baseurl && !String(s.link).startsWith(lang.baseurl + '/')
                ? `${lang.baseurl}${s.link}`
                : String(s.link))
            : '',
          link_label: s.link_label ? String(s.link_label) : '',
          posted: parsePostDate(s.posted, '').toISOString()
        }))
      : [];

    // Categories & Tags indices
    const categoryMap = new Map();
    const tagMap = new Map();
    for (const post of posts) {
      for (const cat of post.categories) {
        const key = slugifyTerm(cat);
        if (!categoryMap.has(key)) categoryMap.set(key, { name: cat, slug: key, posts: [] });
        categoryMap.get(key).posts.push(post);
      }
      for (const tag of post.tags) {
        const key = slugifyTerm(tag);
        if (!tagMap.has(key)) tagMap.set(key, { name: tag, slug: key, posts: [] });
        tagMap.get(key).posts.push(post);
      }
    }

    const categories = Array.from(categoryMap.values()).sort((a, b) => b.posts.length - a.posts.length || a.name.localeCompare(b.name));
    const tags = Array.from(tagMap.values()).sort((a, b) => b.posts.length - a.posts.length || a.name.localeCompare(b.name));

    languageBundles[lang.key] = {
      lang,
      ui,
      config: {
        tagline: cfg.tagline || ui.site_tagline || '',
        description: cfg.description || ''
      },
      project: projectData[lang.uiKey] || projectData.en || {},
      posts,
      about,
      stories,
      categories,
      tags
    };
  }

  return { languageBundles, availablePostSlugsByLang };
}
