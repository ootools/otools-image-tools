import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { buildPdf } from '../web/core.js';

const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
const bridge = await readFile(new URL('../web/bridge.js', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(new URL('../plugin.json', import.meta.url), 'utf8'));
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'HTML IDs must be unique');
for (const match of app.matchAll(/\$\('([^']+)'\)/g)) assert.ok(ids.includes(match[1]), `UI element exists: ${match[1]}`);
for (const id of ['tools', 'tray']) assert.match(html, new RegExp(`id="${id}"[^>]*hidden`), `${id} starts hidden`);
for (const id of ['backBtn','forwardBtn','topExportBtn','saveBtn','editBtn','trayToggle','infoBtn','zoomPercent','rotateLeft','rotateRight']) assert.ok(ids.includes(id));
assert.ok(manifest.inputTypes?.includes('image'), 'plugin declares image input type');
assert.ok(Array.isArray(manifest.fileAssociations) && manifest.fileAssociations.some((a) => a.ext === 'jpg'), 'plugin declares image file associations');
assert.equal(manifest.openInBrowser, false, 'image input requires non-browser plugin');
assert.match(app, /onPanelImage\(/, 'app subscribes to PANEL image input');
assert.match(bridge, /onOtoolsKeyword\(/, 'bridge listens to host keyword dispatch');
assert.match(bridge, /PANEL_IMAGE_KEYWORD\s*=\s*'panel-image'/, 'bridge handles panel-image keyword');
for (const source of ['app.js', 'core.js', 'engine.js', 'bridge.js']) {
  const contents = await readFile(new URL(`../web/${source}`, import.meta.url), 'utf8');
  assert.ok(contents.length > 50, `${source} exists`);
}
const jpeg = Uint8Array.of(0xff, 0xd8, 0x31, 0x32, 0xff, 0xd9);
const pdf = Buffer.from(buildPdf([{ width: 2, height: 1, jpeg }]));
const marker = Buffer.from('startxref\n'), start = pdf.lastIndexOf(marker);
const offset = Number(pdf.subarray(start + marker.length).toString('ascii').split('\n')[0]);
assert.equal(pdf.subarray(offset, offset + 4).toString('ascii'), 'xref');
const entries = pdf.subarray(offset).toString('ascii').split('\n'), count = Number(entries[1].split(' ')[1]);
for (let id = 1; id < count; id++) {
  const objectOffset = Number(entries[id + 2].slice(0, 10));
  assert.equal(pdf.subarray(objectOffset).toString('ascii', 0, `${id} 0 obj`.length), `${id} 0 obj`);
}
const provenance = JSON.parse(await readFile(new URL('../web/vendor/codecs.json', import.meta.url), 'utf8'));
for (const codec of provenance) for (const file of codec.files) {
  const data = await readFile(new URL(`../web/vendor/${file.file}`, import.meta.url));
  assert.equal(createHash('sha256').update(data).digest('hex'), file.sha256, `Original codec bytes preserved: ${file.file}`);
}
console.log('Viewer DOM contracts, hidden panels, module files, PDF references and offline codec SHA256 validated.');
