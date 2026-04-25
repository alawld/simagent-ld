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
// the correct <script src=…> URL into the host page. A sibling index.d.ts
// declares the public API surface (mount/MountOptions/MountedGame) for
// type-only imports in the host project.

import { defineConfig, type Plugin } from 'vite';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Emit dist-lib/manifest.json after the bundle is written, so the website
 *  deploy can read `entry` and inject the right hashed <script src=…>.
 *
 *  Asserts exactly one entry chunk — silent skip on multi-entry would
 *  produce a stale or missing manifest, which the website's deploy then
 *  reads and breaks production. Better to fail the build loudly. */
const manifestPlugin = (): Plugin => ({
  name: 'subterrans-lib-manifest',
  writeBundle(options, bundle) {
    const entries = Object.values(bundle).filter(
      (chunk) => 'isEntry' in chunk && chunk.isEntry === true,
    );
    if (entries.length !== 1) {
      throw new Error(
        `subterrans-lib-manifest: expected exactly 1 entry chunk, found ${entries.length}. ` +
        `Library build assumes a single ESM entry — check vite.lib.config.ts lib.entry.`,
      );
    }
    const entry = entries[0];
    const dir = options.dir ?? 'dist-lib';
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify({ entry: entry.fileName }, null, 2) + '\n',
    );
  },
});

/** Emit a hand-written dist-lib/index.d.ts describing only the public API
 *  surface (mount, MountOptions, MountedGame). Hand-written rather than
 *  generated via vite-plugin-dts so we don't pull in a tsc-on-rollup
 *  dependency, and so the published types are exactly the embedder
 *  contract — not every transitively re-exported render-internal type.
 *
 *  Filename is fixed (no hash) because TS module resolution looks up
 *  `.d.ts` next to the source path, and consumers reference types via a
 *  type-only import that is decoupled from the runtime entry name in
 *  manifest.json. Keep this string in sync with src/main.ts. */
const dtsPlugin = (): Plugin => ({
  name: 'subterrans-lib-dts',
  writeBundle(options) {
    const dir = options.dir ?? 'dist-lib';
    const dts = `// Public API surface for the Subterrans library bundle. Hand-maintained
// in vite.lib.config.ts; regenerated on each build. Keep in sync with
// src/main.ts.

export interface MountOptions {
  /**
   * Override the base path under which runtime assets are resolved. When
   * set, sprite URLs become \`\${assetsBase}sprites/*.svg\` instead of the
   * build-baked default. Must end with a trailing slash.
   */
  assetsBase?: string;
}

export interface MountedGame {
  /** Tear down the underlying Phaser.Game and remove its canvas. */
  destroy(): void;
  /**
   * Resolves once GameScene.create() has finished — preload assets are
   * loaded, the canvas is painted, and the boot path (fresh world or
   * SavePrompt overlay) is visible. Never rejects.
   */
  ready: Promise<void>;
}

export function mount(target: HTMLElement, options?: MountOptions): MountedGame;
`;
    writeFileSync(join(dir, 'index.d.ts'), dts);
  },
});

export default defineConfig({
  // Suppress copying public/* into dist-lib/. Sprite assets live in the
  // website's deploy at /demo/play/assets/sprites/* — the library bundle
  // doesn't need to ship duplicates.
  publicDir: false,
  plugins: [manifestPlugin(), dtsPlugin()],
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
