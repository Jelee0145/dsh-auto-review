/**
 * Shared helpers for the dsh-auto-review install/uninstall/doctor scripts.
 * Zero runtime dependencies: node builtins only.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const BACKUP_SUFFIX = '.dsh-ar-orig'
export const PROFILE_BLOCK_BEGIN = '# >>> dsh-auto-review (community beta) — managed block, do not edit >>>'
export const PROFILE_BLOCK_END = '# <<< dsh-auto-review (community beta) <<<'
export const PROFILE_BLOCK_PREFIX = '# >>> dsh-auto-review'
export const RECEIPT_NAME = '.dsh-auto-review-receipt.json'

/** @param {Buffer} buffer @returns {string} */
export const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')

/** @param {string} path @returns {string} */
export const sha256File = (path) => sha256(readFileSync(path))

/** Parse `--key value` and `--flag` arguments. @param {string[]} argv @returns {Record<string, string | boolean>} */
export function parseArgs(argv) {
  const out = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? ''
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[index + 1]
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next
      index += 1
    } else {
      out[key] = true
    }
  }
  return out
}

/**
 * Locate the globally installed @deepseek-ai/dsh package directory.
 * Order: --dsh-root flag, DSH_AR_DSH_ROOT env, then `npm root -g`.
 * @param {Record<string, string | boolean>} args
 * @returns {string}
 */
export function locateDshRoot(args) {
  const explicit = typeof args['dsh-root'] === 'string' ? args['dsh-root']
    : typeof process.env.DSH_AR_DSH_ROOT === 'string' ? process.env.DSH_AR_DSH_ROOT
      : undefined
  const candidates = explicit !== undefined
    ? [explicit]
    : (() => {
        const npmRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()
        return [join(npmRoot, '@deepseek-ai', 'dsh')]
      })()
  for (const candidate of candidates) {
    const pkgPath = join(candidate, 'package.json')
    if (!existsSync(pkgPath)) continue
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    if (pkg.name === '@deepseek-ai/dsh') return candidate
  }
  throw new Error(`could not locate a global @deepseek-ai/dsh installation (tried: ${candidates.join(', ')})`)
}

/**
 * Resolve the DSH home directory (profiles live under <home>/profiles).
 * @param {Record<string, string | boolean>} args
 * @returns {string}
 */
export function locateDshHome(args) {
  if (typeof args['dsh-home'] === 'string') return args['dsh-home']
  if (typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== '') return process.env.DSH_HOME
  return join(homedir(), '.dsh')
}

/**
 * Load patches/manifest.json from the repository.
 * @param {string} repoRoot @returns {{ dshVersion: string, files: Array<{ path: string, feature: string, edits: Array<{ find: string, replace: string }>, shaBefore: string, shaAfter: string }> }}
 */
export function loadManifest(repoRoot) {
  return JSON.parse(readFileSync(join(repoRoot, 'patches', 'manifest.json'), 'utf8'))
}

const detectEol = (text) => (text.includes('\r\n') ? '\r\n' : '\n')
const toFileEol = (text, eol) => text.replace(/\n/g, eol)

/**
 * Apply edits to file text in memory; every anchor must occur exactly once.
 * @param {string} text @param {Array<{ find: string, replace: string }>} edits @param {boolean} reverse
 * @returns {string}
 */
export function applyEdits(text, edits, reverse = false) {
  const eol = detectEol(text)
  let result = text
  for (const edit of edits) {
    const find = toFileEol(reverse ? edit.replace : edit.find, eol)
    const replace = toFileEol(reverse ? edit.find : edit.replace, eol)
    const first = result.indexOf(find)
    if (first === -1) throw new Error(`anchor not found: ${JSON.stringify(find.slice(0, 80))}`)
    if (result.indexOf(find, first + 1) !== -1) throw new Error(`anchor not unique: ${JSON.stringify(find.slice(0, 80))}`)
    result = result.slice(0, first) + replace + result.slice(first + find.length)
  }
  return result
}

/**
 * Classify one manifest file's current state by hash.
 * @param {string} absolutePath @param {{ shaBefore: string, shaAfter: string }} entry
 * @returns {'original' | 'patched' | 'missing' | 'unknown'}
 */
export function classifyFile(absolutePath, entry) {
  if (!existsSync(absolutePath)) return 'missing'
  const hash = sha256File(absolutePath)
  if (hash === entry.shaBefore) return 'original'
  if (hash === entry.shaAfter) return 'patched'
  return 'unknown'
}

/**
 * Insert (or replace) the managed profile block in a cordis.patch.yml.
 * Replaces a bare `[]` document with the block, appends to an existing
 * top-level block sequence, and replaces any existing managed block (older
 * version) in place.
 * @param {string} current @param {string} blockBody yaml list items (no markers)
 * @returns {{ text: string, changed: boolean }}
 */
export function upsertProfileBlock(current, blockBody) {
  const eol = detectEol(current)
  const lines = current.split(eol)
  const begin = lines.findIndex((line) => line.startsWith(PROFILE_BLOCK_PREFIX))
  const fresh = `${PROFILE_BLOCK_BEGIN}${eol}${blockBody}${eol}${PROFILE_BLOCK_END}`
  if (begin !== -1) {
    const end = lines.findIndex((line, index) => index > begin && line.startsWith(PROFILE_BLOCK_END))
    if (end === -1) throw new Error('managed profile block is malformed; edit cordis.patch.yml manually')
    const replaced = [...lines.slice(0, begin), fresh, ...lines.slice(end + 1)].join(eol)
    return { text: replaced, changed: replaced !== current }
  }
  const firstContent = lines.find((line) => line.trim() !== '' && !line.trim().startsWith('#'))
  let base
  if (firstContent === undefined) {
    base = lines.join(eol)
  } else if (firstContent.trim() === '[]') {
    const idx = lines.indexOf(firstContent)
    lines.splice(idx, 1)
    base = lines.join(eol)
  } else {
    base = lines.join(eol)
  }
  const prefix = base === '' || base.endsWith(eol) ? base : `${base}${eol}`
  return { text: `${prefix}${fresh}${eol}`, changed: true }
}

/**
 * Remove the managed profile block from a cordis.patch.yml; restores a bare
 * `[]` document when nothing else remains.
 * @param {string} current @returns {{ text: string, changed: boolean }}
 */
export function removeProfileBlock(current) {
  const eol = detectEol(current)
  const lines = current.split(eol)
  const begin = lines.findIndex((line) => line.startsWith(PROFILE_BLOCK_PREFIX))
  if (begin === -1) return { text: current, changed: false }
  const end = lines.findIndex((line, index) => index > begin && line.startsWith(PROFILE_BLOCK_END))
  if (end === -1) throw new Error('managed profile block is malformed; edit cordis.patch.yml manually')
  lines.splice(begin, end - begin + 1)
  const remaining = lines.filter((line) => line.trim() !== '' && !line.trim().startsWith('#'))
  if (remaining.length === 0) {
    const comments = lines.filter((line) => line.trim().startsWith('#') || line.trim() === '')
    let text = comments.join(eol)
    if (text !== '' && !text.endsWith(eol)) text += eol
    return { text: `${text}[]${eol}`, changed: true }
  }
  return { text: lines.join(eol), changed: true }
}

/** The profile block body the installer manages. @param {string} pluginName @returns {string} */
export function profileBlockBody(pluginName) {
  return [
    '- id: approval',
    '  config:',
    '    policy: auto-review',
    '- id: permission',
    '  config:',
    '    presets:',
    '      workspace-write:',
    '        sandbox: workspace-write',
    '        approval: ask',
    '        name: workspace-write',
    "        description: Write inside the workspace and permitted temporary directories; wider retries require approval.",
    '      danger-full-access:',
    '        sandbox: danger-full-access',
    '        approval: never',
    '        name: danger-full-access',
    "        description: Full file access without approval prompts.",
    '      auto-review:',
    '        sandbox: workspace-write',
    '        approval: auto-review',
    '        name: auto-review',
    "        description: Write inside the workspace; wider retries are decided by an automated reviewer instead of a human.",
    '- insert:',
    '    - id: auto-review',
    `      name: ${pluginName}`,
    '      config:',
    "        answerTools: ['bash', 'pwsh', 'write', 'edit']",
  ].join('\n')
}

/** Exit with a formatted error. @param {string} message @returns {never} */
export function fail(message) {
  console.error(`dsh-auto-review: ${message}`)
  process.exit(1)
}
