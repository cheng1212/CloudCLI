import fsSync, { promises as fs } from 'node:fs';
import path from 'node:path';

import mime from 'mime-types';

import { getGlobalImageAssetsDir, toPosixPath } from '@/shared/image-attachments.js';

/**
 * Image mime types accepted for chat attachment uploads. SVG is allowed for
 * storage/preview even though some providers (Claude API) skip it at send time.
 */
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]);

// Used only by this service and the assets routes via the barrel file.
type StoredImageAsset = {
  /** Original upload filename, for display. */
  name: string;
  /** Absolute posix-normalized path inside the global assets folder. */
  path: string;
  size: number;
  mimeType: string;
};

// Shape of one multer-stored file; kept local because only this module reads it.
type UploadedImageFile = {
  originalname: string;
  filename: string;
  /** Absolute path multer wrote the upload to (diskStorage). */
  path: string;
  size: number;
  mimetype: string;
};

type UploadedAttachmentFile = UploadedImageFile;

/** Returns whether one uploaded mime type may be stored as a chat image asset. */
export function isAllowedImageMimeType(mimeType: string): boolean {
  return ALLOWED_IMAGE_MIME_TYPES.has(mimeType);
}

/**
 * Content signatures for the raster members of ALLOWED_IMAGE_MIME_TYPES.
 * Multer's fileFilter only sees the client-declared mimetype, which is trivial
 * to spoof, so stored images are additionally verified against their real
 * header bytes (expressjs/multer#114). SVG is text and gets a prefix check.
 */
const IMAGE_SIGNATURE_CHECKS: Array<{
  mimeType: string;
  matches: (head: Buffer) => boolean;
}> = [
  {
    mimeType: 'image/png',
    matches: (head) => head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mimeType: 'image/jpeg',
    matches: (head) => head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff,
  },
  {
    mimeType: 'image/gif',
    matches: (head) => head.subarray(0, 3).toString('latin1') === 'GIF',
  },
  {
    mimeType: 'image/webp',
    matches: (head) => head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP',
  },
];

/**
 * Verifies that every stored image upload's actual content matches its
 * declared mime type. Returns null when all files are genuine, otherwise an
 * error message naming the first mismatched file (the caller rejects the
 * request and cleans up the already-stored copies).
 */
export async function verifyStoredImageAssets(files: UploadedImageFile[]): Promise<string | null> {
  for (const file of files) {
    const head = Buffer.alloc(64);
    const handle = await fs.open(file.path, 'r');
    try {
      const { bytesRead } = await handle.read(head, 0, head.length, 0);
      head.fill(0, bytesRead);
    } finally {
      await handle.close();
    }

    if (file.mimetype === 'image/svg+xml') {
      if (!head.toString('utf8').trimStart().startsWith('<')) {
        return `File content is not valid SVG: ${file.originalname}`;
      }
      continue;
    }

    const check = IMAGE_SIGNATURE_CHECKS.find((entry) => entry.mimeType === file.mimetype);
    if (!check || !check.matches(head)) {
      return `File content does not match its declared image type: ${file.originalname}`;
    }
  }
  return null;
}

/** Removes stored upload copies after a rejected verification (best effort). */
export async function removeStoredImageAssets(files: UploadedImageFile[]): Promise<void> {
  await Promise.allSettled(files.map((file) => fs.unlink(file.path)));
}

/** Creates the global `~/.cloudcli/assets` folder if needed and returns it. */
export async function ensureImageAssetsDir(): Promise<string> {
  const assetsDir = getGlobalImageAssetsDir();
  await fs.mkdir(assetsDir, { recursive: true });
  return assetsDir;
}

/**
 * Maps multer-stored upload files to the attachment records returned to the
 * chat composer. The absolute path is what providers receive and what session
 * history carries back to the UI.
 */
export function buildStoredImageRecords(files: UploadedImageFile[]): StoredImageAsset[] {
  const assetsDir = getGlobalImageAssetsDir();
  return files.map((file) => ({
    name: file.originalname,
    path: toPosixPath(path.join(assetsDir, file.filename)),
    size: file.size,
    mimeType: file.mimetype,
  }));
}

/**
 * Maps multer-stored files to provider-neutral attachment records for the
 * assets route. The shared storage format intentionally matches image records
 * so one uploaded file can move through queueing and provider dispatch.
 */
export function buildStoredAttachmentRecords(files: UploadedAttachmentFile[]): StoredImageAsset[] {
  return buildStoredImageRecords(files);
}

/**
 * Resolves one asset filename to its absolute path inside the global assets
 * folder, or null when the name is empty, contains path separators/traversal,
 * or would escape the folder. This is the only lookup the serving route uses,
 * so nothing outside `~/.cloudcli/assets` can ever be read through it.
 */
export function resolveImageAssetFile(filename: string): string | null {
  const trimmed = typeof filename === 'string' ? filename.trim() : '';
  if (!trimmed || trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) {
    return null;
  }

  const assetsDir = path.resolve(getGlobalImageAssetsDir());
  const resolved = path.resolve(assetsDir, trimmed);
  if (!resolved.startsWith(assetsDir + path.sep)) {
    return null;
  }

  return resolved;
}

/**
 * Resolves a general chat attachment for the assets serving route. It shares
 * the image resolver's strict direct-child containment boundary.
 */
export function resolveAttachmentAssetFile(filename: string): string | null {
  return resolveImageAssetFile(filename);
}

/**
 * Opens one stored chat asset for the assets route without exposing arbitrary
 * filesystem reads. The route translates the lookup status and streams the
 * returned direct-child file to the authenticated client.
 */
export async function openStoredAttachmentAsset(filename: string) {
  const resolved = resolveAttachmentAssetFile(filename);
  if (!resolved) {
    return { status: 'invalid' as const };
  }

  try {
    await fs.access(resolved);
  } catch {
    return { status: 'missing' as const };
  }

  return {
    status: 'found' as const,
    contentType: mime.lookup(resolved) || 'application/octet-stream',
    stream: fsSync.createReadStream(resolved),
  };
}
