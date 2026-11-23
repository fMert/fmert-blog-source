import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildSite } from '../src/builder/build.mjs';

const SOURCE_DIR = process.cwd();

async function listFilesRecursive(dir) {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listFilesRecursive(full)));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

test('buildSite generates all 3 languages with valid internal links and manifests', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fmert-build-test-'));
  try {
    const dataDir = path.join(tmp, 'data');
    const outDir = path.join(tmp, 'site');

    // Add a legacy Turkish-only post and a draft that MUST NOT appear in output
    await fs.mkdir(path.join(dataDir, 'posts/.drafts'), { recursive: true });
    await fs.writeFile(
      path.join(dataDir, 'posts/2026-07-01-legacy-tr-post.md'),
      '---\ntitle: Eski Türkçe Yazı\ndate: 2026-07-01 12:00:00 +0300\ncategories: [Genel]\ntags: [test]\n---\n\nMerhaba.\n'
    );
    await fs.writeFile(
      path.join(dataDir, 'posts/.drafts/secret-draft.json'),
      JSON.stringify({ slug: 'secret-draft', status: 'draft', translations: { eo: { title: 'Secret', body: 'Hidden' } } })
    );

    const res = await buildSite({ sourceDir: SOURCE_DIR, dataDir, outputDir: outDir, releaseMode: false });
    assert.equal(res.counts.eo, 6);
    assert.equal(res.counts.en, 6);
    assert.equal(res.counts.tr, 7);

    // Draft must not be built
    assert.equal(await exists(path.join(outDir, 'posts/secret-draft/index.html')), false);
    // Legacy Turkish-only post must be built under /tr/ only
    assert.equal(await exists(path.join(outDir, 'tr/posts/legacy-tr-post/index.html')), true);
    assert.equal(await exists(path.join(outDir, 'posts/legacy-tr-post/index.html')), false);

    // Verify key outputs exist
    for (const rel of [
      'index.html', 'en/index.html', 'tr/index.html',
      'about/index.html', 'en/about/index.html', 'tr/about/index.html',
      'archives/index.html', 'en/archives/index.html', 'tr/archives/index.html',
      'projects/aksaray-kirmizi-araba/index.html',
      'en/projects/aksaray-kirmizi-araba/index.html',
      'tr/projects/aksaray-kirmizi-araba/index.html',
      'feed.xml', 'en/feed.xml', 'tr/feed.xml',
      'search.json', 'en/search.json', 'tr/search.json',
      'like-targets.json', 'en/like-targets.json', 'tr/like-targets.json',
      'sitemap.xml', 'robots.txt', 'sw.min.js', 'reset-site.html',
      'assets/css/main.css', 'assets/js/site.js', 'assets/js/stories.js',
      'assets/js/likes.js', 'assets/js/analytics.js'
    ]) {
      assert.equal(await exists(path.join(outDir, rel)), true, `Missing output file: ${rel}`);
    }

    // Internal link integrity check across every HTML file (replaces html-proofer)
    const allFiles = await listFilesRecursive(outDir);
    const htmlFiles = allFiles.filter((f) => f.endsWith('.html'));
    assert.ok(htmlFiles.length > 30, 'Expected >30 HTML files');

    const attrRe = /\b(?:href|src)="(\/[^"#?]*)(?:[?#][^"]*)?"/g;
    for (const htmlFile of htmlFiles) {
      const content = await fs.readFile(htmlFile, 'utf8');
      let match;
      while ((match = attrRe.exec(content)) !== null) {
        const rawUrl = decodeURIComponent(match[1]);
        if (rawUrl.startsWith('/stories-') || rawUrl.startsWith('/story-media/')) continue;
        const candidate = rawUrl.endsWith('/')
          ? path.join(outDir, rawUrl, 'index.html')
          : path.join(outDir, rawUrl);
        const altCandidate = path.join(outDir, rawUrl, 'index.html');
        const ok = (await exists(candidate)) || (await exists(altCandidate));
        assert.equal(ok, true, `Broken internal link ${rawUrl} in ${path.relative(outDir, htmlFile)}`);
      }
    }

    // Verify search.json and like-targets.json parse cleanly
    const searchTr = JSON.parse(await fs.readFile(path.join(outDir, 'tr/search.json'), 'utf8'));
    assert.equal(searchTr.length, 7);
    const likeTargetsEo = JSON.parse(await fs.readFile(path.join(outDir, 'like-targets.json'), 'utf8'));
    assert.ok(likeTargetsEo.some((x) => x.kind === 'post' && x.id === '/posts/aria/'));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('buildSite releaseMode swaps current symlink atomically and prunes old releases', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fmert-release-test-'));
  try {
    const dataDir = path.join(tmp, 'data');
    const distDir = path.join(tmp, 'dist');
    for (let i = 0; i < 5; i++) {
      const res = await buildSite({ sourceDir: SOURCE_DIR, dataDir, outputDir: distDir, releaseMode: true });
      assert.equal(await exists(path.join(res.releasePath, 'index.html')), true);
    }
    const linkTarget = await fs.readlink(path.join(distDir, 'current'));
    assert.match(linkTarget, /^releases\//);
    const releases = await fs.readdir(path.join(distDir, 'releases'));
    assert.equal(releases.length, 3, 'Should retain only the 3 latest releases');
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
