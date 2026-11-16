import test from 'node:test';
import assert from 'node:assert/strict';
import { baseName, dirName, extension, isImage, joinPath, normalizeMeta, pathKey } from '../web/bridge.js';

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
