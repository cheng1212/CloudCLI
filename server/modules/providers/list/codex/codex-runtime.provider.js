/**
 * OpenAI Codex SDK Integration
 * =============================
 *
 * This module provides integration with the OpenAI Codex SDK for non-interactive
 * chat sessions. It mirrors the Claude runtime adapter for consistency.
 *
 * ## Usage
 *
 * - codexRuntime.run(command, options, writer, context) - Execute a streamed prompt
 * - abortCodexSession(sessionId) - Cancel an active session
 * - isCodexSessionActive(sessionId) - Check if a session is running
 * - getActiveCodexSessions() - List all active sessions
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Codex } from '@openai/codex-sdk';

import {
  appendFilesInputTag,
  buildCodexInputItems,
  normalizeImageDescriptors
} from '@/shared/image-attachments.js';
import { notifyRunFailed, notifyRunStopped } from '@/modules/notifications/index.js';
import { buildCodexOptions } from '@/shared/model-routes.js';
import { createCompleteMessage, createNormalizedMessage } from '@/shared/utils.js';

const activeCodexSessions = new Map();

function readUsageNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractCodexTokenBudget(event) {
  const info = event?.info || event?.payload?.info || event?.usage?.info;
  const usage = info?.total_token_usage || event?.usage?.total_token_usage || event?.usage;
  if (!usage || typeof usage !== 'object') {
    return null;
  }

  const inputTokens = readUsageNumber(usage.input_tokens);
  const outputTokens = readUsageNumber(usage.output_tokens);
  const used = readUsageNumber(usage.total_tokens) || inputTokens + outputTokens;

  return {
    used,
    total: readUsageNumber(info?.model_context_window || event?.usage?.model_context_window) || 200000,
    inputTokens,
    outputTokens,
    breakdown: {
      input: inputTokens,
      output: outputTokens,
    },
  };
}

/**
 * Transform Codex SDK event to WebSocket message format
 * @param {object} event - SDK event
 * @returns {object} - Transformed event for WebSocket
 */
function transformCodexEvent(event) {
  // Map SDK event types to a consistent format
  switch (event.type) {
    case 'item.started':
    case 'item.updated':
    case 'item.completed':
      const item = event.item;
      if (!item) {
        return { type: event.type, item: null };
      }

      // Transform based on item type
      switch (item.type) {
        case 'agent_message':
          return {
            type: 'item',
            itemType: 'agent_message',
            message: {
              role: 'assistant',
              content: item.text
            }
          };

        case 'reasoning':
          return {
            type: 'item',
            itemType: 'reasoning',
            message: {
              role: 'assistant',
              content: item.text,
              isReasoning: true
            }
          };

        case 'command_execution':
          return {
            type: 'item',
            itemType: 'command_execution',
            command: item.command,
            output: item.aggregated_output,
            exitCode: item.exit_code,
            status: item.status
          };

        case 'file_change':
          return {
            type: 'item',
            itemType: 'file_change',
            changes: item.changes,
            status: item.status
          };

        case 'mcp_tool_call':
          return {
            type: 'item',
            itemType: 'mcp_tool_call',
            server: item.server,
            tool: item.tool,
            arguments: item.arguments,
            result: item.result,
            error: item.error,
            status: item.status
          };

        case 'web_search':
          return {
            type: 'item',
            itemType: 'web_search',
            query: item.query
          };

        case 'todo_list':
          return {
            type: 'item',
            itemType: 'todo_list',
            items: item.items
          };

        case 'error':
          return {
            type: 'item',
            itemType: 'error',
            message: {
              role: 'error',
              content: item.message
            }
          };

        default:
          return {
            type: 'item',
            itemType: item.type,
            item: item
          };
      }

    case 'turn.started':
      return {
        type: 'turn_started'
      };

    case 'turn.completed':
      return {
        type: 'turn_complete',
        usage: event.usage
      };

    case 'turn.failed':
      return {
        type: 'turn_failed',
        error: event.error
      };

    case 'thread.started':
      return {
        type: 'thread_started',
        threadId: event.thread_id || event.id
      };

    case 'error':
      return {
        type: 'error',
        message: event.message
      };

    default:
      return {
        type: event.type,
        data: event
      };
  }
}

/**
 * Map permission mode to Codex SDK options
 * @param {string} permissionMode - 'default', 'acceptEdits', or 'bypassPermissions'
 * @returns {object} - { sandboxMode, approvalPolicy }
 */
function mapPermissionModeToCodexOptions(permissionMode) {
  switch (permissionMode) {
    case 'acceptEdits':
      return {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'never'
      };
    case 'bypassPermissions':
      return {
        sandboxMode: 'danger-full-access',
        approvalPolicy: 'never'
      };
    case 'default':
    default:
      return {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'untrusted'
      };
  }
}

/**
 * Windows DLL-search hardening for spawned codex processes.
 *
 * The loader only honors the correctly-cased `NoDefaultCurrentDirectoryInExePath`.
 * Environments inherited from older Claude/bash sessions can carry only the
 * all-caps NODEFAULTCURRENTDIRECTORYINEXEPATH, which the loader ignores - so
 * codex.exe's DLL search includes the current directory and can surface stray
 * DLLs, failing with STATUS_DLL_INIT_FAILED (exit code 3221225794 / 0xC0000142).
 * Force the correctly-cased variable and drop the ambiguous all-caps variant
 * so the current directory is always excluded from codex's DLL search.
 */
function hardenCodexSpawnEnv() {
  delete process.env.NODEFAULTCURRENTDIRECTORYINEXEPATH;
  process.env.NoDefaultCurrentDirectoryInExePath = '1';
  // Mirror real CloudCLI: forward the Windows system proxy (registry) so codex
  // can reach wss/HTTPS endpoints. Codex reads HTTPS_PROXY etc. from env; without
  // it WebSocket connects stall before falling back to HTTPS. Existing env
  // proxies (e.g. from a bash/Claude session) take precedence.
  if (!process.env.HTTPS_PROXY && !process.env.HTTP_PROXY && !process.env.ALL_PROXY) {
    let proxy = null;
    try {
      const out = execFileSync('reg', [
        'query',
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
        '/v',
        'ProxyServer',
      ], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
      const match = out.match(/ProxyServer\s+REG_SZ\s+(\S+)/);
      if (match?.[1]) proxy = match[1];
    } catch { /* no registry access or key missing */ }
    if (proxy) {
      const value = /^https?:\/\//.test(proxy) ? proxy : `http://${proxy}`;
      process.env.HTTPS_PROXY = value;
      process.env.HTTP_PROXY = value;
      process.env.ALL_PROXY = value;
      process.env.NO_PROXY = '127.0.0.1,localhost,::1';
    }
  }
}

/**
 * Codex thread writer-lock reconciliation.
 *
 * Codex persists conversations as threads under ~/.codex/sessions and guards
 * each with a marker file in ~/.codex/thread-writer-locks/<threadId>.lock. A
 * marker file means "some writer owns this thread right now" — so the desktop
 * Codex app-server (which owns its own ~/.codex) can hold these locks even for
 * threads the user last touched on the desktop, and another Codex instance
 * (e.g. this Cloud CLI) that tries to `resume` the same thread will fail with
 * `thread storage conflict` / "-32600".
 *
 * The marker file is a plain existence-flag: it carries no owner pid, so we
 * must distinguish a live lock from a stale one. On Windows a live lock is a
 * file some process holds open (a writer that will reject concurrent writes).
 * Node's fs.open cannot detect that — it opens with a share mode that lets the
 * exclusive lock succeed anyway — so we probe with PowerShell using the
 * .NET `FileShare.None` exclusive-open, which throws when another handle is
 * open on the file. That is the only reliable signal on Windows.
 *
 * Safety: probing powershell is skipped/fails open to 'held' (worker refuses to
 * steal a thread it cannot prove is abandoned). We only ever delete a lock we
 * PROVED has no live holder, never one we merely failed to probe.
 *
 * `reconcileCodexThreadLock(threadId)` returns one of:
 *   - 'ok'     : no lock file -> resume is safe
 *   - 'stale'  : abandoned lock removed -> resume is now safe
 *   - 'held'   : a live writer owns the thread -> do not resume, surface a hint
 *   - 'unknown': probe failed; treat as held (never steal)
 */
function threadLockExists(threadId) {
  const lockPath = path.join(os.homedir(), '.codex', 'thread-writer-locks', `${threadId}.lock`);
  return { exists: fs.existsSync(lockPath), lockPath };
}

/**
 * Returns true when a live process holds `lockPath` open (exclusive probe).
 * Returns null when the probe itself failed (powershell unavailable/timeout) —
 * callers must then treat the lock as live.
 */
function isLockHeldByLiveProcess(lockPath) {
  const script =
    `try { $f=[System.IO.File]::Open('${lockPath.replace(/'/g, "''")}',` +
    `'Open','ReadWrite','None'); $f.Close(); $f.Dispose(); 'FREE' } catch { 'HELD' }`;
  let out;
  try {
    const result = spawnSync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', timeout: 8000, windowsHide: true },
    );
    out = (result.stdout || '').trim();
  } catch {
    return null;
  }
  if (out === 'FREE') return false;
  if (out === 'HELD') return true;
  return null;
}

function reconcileCodexThreadLock(threadId) {
  if (!threadId) {
    return 'ok';
  }
  const { exists, lockPath } = threadLockExists(threadId);

  // Fast path: no marker file -> no writer contention.
  if (!exists) {
    return 'ok';
  }

  // Probe whether a live process holds the file open. Node fs.open cannot do
  // this reliably on Windows (it shares the handle), so delegate to PowerShell.
  const held = isLockHeldByLiveProcess(lockPath);
  if (held !== false) {
    // held === true (definitely live) or null (probe failed -> unknown). In
    // both cases we must NOT steal the thread: deleting a live lock would let
    // two writers corrupt the same thread, and deleting an unprobed one is
    // gambling on ownership. Surface guidance instead.
    return held === null ? 'unknown' : 'held';
  }

  // Probe says FREE: no live holder, so the marker is an abandoned leftover.
  // Remove it to let another instance resume the thread cleanly.
  try {
    fs.unlinkSync(lockPath);
    return 'stale';
  } catch {
    // Race: a writer grabbed the file between our probe and unlink. Treat as
    // held so the caller surfaces guidance rather than a confusing raw error.
    return 'held';
  }
}

export async function queryCodex(command, options = {}, ws, context) {
  hardenCodexSpawnEnv();
  const {
    sessionId,
    sessionSummary,
    cwd,
    projectPath,
    model,
    effort,
    images,
    files,
    permissionMode = 'default'
  } = options;

  // Callers pass the stable app session id; the SDK resumes threads with the
  // provider-native id recorded on the session row.
  const providerSessionId = context.resolveProviderSessionId(sessionId);

  const resolvedModel = await context.resolveResumeModel(sessionId, model);

  const workingDirectory = cwd || projectPath || process.cwd();
  const { sandboxMode, approvalPolicy } = mapPermissionModeToCodexOptions(permissionMode);
  const catalog = await context.getProviderModels();
  const selectedModel = catalog.OPTIONS.find((option) => option.value === resolvedModel) || null;
  const allowedEfforts = selectedModel?.effort?.values?.map((value) => value.value) || [];
  const resolvedEffort = typeof effort === 'string' && effort !== 'default' && allowedEfforts.includes(effort)
    ? effort
    : undefined;

  // Unified routing: pin model_provider / base_url / model for the Codex CLI so
  // the global ~/.codex/config.toml (e.g. model_provider="nvidia") can never
  // capture a session meant for another provider, and custom ids like
  // `opencode-go/grok-4.5` reach their upstream under the right model name.
  // Every model — predefined GPT or custom — gets an explicit provider: the
  // routes file's defaultRoute sends first-party GPT models back to the OpenAI
  // official channel regardless of the global config.toml.
  const routeModel = resolvedModel || model;
  const codexOptions = buildCodexOptions(routeModel);
  const routedModel = codexOptions?.model || resolvedModel;

  // Surface the model that will actually serve this run. The route is the
  // endpoint truth: custom ids like `opencode-go/gpt-5.6-luna` are rewritten by
  // the route to their upstream name (e.g. `gpt-5.6-luna`), so the client can
  // show where the request really lands instead of the DB model id.
  const routedProvider = codexOptions?.config?.model_provider || null;
  const routedBaseUrl = (codexOptions?.config?.model_providers
    && routedProvider
    && codexOptions.config.model_providers[routedProvider]?.base_url) || null;
  sendMessage(ws, createNormalizedMessage({
    kind: 'status',
    text: 'model_routed',
    model: routedModel || routeModel || '',
    endpoint: routedBaseUrl,
    sessionId: sessionId || null,
    provider: 'codex',
  }));

  // The SDK's env option REPLACES process.env, so every env-based override this
  // module set up (hardenCodexSpawnEnv's DLL-search guards, the system proxy,
  // the user's PATH) must be merged in explicitly — otherwise the spawned
  // binary loses them. The route-provided CODEX_API_KEY wins.
  if (codexOptions?.env) {
    codexOptions.env = { ...process.env, ...codexOptions.env };
  }

  let codex;
  let thread;
  // Provider-native thread id (starts as the resume id, or is captured from
  // the stream for brand-new sessions).
  let capturedSessionId = providerSessionId;
  let sessionCreatedSent = false;
  let terminalFailure = null;
  const abortController = new AbortController();
  // Session-map key: the app session id when the caller supplied one, else
  // the provider-native thread id once captured (legacy/direct API callers).
  const sessionKey = () => sessionId || capturedSessionId || null;

  try {
    // The SDK's env option replaces process.env (rather than overlaying it), so
    // the proxy forwarded by hardenCodexSpawnEnv must be merged explicitly into
    // the route-provided env, if any.
    codex = new Codex(codexOptions || {});

    const threadOptions = {
      workingDirectory,
      skipGitRepoCheck: true,
      sandboxMode,
      approvalPolicy,
      model: routedModel,
      modelReasoningEffort: resolvedEffort,
    };

    if (providerSessionId) {
      // Before resuming a provider-native thread, reconcile its writer lock so a
      // leftover marker from an exited writer is cleared (seamless re-entry) and
      // a genuinely live contender surfaces as actionable guidance instead of a
      // raw "-32600 thread storage conflict".
      const lockState = reconcileCodexThreadLock(providerSessionId);
      if (lockState === 'held' || lockState === 'unknown') {
        const heldText = lockState === 'held'
          ? `Codex 线程「${providerSessionId}」正被电脑端的 Codex 占用。`
          : `无法确认 Codex 线程「${providerSessionId}」的锁归属，为安全起见暂不接管。`;
        terminalFailure = new Error(
          `${heldText}请先在电脑端关闭/结束该会话（Desktop Codex app-server 仍在运行），再回到 Cloud CLI 重试。`
        );
        sendMessage(ws, createNormalizedMessage({
          kind: 'error',
          content: terminalFailure.message,
          sessionId: capturedSessionId || sessionId || null,
          provider: 'codex',
        }));
        sendMessage(ws, createCompleteMessage({
          provider: 'codex',
          sessionId: capturedSessionId || sessionId || null,
          exitCode: 1,
        }));
        notifyRunFailed({
          userId: ws?.userId || null,
          provider: 'codex',
          sessionId: sessionId || capturedSessionId || null,
          sessionName: sessionSummary,
          error: terminalFailure,
        });
        return;
      }
      thread = codex.resumeThread(providerSessionId, threadOptions);
    } else {
      thread = codex.startThread(threadOptions);
    }

    const registerSession = (id) => {
      if (!id) {
        return;
      }
      activeCodexSessions.set(id, {
        thread,
        codex,
        status: 'running',
        abortController,
        startedAt: new Date().toISOString()
      });
    };

    if (sessionKey()) {
      registerSession(sessionKey());
    }

    // Execute with streaming. Turns with image attachments send structured
    // input items so Codex reads the images from their local asset paths.
    const promptWithFiles = appendFilesInputTag(command, files);
    const turnInput = normalizeImageDescriptors(images).length > 0
      ? buildCodexInputItems(promptWithFiles, images, workingDirectory)
      : promptWithFiles;
    const streamedTurn = await thread.runStreamed(turnInput, {
      signal: abortController.signal
    });

    for await (const event of streamedTurn.events) {
      // Capture thread/session id lazily from the stream (Codex emits this asynchronously).
      if (event.type === 'thread.started') {
        const discoveredSessionId = event.thread_id || event.id || null;
        if (discoveredSessionId && !capturedSessionId) {
          capturedSessionId = discoveredSessionId;
          registerSession(sessionKey());

          if (ws.setSessionId && typeof ws.setSessionId === 'function') {
            ws.setSessionId(capturedSessionId);
          }

          if (!providerSessionId && !sessionCreatedSent) {
            sessionCreatedSent = true;
            sendMessage(ws, createNormalizedMessage({ kind: 'session_created', newSessionId: capturedSessionId, sessionId: capturedSessionId, provider: 'codex' }));
          }
        }
      }

      // Check if session was aborted
      if (abortController.signal.aborted) {
        break;
      }
      if (sessionKey()) {
        const session = activeCodexSessions.get(sessionKey());
        if (session?.status === 'aborted') {
          break;
        }
      }

      if (event.type === 'item.started' || event.type === 'item.updated') {
        continue;
      }

      const transformed = transformCodexEvent(event);

      // Normalize the transformed event into NormalizedMessage(s) via adapter
      const normalizedMsgs = context.normalizeMessage(transformed, capturedSessionId || sessionId || null);
      for (const msg of normalizedMsgs) {
        sendMessage(ws, msg);
      }

      if (event.type === 'turn.failed' && !terminalFailure) {
        terminalFailure = event.error || new Error('Turn failed');
        // Notifications are app-facing, so they carry the app session id.
        notifyRunFailed({
          userId: ws?.userId || null,
          provider: 'codex',
          sessionId: sessionId || capturedSessionId || null,
          sessionName: sessionSummary,
          error: terminalFailure
        });
      }

      // Extract and send token usage if available (normalized to match Claude format)
      if (event.type === 'turn.completed') {
        const tokenBudget = extractCodexTokenBudget(event);
        if (tokenBudget) {
          sendMessage(ws, createNormalizedMessage({ kind: 'status', text: 'token_budget', tokenBudget, sessionId: capturedSessionId || sessionId || null, provider: 'codex' }));
        }
      }
    }

    // Send the terminal completion event — skipped for aborted runs, whose
    // terminal `complete` (aborted: true) was already sent by abort-session.
    const runSession = sessionKey() ? activeCodexSessions.get(sessionKey()) : null;
    const runAborted = runSession?.status === 'aborted' || abortController.signal.aborted;
    if (!runAborted) {
      sendMessage(ws, createCompleteMessage({
        provider: 'codex',
        sessionId: capturedSessionId || sessionId || null,
        actualSessionId: capturedSessionId || thread.id || sessionId || null,
        exitCode: terminalFailure ? 1 : 0,
      }));
      if (!terminalFailure) {
        notifyRunStopped({
          userId: ws?.userId || null,
          provider: 'codex',
          sessionId: sessionId || capturedSessionId || null,
          sessionName: sessionSummary,
          stopReason: 'completed'
        });
      }
    }

  } catch (error) {
    const session = sessionKey() ? activeCodexSessions.get(sessionKey()) : null;
    const wasAborted =
      session?.status === 'aborted' ||
      error?.name === 'AbortError' ||
      String(error?.message || '').toLowerCase().includes('aborted');

    if (!wasAborted) {
      console.error('[Codex] Error:', error);

      // Check if Codex SDK is available for a clearer error message
      const installed = await context.isProviderInstalled();
      const errorContent = !installed
        ? 'Codex CLI is not configured. Please set up authentication first.'
        : error.message;

      sendMessage(ws, createNormalizedMessage({ kind: 'error', content: errorContent, sessionId: capturedSessionId || sessionId || null, provider: 'codex' }));
      sendMessage(ws, createCompleteMessage({
        provider: 'codex',
        sessionId: capturedSessionId || sessionId || null,
        exitCode: 1,
      }));
      if (!terminalFailure) {
        notifyRunFailed({
          userId: ws?.userId || null,
          provider: 'codex',
          sessionId: sessionId || capturedSessionId || null,
          sessionName: sessionSummary,
          error
        });
      }
    }

  } finally {
    // Update session status
    if (sessionKey()) {
      const session = activeCodexSessions.get(sessionKey());
      if (session) {
        session.status = session.status === 'aborted' ? 'aborted' : 'completed';
      }
    }
  }
}

/**
 * Abort an active Codex session
 * @param {string} sessionId - Session ID to abort
 * @returns {boolean} - Whether abort was successful
 */
export function abortCodexSession(sessionId) {
  const session = activeCodexSessions.get(sessionId);

  if (!session) {
    return false;
  }

  session.status = 'aborted';
  try {
    session.abortController?.abort();
  } catch (error) {
    console.warn(`[Codex] Failed to abort session ${sessionId}:`, error);
  }

  return true;
}

/**
 * Check if a session is active
 * @param {string} sessionId - Session ID to check
 * @returns {boolean} - Whether session is active
 */
export function isCodexSessionActive(sessionId) {
  const session = activeCodexSessions.get(sessionId);
  return session?.status === 'running';
}

/**
 * Get all active sessions
 * @returns {Array} - Array of active session info
 */
export function getActiveCodexSessions() {
  const sessions = [];

  for (const [id, session] of activeCodexSessions.entries()) {
    if (session.status === 'running') {
      sessions.push({
        id,
        status: session.status,
        startedAt: session.startedAt
      });
    }
  }

  return sessions;
}

export const codexRuntime = {
  run: queryCodex,
  abort: abortCodexSession,
};

/**
 * Helper to send message via WebSocket or writer
 * @param {WebSocket|object} ws - WebSocket or response writer
 * @param {object} data - Data to send
 */
function sendMessage(ws, data) {
  try {
    if (ws.isSSEStreamWriter || ws.isWebSocketWriter) {
      // Writer handles stringification (SSEStreamWriter or WebSocketWriter)
      ws.send(data);
    } else if (typeof ws.send === 'function') {
      // Raw WebSocket - stringify here
      ws.send(JSON.stringify(data));
    }
  } catch (error) {
    console.error('[Codex] Error sending message:', error);
  }
}

// Clean up old completed sessions periodically
const completedSessionCleanupTimer = setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 minutes

  for (const [id, session] of activeCodexSessions.entries()) {
    if (session.status !== 'running') {
      const startedAt = new Date(session.startedAt).getTime();
      if (now - startedAt > maxAge) {
        activeCodexSessions.delete(id);
      }
    }
  }
}, 5 * 60 * 1000); // Every 5 minutes

// Runtime cleanup should not keep focused tests or one-off scripts alive after
// their provider work has completed.
completedSessionCleanupTimer.unref?.();
