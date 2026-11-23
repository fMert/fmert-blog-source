import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { createRateLimiter } from './auth.mjs';
import { ensureDir, httpError, readDir, removeFile } from './storage.mjs';

const dayMs = 86_400_000;
const istanbulOffset = 3 * 60 * 60 * 1000;
const dayOf = time => new Date(time).toISOString().slice(0, 10);
const logPattern = /^\d{4}-\d{2}-\d{2}\.jsonl$/;

function referrerName(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:' || url.protocol === 'http:') {
      return url.hostname === 'www.fmert.me' ? 'fmert.me' : url.hostname.slice(0, 100);
    }
  } catch {
    // The referrer can be empty or unavailable.
  }
  return 'Direct / unknown';
}

export function visitFromRequest(req, auth, page, referrer) {
  const ua = (req.headers['user-agent'] || '').slice(0, 1000);
  const device = /bot|crawler|spider|slurp|headless/i.test(ua) ? 'Bot'
    : /ipad|tablet|kindle|silk/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua)) ? 'Tablet'
    : /mobile|iphone|android/i.test(ua) ? 'Mobile' : 'Desktop';
  const browser = [
    ['Edge', /edg(?:e|a|ios)?\//i], ['Opera', /opr\/|opera/i], ['Firefox', /firefox\/|fxios\//i],
    ['Chrome', /chrome\/|crios\//i], ['Safari', /safari\//i],
  ].find(([, pattern]) => pattern.test(ua))?.[0] ?? 'Other';
  return { at: new Date().toISOString(), path: page, ip: auth.getClientIp(req), device, browser, referrer: referrerName(referrer) };
}

export function createAnalyticsService({ config, lock, auth }) {
  const dir = path.join(config.dataDir, 'analytics');
  const limiter = createRateLimiter(60, 60_000, 600);

  async function prune(now) {
    const cutoff = dayOf(now - 30 * dayMs);
    const current = [];
    for (const entry of await readDir(dir)) {
      if (!entry.isFile() || !logPattern.test(entry.name)) continue;
      const day = entry.name.slice(0, 10);
      const date = Date.parse(day);
      if (Number.isNaN(date) || dayOf(date) !== day) continue;
      const file = path.join(dir, entry.name);
      if (day < cutoff) await removeFile(file);
      else current.push({ day, file });
    }
    return current;
  }

  function pruneOldLogs() {
    return lock.withLock('analytics', () => prune(Date.now()));
  }

  function recordVisit(req, payload) {
    if (!auth.verifySameOrigin(req)) throw httpError(403, 'forbidden');
    const raw = payload?.path;
    const referrer = payload?.referrer;
    if (typeof raw !== 'string' || raw.length > 512 || !raw.startsWith('/') || raw.startsWith('//') ||
        /[\\\u0000-\u0020]/.test(raw) || (referrer != null && typeof referrer !== 'string')) {
      throw httpError(400, 'Invalid visit');
    }
    const page = new URL(raw, 'http://localhost').pathname;
    if (page.startsWith('/stories-')) throw httpError(400, 'Invalid visit path');
    if (!limiter.allow(auth.getClientIp(req))) throw httpError(429, 'Too many visits');
    const visit = visitFromRequest(req, auth, page, referrer);
    const day = visit.at.slice(0, 10);
    const json = JSON.stringify(visit) + '\n';

    return lock.withLock('analytics', async () => {
      const files = await prune(Date.now());
      let total = 0;
      let daily = 0;
      for (const entry of files) {
        const { size } = await fs.stat(entry.file);
        total += size;
        if (entry.day === day) daily = size;
      }
      await ensureDir(dir);
      const file = await fs.open(path.join(dir, day + '.jsonl'), 'a+');
      try {
        let line = json;
        if (daily > 0) {
          const last = Buffer.alloc(1);
          await file.read(last, 0, 1, daily - 1);
          if (last[0] !== 10) line = '\n' + line;
        }
        const bytes = Buffer.byteLength(line);
        if (daily + bytes > 10 << 20 || total + bytes > 100 << 20) {
          throw httpError(503, 'Analytics storage limit reached');
        }
        await file.appendFile(line);
      } finally {
        await file.close();
      }
    });
  }

  function getSummary(likes = { totalLikes: 0, items: [] }) {
    return lock.withLock('analytics', async () => {
      const now = Date.now();
      const today = dayOf(now + istanbulOffset);
      const daily = new Map(Array.from({ length: 30 }, (_, index) => [dayOf(now - (29 - index) * dayMs), 0]));
      const totals = { views: 0, uniqueIps: 0, todayViews: 0, totalLikes: likes.totalLikes };
      const ips = new Set();
      const counts = { path: new Map(), device: new Map(), browser: new Map(), referrer: new Map() };
      let recentVisits = [];
      const newest = (a, b) => b.at.localeCompare(a.at);
      for (const { day, file } of await prune(now)) {
        if (!daily.has(day)) continue;
        const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
        for await (const line of lines) {
          let raw;
          try {
            raw = JSON.parse(line);
          } catch {
            continue;
          }
          const time = Date.parse(raw?.at ?? raw?.time);
          if (!Number.isFinite(time) || typeof raw.path !== 'string') continue;
          const at = new Date(time).toISOString();
          const { ip, device, browser, referrer } = raw;
          const visit = { at, path: raw.path, ip, device, browser, referrer };
          daily.set(day, daily.get(day) + 1);
          totals.views++;
          if (dayOf(time + istanbulOffset) === today) totals.todayViews++;
          if (ip && ip !== 'unknown') ips.add(ip);
          for (const [key, map] of Object.entries(counts)) {
            const value = visit[key];
            if (typeof value === 'string' && value) map.set(value, (map.get(value) || 0) + 1);
          }
          recentVisits.push(visit);
          if (recentVisits.length === 200) recentVisits = recentVisits.sort(newest).slice(0, 100);
        }
      }
      totals.uniqueIps = ips.size;
      const ranked = map => [...map].map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      return {
        totals,
        dailySeries: [...daily].map(([date, views]) => ({ date, views })),
        topPages: ranked(counts.path).slice(0, 15),
        devices: ranked(counts.device),
        browsers: ranked(counts.browser),
        referrers: ranked(counts.referrer).slice(0, 15),
        recentVisits: recentVisits.sort(newest).slice(0, 100),
        likes,
      };
    });
  }

  return { pruneOldLogs, recordVisit, getSummary };
}
