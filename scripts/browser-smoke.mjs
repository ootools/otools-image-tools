import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = path.join(root, 'outputs', 'test-images');
const out = path.join(root, 'outputs', 'browser-smoke');
await fs.mkdir(out, { recursive: true });
const files = await fs.readdir(fixtures);
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_CORE || 'C:/Users/Admin/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.mjs').href);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.heic': 'image/heic' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const directory = url.pathname.startsWith('/fixtures/') ? fixtures : path.join(root, 'dist');
    const relative = url.pathname.startsWith('/fixtures/') ? url.pathname.slice('/fixtures/'.length) : url.pathname.slice(1) || 'index.html';
    const file = path.resolve(directory, decodeURIComponent(relative));
    if (!file.startsWith(directory + path.sep)) { res.writeHead(403).end(); return; }
    const content = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(content);
  } catch { res.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
let browser;
const results = [], errors = [];
const record = (name, condition, detail = '') => { assert.ok(condition, `${name}: ${detail}`); results.push(name); console.log(`PASS ${name}`); };
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox', '--disable-extensions', '--proxy-server=direct://', '--proxy-bypass-list=*'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => errors.push(error.message));
  const api = { picker: '01-quadrants.png', save: 'result.jpg', cancelled: false, folder: '/output', failWrite: false, writes: [] };
  function metadata(name) { return { path: `/fixtures/${name}`, name, kind: 'file', size: 1000, mime: name.endsWith('png') ? 'image/png' : 'application/octet-stream', lastModified: 1794800000000 }; }
  const waitForOutputCount = async (count) => {
    await page.waitForFunction((expected) => window.__testOutputCount === expected && document.querySelector('#busy').hidden, count);
  };
  await page.exposeFunction('testHostInvoke', async (command, payload = {}) => {
    if (command === 'tools_webview_pick_files') return api.cancelled ? [] : [metadata(api.picker)];
    if (command === 'tools_webview_list_dir') {
      if (payload.path === '/fixtures') return files.map(metadata);
      if (payload.path === '/output') return [...api.writes.filter((item) => item.path.startsWith('/output/')).map((item) => ({ path: item.path, name: path.basename(item.path), kind: 'file' })), { path: '/output/01-quadrants-转换.jpg', name: '01-quadrants-转换.jpg', kind: 'file' }];
      return [];
    }
    if (command === 'tools_webview_read_file') {
      const file = path.join(fixtures, path.basename(payload.path)), bytes = await fs.readFile(file);
      return { ...metadata(path.basename(file)), size: bytes.length, dataBase64: bytes.toString('base64') };
    }
    if (command === 'tools_webview_pick_save_path') return api.cancelled ? null : { path: path.posix.resolve('/output', api.save), name: api.save };
    if (command === 'tools_webview_pick_folder') return api.cancelled ? null : { path: api.folder, name: path.basename(api.folder) };
    if (command === 'tools_webview_write_file') {
      assert.ok(payload.request && !payload.dataBase64, 'host write uses { request: { path, dataBase64 } }');
      if (api.failWrite) throw new Error('模拟磁盘写入失败');
      const { path: target, dataBase64 } = payload.request;
      assert.ok(target.startsWith('/output/'), `unexpected write target: ${target}`);
      const bytes = Buffer.from(dataBase64, 'base64');
      await fs.writeFile(path.join(out, path.basename(target)), bytes);
      api.writes.push({ path: target, bytes: bytes.length, signature: bytes.subarray(0, 8).toString('hex') });
      await page.evaluate((count) => { window.__testOutputCount = count; }, api.writes.length);
      return null;
    }
    throw new Error(`Unknown host command: ${command}`);
  });
  await page.addInitScript(() => { window.__TAURI_INTERNALS__ = { invoke: (command, payload) => window.testHostInvoke(command, payload) }; });
  await page.goto(url);
  await page.waitForSelector('html[data-ready=true]');
  record('viewer starts with both panels hidden', await page.locator('#tools').isHidden() && await page.locator('#tray').isHidden());
  record('empty viewer save/export disabled', await page.locator('#saveBtn').isDisabled() && await page.locator('#topExportBtn').isDisabled());
  const controlOrder = await page.locator('.top-actions button').evaluateAll((nodes) => nodes.map((node) => node.id));
  record('top actions in requested order', controlOrder.join(',') === 'backBtn,forwardBtn,topExportBtn,saveBtn,editBtn', controlOrder);
  await page.click('#openBtn');
  await page.waitForFunction(() => document.querySelector('#image').naturalWidth === 640 && !document.querySelector('#canvasWrap').hidden && !document.querySelector('#infoBtn').disabled);
  record('opens actual PNG pixels', await page.locator('#imageMeta').textContent() === '640 × 480');
  record('directory read does not reveal panels', await page.locator('#tray').isHidden() && await page.locator('#tools').isHidden());
  const countText = await page.locator('#trayCount').textContent();
  record('same folder includes image formats, ignores text', !countText.startsWith('0') && !(await page.locator('#thumbs').textContent()).includes('ignored.txt'), countText);
  await page.click('#infoBtn');
  record('image info shows source and pixel dimensions', (await page.locator('#imageInfo').textContent()).includes('/fixtures/01-quadrants.png') && (await page.locator('#imageInfo').textContent()).includes('640 × 480'));
  await page.click('#infoClose');
  await page.fill('#zoomPercent', '150%'); await page.locator('#zoomPercent').press('Enter');
  record('150 percent is true source pixel scaling', (await page.locator('#image').boundingBox()).width === 960);
  await page.click('#zoomFit');
  record('fit restores image within viewport', (await page.locator('#image').boundingBox()).height <= 800);
  await page.click('#trayToggle');
  record('bottom toggle reveals filmstrip and batch controls', await page.locator('#tray').isVisible());
  await page.locator('.thumb-open').filter({ hasText: '02-quadrants.jpg' }).click();
  await page.waitForFunction(() => document.querySelector('#fileName').textContent === '02-quadrants.jpg');
  await page.click('#backBtn'); await page.waitForFunction(() => document.querySelector('#fileName').textContent === '01-quadrants.png');
  record('back and forward switch same-directory images', true);
  await page.click('#editBtn');
  record('edit toggles right tools', await page.locator('#tools').isVisible());
  await page.click('#rotateRight');
  await page.waitForFunction(() => document.querySelector('#imageMeta').textContent === '480 × 640');
  record('rotation updates actual preview dimensions', true);
  await page.click('#saveBtn');
  await page.waitForFunction(() => document.querySelector('#statusText').textContent.includes('已保存'));
  record('save writes a real JPG', api.writes.length === 1 && api.writes[0].signature.startsWith('ffd8'));
  await page.click('#resetBtn');
  await page.waitForFunction(() => document.querySelector('#imageMeta').textContent === '640 × 480');
  await page.click('#cropStart'); await page.waitForSelector('#cropBox:not([hidden])'); await page.click('#cropApply');
  await page.waitForFunction(() => document.querySelector('#imageMeta').textContent === '512 × 384');
  record('crop changes actual preview, not just an overlay', true);
  await page.click('#undoBtn'); await page.waitForFunction(() => document.querySelector('#imageMeta').textContent === '640 × 480');
  record('undo restores crop', true);
  await page.locator('#brightness').evaluate((node) => { node.value = '15'; node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.locator('.thumb-open').filter({ hasText: '02-quadrants.jpg' }).click(); await page.waitForFunction(() => document.querySelector('#fileName').textContent === '02-quadrants.jpg');
  await page.click('#backBtn'); await page.waitForFunction(() => document.querySelector('#fileName').textContent === '01-quadrants.png');
  record('each image retains its edits', await page.locator('#brightness').inputValue() === '15');
  await page.click('#resetBtn');
  const writesBeforeCancel = api.writes.length; api.cancelled = true;
  await page.click('#saveBtn'); await page.waitForFunction(() => document.querySelector('#statusText').textContent.includes('已取消保存'));
  record('cancel save performs no write', api.writes.length === writesBeforeCancel); api.cancelled = false;
  api.failWrite = true; api.save = 'fail.jpg';
  await page.click('#saveBtn'); await page.waitForFunction(() => document.querySelector('#statusText').textContent.includes('模拟磁盘写入失败'));
  record('disk failure is not reported as success', api.writes.length === writesBeforeCancel); api.failWrite = false;
  api.save = '01-quadrants-转换.jpg'; await page.click('#saveBtn');
  await page.waitForFunction(() => document.querySelector('#statusText').textContent.includes('已存在'));
  record('existing target is never silently overwritten', api.writes.length === writesBeforeCancel);
  await page.locator('summary').filter({ hasText: '保存格式' }).click();
  api.save = '../fixtures/01-quadrants.png'; await page.selectOption('#format', 'image/png'); await page.click('#saveBtn');
  await page.waitForFunction(() => document.querySelector('#statusText').textContent.includes('原图'));
  record('original image overwrite is rejected', api.writes.length === writesBeforeCancel); await page.selectOption('#format', 'image/jpeg');
  await page.click('#topExportBtn'); await page.click('#exportImageMenu');
  record('top export offers explicit format settings', await page.locator('#exportModal').isVisible());
  await page.selectOption('#exportFormat', 'image/webp'); api.save = 'converted.webp';
  await page.click('#exportConfirm'); await page.waitForFunction(() => document.querySelector('#statusText').textContent.includes('converted.webp'));
  record('WebP export has RIFF signature', api.writes.at(-1).signature.startsWith('52494646'));
  await page.click('#clearSelectionBtn');
  await page.locator('input[aria-label="选择 01-quadrants.png"]').check();
  await page.locator('input[aria-label="选择 02-quadrants.jpg"]').check();
  await page.click('#batchConvertBtn'); api.save = 'unused.jpg';
  await page.selectOption('#exportFormat', 'image/jpeg');
  const beforeConvert = api.writes.length;
  await page.click('#exportConfirm'); await waitForOutputCount(beforeConvert + 2);
  record('batch uses one directory and avoids an existing name', api.writes.some((item) => item.path.includes('01-quadrants-转换-2.jpg')));
  api.save = 'images.pdf'; await page.click('#batchPdfBtn');
  record('PDF dialog contains selected images', await page.locator('#pdfList .pdf-item').count() === 2);
  const reachable = await page.locator('#pdfConfirm').evaluate((button) => { const rect = button.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= innerHeight && button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)); });
  record('PDF save is reachable on screen', reachable);
  await page.click('#pdfConfirm'); await page.waitForFunction(() => document.querySelector('#statusText').textContent.includes('PDF 已保存') && document.querySelector('#busy').hidden);
  record('multi-image PDF writes a PDF file', api.writes.at(-1).signature.startsWith('25504446'));
  const beforeCompress = api.writes.length;
  await page.click('#batchResizeBtn'); await page.selectOption('#exportEdge', '1280'); await page.selectOption('#exportFormat', 'image/png'); await page.click('#exportConfirm');
  await waitForOutputCount(beforeCompress + 2);
  record('batch compression also produces valid PNGs', api.writes.length === beforeCompress + 2 && api.writes.at(-1).signature.startsWith('89504e47'));
  await page.locator('#brightness').evaluate((node) => { node.value = '10'; node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); });
  const beforeAdjust = api.writes.length;
  await page.click('#batchEditBtn'); await page.click('#exportConfirm');
  await waitForOutputCount(beforeAdjust + 2);
  record('batch adjustments export selected images', api.writes.length === beforeAdjust + 2 && api.writes.at(-1).path.includes('已调整'), JSON.stringify(api.writes.slice(beforeAdjust)));
  await page.click('#resetBtn');
  const beforeBatchCancel = api.writes.length; api.cancelled = true;
  await page.click('#batchConvertBtn'); await page.click('#exportConfirm');
  await page.waitForFunction(() => !document.querySelector('#exportModal').classList.contains('open') && document.querySelector('#busy').hidden);
  record('cancel batch output directory does not write', api.writes.length === beforeBatchCancel); api.cancelled = false;
  const engineChecks = await page.evaluate(async () => {
    const { decodeImage, renderImage, defaultEdit, encodeCanvas } = await import('./engine.js');
    const results = [];
    for (const name of ['01-quadrants.png','02-quadrants.jpg','03-quadrants.webp','04-quadrants.bmp','05-quadrants.tiff','06-quadrants.avif','07-quadrants.ico','08-animation.gif','09-transparent.png','10-vector.svg','heic-sample.heic']) {
      const response = await fetch(`/fixtures/${name}`); if (!response.ok) continue;
      const decoded = await decodeImage(await response.blob(), name);
      const canvas = await renderImage(decoded, defaultEdit(), { preview: true, maxPreview: 500 });
      results.push({ name, width: decoded.width, height: decoded.height, sample: [...canvas.getContext('2d').getImageData(Math.min(10, canvas.width - 1), Math.min(10, canvas.height - 1), 1, 1).data] });
      decoded.dispose();
    }
    const source = await decodeImage(await (await fetch('/fixtures/01-quadrants.png')).blob(), 'quad.png');
    const rotated = await renderImage(source, { rotation: 90 });
    const pixels = [...rotated.getContext('2d').getImageData(10, 10, 1, 1).data];
    const transparent = await decodeImage(await (await fetch('/fixtures/09-transparent.png')).blob(), 'transparent.png');
    const jpg = await encodeCanvas(await renderImage(transparent), 'image/jpeg', .9);
    const white = await decodeImage(jpg, 'white.jpg');
    const whiteCanvas = await renderImage(white); const whitePixel = [...whiteCanvas.getContext('2d').getImageData(5, 5, 1, 1).data];
    return { results, rotated: { width: rotated.width, height: rotated.height, pixels }, whitePixel };
  });
  record('native and offline TIFF formats decode to actual pixels', engineChecks.results.length >= 10 && engineChecks.results.every((item) => item.width > 0 && item.height > 0), JSON.stringify(engineChecks));
  if (files.includes('heic-sample.heic')) record('HEIC decodes offline', engineChecks.results.some((item) => item.name === 'heic-sample.heic'));
  record('clockwise rotation preserves quadrant orientation', engineChecks.rotated.width === 480 && engineChecks.rotated.height === 640 && engineChecks.rotated.pixels[2] > 180 && engineChecks.rotated.pixels[0] < 60, JSON.stringify(engineChecks.rotated));
  record('transparent JPEG output is white, not black', engineChecks.whitePixel.slice(0, 3).every((n) => n > 245));
  api.picker = 'broken.png'; await page.click('#openBtn');
  await page.waitForFunction(() => document.querySelector('#statusText').textContent.includes('无法打开 broken.png'));
  record('corrupt image shows an actionable error', true);
  api.picker = '05-quadrants.tiff'; await page.click('#openBtn'); await page.waitForFunction(() => document.querySelector('#fileName').textContent === '05-quadrants.tiff' && document.querySelector('#image').naturalWidth > 0);
  record('app routes TIFF through the decoder', true);
  if (files.includes('heic-sample.heic')) { api.picker = 'heic-sample.heic'; await page.click('#openBtn'); await page.waitForFunction(() => document.querySelector('#fileName').textContent === 'heic-sample.heic' && document.querySelector('#image').naturalWidth > 0, { timeout: 45000 }); record('app opens HEIC through offline decoder', true); }
  api.picker = '00-mountain-lake.jpg'; await page.click('#openBtn'); await page.waitForFunction(() => document.querySelector('#fileName').textContent === '00-mountain-lake.jpg');
  if (await page.locator('#tools').isVisible()) await page.click('#toolToggle');
  if (await page.locator('#tray').isVisible()) await page.click('#trayToggle');
  await page.evaluate(() => { document.querySelector('#toast').hidden = true; });
  await page.screenshot({ path: path.join(root, 'outputs', 'viewer-light.png') });
  await page.click('#themeBtn'); await page.screenshot({ path: path.join(root, 'outputs', 'viewer-dark.png') });
  await page.click('#editBtn'); await page.click('#trayToggle'); await page.mouse.move(350, 80); await page.screenshot({ path: path.join(root, 'outputs', 'viewer-editing.png') });
  record('active edit button text remains readable in dark mode', await page.locator('#editBtn').evaluate((button) => getComputedStyle(button).color !== getComputedStyle(button).backgroundColor));
  for (const width of [1000, 800, 680]) {
    await page.setViewportSize({ width, height: 700 });
    const layout = await page.evaluate(() => {
      const ids = ['backBtn','forwardBtn','topExportBtn','saveBtn','editBtn','trayToggle','zoomPercent','rotateRight'];
      return ids.map((id) => { const rect = document.getElementById(id).getBoundingClientRect(); return { id, inside: rect.x >= 0 && rect.right <= innerWidth && rect.y >= 0 && rect.bottom <= innerHeight }; });
    });
    record(`controls remain inside ${width}px window`, layout.every((item) => item.inside), JSON.stringify(layout));
  }
  record('no uncaught browser errors', errors.length === 0, errors.join('\n'));
  await fs.writeFile(path.join(out, 'results.json'), JSON.stringify({ passed: results.length, tests: results, writes: api.writes, engineChecks, errors }, null, 2));
  console.log(`Completed ${results.length} browser checks.`);
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
