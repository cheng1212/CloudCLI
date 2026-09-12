# CloudCLI

Split out of the original monorepo at `D:/cheng/cloudcli-custom` (v1.37.2, commit `677b7ba`) on 2026-09-01. Each subproject now has its own `package.json` / `pubspec.yaml` and its own `.git` repository.

## Layout

```
D:/workspace/CloudCLI/
├── web/                         Vite + React web frontend, port 5181
├── server/                      tsx Express backend, port 3005
├── flutter-mobile-20260831/     Flutter mobile (provider/http), last touched 2026-08-31
└── flutter-client-20260822/     Flutter client (riverpod + dio + go_router), last touched 2026-08-22
```

## Run

| Subproject | Command | Port |
| --- | --- | --- |
| `server/` | `npm run dev` (or `npm run start` for built bundle) | 3005 |
| `web/`    | `npm run dev` (or `npm run dev:host` to bind 0.0.0.0) | 5181 |
| `flutter-mobile-20260831/` | `flutter run` | — |
| `flutter-client-20260822/` | `flutter run` | — |

The web dev server proxies `/api`, `/ws`, `/shell`, `/plugin-ws` to `SERVER_PORT` (default 3001 → override to `3005` via `.env` or `npm run dev:host` upstream) — see `web/vite.config.js`.

## Notes from the migration

- **Source pointers** (kept for reference only):
  - `D:/cheng/cloudcli-custom/src` → `web/src`
  - `D:/cheng/cloudcli-custom/server` → `server/`
  - `D:/cheng/cloudcli-custom/shared/networkHosts.js` → copied into both `web/shared/` and `server/shared/` (both `vite.config.js` and `server/index.ts` import it relatively)
  - `D:/cheng/cloudcli-custom/scripts/{promote-dist-server.mjs,fix-node-pty.js}` → `server/scripts/` (build pipeline dependencies)
  - `D:/cheng/cloudcli_flutter` → `flutter-mobile-20260831/`
  - `D:/cheng/cloudcli-custom/flutter_client` → `flutter-client-20260822/`
- **Electron / desktop packaging files were dropped** as agreed: `electron/`, `release/`, `dist-server/`, `release.sh`, `desktop:*` npm scripts, `electron-builder` deps, etc.
- **Server tsconfig adjusted**: `rootDir` and `baseUrl` flipped from `..` to `.` (now standalone); `paths["@/*"]` resolved to `./*` instead of `server/*`. `server/index.ts` `'../shared/networkHosts.js'` rewritten to `'./shared/networkHosts.js'`.
- **Web vite dev port pinned to 5181** (`--strictPort`) to match the previous dev URL.
- **node_modules** were copied from the monorepo for instant `npm run dev`; run `npm prune` later in `web/` and `server/` to drop the desktop/server-only deps that came along.

## Git state

| Repo | Initial commit | Notes |
| --- | --- | --- |
| `server/`                          | `154c8f1` | new repo, snapshot of `cloudcli-custom` v1.37.2 server subtree |
| `web/`                             | `368ddab` | new repo, snapshot of `cloudcli-custom` v1.37.2 web subtree |
| `flutter-mobile-20260831/`         | `188abc6` | original repo carried over, history preserved |
| `flutter-client-20260822/`         | `32b65bd` | original repo carried over, history preserved |

Neither Flutter repo had a remote configured at migration time. The two new repos (server, web) also have no remote — add one with `git remote add origin <url>` when ready to push.
