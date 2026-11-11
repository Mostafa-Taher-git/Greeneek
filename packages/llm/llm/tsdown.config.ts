import { defineConfig } from 'tsdown'

/** Build the conformance entry alongside the standard host entries. */
export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/invariant.js', 'lib/types/conformance.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
