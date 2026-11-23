import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { LANGUAGES, SITE_META, loadSiteData } from './content.mjs';
import {
  renderAksarayProjectPage,
  renderArchivesPage,
  renderAtomFeed,
  renderAboutPage,
  renderHomePage,
  renderNotFoundPage,
  renderPostPage,
  renderResetPage,
  renderSelfUnregisterSw,
  renderSitemap,
  renderTaxonomyDetailPage,
  renderTaxonomyIndexPage
} from './templates.mjs';

async function writeTextFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, { encoding: 'utf8', mode: 0o644 });
}

async function copyDirRecursive(src, dest) {
  let entries;
  try {
    entries = await fs.readdir(src, { withFileTypes: true });
  } catch {
    return;
  }
  await fs.mkdir(dest, { recursive: true, mode: 0o755 });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      await fs.copyFile(srcPath, destPath);
      await fs.chmod(destPath, 0o644);
    }
  }
}

async function chmodRecursive(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  await fs.chmod(dirPath, 0o755);
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await chmodRecursive(full);
    } else if (entry.isFile()) {
      await fs.chmod(full, 0o644);
    }
  }
}

async function renderIntoDirectory(targetDir, sourceDir, dataDir) {
  const { languageBundles, availablePostSlugsByLang } = await loadSiteData(sourceDir, dataDir);

  // Copy static assets once at root (/assets/img, /assets/css, /assets/js)
  await copyDirRecursive(path.join(sourceDir, 'assets/img'), path.join(targetDir, 'assets/img'));
  await copyDirRecursive(path.join(sourceDir, 'src/assets/css'), path.join(targetDir, 'assets/css'));
  await copyDirRecursive(path.join(sourceDir, 'src/assets/js'), path.join(targetDir, 'assets/js'));

  // Copy CNAME if present
  try {
    const cname = await fs.readFile(path.join(sourceDir, 'CNAME'), 'utf8');
    await writeTextFile(path.join(targetDir, 'CNAME'), cname);
  } catch {
    // optional
  }

  // Self-unregistering service worker to cleanly evict old Chirpy PWA caches
  const swScript = renderSelfUnregisterSw();
  await writeTextFile(path.join(targetDir, 'sw.min.js'), swScript);

  const sitemapUrls = [];
  const mergedTargets = new Map();
  const counts = {};

  for (const lang of LANGUAGES) {
    const bundle = languageBundles[lang.key];
    const langOut = lang.baseurl ? path.join(targetDir, lang.baseurl.replace(/^\//, '')) : targetDir;
    counts[lang.key] = bundle.posts.length;

    // Home
    await writeTextFile(
      path.join(langOut, 'index.html'),
      renderHomePage(bundle, availablePostSlugsByLang)
    );
    sitemapUrls.push({ loc: `${SITE_META.url}${lang.baseurl}/` });

    // About
    await writeTextFile(
      path.join(langOut, 'about/index.html'),
      renderAboutPage(bundle, availablePostSlugsByLang)
    );
    sitemapUrls.push({ loc: `${SITE_META.url}${lang.baseurl}/about/` });

    // Archives
    await writeTextFile(
      path.join(langOut, 'archives/index.html'),
      renderArchivesPage(bundle, availablePostSlugsByLang)
    );
    sitemapUrls.push({ loc: `${SITE_META.url}${lang.baseurl}/archives/` });

    // Categories & Tags (kept cleanly so no legacy links 404)
    await writeTextFile(
      path.join(langOut, 'categories/index.html'),
      renderTaxonomyIndexPage(bundle, 'categories')
    );
    for (const cat of bundle.categories) {
      await writeTextFile(
        path.join(langOut, 'categories', cat.slug, 'index.html'),
        renderTaxonomyDetailPage(bundle, 'categories', cat)
      );
    }

    await writeTextFile(
      path.join(langOut, 'tags/index.html'),
      renderTaxonomyIndexPage(bundle, 'tags')
    );
    for (const tag of bundle.tags) {
      await writeTextFile(
        path.join(langOut, 'tags', tag.slug, 'index.html'),
        renderTaxonomyDetailPage(bundle, 'tags', tag)
      );
    }

    // Individual Posts (ordered chronologically for prev/next navigation)
    const chrono = [...bundle.posts].sort((a, b) => a.date.getTime() - b.date.getTime());
    for (let i = 0; i < chrono.length; i++) {
      const post = chrono[i];
      const prevPost = i > 0 ? chrono[i - 1] : null;
      const nextPost = i < chrono.length - 1 ? chrono[i + 1] : null;
      await writeTextFile(
        path.join(langOut, 'posts', post.slug, 'index.html'),
        renderPostPage(bundle, post, prevPost, nextPost, availablePostSlugsByLang)
      );
      sitemapUrls.push({
        loc: `${SITE_META.url}${post.url}`,
        lastmod: post.dateIso
      });
    }

    // Aksaray Red Car Study project page
    await writeTextFile(
      path.join(langOut, 'projects/aksaray-kirmizi-araba/index.html'),
      renderAksarayProjectPage(bundle)
    );

    // 404, Reset cache page, legacy sw.min.js under sub-languages
    await writeTextFile(path.join(langOut, '404.html'), renderNotFoundPage(bundle));
    await writeTextFile(path.join(langOut, 'reset-site.html'), renderResetPage(bundle));
    if (lang.baseurl) {
      await writeTextFile(path.join(langOut, 'sw.min.js'), swScript);
    }

    // Atom feed
    await writeTextFile(path.join(langOut, 'feed.xml'), renderAtomFeed(bundle));

    // Search index JSON for instant ⌘K search
    const searchIndex = bundle.posts.map((p) => ({
      title: p.title,
      url: p.url,
      date: p.dateFormatted,
      excerpt: p.excerpt,
      categories: p.categories,
      tags: p.tags,
      readTime: p.readingMinutes
    }));
    await writeTextFile(path.join(langOut, 'search.json'), JSON.stringify(searchIndex));

    // Like targets manifest (compatible with likes backend)
    const likeTargets = [
      ...bundle.posts.map((p) => ({ kind: 'post', id: p.canonicalPath, title: p.title })),
      ...bundle.stories.map((s) => ({ kind: 'story', id: s.id, title: s.title || s.text }))
    ];
    await writeTextFile(path.join(langOut, 'like-targets.json'), JSON.stringify(likeTargets, null, 2) + '\n');

    for (const item of likeTargets) {
      const key = `${item.kind}:${item.id}`;
      if (!mergedTargets.has(key)) mergedTargets.set(key, item);
    }
  }

  // Root sitemap & robots.txt
  await writeTextFile(path.join(targetDir, 'sitemap.xml'), renderSitemap(sitemapUrls));
  await writeTextFile(
    path.join(targetDir, 'robots.txt'),
    `User-agent: *\nAllow: /\nDisallow: /stories-admin\nDisallow: /stories-api\n\nSitemap: ${SITE_META.url}/sitemap.xml\n`
  );

  await chmodRecursive(targetDir);

  return {
    counts,
    targets: Array.from(mergedTargets.values())
  };
}

export async function buildSite({
  sourceDir = process.cwd(),
  dataDir = process.env.DATA_DIR || path.join(sourceDir, 'deploy/data'),
  outputDir = path.join(sourceDir, '_site'),
  releaseMode = false
} = {}) {
  const started = Date.now();
  const absSource = path.resolve(sourceDir);
  const absData = path.resolve(dataDir);
  const absOutput = path.resolve(outputDir);

  if (releaseMode) {
    const releasesDir = path.join(absOutput, 'releases');
    await fs.mkdir(releasesDir, { recursive: true, mode: 0o755 });
    const releaseId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const releasePath = path.join(releasesDir, releaseId);

    try {
      const result = await renderIntoDirectory(releasePath, absSource, absData);
      const tmpLink = path.join(absOutput, `.current.tmp.${releaseId}`);
      await fs.symlink(path.join('releases', releaseId), tmpLink);
      await fs.rename(tmpLink, path.join(absOutput, 'current'));

      // Prune old releases, keeping 3 newest
      const existing = (await fs.readdir(releasesDir)).sort().reverse();
      for (const old of existing.slice(3)) {
        await fs.rm(path.join(releasesDir, old), { recursive: true, force: true }).catch(() => {});
      }

      return {
        builtAt: new Date().toISOString(),
        buildMs: Date.now() - started,
        releasePath: path.join(absOutput, 'current'),
        ...result
      };
    } catch (err) {
      await fs.rm(releasePath, { recursive: true, force: true }).catch(() => {});
      throw err;
    }
  }

  // Standard directory mode (atomic swap via sibling temp dir)
  const parent = path.dirname(absOutput);
  await fs.mkdir(parent, { recursive: true });
  const stageDir = path.join(parent, `.site-stage-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);

  try {
    const result = await renderIntoDirectory(stageDir, absSource, absData);
    await fs.rm(absOutput, { recursive: true, force: true });
    await fs.rename(stageDir, absOutput);
    return {
      builtAt: new Date().toISOString(),
      buildMs: Date.now() - started,
      releasePath: absOutput,
      ...result
    };
  } catch (err) {
    await fs.rm(stageDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const outArg = process.argv[2] || '_site';
  const result = await buildSite({ outputDir: outArg });
  console.log(
    `Built fmert.me -> ${result.releasePath} in ${result.buildMs}ms (eo:${result.counts.eo}, en:${result.counts.en}, tr:${result.counts.tr})`
  );
}
