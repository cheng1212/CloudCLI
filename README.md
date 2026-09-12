# CloudCLI

> 自托管的 AI 编程智能体 Web 控制台 —— 给 Claude Code / Codex 等 AI Agent 一个开箱即用的网页工作台。
>
> A self-hosted web console for AI coding agents: chat, code editor, terminal, Git panel and task board — all in your browser.

## 这是什么？

CloudCLI 把 AI 编程代理装进浏览器。启动后端 + 前端后，你可以在网页里：

- 与 Claude Code / Codex 等 Agent **流式对话**，实时看到工具调用、任务清单和子代理的执行过程；
- 在内置**代码编辑器**里直接改项目文件，配合文件树、终端和 Git 面板完成完整开发闭环；
- 用 **PRD → 任务看板**管理工作流，把需求文档拆成可跟踪的任务。

## 功能特性

- 💬 **AI 对话工作台** — 流式输出、会话管理（置顶 / 搜索 / 历史）、TodoWrite 任务清单实时渲染、子代理执行可视化
- 🤖 **多供应商模型库** — 按 API 来源分组管理模型，支持隐藏模型管理，兼容 Claude / Codex / OpenCode 等多种接入方式
- 📝 **内置代码编辑器** — CodeMirror 6：JS/TS/Python/CSS/HTML/JSON/Markdown 语法高亮、Minimap、diff 合并视图、侧边文件树
- 🖥️ **集成终端** — xterm.js + node-pty 真实 PTY，附快捷命令面板
- 🔀 **Git 面板** — 状态 / 暂存 / 提交 / 历史 / 分支 / worktree 管理，可视化回退本地提交
- ✅ **Task Master** — PRD 编辑器自动生成任务，看板跟踪进度
- 🧩 **插件系统** — 独立 WebSocket 插件通道
- 🌐 **多语言** — 简繁中文、英、日、韩、德、法、西、意、俄、土耳其 11 种界面语言
- 🔊 其他 — TTS 语音朗读、图片附件、Markdown / KaTeX / Mermaid 渲染

## 技术栈与架构

| 子项目 | 技术 | 端口 |
| --- | --- | --- |
| `web/` | Vite + React 18 + Tailwind CSS | 5181（dev，脚本固定） |
| `server/` | Node.js + Express + tsx + WebSocket | 3005（本仓库惯例）/ 3001（代码默认） |

- 数据库：SQLite（better-sqlite3），存储用户凭据、API key、token
- 终端：node-pty
- Agent 接入：`@anthropic-ai/claude-agent-sdk`、`@openai/codex-sdk`、OpenCode 兼容 runtime
- 开发模式下 Vite 把 `/api`、`/ws`、`/shell`、`/plugin-ws` 自动代理到后端，无需处理跨域；生产模式下 server 直接托管前端构建产物，单端口访问。

## 环境要求

- Node.js ≥ 20，npm
- Windows / macOS / Linux（`node-pty`、`better-sqlite3` 是原生模块，通常有预编译包；若触发源码编译需要对应构建工具链）

## 快速开始

### 1. 克隆并安装

```bash
git clone https://github.com/cheng1212/CloudCLI.git
cd CloudCLI

# 安装后端依赖
cd server && npm install && cd ..

# 安装前端依赖（另开一个终端跑也行）
cd web && npm install && cd ..
```

### 2. 开发模式

```bash
# 终端 1：后端
cd server && npm run dev

# 终端 2：前端
cd web && npm run dev
# 打开 http://localhost:5181
```

### 3. 生产模式（单端口，推荐日常使用）

```bash
# 构建前端，产物在 web/dist
cd web && npm run build && cd ..

# 把前端产物放到仓库根目录 dist/（server 从这里托管）
# Windows: xcopy /E /Y web\dist dist\   macOS/Linux: cp -r web/dist/* dist/

# 构建并启动后端
cd server && npm run start
# 打开 http://localhost:3005
```

### 4. 首次使用

打开页面会先进入初始化页，**注册管理员账号**后登录即可。模型与供应商在「设置 → API」和模型库面板里配置。

## 配置

通过环境变量配置，均有默认值（不改也能跑）。参考各子项目下的 `.env.example`，或直接设置进程环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SERVER_PORT` | `3001` | 后端 API + WebSocket 端口 |
| `VITE_PORT` | `5173` | 前端 dev 端口（本仓库 dev 脚本固定为 5181） |
| `HOST` | `0.0.0.0` | 监听地址；仅本机使用建议改为 `127.0.0.1` |
| `DATABASE_PATH` | — | 认证数据库文件路径（存用户凭据、API key、token） |
| `CONTEXT_WINDOW` | `160000` | 会话上下文窗口 token 上限 |
| `CLAUDE_CLI_PATH` | `claude` | 自定义 claude CLI 路径 |

## 目录结构

```
CloudCLI/
├── web/            # 前端（Vite + React）
├── server/         # 后端（Express + tsx，20 个业务模块）
├── dist/           # 前端构建产物（生产模式由 server 托管）
└── scan-dead.mjs   # 死代码扫描辅助脚本（结果需人工复核）
```

## 安全提示

- 默认监听 `0.0.0.0` 会暴露到局域网；仅本机使用请设 `HOST=127.0.0.1`
- 公网部署务必放在反向代理 + HTTPS 之后，并做好访问控制
- SQLite 数据库中存有凭据与 token，注意备份与文件权限
- 不要把 `.env`、API key 等敏感信息提交进仓库

## 开发

在 `web/` 或 `server/` 目录下：

```bash
npm run typecheck   # 类型检查
npm run lint        # ESLint
npm test            # 测试
```

## License

[MIT](LICENSE)
