#!/usr/bin/env bun

/**
 * Bundle the plugin into ./build/: main.js, styles.css, manifest.json and
 * versions.json, the layout Obsidian loads. scripts/obsidian-dev.ts links
 * build/ into a vault, which keeps Obsidian away from node_modules.
 *
 * Leaflet comes from its ESM build, which unlike its UMD build doesn't set
 * `window.L`, so this plugin can't swap the Leaflet another plugin uses. Its
 * stylesheet is scoped under `.records-map` for the same reason.
 */

import { build, type BunPlugin } from 'bun'
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { scopeCss } from './scripts/scope-css.ts'

const leafletEsm: BunPlugin = {
  name: 'leaflet-esm',
  setup(builder) {
    builder.onResolve({ filter: /^leaflet$/ }, () => ({
      path: Bun.resolveSync('leaflet/dist/leaflet-src.esm.js', import.meta.dir),
    }))
  },
}

mkdirSync('./build', { recursive: true })

const result = await build({
  entrypoints: ['./src/plugin.ts'],
  outdir: './build',
  naming: { entry: 'main.js' },
  target: 'browser',
  format: 'cjs',
  external: ['obsidian', 'electron'],
  plugins: [leafletEsm],
  sourcemap: 'external',
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

const leafletCss = readFileSync(
  Bun.resolveSync('leaflet/dist/leaflet.css', import.meta.dir),
  'utf8',
)
writeFileSync(
  './build/styles.css',
  `/* Leaflet's stylesheet, scoped to .records-map */\n${scopeCss(leafletCss, '.records-map')}\n${readFileSync('./src/styles.css', 'utf8')}`,
)
cpSync('./manifest.json', './build/manifest.json')
cpSync('./versions.json', './build/versions.json')

console.log(`Built ${result.outputs.map((output) => output.path).join(', ')}`)
