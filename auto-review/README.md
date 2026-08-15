# dsh-auto-review (plugin package)

Codex-style automated approval review for [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh): sandbox-escalation asks are decided by an **isolated reviewer subagent** that judges the operation's intrinsic risk and the user's authorization independently.

Status: **Community Beta 0.1.0-beta.1**. Requires DSH `0.1.0-rc.6` plus this repository's `isolate` compatibility patch. See the [repository README](../README.md) for installation, usage, and limitations — this package is installed by the repository's `scripts/install.mjs`, not published to npm.

## Reference source

`src/` is the TypeScript source of record (types resolve against the DSH workspace packages); `lib/` is the shipped build. The plugin's runtime dependency set is exactly `@deepseek-ai/schemastery`.

## Configuration (profile `cordis.patch.yml` entry)

| Key | Default | Meaning |
|---|---|---|
| `provider` | `spawn` | Reviewer subagent provider; must advertise the `isolate` capability (`spawn`, `fork`). |
| `answerTools` | `['bash', 'write', 'edit']` | Tools whose escalation asks are claimed. Windows needs `pwsh` added. |
| `circuitBreaker` | `true` | Hard-deny `denyPatterns` matches without a review round. |
| `denyPatterns` | built-in catastrophic list | Regex sources matched against the operation text. |
| `allowPatterns` | `[]` | Regex sources that grant outright, before the circuit breaker. |
| `maxCommandBytes` | `8192` | Operation-text cap in the reviewer prompt. |
| `maxContextBytes` | `4096` | UTF-8 byte cap on the trusted user context. |
| `maxRetries` | `3` | Consecutive denials of one operation before the fuse stops re-reviewing it. |
| `failClosed` | `false` | When a review cannot run: fail closed or delegate to the human chain. |
| `promptSection` | `true` | Register the reviewer-policy system-prompt section. |
