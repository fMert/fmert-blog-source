import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { startServer } from './index.mjs';
import { httpError, safeJoin } from './storage.mjs';

const mimeTypes = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.pdf': 'application/pdf',
  '.webm': 'video/webm', '.mp4': 'video/mp4',
}));

async function serveStatic(req, res, pathname, root) {
  if ((req.method !== 'GET' && req.method !== 'HEAD') ||
      pathname.startsWith('/stories-') || pathname.startsWith('/story-media/')) throw httpError(404, 'Not found');
  let file;
  try {
    const relative = decodeURIComponent(pathname).slice(1);
    if (relative.includes('\\') || relative.includes('\0')) throw new Error('Invalid path');
    file = safeJoin(root, relative || 'index.html');
  } catch {
    throw httpError(404, 'Not found');
  }

  const statOrMissing = file => fs.stat(file).catch(error => {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
  });
  let stat = await statOrMissing(file);
  if (stat?.isDirectory()) {
    file = path.join(file, 'index.html');
    stat = await statOrMissing(file);
  }
  if (!stat?.isFile()) throw httpError(404, 'Not found');

  const handle = await fs.open(file, 'r');
  try {
    res.writeHead(200, {
      'Content-Type': mimeTypes.get(path.extname(file).toLowerCase()) ?? 'application/octet-stream',
      'Content-Length': (await handle.stat()).size,
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') res.end();
    else await pipeline(handle.createReadStream(), res);
  } finally {
    await handle.close();
  }
}

const sourceDir = path.resolve(process.env.SOURCE_DIR || process.cwd());
try {
  const server = await startServer({
    env: {
      ...process.env,
      SOURCE_DIR: sourceDir,
      STORY_PASSWORD: process.env.STORY_PASSWORD || 'dev',
      DATA_DIR: path.join(sourceDir, 'deploy/data'),
      SITE_DIST_DIR: '',
      STATIC_OUT_DIR: path.join(sourceDir, '_site'),
      SKIP_INITIAL_BUILD: 'false',
      COOKIE_SECURE: 'false',
      HOST: process.env.HOST || '127.0.0.1',
      PORT: process.env.PORT || '4000',
    },
    serveStatic,
  });
  console.log(`Development server listening on http://127.0.0.1:${server.address().port}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
