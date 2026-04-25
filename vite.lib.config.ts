// vite.lib.config.ts — library-mode build for embedding the game in host pages.
//
// Companion to vite.config.ts. The standalone HTML build (vite.config.ts) emits
// dist/index.html + a hashed JS bundle that auto-mounts via index.html's inline
// script. This config emits a single ESM module exporting { mount, MountOptions,
// MountedGame } with no top-level side effects, so a host page (e.g. an Astro
// page on subterrans.com) can import it and call mount(target) itself.
//
// Phaser is bundled inline (rollupOptions.external = []) so the host doesn't
// need it as its own dependency. Sprite URLs in src/render/game-scene.ts use
// import.meta.env.BASE_URL — invoke this build with --base=/demo/play/ so the
// asset URLs bake in to the website's deploy path.
//
// Output filename is content-hashed (index.[hash].js) so the website can
// publish it under Cache-Control: immutable without invalidation churn.
// A sibling manifest.json maps `entry → filename` so the deploy can inject
// the correct <script src=…> URL into the host page.

import { defineConfig, type Plugin } from 'vite';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Emit dist-lib/manifest.json after the bundle is written, so the website
 *  deploy can read `entry` and inject the right hashed <script src=…>. */
const manifestPlugin = (): Plugin => ({
  name: 'subterrans-lib-manifest',
  writeBundle(options, bundle) {
    const entry = Object.values(bundle).find(
      (chunk) => 'isEntry' in chunk && chunk.isEntry === true,
    );
    if (!entry) return;
    const dir = options.dir ?? 'dist-lib';
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify({ entry: entry.fileName }, null, 2) + '\n',
    );
  },
});

export default defineConfig({
  // Suppress copying public/* into dist-lib/. Sprite assets live in the
  // website's deploy at /demo/play/assets/sprites/* — the library bundle
  // doesn't need to ship duplicates.
  publicDir: false,
  plugins: [manifestPlugin()],
  build: {
    target: 'es2022',
    outDir: 'dist-lib',
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry: 'src/main.ts',
      formats: ['es'],
    },
    rollupOptions: {
      // Bundle dependencies (Phaser) into the library output. Vite's library
      // mode externalizes package.json dependencies by default — we override
      // so consumers don't need Phaser in their own dependency graph.
      external: [],
      output: {
        // Content-hashed filename for cache-busting. Paired with manifest.json
        // (above) so the website's deploy step knows which file to reference.
        entryFileNames: 'index.[hash].js',
      },
    },
  },
});
