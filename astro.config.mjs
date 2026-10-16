import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import { loadEnv, build as viteBuild } from 'vite';

/* Stamped into the Worker so /api/health can answer "did my push actually ship?". Webflow Cloud's builder may not
 * expose git or a commit variable, so fall through the CI-style names, then git, then give up on the sha. */
const commitSha = () => {
  const e = process.env;
  const sha = e.WEBFLOW_COMMIT_SHA || e.CF_PAGES_COMMIT_SHA || e.GITHUB_SHA || e.COMMIT_SHA || e.COMMIT_REF || '';
  if (sha) return sha.slice(0, 7);
  try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return 'unknown'; }
};
const BUILD = { commit: commitSha(), builtAt: new Date().toISOString() };

// Webflow Cloud mounts this app at /dial on alwaysreadyrepair.com and injects `base` at build time from the
// environment's mount path. Never set it here for production (double-prefix). Locally, MOUNT_PATH in .env
// (default in .env.example: /dial) reproduces the mount so dev URLs match production. Leave MOUNT_PATH out of the
// Webflow Cloud environment variables.
const { MOUNT_PATH } = loadEnv(process.env.NODE_ENV || 'development', process.cwd(), '');

let astroBase = '/';

/* The popup ships as one file at <base>/dial.js so Webflow loads it with one script tag. It is built by its own Vite
 * build after Astro's and stays out of Astro's rollup graph: overriding Astro's rollupOptions also hits the SSR build
 * and scatters the Worker's chunks (the pricing app learned this the hard way). Webflow Cloud runs `astro build`
 * directly, not `npm run build`, so this hangs off a build hook rather than a package script. */
const widgetBuild = () => ({
  name: 'arr-dial-widget-build',
  hooks: {
    'astro:config:done': ({ config }) => { astroBase = config.base; },
    'astro:build:done': async ({ dir, logger }) => {
      await viteBuild({
        configFile: false,
        root: process.cwd(),
        base: astroBase,
        logLevel: 'warn',
        define: { __BUILD__: JSON.stringify(BUILD) },
        build: {
          outDir: fileURLToPath(dir),
          emptyOutDir: false,
          rollupOptions: {
            input: { dial: 'src/widget/index.js' },
            output: { entryFileNames: 'dial.js', chunkFileNames: 'dial-assets/[name]-[hash].js', assetFileNames: 'dial-assets/[name]-[hash][extname]' }
          }
        }
      });
      logger.info(`dial.js → ${fileURLToPath(dir)}dial.js`);
    }
  }
});

export default defineConfig({
  output: 'server',
  adapter: cloudflare({ platformProxy: { enabled: true } }),
  ...(MOUNT_PATH ? { base: MOUNT_PATH } : {}),
  build: { assets: 'assets' },
  // `define` only: rollup/build options here would also hit the SSR build.
  vite: { define: { __BUILD__: JSON.stringify(BUILD) } },
  integrations: [widgetBuild()]
});
