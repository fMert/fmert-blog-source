import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { atomicWriteFile, atomicWriteJson, httpError, readJsonStrict, removeFile, safeJoin, validateImageBuffer } from './storage.mjs';

const languages = ['eo', 'en', 'tr'];
const mediaPrefix = '/story-media/';
const mediaName = /^[a-zA-Z0-9._-]+$/;
const mimeTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const fields = { title: 120, text: 1000, subtext: 1000, link_label: 80 };

export function codePointLength(str) {
  return Array.from(str).length;
}

function boundedText(value, max, field) {
  if (value == null) return '';
  if (typeof value !== 'string' || codePointLength(value.trim()) > max) {
    throw httpError(400, `${field} must be text up to ${max} characters`);
  }
  return value.trim();
}

function validLink(link) {
  if (/[\u0000-\u0020\\]/.test(link)) return false;
  if (link.startsWith('/') && !link.startsWith('//')) return true;
  if (!/^https?:\/\//i.test(link)) return false;
  try {
    return Boolean(new URL(link).hostname);
  } catch {
    return false;
  }
}

function validatedImage(buffer) {
  if ((buffer?.length ?? 0) > 10 << 20) throw httpError(413, 'Image exceeds 10 MiB');
  const info = validateImageBuffer(buffer);
  if (!info.ok) throw httpError(400, info.error);
  return info;
}

export function createStoriesService({ config, lock, onStoryDeleted = async () => {} }) {
  const file = path.join(config.dataDir, 'stories.json');
  const media = path.join(config.dataDir, 'media');

  async function listAdmin() {
    const stories = await readJsonStrict(file, []);
    return stories.sort((a, b) => String(b.posted).localeCompare(String(a.posted)));
  }

  async function listPublic(lang = 'eo') {
    if (!languages.includes(lang)) lang = 'eo';
    return (await listAdmin()).flatMap(({ translations, ...story }) => {
      if (!translations && lang !== 'tr') return [];
      const translation = translations?.[lang];
      if (translation?.text?.trim()) {
        for (const field of Object.keys(fields)) story[field] = translation[field] ?? '';
      }
      if (lang !== 'eo' && story.link?.startsWith('/posts/')) story.link = '/' + lang + story.link;
      return [story];
    });
  }

  function mediaPath(url) {
    const name = url?.startsWith(mediaPrefix) && url.slice(mediaPrefix.length);
    if (name && name !== '.' && name !== '..' && mediaName.test(name)) return safeJoin(media, name);
  }

  async function cleanMedia(url, stories) {
    const target = mediaPath(url);
    if (target && !stories.some(story => story.image === url)) await removeFile(target);
  }

  function saveStory({ id, type, bg, link, translations, primary, imageFile }) {
    if (!['text', 'image', 'link'].includes(type)) throw httpError(400, 'Invalid story type');
    if (id && (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(id))) throw httpError(400, 'Invalid story ID');
    bg = boundedText(bg, 300, 'bg');
    link = type === 'link' ? boundedText(link, 500, 'link') : '';
    if (type === 'link' && !validLink(link)) throw httpError(400, 'A valid link is required');
    const localized = Object.fromEntries(languages.map(lang => {
      const source = translations?.[lang] ?? (lang === 'eo' ? primary : undefined);
      const entry = Object.fromEntries(Object.entries(fields).map(([field, max]) => [
        field, field === 'link_label' && type !== 'link' ? '' : boundedText(source?.[field], max, field),
      ]));
      return [lang, entry];
    }));
    const base = languages.map(lang => localized[lang]).find(entry => entry.text);
    if (!base) throw httpError(400, 'Story text is required in at least one language');
    const buffer = Buffer.isBuffer(imageFile) ? imageFile : imageFile?.buffer;
    const imageInfo = type === 'image' && imageFile ? validatedImage(buffer) : null;

    return lock.withLock('stories', async () => {
      const stories = await listAdmin();
      const previous = id ? stories.find(story => story.id === id) : null;
      if (id && !previous) throw httpError(404, 'Story not found');
      const now = new Date().toISOString();
      const story = {
        id: id || crypto.randomBytes(16).toString('hex'), type, bg, link, ...base,
        image: type === 'image' ? previous?.image || '' : '',
        posted: previous?.posted ?? now,
        translations: { eo: localized.eo, en: localized.en, tr: localized.tr },
      };
      if (previous) story.updated = now;
      if (type === 'image' && !story.image && !imageInfo) throw httpError(400, 'An image is required');

      let written;
      let oldBytes;
      if (imageInfo) {
        story.image = mediaPrefix + story.id + '.' + imageInfo.ext;
        written = mediaPath(story.image);
        if (story.image === previous?.image) oldBytes = await fs.readFile(written).catch(error => {
          if (error.code !== 'ENOENT') throw error;
        });
        await atomicWriteFile(written, buffer);
      }

      const next = [story, ...stories.filter(item => item.id !== story.id)];
      try {
        await atomicWriteJson(file, next);
      } catch (error) {
        if (oldBytes) await atomicWriteFile(written, oldBytes);
        else if (written) await removeFile(written);
        throw error;
      }
      if (previous?.image !== story.image) await cleanMedia(previous?.image, next);
      return story;
    });
  }

  function deleteStory(id) {
    return lock.withLock('stories', async () => {
      const stories = await listAdmin();
      const previous = stories.find(story => story.id === id);
      if (!previous) throw httpError(404, 'Story not found');
      const next = stories.filter(story => story.id !== id);
      await atomicWriteJson(file, next);
      try {
        await cleanMedia(previous.image, next);
      } finally {
        await onStoryDeleted(id);
      }
    });
  }

  async function uploadMedia(buffer) {
    const { ext, mime, width, height } = validatedImage(buffer);
    const filename = `media-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
    await atomicWriteFile(safeJoin(media, filename), buffer);
    return { url: mediaPrefix + filename, width, height, mime };
  }

  async function serveMedia(req, res, filename) {
    const target = mediaPath(mediaPrefix + filename);
    const mime = mimeTypes[path.extname(filename).toLowerCase()];
    if (!target || !mime) throw httpError(404, 'Media not found');
    const handle = await fs.open(target, 'r').catch(error => {
      if (error.code === 'ENOENT') throw httpError(404, 'Media not found');
      throw error;
    });
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw httpError(404, 'Media not found');
      res.writeHead(200, {
        'Content-Type': mime, 'Content-Length': stat.size,
        'Cache-Control': 'public, max-age=604800, immutable', 'X-Content-Type-Options': 'nosniff',
      });
      if (req.method === 'HEAD') res.end();
      else await pipeline(handle.createReadStream(), res);
    } finally {
      await handle.close();
    }
  }

  return { listPublic, listAdmin, saveStory, deleteStory, uploadMedia, serveMedia };
}
