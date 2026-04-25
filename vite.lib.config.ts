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

import { defineConfig } from 'vite';

export default defineConfig({
  // Suppress copying public/* into dist-lib/. Sprite assets live in the
  // website's deploy at /demo/play/assets/sprites/* — the library bundle
  // doesn't need to ship duplicates. Sprite URLs are baked into the JS via
  // import.meta.env.BASE_URL = "/demo/play/" (set by --base on the CLI).
  publicDir: false,
  build: {
    target: 'es2022',
    outDir: 'dist-lib',
    emptyOutDir: true,
    lib: {
      entry: 'src/main.ts',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      // Bundle dependencies (Phaser) into the library output. Vite's library
      // mode externalizes package.json dependencies by default — we override
      // so consumers don't need Phaser in their own dependency graph.
      external: [],
    },
  },
});
