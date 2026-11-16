import test from 'node:test';
import assert from 'node:assert/strict';
import { adjustPixel, cropRectToPixels, defaultEdit, normalizeEdit, orientedSize, resizeDimensions, skinWeight } from '../web/engine.js';

test('default edit is a clean viewer-neutral copy', () => {
  assert.deepEqual(defaultEdit(), { rotation: 0, flipX: false, crop: null, brightness: 0, contrast: 0, saturation: 0, warmth: 0, whiten: 0, soften: 0, effect: 'none', scale: 100, maxEdge: 0 });
});

test('edit values are clamped to safe ranges', () => {
  const edit = normalizeEdit({ rotation: 45, brightness: 999, contrast: -999, whiten: 200, effect: 'unknown', scale: 0 });
  assert.equal(edit.rotation, 0);
  assert.equal(edit.brightness, 100);
  assert.equal(edit.contrast, -100);
  assert.equal(edit.whiten, 100);
  assert.equal(edit.effect, 'none');
  assert.equal(edit.scale, 100);
});

test('orientation swaps dimensions at quarter turns', () => {
  assert.deepEqual(orientedSize({ width: 400, height: 300 }, { rotation: 0 }), { width: 400, height: 300 });
  assert.deepEqual(orientedSize({ width: 400, height: 300 }, { rotation: 90 }), { width: 300, height: 400 });
  assert.deepEqual(orientedSize({ width: 400, height: 300 }, { rotation: 270 }), { width: 300, height: 400 });
});

test('crop rectangle clamps to the image and retains one pixel', () => {
  assert.deepEqual(cropRectToPixels(100, 80, { x: 0.2, y: 0.1, w: 0.3, h: 0.4 }), { x: 20, y: 8, width: 30, height: 32 });
  assert.deepEqual(cropRectToPixels(5, 5, { x: 1, y: 1, w: 0, h: 0 }), { x: 4, y: 4, width: 1, height: 1 });
});

test('resize never enlarges a low-resolution preview', () => {
  assert.deepEqual(resizeDimensions(4000, 2000, { scale: 100, maxEdge: 0 }, 1500), { width: 1500, height: 750 });
  assert.deepEqual(resizeDimensions(1000, 500, { scale: 50, maxEdge: 0 }, 1500), { width: 500, height: 250 });
  assert.deepEqual(resizeDimensions(4000, 2000, { scale: 100, maxEdge: 1200 }, 0), { width: 1200, height: 600 });
});

test('skin-aware whitening does not brighten neutral gray', () => {
  const gray = adjustPixel(120, 120, 120, 255, { whiten: 100 });
  const skin = adjustPixel(190, 135, 105, 255, { whiten: 100 });
  assert.deepEqual(gray, { r: 120, g: 120, b: 120, a: 255 });
  assert.ok(skin.r > 190 && skin.g > 135 && skin.b > 105);
  assert.equal(skinWeight(120, 120, 120), 0);
  assert.ok(skinWeight(190, 135, 105) > 0);
});

test('effects remain bounded and mono removes chroma', () => {
  const mono = adjustPixel(220, 80, 40, 255, { effect: 'mono' });
  assert.equal(mono.r, mono.g);
  assert.equal(mono.g, mono.b);
  const retro = adjustPixel(255, 255, 255, 255, { effect: 'retro', brightness: 100 });
  assert.ok(retro.r <= 255 && retro.g <= 255 && retro.b <= 255);
});
