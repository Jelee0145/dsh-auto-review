#!/usr/bin/env node
/**
 * Uninstall DSH Auto-Review: restore every patched dsh file from its backup
 * (or by reversing the manifest edits when the backup is gone), remove the
 * plugin copy, remove the managed profile block, and delete the receipt.
 *
 * Options: --dsh-root <dir>, --dsh-home <dir>, --profile <name> (default web).
 */
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BACKUP_SUFFIX,
  RECEIPT_NAME,
  applyEdits,
  classifyFile,
  fail,
  loadManifest,
  locateDshHome,
  locateDshRoot,
  parseArgs,
  removeProfileBlock,
} from './lib.mjs'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const args = parseArgs(process.argv.slice(2))
const profile = typeof args.profile === 'string' ? args.profile : 'web'
const pluginName = 'dsh-auto-review'

const dshRoot = resolve(locateDshRoot(args))
const dshHome = resolve(locateDshHome(args))
const manifest = loadManifest(repoRoot)

console.log('dsh-auto-review uninstall')
console.log(`  dsh package: ${dshRoot}`)

const dshPkg = JSON.parse(readFileSync(join(dshRoot, 'package.json'), 'utf8'))
if (dshPkg.version !== manifest.dshVersion) {
  console.warn(`  warning: installed dsh version ${dshPkg.version} differs from the manifest version ${manifest.dshVersion}; `
    + 'restoring whatever still matches and cleaning up the rest')
}

// --- 1. restore patched files -------------------------------------------------
for (const entry of manifest.files) {
  const absolute = join(dshRoot, entry.path)
  const backup = `${absolute}${BACKUP_SUFFIX}`
  const state = classifyFile(absolute, entry)
  if (state === 'patched') {
    if (existsSync(backup)) {
      copyFileSync(backup, absolute)
      rmSync(backup)
    } else {
      const text = readFileSync(absolute, 'utf8')
      writeFileSync(absolute, applyEdits(text, entry.edits, true))
    }
    if (classifyFile(absolute, entry) !== 'original') {
      fail(`restore verification failed for ${entry.path}`)
    }
    console.log(`  [patch] restored: ${entry.path}`)
  } else if (state === 'original') {
    if (existsSync(backup)) rmSync(backup)
    console.log(`  [patch] already original: ${entry.path}`)
  } else {
    console.warn(`  [patch] skipped (state ${state}): ${entry.path}`)
  }
}

// --- 2. remove the plugin -------------------------------------------------------
const profilesRoot = join(dshHome, 'profiles')
const pluginTarget = join(profilesRoot, 'node_modules', pluginName)
if (existsSync(pluginTarget)) {
  rmSync(pluginTarget, { recursive: true, force: true })
  console.log(`  [plugin] removed: ${pluginTarget}`)
}
rmSync(`${pluginTarget}${BACKUP_SUFFIX}`, { recursive: true, force: true })

// --- 3. remove the profile block -------------------------------------------------
const patchYml = join(profilesRoot, profile, 'cordis.patch.yml')
if (existsSync(patchYml)) {
  try {
    const { text, changed } = removeProfileBlock(readFileSync(patchYml, 'utf8'))
    if (changed) {
      writeFileSync(patchYml, text)
      console.log(`  [profile] removed managed block: ${patchYml}`)
    } else {
      console.log(`  [profile] no managed block present: ${patchYml}`)
    }
  } catch (error) {
    fail(`profile cleanup failed: ${error instanceof Error ? error.message : String(error)}`)
  }
} else {
  console.log(`  [profile] no patch file present: ${patchYml}`)
}

// --- 4. receipt -------------------------------------------------------------------
const receipt = join(profilesRoot, RECEIPT_NAME)
if (existsSync(receipt)) {
  rmSync(receipt)
  console.log(`  [receipt] removed: ${receipt}`)
}
console.log('uninstall complete.')
