import crypto from 'node:crypto';
import path from 'node:path';
import { visitFromRequest } from './analytics.mjs';
import { createRateLimiter } from './auth.mjs';
import { atomicWriteJson, httpError, readDir, readJsonStrict, removeFile } from './storage.mjs';

const targetKey = (kind, id) => kind + ':' + id;
const targetHash = (kind, id) => crypto.createHash('sha256').update(targetKey(kind, id)).digest('hex');

function validTarget(kind, id) {
  if (typeof id !== 'string') return false;
  if (kind === 'story') return /^[a-zA-Z0-9_-]{1,120}$/.test(id);
  return kind === 'post' && id.length <= 500 && /^\/posts\/[^?#\\\s]+\/$/.test(id) && !id.includes('..');
}

function snapshots(content) {
  if (!content || typeof content !== 'object' || Array.isArray(content)) throw new Error('Invalid like file');
  const likes = content.likes ?? content.visitors ?? {};
  if (typeof likes !== 'object' || Array.isArray(likes)) throw new Error('Invalid like snapshots');
  return likes;
}

export function createLikesService({ config, lock, auth, storiesService, getSiteRoot }) {
  const dir = path.join(config.dataDir, 'likes');
  const limiter = createRateLimiter(60, 60_000);
  const filename = hash => path.join(dir, hash + '.json');
  let cached;

  function invalidateTargets() {
    cached = undefined;
  }

  async function loadTargets() {
    const root = getSiteRoot();
    const manifests = ['', 'en', 'tr'];
    let error;
    let foundLocal = false;
    let data = await Promise.all(manifests.map(async prefix => {
      try {
        const value = root ? await readJsonStrict(path.join(root, prefix, 'like-targets.json')) : undefined;
        if (value !== undefined) foundLocal = true;
        return value;
      } catch (cause) {
        foundLocal = true;
        error = cause;
      }
    }));
    if (!foundLocal && config.blogOrigin) {
      data = await Promise.all(manifests.map(async prefix => {
        try {
          const response = await fetch(config.blogOrigin.replace(/\/+$/, '') + (prefix ? '/' + prefix : '') + '/like-targets.json', {
            signal: AbortSignal.timeout(3000),
          });
          if (response.status === 404) return;
          if (!response.ok) throw new Error('Manifest returned HTTP ' + response.status);
          return await response.json();
        } catch (cause) {
          error = cause;
        }
      }));
    }

    const targets = new Map();
    for (const entries of data) {
      if (entries === undefined) continue;
      if (!Array.isArray(entries)) {
        error = new Error('Invalid like manifest');
        continue;
      }
      for (const entry of entries) {
        if (!validTarget(entry?.kind, entry?.id)) continue;
        const key = targetKey(entry.kind, entry.id);
        if (!targets.has(key)) targets.set(key, entry);
      }
    }
    if (error && !targets.size) throw httpError(503, 'Content targets are unavailable');
    return targets;
  }

  async function findTarget(kind, id) {
    if (kind === 'story') {
      const story = (await storiesService.listAdmin()).find(item => item.id === id);
      if (story) return { kind, id, title: story.title || story.text };
    }
    if (!cached) {
      const loading = loadTargets();
      cached = loading;
      loading.catch(() => {
        if (cached === loading) invalidateTargets();
      });
    }
    return (await cached).get(targetKey(kind, id));
  }

  function state(likes, visitor) {
    return { count: Object.keys(likes).length, liked: Object.hasOwn(likes, visitor) };
  }

  async function getLikeState(req, kind, id) {
    if (!validTarget(kind, id)) throw httpError(400, 'Invalid like target');
    const content = await readJsonStrict(filename(targetHash(kind, id)), {});
    return state(snapshots(content), auth.getVisitorId(req));
  }

  function setLikeState(req, res, payload) {
    if (!auth.verifySameOrigin(req)) throw httpError(403, 'forbidden');
    const { kind, id, liked, referrer, page } = payload ?? {};
    if (!validTarget(kind, id) || typeof liked !== 'boolean' ||
        (referrer != null && typeof referrer !== 'string') ||
        (page != null && (typeof page !== 'string' || !page.startsWith('/') || page.startsWith('//') ||
          page.length > 512 || /[\\\u0000-\u0020]/.test(page)))) throw httpError(400, 'Invalid like');
    if (!limiter.allow(auth.getClientIp(req))) throw httpError(429, 'Too many likes');
    const hash = targetHash(kind, id);
    return lock.withLock('like:' + hash, async () => {
      const file = filename(hash);
      const content = await readJsonStrict(file, {});
      const likes = snapshots(content);
      let visitor = auth.getVisitorId(req);
      if (liked) {
        const target = await findTarget(kind, id);
        if (!target) throw httpError(404, 'Content not found');
        if (Object.hasOwn(likes, visitor)) return state(likes, visitor);
        if (Object.keys(likes).length >= 5000) throw httpError(503, 'Like storage limit reached');
        visitor ||= auth.getOrCreateVisitorId(req, res);
        const visit = visitFromRequest(req, auth, page || (kind === 'post' ? id : '/'), referrer);
        const { path: visitPath, ...details } = visit;
        likes[visitor] = { ...details, page: visitPath };
        await atomicWriteJson(file, { kind, id, title: target.title || id, likes });
      } else if (visitor && Object.hasOwn(likes, visitor)) {
        delete likes[visitor];
        if (!Object.keys(likes).length) await removeFile(file);
        else await atomicWriteJson(file, { kind, id, title: content.title || id, likes });
      }
      return state(likes, visitor);
    });
  }

  function deleteTarget(kind, id) {
    const hash = targetHash(kind, id);
    return lock.withLock('like:' + hash, () => removeFile(filename(hash)));
  }

  async function listAllSnapshots() {
    const items = [];
    for (const entry of await readDir(dir)) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const file = path.join(dir, entry.name);
      try {
        const content = await readJsonStrict(file);
        if (!content) continue;
        if (!validTarget(content.kind, content.id)) throw new Error('Invalid like target');
        for (const visit of Object.values(snapshots(content))) {
          const time = Date.parse(visit?.at ?? visit?.time);
          if (!Number.isFinite(time)) continue;
          const { ip, device, browser, referrer } = visit;
          items.push({ kind: content.kind, id: content.id, title: content.title, at: new Date(time).toISOString(),
            page: visit.page ?? visit.path, ip, device, browser, referrer });
        }
      } catch (error) {
        console.warn(`Skipping like file ${file}:`, error.message);
      }
    }
    items.sort((a, b) => b.at.localeCompare(a.at));
    return { totalLikes: items.length, items };
  }

  return { invalidateTargets, getLikeState, setLikeState, deleteTarget, listAllSnapshots };
}
