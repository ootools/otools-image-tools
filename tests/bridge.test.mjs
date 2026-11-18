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

test('host API prefers window.otools pickFiles and avoids raw directory:false invoke', async () => {
  const { pickImages, chooseSavePath, listDirectory, readBlob, writeBlob, pickFolder } = await import('../web/bridge.js');
  const previous = globalThis.window;
  const calls = [];
  let rawInvokeHits = 0;
  const api = {
    apiVersion: 3,
    pickFiles: async (options) => { calls.push(['pickFiles', options]); return ['D://p//a.png', 'D://p//b.jpg']; },
    pickDirectory: async (options) => { calls.push(['pickDirectory', options]); return 'D://p'; },
    listHostDir: async (path) => { calls.push(['listHostDir', path]); return ['D://p//a.png']; },
    readHostFile: async (path) => { calls.push(['readHostFile', path]); return { dataBase64: Buffer.from([1, 2]).toString('base64'), size: 2 }; },
    writeHostFile: async (req) => { calls.push(['writeHostFile', req]); },
    saveFile: async (options) => { calls.push(['saveFile', options]); return 'D://p//out.jpg'; },
  };
  globalThis.window = { otools: api, __TAURI_INTERNALS__: { invoke: async (cmd) => { rawInvokeHits++; calls.push(['invoke', cmd]); } } };
  try {
    const imgs = await pickImages();
    assert.deepEqual(imgs.map((i) => i.name), ['a.png', 'b.jpg']);
    assert.equal(calls[0][0], 'pickFiles');
    assert.equal('directory' in calls[0][1], false, 'no boolean directory leaks into options');

    await pickFolder();
    assert.equal(calls.at(-1)[0], 'pickDirectory');

    await listDirectory('D://p');
    assert.equal(calls.at(-1)[0], 'listHostDir');

    const blob = await readBlob({ path: 'D://p//a.png', name: 'a.png' });
    assert.equal(blob.size, 2);
    assert.equal(calls.at(-1)[0], 'readHostFile');

    const save = await chooseSavePath('x.jpg', 'jpg');
    assert.equal(save, 'D://p//out.jpg');
    assert.equal(calls.at(-1)[0], 'saveFile');

    await writeBlob('D://p//out.jpg', new Blob([new Uint8Array([9])]));
    assert.equal(calls.at(-1)[0], 'writeHostFile');

    assert.equal(rawInvokeHits, 0, 'all host calls went through otools.* APIs');
  } finally {
    globalThis.window = previous;
  }
});
