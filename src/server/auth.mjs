import crypto from 'node:crypto';
import { isIP } from 'node:net';
import path from 'node:path';
import * as defaultStorage from './storage.mjs';

const day = 24 * 60 * 60;
export const sessionMaxAge = 7 * day;
const hash = value => crypto.createHash('sha256').update(value).digest();
const mac = (key, value) => crypto.createHmac('sha256', key).update(value).digest();

export function parseCookies(req) {
  const cookies = Object.create(null);
  for (const part of (req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    try {
      cookies[name] ??= decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      // Ignore malformed cookie values.
    }
  }
  return cookies;
}

export function buildCookie(name, value, { maxAge, secure, httpOnly = true, sameSite = 'Strict', path = '/' } = {}) {
  const parts = [name + '=' + encodeURIComponent(value), 'Path=' + path];
  if (maxAge !== undefined) parts.push('Max-Age=' + maxAge);
  if (secure) parts.push('Secure');
  if (httpOnly) parts.push('HttpOnly');
  if (sameSite) parts.push('SameSite=' + sameSite);
  return parts.join('; ');
}

export function isSecureRequest(req, config) {
  if (typeof config.cookieSecure === 'boolean') return config.cookieSecure;
  return Boolean(req.socket?.encrypted || req.headers['x-forwarded-proto'] === 'https');
}

export function verifySameOrigin(req, config = {}) {
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return false;
  const host = (config.trustProxyHeaders && req.headers['x-forwarded-host']) || req.headers.host;
  try {
    const origin = new URL(req.headers.origin);
    return (origin.protocol === 'http:' || origin.protocol === 'https:') &&
      origin.host === new URL(origin.protocol + '//' + host).host &&
      Boolean(host) && !origin.username && !origin.password &&
      origin.pathname === '/' && !origin.search && !origin.hash;
  } catch {
    return false;
  }
}

export function getClientIp(req, config = {}) {
  const remote = req.socket?.remoteAddress || 'unknown';
  if (config.trustProxyHeaders || ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) {
    const entries = (req.headers['x-forwarded-for'] || '').split(',');
    for (let i = entries.length - 1; i >= 0; i--) {
      const candidate = entries[i].trim();
      if (isIP(candidate)) return candidate;
    }
  }
  return remote;
}

export function createRateLimiter(limit, period, totalLimit = Infinity) {
  const clients = new Map();
  let total = 0;
  let totalExpires = 0;
  function count(key, now = Date.now()) {
    const current = clients.get(key);
    clients.delete(key);
    if (!current || current.expires <= now) return 0;
    clients.set(key, current);
    return current.count;
  }
  function allow(key) {
    const now = Date.now();
    const used = count(key, now);
    if (now >= totalExpires) {
      total = 0;
      totalExpires = now + period;
    }
    if (used >= limit || total >= totalLimit) return false;
    if (!used && clients.size >= 4096) clients.delete(clients.keys().next().value);
    clients.set(key, { count: used + 1, expires: clients.get(key)?.expires ?? now + period });
    total++;
    return true;
  }
  return { allow, blocked: key => count(key) >= limit, clear: key => clients.delete(key) };
}

export function createAuth(config, storage = defaultStorage) {
  const passwordHash = hash(config.storyPassword);
  const sessionKey = mac(config.storyPassword, 'fmert-admin-session-v2');
  const visitorKey = mac(config.storyPassword, 'fmert-visitor-likes-v2');
  const loginLimiter = createRateLimiter(10, 15 * 60 * 1000);
  const sessionFile = path.join(config.dataDir, '.sessions.json');
  const withLock = storage.withLock || storage.createKeyedLock();

  function sessions(fn) {
    return withLock('admin-sessions', async () => {
      const now = Date.now();
      const saved = await storage.readJsonStrict(sessionFile, {});
      const active = Object.fromEntries(Object.entries(saved).filter(([, session]) => session?.expiresAt > now));
      const result = fn(active, now);
      if (JSON.stringify(saved) !== JSON.stringify(active)) await storage.atomicWriteJson(sessionFile, active);
      return result;
    });
  }

  function sessionHash(req) {
    const token = parseCookies(req).story_session;
    return /^[a-f0-9]{64}$/.test(token || '') ? hash(token).toString('hex') : '';
  }

  function createSession() {
    const token = mac(sessionKey, crypto.randomBytes(32)).toString('hex');
    return sessions((active, now) => {
      active[hash(token).toString('hex')] = { createdAt: now, expiresAt: now + sessionMaxAge * 1000 };
      return token;
    });
  }

  function verifySession(req) {
    const key = sessionHash(req);
    return key ? sessions(active => Object.hasOwn(active, key)) : false;
  }

  function revokeSession(req) {
    const key = sessionHash(req);
    if (key) return sessions(active => delete active[key]);
  }

  function verifyPassword(candidate) {
    return typeof candidate === 'string' && crypto.timingSafeEqual(hash(candidate), passwordHash);
  }

  function getVisitorId(req) {
    const cookie = parseCookies(req).fmert_likes;
    const match = /^([a-f0-9]{32}|[a-f0-9]{64})\.([a-f0-9]{64})$/.exec(cookie || '');
    if (!match) return '';
    const [, id, signature] = match;
    const received = Buffer.from(signature, 'hex');
    const valid = crypto.timingSafeEqual(received, mac(visitorKey, id)) ||
      (id.length === 64 && crypto.timingSafeEqual(received, mac(config.storyPassword, 'like-visitor:' + id)));
    return valid ? hash(id).toString('hex') : '';
  }

  function getOrCreateVisitorId(req, res) {
    const existing = getVisitorId(req);
    if (existing) return existing;
    const id = crypto.randomBytes(16).toString('hex');
    const cookie = buildCookie('fmert_likes', id + '.' + mac(visitorKey, id).toString('hex'), {
      maxAge: 365 * day,
      secure: isSecureRequest(req, config),
    });
    res.setHeader('Set-Cookie', cookie);
    return hash(id).toString('hex');
  }

  return {
    createSession, verifySession, revokeSession, verifyPassword, loginLimiter,
    getVisitorId, getOrCreateVisitorId, parseCookies, buildCookie,
    isSecureRequest: req => isSecureRequest(req, config),
    verifySameOrigin: req => verifySameOrigin(req, config),
    getClientIp: req => getClientIp(req, config),
  };
}
