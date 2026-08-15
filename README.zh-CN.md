<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/e3a68a64-709c-481b-8d4c-4cbb2ada155b" /># DSH Auto-Review

[English](README.md) | [简体中文](README.zh-CN.md)

面向 [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh)（DSH）的 Codex 式自动审批审查。沙箱提权请求不再只靠人工提示或一律拒绝，而是交由一个**隔离的审查 subagent**，独立回答两个问题——*这条确切操作本身有多危险？* 和 *用户是否真正授权了这一效果？*——并返回结构化 allow/deny 判定。

> **状态：Community Beta（v0.1.0-beta.1）。** 本项目**不是** DeepSeek AI 官方产品或插件，而是独立于 DSH 的社区项目。存在粗糙之处，见 [Known Limitations / 已知限制](#known-limitations)。

## 工作原理（简述）

DSH agent 需要写沙箱之外的文件时，会带 `sandbox_permissions` + `justification` 重试一次。DSH 把该提权请求路由到审批缝；Auto-Review 认领该请求，并把以下内容交给审查 subagent：

- **确切操作**——完整校验后的工具参数；
- **可信上下文**——用户的真实消息（唯一的授权证据；agent 的 justification 被标记为不可信）；
- **一次性语义**——授权只对这一条调用生效，别无其他。

审查者返回 `{ verdict, riskLevel, userAuthorization, reason }`。`critical` 风险不论模型 verdict 如何都会被确定性拒绝。灾难性命令命中熔断名单，不经审查直接拒绝；同操作拒绝熔断阻止 agent 靠改写 justification 反复重新申请。

审查者是**结构性隔离**的：零工具、固定审查者 persona、approval 钉死为 `never`、委托深度封顶，并通过 `isolate` 能力做到**不继承父 agent 的 preset**（不继承父工具、system-prompt 段落或对话历史）。当 `isolate` 能力不可用时，Auto-Review **fail closed**——绝不退化为未隔离的审查。

## 为什么现在需要 compatibility patch

Auto-Review 依赖三样官方 DSH `0.1.0-rc.6` **尚未提供**的东西：

1. subagent `isolate` start-time 能力（隔离审查子 agent）；
2. 审批策略词汇中的 `auto-review` 取值；
3. 提权 `arguments` 参数缝（已校验工具参数到达审批请求方）。

本仓库提供一个**最小、按哈希钉死的 compatibility patch**（`patches/`），为受支持的 DSH 安装精确补齐这三样，并附带一个安全应用它的安装脚本。**不存在** prompt-only 隔离等弱化 fallback：不打补丁，Auto-Review 就 fail closed。

## 支持的 DSH 版本

| DSH 版本 | 状态 |
|---|---|
| `0.1.0-rc.6` | ✅ 支持（patch manifest 钉死在该版本） |
| 其它版本 | ❌ 拒绝——安装脚本直接退出，不动 DSH |

安装脚本读取已装 DSH 的版本，其它版本一律拒绝打补丁。升级 DSH 后请运行 `doctor`，并等待支持新版本的 manifest（见 [DSH 升级之后](#dsh-升级之后)）。

## 安装

**平台：** Windows 是主要验证平台。Linux/macOS 未声称完整支持（`isolate` 能力面向进程内 subagent provider，本身跨平台，但完整流程只在 Windows 上跑过）。

前置：Node.js `>= 22.19`（或 `>= 24`），以及受支持版本的全局 DSH：

```bash
npm install -g @deepseek-ai/dsh@0.1.0-rc.6
```

然后下载本仓库并运行安装脚本：

```bash
git clone https://github.com/Jelee0145/dsh-auto-review.git
cd dsh-auto-review
node scripts/install.mjs
```

安装脚本依次：

1. 通过 `npm root -g` 定位全局 DSH；
2. 校验已装 DSH 版本是否精确等于受支持版本（否则退出）；
3. 对 DSH 包内的 9 个文件应用 compatibility patch（每个目标在打补丁**前与后**都用 SHA-256 校验；原文件以 `.dsh-ar-orig` 后缀备份；重复运行幂等；任何失败都会回滚本次已改动的全部文件）；
4. 把插件复制到 `<DSH_HOME>/profiles/node_modules/dsh-auto-review`；
5. 在 `<DSH_HOME>/profiles/<profile>/cordis.patch.yml` 写入托管块（选择 `auto-review` 审批策略、以带 `auto-review` 行的方式重述 permission presets、挂载插件）。

`<DSH_HOME>` 默认是 `~/.dsh`（或 `$DSH_HOME`）。默认 profile 是 `web`；换其它 profile 用 `--profile <name>`。

验证结果：

```bash
node scripts/doctor.mjs
```

然后照常启动 DSH：

```bash
dsh web
```

（若 profile 不是 `web`，请给 `install.mjs` 和 `dsh` 都加 `--profile <name>`。）

### 使用 Agent 安装 / Install with an Agent

把下面这段直接复制给任意 coding agent（Codex、Claude Code、DSH agent 等）：

> 请阅读https://github.com/Jelee0145/dsh-auto-review/blob/main/README.md安装 DSH Auto-Review。先检查我当前安装的 DSH 版本是否受支持，再使用仓库提供的安装脚本应用所需的 isolate compatibility patch 并安装 Auto-Review。不要修改 README 未要求的其他 DSH 代码，不要使用弱化的隔离 fallback。安装完成后运行项目提供的 doctor/验证步骤，并告诉我实际修改了哪些文件以及验证结果。如果版本或文件校验不匹配，请停止并告诉我原因，不要强行 patch。

<details>
<summary>English（语义一致）</summary>

> Follow https://github.com/Jelee0145/dsh-auto-review/blob/main/README.md to install DSH Auto-Review. First check whether my installed DSH version is supported, then use the repository's installer to apply the required isolate compatibility patch and install Auto-Review. Do not modify DSH code beyond what the README requires, and do not use a weakened isolation fallback. After installing, run the project's doctor/verification steps and tell me which files were actually modified and what the results were. If the version or file checks do not match, stop and tell me why — do not force the patch.

</details>

## 使用方式

安装成功后，审批策略为 `auto-review` 的会话上的提权会被自动裁决：

- **良性且已授权的操作**（例如用户明确要求在工作区外写一个临时文件）在审查后放行；
- **高风险或未授权的操作**被拒绝；灾难性命令由熔断不经审查直接拒绝；
- **同一操作反复被拒**会触发拒绝熔断，停止继续复审。

审查者的推理不注入父会话；可通过 `list_agents` 从审查子会话重建。

## DSH 升级之后

patch 钉死在 DSH `0.1.0-rc.6`。若日后执行 `npm install -g @deepseek-ai/dsh@<新版>`，被补丁的文件会被 npm 替换，manifest 也不再匹配：

1. 运行 `node scripts/doctor.mjs`——它会报告版本不受支持；
2. **不要**对新版本强行运行安装脚本（锚点可能已变化）；
3. 若仍需 Auto-Review，先卸载残留状态，等待本仓库发布支持新 DSH 版本的 manifest。

## 卸载 / 恢复

```bash
node scripts/uninstall.mjs
```

卸载脚本从 `.dsh-ar-orig` 备份还原每个被补丁的 DSH 文件（备份缺失时反向撤销补丁）、移除插件副本、移除托管 profile 块、删除安装回执。已卸载时重复运行是安全的。

## 已知限制 / Known Limitations

- **Auto-Review 只审核真正进入提权缝的操作**，不能替代 DSH 底层沙箱。特别地，在 Windows ACL 沙箱下，受限子进程可以删除调用用户本身可删除的已存在文件（经文件上的 `DELETE` 或父目录上的 `FILE_DELETE_CHILD`），这类操作不产生提权请求——Auto-Review 根本看不到。这是 DSH 既有的沙箱边界，而非 Auto-Review 缺陷。
- **审查者继承父工作目录。** `isolate` 能力移除了父 preset（工具、system-prompt 段落、对话历史），但审查子 agent 仍以父的 `cwd` 运行，宿主的工作区指令注入（如 `AGENTS.md`）仍会到达它。这是开发者上下文（非权限、非隐藏状态泄漏）；要做到 cwd 中立需要进一步的 DSH 能力，已延后。
- **Linux/macOS 未测试。** 完整 安装→allow/deny→卸载 流程只在 Windows 上验证过。
- **无判定缓存**——相同 ask 每次都重新审查。
- **敏感读取不在范围内**——读取工作区外文件可能根本不经过提权请求。

## 仓库结构

```text
auto-review/   插件（源码 + 构建产物；由安装脚本安装）
patches/       compatibility patch manifest（按哈希钉死到一个 DSH 版本）
scripts/       install.mjs / uninstall.mjs / doctor.mjs（+ lib.mjs、gen-manifest.mjs）
profile/       托管 profile 条目的参考副本
verify/        keyless mock-model 验证套件（仅开发用；不会被安装）
```

## 非 DeepSeek AI 官方插件声明

本项目由社区维护，与 DeepSeek AI 无隶属、背书或提供关系。它会对第三方安装的 DeepSeek Harness 打补丁；补丁仅由显式安装步骤应用（绝不通过 npm `postinstall` 静默执行），只针对上文列出的特性，且可用卸载脚本完全还原。

## 许可协议

[MIT](LICENSE)
