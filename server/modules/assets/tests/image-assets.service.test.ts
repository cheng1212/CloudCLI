import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildStoredAttachmentRecords,
  buildStoredImageRecords,
  isAllowedImageMimeType,
  removeStoredImageAssets,
  resolveAttachmentAssetFile,
  resolveImageAssetFile,
  verifyStoredImageAssets,
} from '@/modules/assets/services/image-assets.service.js';

const ASSETS_DIR = path.join(os.homedir(), '.cloudcli', 'assets');

test('isAllowedImageMimeType accepts image formats and rejects the rest', () => {
  assert.equal(isAllowedImageMimeType('image/png'), true);
  assert.equal(isAllowedImageMimeType('image/svg+xml'), true);
  assert.equal(isAllowedImageMimeType('application/pdf'), false);
  assert.equal(isAllowedImageMimeType('text/html'), false);
});

test('buildStoredImageRecords returns absolute posix paths in the assets dir', () => {
  const records = buildStoredImageRecords([
    { originalname: 'shot.png', filename: '123-456-shot.png', path: 'unused', size: 42, mimetype: 'image/png' },
  ]);

  assert.equal(records.length, 1);
  assert.equal(records[0].name, 'shot.png');
  assert.equal(records[0].size, 42);
  assert.equal(records[0].mimeType, 'image/png');
  assert.equal(records[0].path, `${ASSETS_DIR.replace(/\\/g, '/')}/123-456-shot.png`);
});

test('buildStoredAttachmentRecords preserves metadata for non-image files', () => {
  const records = buildStoredAttachmentRecords([
    {
      originalname: 'requirements.pdf',
      filename: '123-456-requirements.pdf',
      path: 'unused',
      size: 2048,
      mimetype: 'application/pdf',
    },
  ]);

  assert.deepEqual(records[0], {
    name: 'requirements.pdf',
    path: `${ASSETS_DIR.replace(/\\/g, '/')}/123-456-requirements.pdf`,
    size: 2048,
    mimeType: 'application/pdf',
  });
});

test('resolveImageAssetFile resolves plain filenames inside the assets dir', () => {
  const resolved = resolveImageAssetFile('123-shot.png');
  assert.equal(resolved, path.join(path.resolve(ASSETS_DIR), '123-shot.png'));
});

test('resolveImageAssetFile rejects traversal and separator attempts', () => {
  assert.equal(resolveImageAssetFile(''), null);
  assert.equal(resolveImageAssetFile('   '), null);
  assert.equal(resolveImageAssetFile('../auth.db'), null);
  assert.equal(resolveImageAssetFile('..'), null);
  assert.equal(resolveImageAssetFile('sub/dir.png'), null);
  assert.equal(resolveImageAssetFile('sub\\dir.png'), null);
  assert.equal(resolveImageAssetFile('a..b/../c.png'), null);
});

test('resolveAttachmentAssetFile uses the same direct-child boundary', () => {
  assert.equal(
    resolveAttachmentAssetFile('123-notes.txt'),
    path.join(path.resolve(ASSETS_DIR), '123-notes.txt'),
  );
  assert.equal(resolveAttachmentAssetFile('../notes.txt'), null);
});

test('verifyStoredImageAssets accepts genuine images and rejects spoofed ones', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-verify-'));
  try {
    const pngBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ]);
    const pngPath = path.join(dir, 'real.png');
    fs.writeFileSync(pngPath, pngBytes);

    const spoofedPath = path.join(dir, 'fake.png');
    fs.writeFileSync(spoofedPath, Buffer.from('MZ' + 'A'.repeat(64), 'latin1'));

    const svgPath = path.join(dir, 'ok.svg');
    fs.writeFileSync(svgPath, Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'));
    const badSvgPath = path.join(dir, 'bad.svg');
    fs.writeFileSync(badSvgPath, Buffer.from('MZ not svg at all'));

    const base = { filename: 'x', size: 10 };
    assert.equal(
      await verifyStoredImageAssets([
        { ...base, originalname: 'real.png', path: pngPath, mimetype: 'image/png' },
        { ...base, originalname: 'ok.svg', path: svgPath, mimetype: 'image/svg+xml' },
      ]),
      null,
    );

    const spoofError = await verifyStoredImageAssets([
      { ...base, originalname: 'fake.png', path: spoofedPath, mimetype: 'image/png' },
    ]);
    assert.match(spoofError ?? '', /does not match/);
    const badSvgError = await verifyStoredImageAssets([
      { ...base, originalname: 'bad.svg', path: badSvgPath, mimetype: 'image/svg+xml' },
    ]);
    assert.match(badSvgError ?? '', /not valid SVG/);

    const gone = path.join(dir, 'doomed.png');
    fs.writeFileSync(gone, pngBytes);
    await removeStoredImageAssets([{ ...base, originalname: 'doomed.png', path: gone, mimetype: 'image/png' }]);
    assert.equal(fs.existsSync(gone), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
