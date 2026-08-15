#!/usr/bin/env node
/**
 * Regenerate patches/manifest.json against a PRISTINE npm installation of the
 * supported DSH version. Developer tool: run it only right after
 * `npm install -g @deepseek-ai/dsh@<version>` (before any patching), with
 * DSH_AR_DSH_ROOT pointing at the installed `@deepseek-ai/dsh` package
 * directory. The installer consumes only the generated manifest.
 *
 * Each edit is an exact-once substring replacement (anchors written against
 * the unminified tsdown bundles). `\n` in find/replace is normalized to the
 * target file's line endings at apply time.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dshRoot = process.env.DSH_AR_DSH_ROOT
if (dshRoot === undefined) {
  console.error('gen-manifest: set DSH_AR_DSH_ROOT to the pristine @deepseek-ai/dsh package directory')
  process.exit(1)
}

/** All compatibility edits, grouped by feature. Paths are relative to the dsh package directory. */
const EDIT_GROUPS = [
  {
    feature: 'subagent isolate capability',
    files: [
      {
        path: 'node_modules/@deepseek-ai/dsh-subagent/lib/index.js',
        edits: [
          {
            find: '\tchildCtx.get("agentPresets")?.composeFrom(childCtx, parent.ctx);',
            replace: '\tif (composition.isolate !== true) childCtx.get("agentPresets")?.composeFrom(childCtx, parent.ctx);',
          },
        ],
      },
      {
        path: 'node_modules/@deepseek-ai/dsh-subagent-in-process-driver/lib/index.js',
        edits: [
          {
            find: '\t\t\ttoolFilter: request.toolFilter\n\t\t});',
            replace: '\t\t\ttoolFilter: request.toolFilter,\n\t\t\tisolate: request.isolate\n\t\t});',
          },
        ],
      },
      {
        path: 'node_modules/@deepseek-ai/dsh-subagent-spawn-in-process/lib/index.js',
        edits: [
          {
            find: '\t\tpersona: true\n\t};',
            replace: '\t\tpersona: true,\n\t\tisolate: true\n\t};',
          },
        ],
      },
      {
        path: 'node_modules/@deepseek-ai/dsh-subagent-fork-in-process/lib/index.js',
        edits: [
          {
            find: '\t\tpersona: true\n\t};',
            replace: '\t\tpersona: true,\n\t\tisolate: true\n\t};',
          },
        ],
      },
    ],
  },
  {
    feature: "approval policy 'auto-review' vocabulary",
    files: [
      {
        path: 'node_modules/@deepseek-ai/dsh-user-approval/lib/index.js',
        edits: [
          {
            find: 'const APPROVAL_POLICIES = ["ask", "never"];',
            replace: 'const APPROVAL_POLICIES = ["ask", "never", "auto-review"];',
          },
          {
            find: 'z.union(["ask", "never"]).default("ask")',
            replace: 'z.union(["ask", "never", "auto-review"]).default("ask")',
          },
        ],
      },
    ],
  },
  {
    feature: 'escalation arguments seam (validated call arguments reach approval requesters)',
    files: [
      {
        path: 'node_modules/@deepseek-ai/dsh-sandbox/lib/index.js',
        edits: [
          {
            find: '\t\treason: `escalate sandbox to ${mode}: ${justification}`,\n\t\t...approval.signal ? { signal: approval.signal } : {}',
            replace: '\t\treason: `escalate sandbox to ${mode}: ${justification}`,\n\t\t...approval.arguments !== void 0 ? { arguments: approval.arguments } : {},\n\t\t...approval.signal ? { signal: approval.signal } : {}',
          },
        ],
      },
      {
        path: 'node_modules/@deepseek-ai/dsh-tool-pwsh/lib/index.js',
        edits: [
          {
            find: 'const approvePwshEscalation = (mode, justification, exec, standingPolicy) => {',
            replace: 'const approvePwshEscalation = (mode, justification, exec, standingPolicy, callArguments) => {',
          },
          {
            find: '\t\t\tcallId: exec.callId,\n\t\t\ttoolName: "pwsh",\n\t\t\tsignal: exec.signal\n\t\t});',
            replace: '\t\t\tcallId: exec.callId,\n\t\t\ttoolName: "pwsh",\n\t\t\targuments: callArguments,\n\t\t\tsignal: exec.signal\n\t\t});',
          },
          {
            find: 'await approvePwshEscalation(args.sandbox_permissions, args.justification, exec, standingPolicy)',
            replace: 'await approvePwshEscalation(args.sandbox_permissions, args.justification, exec, standingPolicy, args)',
          },
        ],
      },
      {
        path: 'node_modules/@deepseek-ai/dsh-tool-bash/lib/index.js',
        edits: [
          {
            find: 'const approveBashEscalation = (mode, justification, exec, standingPolicy) => {',
            replace: 'const approveBashEscalation = (mode, justification, exec, standingPolicy, callArguments) => {',
          },
          {
            find: '\t\t\tcallId: exec.callId,\n\t\t\ttoolName: "bash",\n\t\t\tsignal: exec.signal\n\t\t});',
            replace: '\t\t\tcallId: exec.callId,\n\t\t\ttoolName: "bash",\n\t\t\targuments: callArguments,\n\t\t\tsignal: exec.signal\n\t\t});',
          },
          {
            find: 'await approveBashEscalation(args.sandbox_permissions, args.justification, exec, standingPolicy)',
            replace: 'await approveBashEscalation(args.sandbox_permissions, args.justification, exec, standingPolicy, args)',
          },
        ],
      },
      {
        path: 'node_modules/@deepseek-ai/dsh-tool-fs/lib/index.js',
        edits: [
          {
            find: '\t\t\tcallId: exec.callId,\n\t\t\ttoolName,\n\t\t\tsignal: exec.signal\n\t\t});',
            replace: '\t\t\tcallId: exec.callId,\n\t\t\ttoolName,\n\t\t\targuments: args,\n\t\t\tsignal: exec.signal\n\t\t});',
          },
        ],
      },
    ],
  },
]

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')
const detectEol = (text) => (text.includes('\r\n') ? '\r\n' : '\n')
const toFileEol = (text, eol) => text.replace(/\n/g, eol)

/** Apply one group of edits in memory; every find must occur exactly once. */
function applyEdits(text, edits) {
  const eol = detectEol(text)
  let result = text
  for (const edit of edits) {
    const find = toFileEol(edit.find, eol)
    const replace = toFileEol(edit.replace, eol)
    const first = result.indexOf(find)
    if (first === -1) throw new Error(`anchor not found: ${JSON.stringify(edit.find.slice(0, 80))}`)
    if (result.indexOf(find, first + 1) !== -1) throw new Error(`anchor not unique: ${JSON.stringify(edit.find.slice(0, 80))}`)
    result = result.slice(0, first) + replace + result.slice(first + find.length)
  }
  return result
}

const pkg = JSON.parse(readFileSync(join(dshRoot, 'package.json'), 'utf8'))
const manifest = {
  dshVersion: pkg.version,
  generatedAt: new Date().toISOString(),
  features: EDIT_GROUPS.map((group) => group.feature),
  files: [],
}

for (const group of EDIT_GROUPS) {
  for (const file of group.files) {
    const absolute = join(dshRoot, file.path)
    const original = readFileSync(absolute)
    const patched = applyEdits(original.toString('utf8'), file.edits)
    manifest.files.push({
      path: file.path,
      feature: group.feature,
      edits: file.edits,
      shaBefore: sha256(original),
      shaAfter: sha256(Buffer.from(patched, 'utf8')),
      bytesBefore: original.length,
      bytesAfter: Buffer.byteLength(patched),
    })
  }
}

const out = join(root, 'patches', 'manifest.json')
writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`gen-manifest: wrote ${manifest.files.length} file entries for dsh ${manifest.dshVersion} -> ${out}`)
