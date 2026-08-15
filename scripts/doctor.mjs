#!/usr/bin/env node
/**
 * Verify the DSH Auto-Review installation state: dsh version, every patch
 * target, plugin presence and version, runtime dependency resolution, the
 * managed profile block, and the install receipt. Exits 0 when everything is
 * healthy, 1 otherwise.
 *
 * Options: --dsh-root <dir>, --dsh-home <dir>, --profile <name> (default web).
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BACKUP_SUFFIX, RECEIPT_NAME, classifyFile, loadManifest, locateDshHome, locateDshRoot, parseArgs, PROFILE_BLOCK_BEGIN } from './lib.mjs'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const args = parseArgs(process.argv.slice(2))
const profile = typeof args.profile === 'string' ? args.profile : 'web'
const pluginName = 'dsh-auto-review'

let healthy = true
const mark = (ok) => {
  if (!ok) healthy = false
  return ok ? 'OK  ' : 'FAIL'
}

console.log('dsh-auto-review doctor')

let dshRoot
try {
  dshRoot = resolve(locateDshRoot(args))
} catch (error) {
  console.error(`FAIL dsh installation not found: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
const dshHome = resolve(locateDshHome(args))
const manifest = loadManifest(repoRoot)
console.log(`     dsh package : ${dshRoot}`)
console.log(`     dsh home    : ${dshHome}`)

const dshPkg = JSON.parse(readFileSync(join(dshRoot, 'package.json'), 'utf8'))
console.log(`${mark(dshPkg.version === manifest.dshVersion)} dsh version ${dshPkg.version} (supported: ${manifest.dshVersion})`)

for (const entry of manifest.files) {
  const absolute = join(dshRoot, entry.path)
  const state = classifyFile(absolute, entry)
  const backup = `${absolute}${BACKUP_SUFFIX}`
  console.log(`${mark(state === 'patched')} patch ${entry.path} -> ${state}${existsSync(backup) ? ' (backup present)' : ''}`)
}

const profilesRoot = join(dshHome, 'profiles')
const pluginDir = join(profilesRoot, 'node_modules', pluginName)
const pluginPkg = join(pluginDir, 'package.json')
if (existsSync(pluginPkg)) {
  const pkg = JSON.parse(readFileSync(pluginPkg, 'utf8'))
  console.log(`${mark(pkg.version === '0.1.0-beta.1')} plugin ${pluginDir} @ ${pkg.version}`)
} else {
  mark(false)
  console.log(`FAIL plugin missing: ${pluginDir}`)
}

const schemastery = join(profilesRoot, 'node_modules', '@deepseek-ai', 'schemastery')
console.log(`${mark(existsSync(schemastery))} runtime dependency @deepseek-ai/schemastery resolvable`)

const patchYml = join(profilesRoot, profile, 'cordis.patch.yml')
const profileOk = existsSync(patchYml) && readFileSync(patchYml, 'utf8').includes(PROFILE_BLOCK_BEGIN)
console.log(`${mark(profileOk)} profile '${profile}' managed block (${patchYml})`)

const receipt = join(profilesRoot, RECEIPT_NAME)
console.log(`${mark(existsSync(receipt))} install receipt (${receipt})`)

console.log(healthy ? 'doctor: all checks passed.' : 'doctor: problems found — see FAIL lines above.')
process.exit(healthy ? 0 : 1)
