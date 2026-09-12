/**
 * Unified model routing for Claude Code and Codex runtimes.
 *
 * CloudCLI lets the user pick models from a catalog whose entries can point at
 * providers other than the upstream vendor (NVIDIA / DeepSeek / GLM via the
 * local LiteLLM proxy on 4000, OpenCode Go, ...). The runtime must therefore
 * resolve the *selected model id* to an *endpoint + token + upstream model
 * name* before spawning the CLI, otherwise the CLI uses whatever endpoint is
 * baked into its own config (~/.claude/settings.json or ~/.codex/config.toml)
 * and the request lands on the wrong provider.
 *
 * Routes live in standalone JSON files so adding a provider needs no code:
 *   - Claude  → CLOUDCLI_CLAUDE_ROUTES_PATH, default `~/litellm/claude-routes.json`
 *   - Codex   → CLOUDCLI_CODEX_ROUTES_PATH, default `~/litellm/codex-routes.json`
 *
 * Layout, matching the configs shipped with the product:
 *   { defaultRoute: {baseUrl, authToken, ...}, routes: { "<model_id>": {baseUrl, authToken, model, ...} } }
 *
 * For Claude the entry point is `buildClaudeRouteSettings(model)`: it returns a
 * settings-object to hand Claude Code through the SDK's `settings` option
 * (equivalent to `--settings`, the highest-priority user-controlled settings
 * layer), or null when the model has no route. The caller makes the CLI read it
 * without touching the real `~/.claude/settings.json`.
 *
 * For Codex the entry point is `buildCodexOptions(model)` (mirrors the same
 * helper in the 3002 CloudCLI patch): it returns `new Codex()` options that
 * pin `model_provider` / `base_url` / `model` so `~/.codex/config.toml`
 * global settings can never capture the session.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type ClaudeRouteSettings = {
  env: {
    ANTHROPIC_BASE_URL: string;
    ANTHROPIC_AUTH_TOKEN: string;
  };
  model: string;
};

export type CodexRouteOptions = {
  config?: Record<string, unknown>;
  env?: Record<string, string>;
  model?: string;
};

export type RouteLoadResult = {
  baseUrl?: string;
  authToken?: string;
  model?: string;
  provider?: string;
  modelProvider?: string;
  wireApi?: string;
  requiresOpenaiAuth?: boolean;
  apiKey?: string;
  _isDefault?: boolean;
};

export type RouteConfig = {
  defaultRoute?: RouteLoadResult;
  routes?: Record<string, RouteLoadResult>;
  providers?: Record<string, {
    baseUrl?: string;
    apiKey?: string;
    wireApi?: string;
    requiresOpenaiAuth?: boolean;
  }>;
};

const CLAUDE_ROUTES_PATH = process.env.CLOUDCLI_CLAUDE_ROUTES_PATH
  || path.join(os.homedir(), 'litellm', 'claude-routes.json');

const CODEX_ROUTES_PATH = process.env.CLOUDCLI_CODEX_ROUTES_PATH
  || path.join(os.homedir(), 'litellm', 'codex-routes.json');

function loadRoutes(routePath: string): RouteConfig | null {
  try {
    return JSON.parse(fs.readFileSync(routePath, 'utf8')) as RouteConfig;
  } catch {
    return null;
  }
}

/**
 * Resolves a model id against a routes file.
 *
 * Explicit `routes[model]` wins; otherwise the file's `defaultRoute` applies.
 * For pre-defined first-party models (the CLI's own catalog) no route exists,
 * so the model falls through and the CLI keeps its configured endpoint — that
 * is the intended escape hatch for switching back to the upstream vendor.
 */
function findRoute(routes: RouteConfig | null, model: string | undefined | null): RouteLoadResult | null {
  if (!model) {
    return null;
  }
  if (!routes) {
    return null;
  }
  return routes.routes?.[model] ?? routes.defaultRoute ?? null;
}

/**
 * Builds the route settings for a Claude Code run, keyed by the selected model
 * id. Returns null when the model has no route (pre-defined upstream models).
 *
 * The returned settings object is written (by the caller) to a temp file and
 * passed through the SDK `settings` option — the flag-settings layer, which
 * trumps both the user `~/.claude/settings.json` env block and any env-var
 * override. This is the 3005-safe alternative to the 3002 patch's approach of
 * rewriting the real settings file in place.
 */
export function buildClaudeRouteSettings(
  model: string | undefined | null,
): ClaudeRouteSettings | null {
  const route = findRoute(loadRoutes(CLAUDE_ROUTES_PATH), model);
  if (!route?.baseUrl) {
    return null;
  }
  return {
    env: {
      ANTHROPIC_BASE_URL: route.baseUrl,
      ANTHROPIC_AUTH_TOKEN: route.authToken || '',
    },
    model: route.model || model || '',
  };
}

/**
 * Builds the options object for `new Codex()` so the spawned binary talks to
 * the endpoint that serves this model id.
 *
 * Mirrors the 3002 CloudCLI patch (`src-patches/codex/codex-routes.provider.js`).
 * `config` is serialized by the Codex SDK into `--config` flags; `env` sets the
 * provider key the binary's auth layer reads; `model` carries the upstream model
 * name when it differs from the DB model id.
 */
export function buildCodexOptions(
  model: string | undefined | null,
): CodexRouteOptions | null {
  if (!model) {
    return null;
  }
  const routes = loadRoutes(CODEX_ROUTES_PATH);
  const route = findRoute(routes, model);
  if (!route) {
    return null;
  }
  const providerName = route.provider || route.modelProvider || 'openai';
  if (providerName === 'openai') {
    const targetModel = route.model || model;
    return {
      config: { model_provider: 'openai' },
      ...(targetModel !== model ? { model: targetModel } : {}),
    };
  }
  const provider = routes?.providers?.[providerName] || {};
  const config: Record<string, unknown> = {
    model_provider: providerName,
  };
  const block: Record<string, unknown> = {
    name: providerName,
    wire_api: provider.wireApi || route.wireApi || 'responses',
  };
  if (provider.baseUrl) {
    block.base_url = provider.baseUrl;
  }
  if (provider.apiKey) {
    block.env_key = 'CODEX_API_KEY';
  }
  config.model_providers = { [providerName]: block };
  const env: Record<string, string> = {};
  if (provider.apiKey) {
    env.CODEX_API_KEY = provider.apiKey;
  }
  const targetModel = route.model || model;
  return {
    config,
    ...(Object.keys(env).length > 0 ? { env } : {}),
    ...(targetModel !== model ? { model: targetModel } : {}),
  };
}