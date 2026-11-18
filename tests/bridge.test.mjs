import test from 'node:test';
import assert from 'node:assert/strict';
import { baseName, dirName, extension, imagePayloadToMeta, isImage, joinPath, normalizeMeta, PANEL_IMAGE_KEYWORD, pathKey } from '../web/bridge.js';

test('Windows drive roots and native separators are preserved', () => {
  assert.equal(baseName('D:\\photos\\sample.png'), 'sample.png');
  assert.equal(dirName('D:\\sample.png'), 'D:\\');
  assert.equal(dirName('/sample.png'), '/');
  assert.equal(joinPath('D:\\photos', 'new.png'), 'D:\\photos\\new.png');
  assert.equal(joinPath('/photos/', 'new.png'), '/photos/new.png');
});
test('only supported image formats are listed, without directories', () => {
  assert.equal(isImage({ name: 'sample.HEIC', kind: 'file' }), true);
  assert.equal(isImage({ name: 'sample.tiff', kind: 'file' }), true);
  assert.equal(isImage({ name: 'sample.png', kind: 'directory' }), false);
  assert.equal(isImage({ name: 'sample.txt', kind: 'file' }), false);
  assert.equal(extension('sample.JPEG'), 'jpeg');
});
test('path comparison is Windows case-insensitive but preserves Unix case', () => {
  assert.equal(pathKey('D:\\Photos\\A.png'), pathKey('d:/photos/a.png'));
  assert.notEqual(pathKey('/photos/A.png'), pathKey('/photos/a.png'));
});
test('string metadata becomes normalized host image metadata', () => {
  assert.deepEqual(normalizeMeta('D:\\sample.tif'), { path: 'D:\\sample.tif', name: 'sample.tif', mime: 'image/tiff' });
});

test('panel-image keyword matches the host delivery contract', () => {
  assert.equal(PANEL_IMAGE_KEYWORD, 'panel-image');
});
test('panel image payload becomes a loadable File meta', async () => {
  const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  const base64 = Buffer.from(png).toString('base64');
  const meta = imagePayloadToMeta({ dataUrl: `data:image/png;base64,${base64}`, mimeType: 'image/png', name: 'paste.png' });
  assert.equal(meta.name, 'paste.png');
  assert.equal(meta.mime, 'image/png');
  assert.equal(meta.size, png.length);
  assert.equal(meta.file.name, 'paste.png');
  assert.equal(meta.file.type, 'image/png');
  assert.deepEqual(new Uint8Array(await meta.file.arrayBuffer()), png);
});
test('panel image payload falls back mime and name from dataUrl', () => {
  const base64 = Buffer.from([1, 2, 3]).toString('base64');
  const meta = imagePayloadToMeta({ dataUrl: `data:image/jpeg;base64,${base64}` });
  assert.equal(meta.mime, 'image/jpeg');
  assert.equal(meta.name, 'clipboard.jpeg');
  assert.equal(meta.size, 3);
});
test('panel image payload rejects data without a base64 comma', () => {
  assert.throws(() => imagePayloadToMeta({ dataUrl: 'not-a-data-url' }), /无效/);
});
