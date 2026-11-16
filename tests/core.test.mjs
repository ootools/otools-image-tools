import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPdf, cropToPixels, getResizedDimensions } from '../web/core.js';

test('PDF creates a valid xref table and embeds one JPG per page', () => {
  const pdf = buildPdf([
    { width: 3, height: 2, jpeg: Uint8Array.of(0xff, 0xd8, 1, 2, 0xff, 0xd9) },
    { width: 2, height: 3, jpeg: Uint8Array.of(0xff, 0xd8, 3, 4, 0xff, 0xd9) },
  ]);
  const text = Buffer.from(pdf).toString('latin1');
  assert.equal(text.slice(0, 8), '%PDF-1.4');
  assert.match(text, /\/Count 2/);
  assert.equal((text.match(/\/Subtype \/Image/g) || []).length, 2);
  const startXref = Number(text.match(/startxref\n(\d+)\n%%EOF/)[1]);
  assert.equal(text.slice(startXref, startXref + 4), 'xref');
  assert.ok(text.includes('/Filter /DCTDecode'));
});

test('PDF requires at least one valid JPEG', () => {
  assert.throws(() => buildPdf([]), /至少需要一张图片/);
  assert.throws(() => buildPdf([{ width: 1, height: 1, jpeg: Uint8Array.of(1, 2) }]), /不是有效的 JPG/);
});

test('resize keeps aspect ratio and honors max edge', () => {
  assert.deepEqual(getResizedDimensions(4000, 2000, 1600, 1), { width: 1600, height: 800 });
  assert.deepEqual(getResizedDimensions(1000, 500, 0, 0.5), { width: 500, height: 250 });
  assert.throws(() => getResizedDimensions(0, 1), /尺寸无效/);
});

test('crop selection clamps to source bounds and keeps at least one pixel', () => {
  assert.deepEqual(cropToPixels(100, 80, { x: 0.2, y: 0.1, w: 0.3, h: 0.4 }), { x: 20, y: 8, width: 30, height: 32 });
  assert.deepEqual(cropToPixels(5, 5, { x: 1, y: 1, w: 0, h: 0 }), { x: 4, y: 4, width: 1, height: 1 });
});

test('embedded JPEG stream is preserved byte-for-byte', () => {
  const jpeg = Uint8Array.of(0xff, 0xd8, 0x31, 0x32, 0xff, 0xd9);
  const pdf = buildPdf([{ width: 1, height: 1, jpeg }]);
  assert.ok(Buffer.from(pdf).includes(Buffer.from(jpeg)));
});
