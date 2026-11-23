import path from 'node:path';

export function loadConfig(env = process.env) {
  const sourceDir = path.resolve(env.SOURCE_DIR || process.cwd());
  return {
    port: Number(env.PORT || 8081),
    host: env.HOST || '0.0.0.0',
    storyPassword: String(env.STORY_PASSWORD || ''),
    dataDir: path.resolve(env.DATA_DIR || '/data'),
    sourceDir,
    siteDistDir: env.SITE_DIST_DIR ? path.resolve(env.SITE_DIST_DIR) : '',
    staticOutDir: env.STATIC_OUT_DIR ? path.resolve(env.STATIC_OUT_DIR) : path.join(sourceDir, '_site'),
    trustProxyHeaders: env.TRUST_PROXY_HEADERS === 'true',
    cookieSecure: env.COOKIE_SECURE === 'true' ? true : env.COOKIE_SECURE === 'false' ? false : 'auto',
    blogOrigin: env.BLOG_ORIGIN || '',
    skipInitialBuild: env.SKIP_INITIAL_BUILD === 'true',
  };
}
