#!/usr/bin/env node
/**
 * Install DSH Auto-Review (Community Beta) into a global npm installation of
 * DeepSeek Harness:
 *
 *   1. verify the installed dsh version is exactly the supported one;
 *   2. apply the isolate/approval/arguments compatibility patch to the dsh
 *      package's bundled files (hash-verified, backed up, idempotent);
 *   3. copy the plugin into <DSH_HOME>/profiles/node_modules so profile
 *      compositions can load it by name;
 *   4. add the managed block to <DSH_HOME>/profiles/<profile>/cordis.patch.yml
 *      (selects the 'auto-review' approval policy, restates the permission
 *      presets, and mounts the plugin).
 *
 * The whole install is transactional: if any step fails, every mutation made
 * so far (patched files, plugin copy, profile block) is rolled back, so a
 * failed install never leaves a half-installed DSH.
 *
 * Options: --dsh-root <dir> (default: resolve via `npm root -g`),
 *          --dsh-home <dir> (default: $DSH_HOME or ~/.dsh),
 *          --profile <name> (default: web).
 *
 * The patch is never applied to an unverified version and never falls back to
 * a weakened (un-isolated) reviewer. Run scripts/doctor.mjs afterwards.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  profileBlockBody,
  sha256,
  upsertProfileBlock,
} from './lib.mjs'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const args = parseArgs(process.argv.slice(2))
const profile = typeof args.profile === 'string' ? args.profile : 'web'
const pluginName = 'dsh-auto-review'

const dshRoot = resolve(locateDshRoot(args))
const dshHome = resolve(locateDshHome(args))
const manifest = loadManifest(repoRoot)

console.log(`dsh-auto-review install (0.1.0-beta.1)`)
console.log(`  dsh package: ${dshRoot}`)

const dshPkg = JSON.parse(readFileSync(join(dshRoot, 'package.json'), 'utf8'))
if (dshPkg.version !== manifest.dshVersion) {
  fail(`installed dsh version ${dshPkg.version} is not the supported version ${manifest.dshVersion}; `
    + 'refusing to patch (install @deepseek-ai/dsh@' + manifest.dshVersion + ' or wait for a supported manifest)')
}
console.log(`  dsh version: ${dshPkg.version} (supported)`)

// --- transactional install ---------------------------------------------------
const patchedHere = []
const backupCreated = new Set()
let profileChanged = false
let originalPatchYml = null

try {
  // 2. compatibility patch
  for (const entry of manifest.files) {
    const absolute = join(dshRoot, entry.path)
    const state = classifyFile(absolute, entry)
    if (state === 'patched') {
      console.log(`  [patch] already patched: ${entry.path}`)
      continue
    }
    if (state !== 'original') {
      throw new Error(`refusing to patch ${entry.path}: file is neither pristine nor patched (state ${state}); reinstall dsh or restore from backup`)
    }
    const backup = `${absolute}${BACKUP_SUFFIX}`
    if (!existsSync(backup)) {
      copyFileSync(absolute, backup)
      backupCreated.add(absolute)
    }
    const buffer = Buffer.from(applyEdits(readFileSync(absolute, 'utf8'), entry.edits), 'utf8')
    if (sha256(buffer) !== entry.shaAfter) throw new Error(`post-patch hash mismatch for ${entry.path}`)
    writeFileSync(absolute, buffer)
    patchedHere.push(absolute)
    console.log(`  [patch] applied (${entry.feature}): ${entry.path}`)
  }

  // 3. plugin copy
  const profilesRoot = join(dshHome, 'profiles')
  const profileDir = join(profilesRoot, profile)
  ensureProfile(dshHome, profilesRoot, profileDir, dshRoot)
  const pluginTarget = join(profilesRoot, 'node_modules', pluginName)
  const pluginBackup = `${pluginTarget}${BACKUP_SUFFIX}`
  const hadPlugin = existsSync(pluginTarget)
  if (hadPlugin) {
    rmSync(pluginBackup, { force: true, recursive: true })
    cpSync(pluginTarget, pluginBackup, { recursive: true })
    rmSync(pluginTarget, { recursive: true, force: true })
  }
  cpSync(join(repoRoot, 'auto-review'), pluginTarget, { recursive: true })
  console.log(`  [plugin] installed: ${pluginTarget}`)

  const schemastery = join(profilesRoot, 'node_modules', '@deepseek-ai', 'schemastery')
  if (!existsSync(schemastery)) {
    const globalSchemastery = join(dshRoot, 'node_modules', '@deepseek-ai', 'schemastery')
    if (!existsSync(globalSchemastery)) throw new Error('@deepseek-ai/schemastery is resolvable nowhere; the profile bootstrap did not install it')
    cpSync(globalSchemastery, schemastery, { recursive: true })
    console.log('  [plugin] copied @deepseek-ai/schemastery into the profile node_modules')
  }

  // 4. profile block
  const patchYml = join(profileDir, 'cordis.patch.yml')
  originalPatchYml = readFileSync(patchYml, 'utf8')
  const { text, changed } = upsertProfileBlock(originalPatchYml, profileBlockBody(pluginName))
  if (changed) {
    writeFileSync(patchYml, text)
    profileChanged = true
    console.log(`  [profile] added managed block: ${patchYml}`)
  } else {
    console.log(`  [profile] managed block already present: ${patchYml}`)
  }
} catch (error) {
  rollback()
  fail(`install failed and was rolled back: ${error instanceof Error ? error.message : String(error)}`)

  function rollback() {
    const profilesRoot = join(dshHome, 'profiles')
    for (const absolute of patchedHere) {
      const backup = `${absolute}${BACKUP_SUFFIX}`
      if (existsSync(backup)) {
        copyFileSync(backup, absolute)
        if (backupCreated.has(absolute)) rmSync(backup)
      }
    }
    const pluginTarget = join(profilesRoot, 'node_modules', pluginName)
    const pluginBackup = `${pluginTarget}${BACKUP_SUFFIX}`
    if (existsSync(pluginBackup)) {
      rmSync(pluginTarget, { recursive: true, force: true })
      cpSync(pluginBackup, pluginTarget, { recursive: true })
      rmSync(pluginBackup, { recursive: true, force: true })
    } else {
      rmSync(pluginTarget, { recursive: true, force: true })
    }
    if (profileChanged && originalPatchYml !== null) {
      writeFileSync(join(profilesRoot, profile, 'cordis.patch.yml'), originalPatchYml)
    }
  }
}

// 5. receipt
const profilesRoot = join(dshHome, 'profiles')
writeFileSync(join(profilesRoot, RECEIPT_NAME), `${JSON.stringify({
  name: 'dsh-auto-review',
  version: '0.1.0-beta.1',
  dshVersion: dshPkg.version,
  dshRoot,
  profile,
  patchedFiles: manifest.files.map((entry) => entry.path),
  pluginDir: join(profilesRoot, 'node_modules', pluginName),
  profileFile: join(profilesRoot, profile, 'cordis.patch.yml'),
  createdAt: new Date().toISOString(),
}, null, 2)}\n`)

console.log('install complete. next steps:')
console.log('  node scripts/doctor.mjs            # verify patch/plugin/profile state')
console.log(`  dsh --profile ${profile}            # start DSH with Auto-Review active`)

/** Ensure the profile directory exists (bootstrap it through the dsh CLI when needed). */
function ensureProfile(dshHome, profilesRoot, profileDir, dshRoot) {
  if (existsSync(join(profileDir, 'package.json'))) return
  console.log(`  [profile] bootstrapping profile '${profile}' through the dsh CLI (one-time)…`)
  mkdirSync(profilesRoot, { recursive: true })
  const bin = resolveBin(dshRoot)
  try {
    execFileSync(process.execPath, [bin, '--profile', profile, '--dump-default-config'], {
      stdio: 'pipe',
      encoding: 'utf8',
      env: { ...process.env, DSH_HOME: dshHome },
    })
  } catch (error) {
    throw new Error(`could not bootstrap profile '${profile}' (run \`dsh --profile ${profile}\` once manually, then retry): ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!existsSync(join(profileDir, 'package.json'))) {
    throw new Error(`profile '${profile}' did not materialize under ${profilesRoot}`)
  }
}

/** Resolve the dsh CLI entry (bin script inside the installed package). */
function resolveBin(dshRoot) {
  const pkg = JSON.parse(readFileSync(join(dshRoot, 'package.json'), 'utf8'))
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.dsh
  if (typeof bin !== 'string') fail(`cannot find the dsh bin entry in ${dshRoot}`)
  return join(dshRoot, bin)
}
