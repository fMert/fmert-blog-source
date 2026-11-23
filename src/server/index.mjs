import http from 'node:http';
import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite } from '../builder/build.mjs';
import { renderAdminPage, serveAdminStatic } from './admin-ui.mjs';
import { createAnalyticsService } from './analytics.mjs';
import { createAuth, sessionMaxAge } from './auth.mjs';
import { loadConfig } from './config.mjs';
import { createLikesService } from './likes.mjs';
import { createPostsService } from './posts.mjs';
import * as storage from './storage.mjs';
import { createStoriesService } from './stories.mjs';

const { httpError } = storage;
const mebibyte = 1 << 20;
const languages = ['eo', 'en', 'tr'];

function parseMultipart(buffer, contentType) {
  const match = /(?:^|;)\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary || !/^[0-9A-Za-z'()+_,./:=? -]{1,70}$/.test(boundary) || boundary.endsWith(' ')) {
    throw httpError(400, 'Invalid multipart boundary');
  }
  const opening = Buffer.from('--' + boundary);
  const delimiter = Buffer.from('\r\n--' + boundary);
  const fields = Object.create(null);
  const files = Object.create(null);
  const malformed = () => httpError(400, 'Malformed multipart body');
  if (!buffer.subarray(0, opening.length).equals(opening)) throw malformed();
  let offset = opening.length;
  for (let parts = 0; parts <= 128; parts++) {
    const suffix = buffer.toString('latin1', offset, offset + 2);
    if (suffix === '--') return { fields, files };
    if (suffix !== '\r\n') throw malformed();
    offset += 2;
    const headerEnd = buffer.indexOf('\r\n\r\n', offset);
    if (headerEnd < 0 || headerEnd - offset > 8192) throw malformed();
    const disposition = buffer.toString('utf8', offset, headerEnd).split('\r\n')
      .find(line => /^content-disposition:\s*form-data(?:;|$)/i.test(line));
    const name = /(?:^|;)\s*name="([^"]+)"/i.exec(disposition ?? '')?.[1];
    const filename = /(?:^|;)\s*filename="([^"]*)"/i.exec(disposition ?? '')?.[1];
    if (!name) throw malformed();
    const start = headerEnd + 4;
    let end = buffer.indexOf(delimiter, start);
    while (end >= 0 && !['--', '\r\n'].includes(buffer.toString('latin1', end + delimiter.length, end + delimiter.length + 2))) {
      end = buffer.indexOf(delimiter, end + delimiter.length);
    }
    if (end < 0) throw malformed();
    const value = buffer.subarray(start, end);
    if (filename === undefined) fields[name] = value.toString('utf8');
    else if (filename || value.length) files[name] = value;
    offset = end + delimiter.length;
  }
  throw malformed();
}

function parseObject(text) {
  try {
    const value = JSON.parse(text);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch {
    // Report malformed JSON as a client error.
  }
  throw httpError(400, 'Invalid JSON object');
}

async function readBody(req, limit = 4096) {
  const contentType = req.headers['content-type'] || '';
  const type = contentType.split(';')[0].trim().toLowerCase();
  if (type === 'multipart/form-data') limit = 12 * mebibyte;
  let size = 0;
  const chunks = [];
  if (Number(req.headers['content-length']) > limit) throw httpError(413, 'Request body is too large');
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) throw httpError(413, 'Request body is too large');
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks, size);
  if (type === 'multipart/form-data') return parseMultipart(body, contentType);
  if (type === 'application/json') return { fields: parseObject(body.toString('utf8')) };
  if (type === 'application/x-www-form-urlencoded' || !body.length) {
    return { fields: Object.fromEntries(new URLSearchParams(body.toString('utf8'))) };
  }
  throw httpError(415, 'Unsupported content type');
}

function translationsFrom(fields, names) {
  if (typeof fields.translations === 'string') return parseObject(fields.translations);
  if (fields.translations) return fields.translations;
  return Object.fromEntries(languages.map(lang => [lang, Object.fromEntries(names.map(name =>
    [name, fields[name + '_' + lang] ?? (lang === 'eo' ? fields[name] : undefined)]))]));
}

function json(res, value, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

function redirect(res, location) {
  res.writeHead(303, { Location: location });
  res.end();
}

function decodeSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw httpError(400, 'Invalid URL segment');
  }
}

export function createAppServer(options = {}) {
  const config = { ...loadConfig(options.env), ...options.config };
  const lock = storage.createKeyedLock();
  const auth = createAuth(config, { ...storage, withLock: lock });
  const getSiteRoot = () => config.siteDistDir ? path.join(config.siteDistDir, 'current') : config.staticOutDir;
  const stories = createStoriesService({ config, lock, onStoryDeleted: id => likes.deleteTarget('story', id) });
  const likes = createLikesService({ config, lock, auth, storiesService: stories, getSiteRoot });
  const analytics = createAnalyticsService({ config, lock, auth });

  function triggerBuild() {
    return lock.withLock('site-build', async () => {
      const result = await (options.buildSite || buildSite)({
        sourceDir: config.sourceDir, dataDir: config.dataDir,
        outputDir: config.siteDistDir || config.staticOutDir, releaseMode: Boolean(config.siteDistDir),
      });
      likes.invalidateTargets();
      return result;
    });
  }

  const posts = createPostsService({ config, lock, triggerBuild });
  function requireOrigin(req) {
    if (!auth.verifySameOrigin(req)) throw httpError(403, 'forbidden');
  }

  async function requireSession(req) {
    if (!await auth.verifySession(req)) throw httpError(401, 'unauthorized');
    if (req.method !== 'GET' && req.method !== 'HEAD') requireOrigin(req);
  }

  async function handle(req, res) {
    const { method } = req;
    const { pathname, searchParams } = new URL(req.url, 'http://localhost');
    const lang = searchParams.get('lang');
    if (pathname === '/health' && (method === 'GET' || method === 'HEAD')) {
      try {
        await storage.ensureDir(config.dataDir);
        await fs.access(config.dataDir, fsConstants.R_OK | fsConstants.W_OK);
        if (config.siteDistDir) {
          await fs.access(path.join(config.siteDistDir, 'current', 'index.html'), fsConstants.R_OK);
        }
        return res.writeHead(204).end();
      } catch {
        return res.writeHead(503).end();
      }
    }
    if ((method === 'GET' || method === 'HEAD') && pathname.startsWith('/story-media/')) {
      return stories.serveMedia(req, res, decodeSegment(pathname.slice('/story-media/'.length)));
    }
    if ((method === 'GET' || method === 'HEAD') && pathname.startsWith('/stories-admin/assets/')) {
      return serveAdminStatic(req, res, decodeSegment(pathname.slice('/stories-admin/assets/'.length)));
    }

    if (pathname.startsWith('/stories-')) res.setHeader('Cache-Control', 'no-store');
    if (method === 'GET' && pathname === '/stories-admin') {
      const authenticated = await auth.verifySession(req);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(renderAdminPage({ authenticated, lang, loginError: searchParams.has('error') }));
    }

    if (method === 'POST' && (pathname === '/stories-login' || pathname === '/stories-logout')) {
      requireOrigin(req);
      const cookieOptions = { secure: auth.isSecureRequest(req) };
      const login = pathname === '/stories-login';
      const wantsJson = req.headers['content-type']?.split(';')[0].trim().toLowerCase() === 'application/json' ||
        req.headers.accept?.includes('application/json');
      if (login) {
        const { fields } = await readBody(req);
        const ip = auth.getClientIp(req);
        if (auth.loginLimiter.blocked(ip)) {
          res.setHeader('Retry-After', '900');
          throw httpError(429, 'Too many login attempts');
        }
        if (!auth.verifyPassword(fields.password)) {
          auth.loginLimiter.allow(ip);
          if (wantsJson) throw httpError(401, 'unauthorized');
          return redirect(res, '/stories-admin?error=1');
        }
        const session = await auth.createSession();
        auth.loginLimiter.clear(ip);
        res.setHeader('Set-Cookie', auth.buildCookie('story_session', session, { ...cookieOptions, maxAge: sessionMaxAge }));
      } else {
        await auth.revokeSession(req);
        res.setHeader('Set-Cookie', auth.buildCookie('story_session', '', { ...cookieOptions, maxAge: 0 }));
      }
      return wantsJson ? json(res, { ok: true }) : redirect(res, '/stories-admin');
    }

    if (pathname === '/stories-api' && method === 'GET') return json(res, await stories.listPublic(lang));
    if (pathname === '/stories-api/likes') {
      if (method === 'GET') return json(res, await likes.getLikeState(req, searchParams.get('kind'), searchParams.get('id')));
      if (method === 'POST') {
        requireOrigin(req);
        const { fields } = await readBody(req);
        return json(res, await likes.setLikeState(req, res, fields));
      }
    }
    if (pathname === '/stories-api/analytics/visit' && method === 'POST') {
      requireOrigin(req);
      const { fields } = await readBody(req);
      await analytics.recordVisit(req, fields);
      return res.writeHead(204).end();
    }

    const postSlug = /^\/stories-api\/posts\/([^/]+)$/.exec(pathname)?.[1];
    const endpoint = method + ' ' + pathname;
    const adminRoutes = {
      'POST /stories-api': async () => {
        const { fields, files } = await readBody(req, 64 * 1024);
        const primary = typeof fields.primary === 'string' ? parseObject(fields.primary) : fields.primary;
        const translations = translationsFrom(fields, ['title', 'text', 'subtext', 'link_label']);
        if (primary && !fields.translations) translations.eo = primary;
        const story = await stories.saveStory({ ...fields, primary, translations, imageFile: files?.image || files?.imageFile });
        return { ok: true, story };
      },
      'GET /stories-api/admin/stories': async () => {
        const [items, allLikes] = await Promise.all([stories.listAdmin(), likes.listAllSnapshots()]);
        const counts = new Map();
        for (const entry of allLikes.items) {
          if (entry.kind === 'story') counts.set(entry.id, (counts.get(entry.id) || 0) + 1);
        }
        return items.map(item => ({ ...item, likeCount: counts.get(item.id) || 0 }));
      },
      'POST /stories-api/delete': async () => {
        const { fields } = await readBody(req);
        if (typeof fields.id !== 'string' || !fields.id) throw httpError(400, 'Story ID is required');
        await stories.deleteStory(fields.id);
        return { ok: true };
      },
      'GET /stories-api/posts': () => posts.listPosts(),
      'POST /stories-api/posts': async () => {
        const { fields } = await readBody(req, 8 * mebibyte);
        const translations = translationsFrom(fields, ['title', 'body', 'category', 'tags']);
        const pin = typeof fields.pin === 'string' ? ['true', '1', 'on'].includes(fields.pin) : fields.pin;
        return posts.savePost({ ...fields, translations, pin });
      },
      'POST /stories-api/posts/delete': async () => {
        const { fields } = await readBody(req);
        return posts.deletePost(fields.slug);
      },
      'POST /stories-api/posts/metadata': async () => {
        const { fields } = await readBody(req, 8 * mebibyte);
        return posts.inferMetadata(fields.eo || fields.en || fields.tr ? fields : translationsFrom(fields, ['title', 'body']));
      },
      'POST /stories-api/media': async () => {
        const { files } = await readBody(req);
        return { ok: true, ...(await stories.uploadMedia(files?.image || files?.file || files?.media)) };
      },
      'GET /stories-api/analytics/summary': async () => analytics.getSummary(await likes.listAllSnapshots()),
    };
    if (Object.hasOwn(adminRoutes, endpoint)) {
      await requireSession(req);
      return json(res, await adminRoutes[endpoint]());
    }
    if (postSlug && (method === 'GET' || method === 'DELETE')) {
      await requireSession(req);
      const slug = decodeSegment(postSlug);
      return json(res, await (method === 'GET' ? posts.getPost(slug) : posts.deletePost(slug)));
    }

    if (pathname === '/stories-api' || pathname.startsWith('/stories-api/')) throw httpError(404, 'Not found');
    if (options.serveStatic) return options.serveStatic(req, res, pathname, getSiteRoot());
    throw httpError(404, 'Not found');
  }

  const server = http.createServer({ headersTimeout: 10_000, requestTimeout: 30_000, keepAliveTimeout: 15_000 },
    (req, res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      handle(req, res).catch(error => {
        const status = error.status || 500;
        if (status >= 500 && !error.status) console.error(error);
        if (res.headersSent || res.destroyed) {
          res.destroy();
          return;
        }
        if (status === 413) {
          res.setHeader('Connection', 'close');
          req.resume();
        }
        if (status === 429 && !res.hasHeader('Retry-After')) res.setHeader('Retry-After', '60');
        json(res, { error: error.status ? error.message : 'Internal server error' }, status);
      });
    });

  let pruneTimer;
  let startupPrune;
  const pruneOnStartup = () => startupPrune ??= analytics.pruneOldLogs();
  const logPruneError = error => console.error('Could not prune analytics logs:', error);
  server.on('listening', () => {
    pruneOnStartup().catch(logPruneError);
    pruneTimer = setInterval(() => analytics.pruneOldLogs().catch(logPruneError), 6 * 60 * 60 * 1000);
    pruneTimer.unref();
  });
  server.on('close', () => clearInterval(pruneTimer));

  return Object.assign(server, { server, config, triggerBuild, pruneOnStartup, services: { auth, stories, posts, likes, analytics } });
}

export async function startServer(options = {}) {
  const server = createAppServer(options);
  const { config } = server;
  if (!config.storyPassword) throw new Error('STORY_PASSWORD must be set before starting the server');
  await server.pruneOnStartup();
  if (!config.skipInitialBuild) await server.triggerBuild();
  const listening = once(server, 'listening');
  server.listen(config.port, config.host);
  await listening;
  const shutdown = () => server.close();
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  server.once('close', () => {
    process.removeListener('SIGTERM', shutdown);
    process.removeListener('SIGINT', shutdown);
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().then(server => {
    console.log(`Stories server listening on ${server.config.host}:${server.address().port}`);
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
