import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { createAppServer } from '../src/server/index.mjs';
import { validateImageBuffer } from '../src/server/storage.mjs';

const SOURCE_DIR = process.cwd();
const PASSWORD = 'test-secret-password-2026';

async function startTestServer(extraEnv = {}, extraOpts = {}) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fmert-server-test-'));
  const dataDir = path.join(tmp, 'data');
  const distDir = path.join(tmp, 'dist');
  await fs.mkdir(dataDir, { recursive: true });

  const server = createAppServer({
    env: {
      STORY_PASSWORD: PASSWORD,
      DATA_DIR: dataDir,
      SOURCE_DIR,
      SITE_DIST_DIR: distDir,
      TRUST_PROXY_HEADERS: 'false',
      COOKIE_SECURE: 'false',
      ...extraEnv
    },
    ...extraOpts
  });
  await server.triggerBuild();
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    dataDir,
    distDir,
    server,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await fs.rm(tmp, { recursive: true, force: true });
    }
  };
}

function cookieHeader(response) {
  const raw = response.headers.getSetCookie?.() || [];
  return raw.map((c) => c.split(';')[0]).join('; ');
}

test('validateImageBuffer accepts real avatar.jpg and rejects forged zero-padded PNG', async () => {
  const avatar = await fs.readFile(path.join(SOURCE_DIR, 'assets/img/avatar.jpg'));
  const ok = validateImageBuffer(avatar);
  assert.equal(ok.ok, true, `Expected avatar.jpg to be valid, got: ${ok.error}`);
  assert.equal(ok.ext, 'jpg');

  const forgedPng = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64)]);
  const bad = validateImageBuffer(forgedPng);
  assert.equal(bad.ok, false);
});

test('auth: POST-only login, server-side session revocation on logout, and 401 JSON on API', async () => {
  const ctx = await startTestServer();
  try {
    // Health endpoint verifies data dir + active built release
    const healthRes = await fetch(`${ctx.baseUrl}/health`);
    assert.equal(healthRes.status, 204);

    // Unauthenticated API returns 401 JSON (never 302 redirect!)
    const unauth = await fetch(`${ctx.baseUrl}/stories-api/posts`, { redirect: 'manual' });
    assert.equal(unauth.status, 401);

    // Query-string password MUST NOT log in
    const queryLogin = await fetch(`${ctx.baseUrl}/stories-login?password=${PASSWORD}`, {
      method: 'POST',
      headers: { Origin: ctx.baseUrl, Accept: 'application/json' }
    });
    assert.equal(queryLogin.status, 401);

    // Valid POST JSON login succeeds
    const loginRes = await fetch(`${ctx.baseUrl}/stories-login`, {
      method: 'POST',
      headers: {
        Origin: ctx.baseUrl,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ password: PASSWORD })
    });
    assert.equal(loginRes.status, 200);
    const cookie = cookieHeader(loginRes);
    assert.match(cookie, /story_session=/);

    // Authenticated request works
    const authed = await fetch(`${ctx.baseUrl}/stories-api/posts`, { headers: { Cookie: cookie } });
    assert.equal(authed.status, 200);

    // Logout revokes token immediately on server
    const logoutRes = await fetch(`${ctx.baseUrl}/stories-logout`, {
      method: 'POST',
      headers: { Origin: ctx.baseUrl, Accept: 'application/json', Cookie: cookie }
    });
    assert.equal(logoutRes.status, 200);

    // Replaying the old cookie after logout MUST fail with 401!
    const replayed = await fetch(`${ctx.baseUrl}/stories-api/posts`, { headers: { Cookie: cookie } });
    assert.equal(replayed.status, 401);
  } finally {
    await ctx.close();
  }
});

test('stories: create, edit, type-switch cleanup, image upload, likes cleanup on delete', async () => {
  const ctx = await startTestServer();
  try {
    const loginRes = await fetch(`${ctx.baseUrl}/stories-login`, {
      method: 'POST',
      headers: { Origin: ctx.baseUrl, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD })
    });
    const adminCookie = cookieHeader(loginRes);

    // Create Turkish-only photo story using real avatar.jpg
    const avatarBytes = await fs.readFile(path.join(SOURCE_DIR, 'assets/img/avatar.jpg'));
    const form = new FormData();
    form.append('type', 'image');
    form.append('translations', JSON.stringify({
      eo: { title: '', text: '', subtext: '', link_label: '' },
      en: { title: '', text: '', subtext: '', link_label: '' },
      tr: { title: 'Foto', text: 'Yeni deneme', subtext: 'Aksaray', link_label: '' }
    }));
    form.append('image', new Blob([avatarBytes], { type: 'image/jpeg' }), 'avatar.jpg');

    const createRes = await fetch(`${ctx.baseUrl}/stories-api`, {
      method: 'POST',
      headers: { Origin: ctx.baseUrl, Cookie: adminCookie },
      body: form
    });
    assert.equal(createRes.status, 200);
    const { story } = await createRes.json();
    assert.equal(story.type, 'image');
    assert.match(story.image, /^\/story-media\//);
    assert.equal(story.translations.eo.text, '');
    assert.equal(story.translations.tr.text, 'Yeni deneme');

    // Uploaded image is served cleanly
    const mediaRes = await fetch(`${ctx.baseUrl}${story.image}`);
    assert.equal(mediaRes.status, 200);
    assert.equal(mediaRes.headers.get('content-type'), 'image/jpeg');

    // Public visitor likes the story
    const likeRes = await fetch(`${ctx.baseUrl}/stories-api/likes`, {
      method: 'POST',
      headers: { Origin: ctx.baseUrl, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'story', id: story.id, liked: true, page: '/tr/' })
    });
    assert.equal(likeRes.status, 200);
    const likeData = await likeRes.json();
    assert.equal(likeData.count, 1);
    assert.equal(likeData.liked, true);

    // Admin stories list includes accurate likeCount
    const adminList = await (await fetch(`${ctx.baseUrl}/stories-api/admin/stories`, {
      headers: { Cookie: adminCookie }
    })).json();
    assert.equal(adminList[0].likeCount, 1);

    // Edit story: switch from image -> link (must clean up old image file!)
    const editRes = await fetch(`${ctx.baseUrl}/stories-api`, {
      method: 'POST',
      headers: { Origin: ctx.baseUrl, Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: story.id,
        type: 'link',
        bg: '#23334d',
        link: '/posts/aria/',
        translations: {
          eo: { title: 'Aria', text: 'Legu pri Aria', subtext: '', link_label: 'Malfermi' },
          en: { title: 'Aria', text: 'Read about Aria', subtext: '', link_label: 'Open' },
          tr: { title: 'Aria', text: 'Aria yazısı', subtext: '', link_label: 'Oku' }
        }
      })
    });
    assert.equal(editRes.status, 200);
    const { story: edited } = await editRes.json();
    assert.equal(edited.image, '');
    assert.equal(edited.link, '/posts/aria/');
    // Old media should have been deleted
    assert.equal((await fetch(`${ctx.baseUrl}${story.image}`)).status, 404);

    // Public API localizes link for /tr/
    const publicTr = await (await fetch(`${ctx.baseUrl}/stories-api?lang=tr`)).json();
    assert.equal(publicTr[0].link, '/tr/posts/aria/');
    assert.equal(publicTr[0].text, 'Aria yazısı');

    // Delete story: must also remove its like file!
    const delRes = await fetch(`${ctx.baseUrl}/stories-api/delete`, {
      method: 'POST',
      headers: { Origin: ctx.baseUrl, Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: story.id })
    });
    assert.equal(delRes.status, 200);

    const likesAfterDelete = await (await fetch(`${ctx.baseUrl}/stories-api/likes?kind=story&id=${story.id}`)).json();
    assert.equal(likesAfterDelete.count, 0);
  } finally {
    await ctx.close();
  }
});

test('posts: drafts never leak into builds, publish builds live atomically, edit & delete update site', async () => {
  const ctx = await startTestServer();
  try {
    const loginRes = await fetch(`${ctx.baseUrl}/stories-login`, {
      method: 'POST',
      headers: { Origin: ctx.baseUrl, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD })
    });
    const adminCookie = cookieHeader(loginRes);

    // 1. Metadata inference works past 80 chars (fixes old truncation bug!)
    const longPrefix = 'lorem ipsum '.repeat(20);
    const metaRes = await fetch(`${ctx.baseUrl}/stories-api/posts/metadata`, {
      method: 'POST',
      headers: { Origin: ctx.baseUrl, Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tr: { title: 'Deneme Notu', body: `${longPrefix} Python ve Linux terminalinde Markdown yazıyorum.` }
      })
    });
    assert.equal(metaRes.status, 200);
    const meta = await metaRes.json();
    assert.ok(meta.tags.tr.includes('python'));
    assert.ok(meta.tags.tr.includes('linux'));
    assert.ok(meta.tags.tr.includes('markdown'));

    // 2. Save draft -> MUST NOT appear in built site
    const draftRes = await fetch(`${ctx.baseUrl}/stories-api/posts`, {
      method: 'POST',
      headers: { Origin: ctx.baseUrl, Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: 'my-test-draft',
        status: 'draft',
        translations: {
          tr: { title: 'Taslak Yazı', body: 'Bu henüz taslak.' }
        }
      })
    });
    assert.equal(draftRes.status, 200);
    await assert.rejects(
      fs.access(path.join(ctx.distDir, 'current/tr/posts/my-test-draft/index.html'))
    );

    // 3. Publish post -> built atomically and immediately exists in dist/current!
    const pubRes = await fetch(`${ctx.baseUrl}/stories-api/posts`, {
      method: 'POST',
      headers: { Origin: ctx.baseUrl, Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        originalSlug: 'my-test-draft',
        slug: 'my-test-draft',
        status: 'published',
        translations: {
          en: { title: 'Live Test Post', body: 'Hello from **Node**.' },
          tr: { title: 'Canlı Test Yazısı', body: 'Merhaba **Node**.' }
        }
      })
    });
    assert.equal(pubRes.status, 200);
    const pubJson = await pubRes.json();
    assert.equal(pubJson.ok, true);
    assert.equal(pubJson.urls.tr, '/tr/posts/my-test-draft/');
    assert.equal(pubJson.urls.en, '/en/posts/my-test-draft/');

    const builtHtml = await fs.readFile(path.join(ctx.distDir, 'current/tr/posts/my-test-draft/index.html'), 'utf8');
    assert.match(builtHtml, /Canlı Test Yazısı/);
    assert.match(builtHtml, /<strong>Node<\/strong>/);

    // 4. Delete post -> removed from live build atomically
    const delRes = await fetch(`${ctx.baseUrl}/stories-api/posts/my-test-draft`, {
      method: 'DELETE',
      headers: { Origin: ctx.baseUrl, Cookie: adminCookie }
    });
    assert.equal(delRes.status, 200);
    await assert.rejects(
      fs.access(path.join(ctx.distDir, 'current/tr/posts/my-test-draft/index.html'))
    );
  } finally {
    await ctx.close();
  }
});

test('analytics: auto-prunes >30d files, recovers from truncated JSONL lines, aggregates dashboard', async () => {
  const ctx = await startTestServer();
  try {
    const analyticsDir = path.join(ctx.dataDir, 'analytics');
    await fs.mkdir(analyticsDir, { recursive: true });
    // Write an ancient file (45 days ago) that must be auto-pruned
    const oldDay = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10);
    const oldFile = path.join(analyticsDir, `${oldDay}.jsonl`);
    await fs.writeFile(oldFile, '{"at":"2020-01-01T00:00:00Z","path":"/old/"}\n');

    // Write today's file with a truncated trailing line (no newline!)
    const today = new Date().toISOString().slice(0, 10);
    const todayFile = path.join(analyticsDir, `${today}.jsonl`);
    await fs.writeFile(todayFile, '{"broken-truncated-line"');

    // Record a real visit
    const visitRes = await fetch(`${ctx.baseUrl}/stories-api/analytics/visit`, {
      method: 'POST',
      headers: {
        Origin: ctx.baseUrl,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0'
      },
      body: JSON.stringify({ path: '/tr/posts/aria/', referrer: 'https://github.com/fMert' })
    });
    assert.equal(visitRes.status, 204);

    // Old file should already be pruned without admin opening dashboard!
    await assert.rejects(fs.access(oldFile));

    // Login and check dashboard summary includes the visit cleanly despite prior truncated line
    const loginRes = await fetch(`${ctx.baseUrl}/stories-login`, {
      method: 'POST',
      headers: { Origin: ctx.baseUrl, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD })
    });
    const adminCookie = cookieHeader(loginRes);
    const summary = await (await fetch(`${ctx.baseUrl}/stories-api/analytics/summary`, {
      headers: { Cookie: adminCookie }
    })).json();

    assert.equal(summary.totals.views, 1);
    assert.equal(summary.dailySeries.length, 30);
    assert.equal(summary.topPages[0].name, '/tr/posts/aria/');
    assert.equal(summary.referrers[0].name, 'github.com');
    assert.equal(summary.browsers[0].name, 'Firefox');
  } finally {
    await ctx.close();
  }
});
