# CloudCLI 代码审核交接文档

> 生成时间：2026-09-04。前两层审查已完成，本文档供接手方继续第 3/4 层及遗留事项。
> 项目：`D:\workspace\CloudCLI`（从 `D:\cheng\cloudcli-custom` v1.37.2 迁出的独立仓库，**不要与 3002 官方版 CloudCLI 混淆**，本项目是 5181/3005 自定义版）。

## 项目布局

| 目录 | 说明 | 端口 | 启动 |
|---|---|---|---|
| `web/` | Vite + React 前端，约 54.5K 行 | 5181 | `npm run dev` |
| `server/` | Node + Express + tsx 后端，约 40K 行，20 个 `modules/*` | 3005 | `npm run dev` |
| `web/shared/` 与 `server/shared/` | 各有一份 `networkHosts.js`（当前 hash 一致，无同步机制，改动需两边同步） | — | — |

web 和 server 各自独立 `.git` 仓库，无 remote。

## 当前端线状态（接手前基线，全部已验证）

| 检查 | web | server |
|---|---|---|
| typecheck | ✅ 0 错 | ✅ 0 错 |
| lint（ESLint 9 flat config） | ✅ 0 error / 29 warning | ✅ 0 error / 0 warning |
| test | ✅ 45/45 | ✅ 269/270（唯一失败 `image-attachments.test.ts` 的 symlink 用例是 **EBUSY 环境抖动**，单独重跑 20/20 过，勿当 bug 修） |

### 未提交改动（接手后第一件事：审查并提交）

- `web/`：129 文件改动 —— 恢复的 `eslint.config.js` + `eslint --fix` 机械清理（import 排序/空行/删未用 import）+ `package-lock.json`（新建）
- `server/`：16 文件改动 —— 恢复的 `eslint.config.js` + 10 个失败测试的修复 + 机械清理 + `package-lock.json`（新建）
- 建议分两个 commit：`fix: repair test suite for standalone layout and Windows` 与 `chore: restore eslint configs, lockfiles, mechanical lint fixes`

---

## 已完成工作摘要（避免重复劳动）

### 第 1 层：基线修复 ✅
1. **恢复丢失的 lint 配置**：原 `eslint.config.js` 在旧 monorepo 根，迁移时丢失。已拆成 `web/eslint.config.js` + `server/eslint.config.js`。server 版含 **boundaries 架构边界规则**（模块间只能走 barrel import、shared 类型契约只许 `import type`）。⚠️ **今后在 `server/shared/` 新增公共工具文件时，必须同步加进 server/eslint.config.js 的 `backend-shared-utils` pattern 列表**，否则 `boundaries/no-unknown` 报错。
2. **server typecheck 修复**：`SessionRow` 新增 `isPinned` 后，`provider-token-usage.service.test.ts` 的 mock 工厂补了 `isPinned: 0`。
3. **web 201 → 29 warnings**（`eslint --fix`）。剩余 29 个非机械 warning 中值得关注的真问题：
   - `react-hooks/exhaustive-deps` ×3（`useSessionTodos`、某处 `connect` 依赖缺失）— 有 stale closure 风险
   - `ref.current` 在 effect cleanup 中被引用 — 时序隐患
   - Tailwind 冲突类名 `max-w-4xl` + `max-w-none` ×1

### 第 2 层：迁移残留 / 死代码 / 依赖 ✅
1. **死引用**：代码中无指向旧 monorepo 的实际 import（仅 README/注释提及），无需处理。
2. **10 个失败测试全部修复**，根因四类：
   - 迁移残留：`cli-environment-bootstrap.test.ts` 的 `applicationRoot` 按 monorepo 布局 4 级上跳 → 改 3 级（server 根），fixture 补拷 `shared/data-root.ts`
   - 测试不隔离：`claude-auth.test.ts` 的 `withTempHome` 只改 `HOME`，Windows 上 `os.homedir()` 读 `USERPROFILE`，导致读到本机真实 `~/.claude/settings.json` → 现在 HOME/USERPROFILE 双隔离（**新写测试务必注意**）
   - POSIX 偏置：`projects.db.integration.test.ts`、`project-management.service.test.ts` 硬编码 `/workspace/...` → 改 `path.normalize()`
   - Schema 漂移：`sessions.service.test.ts` 补 `isPinned: false`；`provider-models.db.integration.test.ts` 表结构断言补 `'hidden'` 列
3. **依赖**：两边补建了缺失的 `package-lock.json`；`npm audit fix`（非破坏性）web 15→7、server 29→14。

---

## 待办 1：第 3 层 — server 安全审查（优先级最高）

目标：全面审查 3005 后端的攻击面。已知结构信息：

- 入口 `server/index.ts`：挂载 `/api/*` 路由 + WS 端点（`/ws`、`/shell`、`/plugin-ws` 等，见 `modules/websocket/`）
- 已有的安全资产（审查时别重复造轮子，验证覆盖面即可）：
  - `modules/auth/` 有 `authenticateToken`（JWT），测试覆盖注册/登录/refresh
  - `shared/image-attachments.ts` 有路径穿越防护 + 测试（`resolveImageAssetFile rejects traversal`）
  - `modules/agent/agent.routes.ts` 有 GitHub URL 伪造 host 拒绝、clone 凭证不进 argv 的测试
  - server 的 `boundaries` lint 规则限制了模块间深引用
- 审查清单：
  1. **鉴权覆盖矩阵**：枚举 `index.ts` 挂载的全部路由 + 全部 WS 升级端点，逐个确认 auth 中间件覆盖。重点：WS 升级请求是否验 token（HTTP 中间件管不到 `upgrade` 事件）；静态文件/上传接口是否绕过
  2. **命令注入**：`/shell`（node-pty）、`modules/git/`（git 参数拼接）、`modules/agent/`（clone URL）、`browser-use` 子进程 spawn。检查是否有 `shell: true` 或字符串拼接命令
  3. **路径穿越**：file-tree、PRD 编辑器、代码编辑器的读写 API；`normalizeProjectPath`（`shared/utils.ts`）的绕过可能（`..`、Windows 盘符、UNC `\\`、`%5C` 编码）
  4. **bind 地址与 CORS**：listen 是 `127.0.0.1` 还是 `0.0.0.0`；`cors` 中间件 origin 配置；`.env` 里的开关
  5. **密钥面**：`credentials.ts`/`github-tokens.ts`/`api-keys.ts` 等仓储的加密存储情况；日志是否打印 token（测试输出里已见过打印 clone URL 的行为）；前端 bundle 是否能拿到敏感值
  6. **上传**：multer 配置（大小限制、文件类型白名单——已有 `isAllowedImageMimeType`，确认覆盖所有上传口）
- 产出：按严重度排序的发现清单（文件:行号 + 复现/利用路径 + 修复建议），先报告再动手修

## 待办 2：第 4 层 — 性能优化（可选，需先拿运行时数据）

1. web：`vite build` + 产物分析（codemirror/xterm/mermaid/katex 是大件，确认是否进了首屏 chunk；路由级 lazy 是否覆盖）
2. server：WS 会话断开后是否清理（`chat-websocket.service.ts` 等的 close handler）、同步 fs 调用在请求路径上的阻塞
3. 原则：不凭感觉优化，先测量

## 待办 3：遗留事项

| 事项 | 说明 | 前置条件 |
|---|---|---|
| `npm prune`（web + server） | node_modules 是从旧 monorepo 拷的，含已废弃 desktop 依赖 | **必须停掉 3005/5181 服务再跑**，Windows 运行中删文件会 EBUSY |
| 删除死文件 | web 5 个：`FileSelectionControls.tsx`、`SettingsMainTabs.tsx`、`AgentListItem.tsx`、`VersionInfoSection.tsx`、`contexts/AuthContext.jsx`；server 1 个候选：`websocket-writer.service.ts`（删前人工确认 WebSocketWriter 无运行时引用，注意 `isWebSocketWriter` duck-typing 标记） | 提交 checkpoint 后单独一个 commit |
| 破坏性依赖升级 | `sharp@^0.35`（high）、`react-syntax-highlighter@16`（prismjs 链）、`react-router@7`、`express@5`、node-gyp 构建链（`tar` critical，属构建期风险） | 每项单独升级 + 全量回归 |
| web 剩余 29 warnings | 3 个 hook 依赖问题值得修，其余 react-refresh/tailwind 顺序类可批量处理 | — |
| shared 双份拷贝 | `networkHosts.js` 两份手工同步；长期方案：构建期从单一源拷贝或发内部包 | — |

## 环境经验（本项目踩过的坑）

1. **PowerShell 5.1 字符串插值陷阱**：双引号字符串里 `"$nlimport"` 会把 `$nl` 和后面的字母拼成变量名 `nlimport`（值为空）。多行字符串拼接用 `[char]10` 显式拼接，别用 `` `n `` 后紧跟字母。
2. **文件换行**：仓库文件是 LF。用 `[System.IO.File]::ReadAllText/WriteAllText` 补丁时先 `.Replace("\`r\`n","\`n")` 归一化，多行匹配才不会 MISS。
3. **后台任务不可靠**：本会话的后台任务多次被会话退出杀掉。长命令用前台 + timeout（最大 600000ms）。
4. **测试环境隔离**：任何读 `~/.claude`、`os.homedir()` 的测试必须同时隔离 `HOME` 和 `USERPROFILE`。
5. **flake 判定流程**：失败先单独重跑该测试文件，过了就是环境抖动（尤其文件 unlink EBUSY 类），不要改代码"修"它。
6. **验证命令**（改动后必跑）：
   ```powershell
   # web
   Set-Location D:\workspace\CloudCLI\web; npm run typecheck; npx eslint src/; npm test
   # server
   Set-Location D:\workspace\CloudCLI\server; npm run typecheck; npx eslint .; cmd /c "npm test > test-out.txt 2>&1"
   ```
7. **辅助工具**：`D:\workspace\CloudCLI\scan-dead.mjs`（死文件扫描器，`node scan-dead.mjs <dir>`）。已知局限：识别不了运行时拼接的动态 import（如 `await import('./x.js')` 字面量能识别，变量拼接不能），结果仅供参考，报"死"必须人工 grep 复核。
