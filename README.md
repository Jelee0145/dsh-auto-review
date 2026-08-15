# DSH Auto-Review

[English](README.md) | [简体中文](README.zh-CN.md)

Codex-style automated approval review for [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) (DSH). Instead of a human prompt or a blanket denial, sandbox-escalation requests are decided by an **isolated reviewer subagent** that judges two independent questions — *how risky is this exact operation?* and *did the user actually authorize this effect?* — and returns a structured allow/deny verdict.

> **Status: Community Beta (v0.1.0-beta.1).** This is **not** an official DeepSeek AI product or plugin. It is a community project distributed separately from DSH. Expect rough edges; see [Known Limitations](#known-limitations).

## How it works (brief)

A DSH agent that needs to write outside its sandbox retries the operation once with `sandbox_permissions` + a `justification`. DSH routes that escalation through the approval seam; Auto-Review claims the ask and hands the reviewer subagent:

- **Exact operation** — the full validated tool arguments.
- **Trusted context** — the user's genuine messages (authorization evidence only; the agent's justification is marked untrusted).
- **One-invocation semantics** — the grant applies to this exact call and nothing else.

The reviewer returns `{ verdict, riskLevel, userAuthorization, reason }`. A `critical` risk is denied deterministically regardless of the model's verdict. Catastrophic commands hit a circuit breaker and are rejected without a review round; a same-operation denial fuse stops the agent from re-asking a denied operation with reworded justifications.

The reviewer is **structurally isolated**: it runs with zero tools, a fixed reviewer persona, its approval pinned to `never`, a delegation-depth cap, and — via the `isolate` capability — **without inheriting the parent agent's preset** (no parent tools, system-prompt sections, or conversation history). If the `isolate` capability is unavailable, Auto-Review **fails closed** — it never falls back to an un-isolated reviewer.

## Why a compatibility patch is needed right now

Auto-Review depends on three things that **official DSH `0.1.0-rc.6` does not yet ship**:

1. the subagent `isolate` start-time capability (isolated reviewer child);
2. the `auto-review` value in the approval-policy vocabulary;
3. the escalation `arguments` seam (validated tool arguments reach the approval requester).

This repository ships a **minimal, hash-pinned compatibility patch** (`patches/`) that adds exactly these three features to a supported DSH installation, plus an installer that applies it safely. There is no prompt-only isolation fallback: without the patch, Auto-Review fails closed.

## Supported DSH version

| DSH version | Status |
|---|---|
| `0.1.0-rc.6` | ✅ supported (the patch manifest is pinned to this version) |
| anything else | ❌ refused — the installer exits without touching DSH |

The installer reads the installed DSH version and refuses to patch any other version. After upgrading DSH, run `doctor` and wait for a manifest that supports the new version (see [After a DSH upgrade](#after-a-dsh-upgrade)).

## Install

**Platform:** Windows is the primary verified platform. Linux/macOS are not claimed as fully supported (the `isolate` capability targets the in-process subagent providers, which are platform-independent, but the full flow has only been exercised on Windows).

Prerequisites: Node.js `>= 22.19` (or `>= 24`), and a global install of the supported DSH version:

```bash
npm install -g @deepseek-ai/dsh@0.1.0-rc.6
```

Then download this repository and run the installer:

```bash
git clone https://github.com/Jelee0145/dsh-auto-review.git
cd dsh-auto-review
node scripts/install.mjs
```

The installer, in order:

1. locates the global DSH install via `npm root -g`;
2. verifies the installed DSH version is exactly the supported one (exits otherwise);
3. applies the compatibility patch to 9 files inside the DSH package (each target is verified by SHA-256 before **and** after; originals are backed up with a `.dsh-ar-orig` suffix; re-running is idempotent; any failure rolls back everything changed in that run);
4. copies the plugin into `<DSH_HOME>/profiles/node_modules/dsh-auto-review`;
5. writes a managed block into `<DSH_HOME>/profiles/<profile>/cordis.patch.yml` (selects the `auto-review` approval policy, restates the permission presets with an `auto-review` row, and mounts the plugin).

`<DSH_HOME>` is `~/.dsh` by default (or `$DSH_HOME`). The default profile is `web`; pass `--profile <name>` for another.

Verify the result:

```bash
node scripts/doctor.mjs
```

Then start DSH as usual:

```bash
dsh web
```

(If your profile is not `web`, pass `--profile <name>` to both `install.mjs` and `dsh`.)

### Install with an Agent / 使用 Agent 安装

Paste this into any coding agent (Codex, Claude Code, a DSH agent, …):

> 请阅读https://github.com/Jelee0145/dsh-auto-review/blob/main/README.md安装 DSH Auto-Review。先检查我当前安装的 DSH 版本是否受支持，再使用仓库提供的安装脚本应用所需的 isolate compatibility patch 并安装 Auto-Review。不要修改 README 未要求的其他 DSH 代码，不要使用弱化的隔离 fallback。安装完成后运行项目提供的 doctor/验证步骤，并告诉我实际修改了哪些文件以及验证结果。如果版本或文件校验不匹配，请停止并告诉我原因，不要强行 patch。

<details>
<summary>English (semantically equivalent)</summary>

> Follow https://github.com/Jelee0145/dsh-auto-review/blob/main/README.md to install DSH Auto-Review. First check whether my installed DSH version is supported, then use the repository's installer to apply the required isolate compatibility patch and install Auto-Review. Do not modify DSH code beyond what the README requires, and do not use a weakened isolation fallback. After installing, run the project's doctor/verification steps and tell me which files were actually modified and what the results were. If the version or file checks do not match, stop and tell me why — do not force the patch.

</details>

## Usage

After a successful install, escalations on sessions whose approval policy is `auto-review` are decided automatically:

- **Benign, authorized operations** (e.g. writing a scratch file the user asked for outside the workspace) are allowed after review.
- **High-risk or unauthorized operations** are denied; catastrophic commands are rejected by the circuit breaker without a review round.
- **Repeated denials of the same operation** trip the denial fuse and stop re-reviewing.

The reviewer's reasoning is not injected into the parent conversation; it is reconstructable from the reviewer child's session (via `list_agents`).

## After a DSH upgrade

The patch is pinned to DSH `0.1.0-rc.6`. If you later run `npm install -g @deepseek-ai/dsh@<newer>`, the patched files are replaced by npm and the manifest no longer matches:

1. run `node scripts/doctor.mjs` — it will report the version as unsupported;
2. do **not** force the installer against a newer version (the anchors may differ);
3. if you still need Auto-Review, uninstall the leftover state and wait for a repository release with a manifest for the new DSH version.

## Uninstall / restore

```bash
node scripts/uninstall.mjs
```

The uninstaller restores every patched DSH file from its `.dsh-ar-orig` backup (or by reversing the patch when the backup is gone), removes the plugin copy, removes the managed profile block, and deletes the install receipt. It is safe to run when already uninstalled.

## Known Limitations

- **Auto-Review reviews only what reaches the escalation seam.** It does not replace the DSH sandbox. Notably, on the Windows ACL sandbox a confined child can delete a pre-existing file the invoking user could delete (`DELETE` on the file or `FILE_DELETE_CHILD` on its parent), and such operations never produce an escalation ask — Auto-Review never sees them. This is a pre-existing DSH sandbox boundary, not an Auto-Review defect.
- **The reviewer inherits the parent's working directory.** The `isolate` capability removes the parent's preset (tools, system-prompt sections, conversation history), but the reviewer child still runs with the parent's `cwd`, so the host's workspace-instruction injection (e.g. `AGENTS.md`) still reaches it. This is developer context (not a privilege or a hidden-state leak); a cwd-neutral reviewer would need a further DSH capability and is deferred.
- **Linux/macOS are untested.** The full install→allow/deny→uninstall flow was exercised on Windows only.
- **No verdict cache** — identical asks are re-reviewed each time.
- **Sensitive reads are out of scope** — reading files outside the workspace may not route through an escalation ask at all.

## Repository layout

```text
auto-review/   the plugin (source + built lib; installed by the installer)
patches/       compatibility patch manifest (hash-pinned to one DSH version)
scripts/       install.mjs / uninstall.mjs / doctor.mjs (+ lib.mjs, gen-manifest.mjs)
profile/       reference copy of the managed profile entries
verify/        keyless mock-model verification harness (dev-only; not installed)
```

## Not an official DeepSeek AI plugin

This project is community-maintained and is not affiliated with, endorsed by, or provided by DeepSeek AI. It patches a third-party installation of DeepSeek Harness; the patch is applied by an explicit install step (never by an npm `postinstall`), targets only the features listed above, and can be fully reverted with the uninstaller.

## License

[MIT](LICENSE)
