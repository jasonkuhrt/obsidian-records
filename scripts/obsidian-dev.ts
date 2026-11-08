#!/usr/bin/env bun

/**
 * Idempotent build + symlink + watch for plugin development against a real Obsidian vault.
 *
 * 1. Resolve repo + build paths (`<repo>` and `<repo>/build`).
 * 2. Resolve the vault plugin path: `<VAULT>/.obsidian/plugins/<plugin-id>/`.
 * 3. Run `bun run build` once so build/ has main.js, styles.css, manifest.json and versions.json.
 * 4. Symlink the vault plugin path → `<repo>/build`. Idempotent. Errors on a
 *    foreign symlink or directory blocking the path.
 * 5. Rebuild whenever a file under src/ changes, until Ctrl-C. Obsidian picks
 *    up a new main.js when the plugin is reloaded.
 *
 * The symlink stays in place across invocations.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ID = 'records'

const DEFAULT_VAULT_PATH = path.join(process.env['HOME'] ?? '', 'me')

const scriptPath = fileURLToPath(import.meta.url)
const repoPath = path.resolve(path.dirname(scriptPath), '..')
const buildPath = path.join(repoPath, 'build')
const vaultPath = process.env['OBSIDIAN_VAULT_PATH'] ?? DEFAULT_VAULT_PATH
const pluginsDir = path.join(vaultPath, '.obsidian', 'plugins')
const pluginPath = path.join(pluginsDir, PLUGIN_ID)
const watchMode = !process.argv.includes('--once')

if (!fs.existsSync(vaultPath)) {
  console.error(`Vault path not found: ${vaultPath}`)
  console.error('Set OBSIDIAN_VAULT_PATH to override the default.')
  process.exit(1)
}

fs.mkdirSync(pluginsDir, { recursive: true })

const runBuild = async (): Promise<number> => {
  const proc = Bun.spawn({
    cmd: ['bun', 'run', 'build'],
    cwd: repoPath,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  return proc.exited
}

const initialBuildCode = await runBuild()
if (initialBuildCode !== 0) {
  console.error('Initial build failed; aborting before symlink + watch.')
  process.exit(initialBuildCode)
}

const ensureSymlink = (): void => {
  let stat: fs.Stats | undefined
  try {
    stat = fs.lstatSync(pluginPath)
  } catch {
    fs.symlinkSync(buildPath, pluginPath, 'dir')
    console.log(`Linked ${pluginPath} → ${buildPath}`)
    return
  }

  if (stat.isSymbolicLink()) {
    const target = fs.readlinkSync(pluginPath)
    const resolved = path.resolve(path.dirname(pluginPath), target)
    if (resolved === buildPath) {
      console.log(`Symlink already in place: ${pluginPath} → ${buildPath}`)
      return
    }
    throw new Error(
      `${pluginPath} is a symlink pointing at ${resolved}, expected ${buildPath}. Remove it manually before retrying.`,
    )
  }

  throw new Error(
    `${pluginPath} exists and is not a symlink. Remove or relocate the existing plugin directory before retrying.`,
  )
}

ensureSymlink()

if (!watchMode) process.exit(0)

console.log('Rebuilding on changes under src/ (Ctrl-C to stop)')
let timer: ReturnType<typeof setTimeout> | undefined
fs.watch(path.join(repoPath, 'src'), { recursive: true }, () => {
  clearTimeout(timer)
  timer = setTimeout(() => void runBuild(), 150)
})
