import os from 'node:os';
import path from 'node:path';

/**
 * Central data-root resolver for cloudcli-custom.
 *
 * Stock CloudCLI hardcodes everything under `~/.cloudcli` (auth.db, chat
 * assets, browser-use profiles, local-server marker). Running a second,
 * isolated instance of the app on a separate port would therefore share (and
 * fight over) those files with the real 3002 instance.
 *
 * This helper redirects ALL of them to a single overridable root:
 *
 *   CLOUDCLI_DATA_ROOT=/path/to/isolated/data
 *
 * When unset, it behaves exactly like stock CloudCLI (`~/.cloudcli`) so the
 * code stays drop-in compatible. The isolated instance sets the variable in
 * its own `.env`, keeping every byte of state separate from 3002.
 */
export function getCloudCliDataRoot(): string {
  return process.env.CLOUDCLI_DATA_ROOT || path.join(os.homedir(), '.cloudcli');
}

/** auth.db lives directly inside the data root. */
export function getAuthDbPath(): string {
  return path.join(getCloudCliDataRoot(), 'auth.db');
}

/** Global chat-attachment upload store. */
export function getGlobalImageAssetsDir(): string {
  return path.join(getCloudCliDataRoot(), 'assets');
}
