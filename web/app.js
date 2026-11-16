import { buildPdf } from './core.js';
import { decodeImage, defaultEdit, encodeCanvas, normalizeEdit, releaseCanvas, renderImage, resizeDimensions } from './engine.js';
import { baseName, chooseSavePath, dirName, extension, hostAvailable, IMAGE_EXTENSIONS, isImage, joinPath, listDirectory, mimeFor, normalizeMeta, pathKey, pickFolder, pickImages, readBlob, writeBlob } from './bridge.js';

const $ = (id) => document.getElementById(id);
const state = {
  items: [], currentId: null, selected: new Set(), busy: false, stop: false,
  zoom: 1, fitMode: true, logicalWidth: 0, logicalHeight: 0,
  cropMode: false, cropDraft: null, cropDrag: null,
  request: 0, rendered: 0, rendering: false, loadToken: 0,
  previewUrl: '', observer: null, exportMode: 'single', pdfItems: [], focusBeforeModal: null,
};
const current = () => state.items.find((item) => item.id === state.currentId);
const clone = (edit) => JSON.parse(JSON.stringify(edit));
const sizeText = (n) => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n || 0} B`;
const errorMessage = (error) => error?.message || String(error);
const suffixName = (name, suffix, ext) => `${name.replace(/\.[^.]+$/, '')}${suffix}.${ext}`;
const mimeExtension = (mime) => ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' })[mime];
const editKeys = ['brightness', 'contrast', 'saturation', 'warmth', 'whiten', 'soften'];

function status(message, error = false) {
  $('statusText').textContent = message;
  $('statusText').title = message;
  $('statusText').classList.toggle('error', error);
}
function toast(message) {
  $('toast').textContent = message; $('toast').hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { $('toast').hidden = true; }, 2500);
}
function report(error) { status(errorMessage(error), true); toast(errorMessage(error)); }
function run(action) { return (...args) => Promise.resolve().then(() => action(...args)).catch(report); }
function setBusy(busy, text = '正在处理…', cancel = false) {
  state.busy = busy; $('busy').hidden = !busy; $('busyText').textContent = text;
  $('cancelBatch').hidden = !cancel;
  if (busy && cancel) { $('cancelBatch').disabled = false; $('cancelBatch').textContent = '完成当前图片后停止'; }
  updateButtons();
}
function updateButtons() {
  const item = current(), has = !!item, index = state.items.indexOf(item), busy = state.busy;
  for (const id of ['topExportBtn', 'saveBtn', 'exportBtn', 'infoBtn', 'zoomOut', 'zoomIn', 'zoomFit', 'zoomPercent', 'rotateLeft', 'rotateRight', 'flipBtn', 'cropStart', 'resetBtn']) $(id).disabled = !has || busy;
  $('undoBtn').disabled = !has || !item.history.length || busy;
  $('backBtn').disabled = !has || index <= 0 || busy;
  $('forwardBtn').disabled = !has || index >= state.items.length - 1 || busy;
  for (const id of ['openBtn', 'folderBtn', 'emptyOpen']) $(id).disabled = busy;
  for (const id of ['batchConvertBtn', 'batchResizeBtn', 'batchEditBtn', 'batchPdfBtn']) $(id).disabled = !state.selected.size || busy || (!hostAvailable() && id !== 'batchPdfBtn');
  $('cropApply').disabled = !state.cropMode || busy; $('cropCancel').disabled = !state.cropMode || busy;
  $('trayCount').textContent = `${state.items.length} 张${state.selected.size ? ` · 已选 ${state.selected.size}` : ''}`;
  if (item) {
    $('fileName').textContent = item.name; $('fileName').title = item.path || item.name;
    $('imageMeta').textContent = `${state.logicalWidth || item.width || '—'} × ${state.logicalHeight || item.height || '—'}`;
    $('fileSize').textContent = sizeText(item.size);
  }
  for (const input of document.querySelectorAll('.tool-content input,.tool-content select,.presets button')) input.disabled = !has || busy;
}
function makeItem(meta) {
  const value = normalizeMeta(meta);
  return { ...value, id: crypto.randomUUID(), edit: defaultEdit(), history: [], decoded: null, decoding: null, thumbUrl: '', thumbPromise: null, touched: 0 };
}
function clearItems() {
  state.observer?.disconnect(); state.loadToken++; state.request++;
  for (const item of state.items) { item.decoded?.dispose(); if (item.thumbUrl) URL.revokeObjectURL(item.thumbUrl); }
  state.items = []; state.currentId = null; state.selected.clear(); state.cropMode = false;
  state.logicalWidth = state.logicalHeight = 0;
  $('image').removeAttribute('src'); $('canvasWrap').hidden = true; $('empty').hidden = false;
  if (state.previewUrl) { URL.revokeObjectURL(state.previewUrl); state.previewUrl = ''; }
}
async function getDecoded(item) {
  item.touched = performance.now();
  if (item.decoded) return item.decoded;
  if (!item.decoding) item.decoding = (async () => {
    const blob = await readBlob(item); item.size ||= blob.size;
    const decoded = await decodeImage(blob, item.name);
    if (!state.items.includes(item)) { decoded.dispose(); throw new Error('图片列表已切换'); }
    item.width = decoded.width; item.height = decoded.height; item.decoded = decoded;
    return decoded;
  })().finally(() => { item.decoding = null; });
  return item.decoding;
}
function pruneCache(keep = []) {
  const cached = state.items.filter((item) => item.decoded && item.id !== state.currentId && !keep.includes(item)).sort((a, b) => b.touched - a.touched);
  for (const item of cached.slice(2)) { item.decoded.dispose(); item.decoded = null; }
}
async function selectItem(item) {
  if (!item || state.busy) return;
  const token = ++state.loadToken;
  status(`正在读取 ${item.name}…`);
  try {
    await getDecoded(item);
    if (token !== state.loadToken || !state.items.includes(item)) return;
    state.cropMode = false; state.cropDraft = null; $('cropBox').hidden = true;
    state.currentId = item.id; state.fitMode = true;
    syncControls(); updateButtons(); renderThumbs();
    await requestPreview();
    if (token !== state.loadToken) return;
    status(`${state.items.indexOf(item) + 1} / ${state.items.length} · ${item.name}${/\.(gif|apng|webp)$/i.test(item.name) ? ' · 调整/导出为静态帧' : ''}`);
    pruneCache();
  } catch (error) { if (token === state.loadToken) report(new Error(`无法打开 ${item.name}：${errorMessage(error)}`)); }
}
async function setItems(metas, firstPath = '') {
  const filtered = metas.filter(isImage);
  if (!filtered.length) { toast('没有找到支持的图片'); return; }
  clearItems(); state.items = filtered.map(makeItem);
  const first = state.items.find((item) => firstPath && pathKey(item.path) === pathKey(firstPath)) || state.items[0];
  renderThumbs(); updateButtons(); await selectItem(first);
}
async function openImages() {
  if (!hostAvailable()) { $('fileFallback').click(); return; }
  const picked = await pickImages(); if (!picked.length) return;
  const first = picked[0], folder = dirName(first.path);
  let metas = picked;
  if (folder) {
    try {
      const siblings = await listDirectory(folder), known = new Set(picked.map((item) => pathKey(item.path)));
      metas = [...picked, ...siblings.filter((item) => isImage(item) && !known.has(pathKey(item.path)))];
      metas.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
    } catch (error) { toast(`只打开所选图片：${errorMessage(error)}`); }
  }
  $('trayTitle').textContent = folder ? baseName(folder) : '已打开图片';
  await setItems(metas, first.path);
}
async function openFolder() {
  if (!hostAvailable()) { $('fileFallback').click(); return; }
  const folder = await pickFolder(); if (!folder) return;
  const entries = await listDirectory(folder.path);
  $('trayTitle').textContent = folder.name;
  await setItems(entries);
}
function navigate(delta) {
  const index = state.items.indexOf(current());
  const next = state.items[index + delta]; if (next) return selectItem(next);
}

let thumbActive = 0;
const thumbWaiters = [];
async function getThumbnail(item) {
  if (item.thumbUrl) return item.thumbUrl;
  if (item.thumbPromise) return item.thumbPromise;
  item.thumbPromise = (async () => {
    if (thumbActive >= 2) await new Promise((resolve) => thumbWaiters.push(resolve));
    thumbActive++;
    try {
      const decoded = await getDecoded(item);
      const canvas = await renderImage(decoded, defaultEdit(), { preview: true, maxPreview: 180 });
      const blob = await encodeCanvas(canvas, 'image/png'); releaseCanvas(canvas);
      if (!state.items.includes(item)) return '';
      item.thumbUrl = URL.createObjectURL(blob); pruneCache([item]); return item.thumbUrl;
    } finally { thumbActive--; thumbWaiters.shift()?.(); }
  })().finally(() => { item.thumbPromise = null; });
  return item.thumbPromise;
}
function renderThumbs() {
  const container = $('thumbs'), scrollLeft = container.scrollLeft;
  state.observer?.disconnect(); container.replaceChildren();
  state.observer = new IntersectionObserver((entries, observer) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      const { item, img } = entry.target._thumb;
      getThumbnail(item).then((url) => { if (url) img.src = url; }).catch(() => { img.alt = '无法预览'; entry.target.title = `${item.name}（无法预览）`; });
    }
  }, { root: container, rootMargin: '100px' });
  for (const item of state.items) {
    const card = document.createElement('div'); card.className = `thumb${item.id === state.currentId ? ' active' : ''}`; card.title = item.name;
    const check = document.createElement('input'); check.type = 'checkbox'; check.checked = state.selected.has(item.id); check.setAttribute('aria-label', `选择 ${item.name}`);
    check.addEventListener('change', () => { check.checked ? state.selected.add(item.id) : state.selected.delete(item.id); updateButtons(); });
    const button = document.createElement('button'); button.className = 'thumb-open'; button.setAttribute('aria-label', `查看 ${item.name}`);
    const img = document.createElement('img'); img.alt = ''; if (item.thumbUrl) img.src = item.thumbUrl;
    const label = document.createElement('span'); label.className = 'thumb-name'; label.textContent = item.name;
    button.append(img, label); button.addEventListener('click', run(() => selectItem(item))); card.append(check, button); container.append(card);
    card._thumb = { item, img }; if (!item.thumbUrl && !$('tray').hidden) state.observer.observe(card);
  }
  container.scrollLeft = scrollLeft; updateButtons();
}
function toggleTray() {
  $('tray').hidden = !$('tray').hidden;
  const open = !$('tray').hidden;
  $('trayToggle').setAttribute('aria-expanded', String(open)); $('trayToggle').setAttribute('aria-pressed', String(open));
  if (open) renderThumbs(); else state.observer?.disconnect();
  requestAnimationFrame(() => { if (state.fitMode) applyZoom(); });
}
function toggleEditor(open = $('tools').hidden) {
  $('tools').hidden = !open; $('editBtn').setAttribute('aria-expanded', String(open)); $('editBtn').setAttribute('aria-pressed', String(open));
  if (!open && state.cropMode) cancelCrop();
  requestAnimationFrame(() => { if (state.fitMode) applyZoom(); });
}
function saveHistory() {
  const item = current(); if (!item) return;
  item.history.push(clone(item.edit)); if (item.history.length > 25) item.history.shift();
}
function mutateEdit(patch) {
  const item = current(); if (!item || state.busy) return;
  saveHistory(); Object.assign(item.edit, patch); syncControls(); updateButtons(); void requestPreview();
}
function syncControls() {
  const item = current(); if (!item) return;
  for (const key of editKeys) { $(key).value = item.edit[key]; $(key).nextElementSibling.textContent = String(item.edit[key]); }
  $('resizePct').value = item.edit.scale; $('resizePct').nextElementSibling.textContent = `${item.edit.scale}%`;
  $('maxWidth').value = String(item.edit.maxEdge);
  for (const button of document.querySelectorAll('[data-filter]')) button.setAttribute('aria-pressed', String(button.dataset.filter === item.edit.effect));
  $('cropStatus').textContent = item.edit.crop ? '已裁剪。可重新选择，或撤销恢复。' : '拖动选框，拉动右下角调整范围。';
}
function viewDimensions(item) {
  const edit = { ...item.edit, scale: 100, maxEdge: 0 };
  if (state.cropMode) edit.crop = null;
  return resizeDimensions(item.width, item.height, edit);
}
async function requestPreview() {
  state.request++;
  if (state.rendering) return;
  state.rendering = true;
  try {
    while (state.rendered < state.request) {
      const version = state.request, item = current();
      if (!item) { state.rendered = version; continue; }
      const edit = clone(item.edit); if (state.cropMode) edit.crop = null;
      edit.scale = 100; edit.maxEdge = 0;
      const decoded = await getDecoded(item), dims = viewDimensions(item);
      const plain = JSON.stringify(normalizeEdit(edit)) === JSON.stringify(defaultEdit());
      let url, owned = false;
      if (plain && decoded.url) url = decoded.url;
      else {
        const canvas = await renderImage(decoded, edit, { preview: true, maxPreview: 1800 });
        const blob = await encodeCanvas(canvas, 'image/png'); releaseCanvas(canvas);
        url = URL.createObjectURL(blob); owned = true;
      }
      if (version !== state.request || item !== current()) { if (owned) URL.revokeObjectURL(url); state.rendered = version; continue; }
      $('image').src = url; await $('image').decode();
      if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
      state.previewUrl = owned ? url : '';
      state.logicalWidth = dims.width; state.logicalHeight = dims.height;
      $('empty').hidden = true; $('canvasWrap').hidden = false;
      applyZoom(); updateCropBox(); updateButtons();
      state.rendered = version;
    }
  } catch (error) { state.rendered = state.request; report(error); }
  finally { state.rendering = false; }
}
function applyZoom() {
  if (!current() || !state.logicalWidth) return;
  if (state.fitMode) state.zoom = Math.min(1, Math.max(1, $('stage').clientWidth - 48) / state.logicalWidth, Math.max(1, $('stage').clientHeight - 48) / state.logicalHeight);
  const width = Math.max(1, Math.round(state.logicalWidth * state.zoom)), height = Math.max(1, Math.round(state.logicalHeight * state.zoom));
  $('image').style.width = `${width}px`; $('image').style.height = `${height}px`;
  $('zoomPercent').value = `${Number((state.zoom * 100).toFixed(1))}%`;
  $('zoomPercent').title = '100% 表示一个图片像素对应一个显示像素'; updateCropBox();
}
function zoomTo(percent) {
  if (!current()) return;
  if (!Number.isFinite(percent) || percent <= 0) { applyZoom(); return; }
  state.fitMode = false; state.zoom = Math.max(0.02, Math.min(8, percent / 100)); applyZoom();
}
function rotate(amount) {
  const item = current(); if (!item) return;
  cancelCrop(false); mutateEdit({ rotation: (item.edit.rotation + amount + 360) % 360, crop: null });
  state.fitMode = true;
}
function updateCropBox() {
  if (!state.cropMode || !state.cropDraft) { $('cropBox').hidden = true; return; }
  const rect = state.cropDraft, width = $('image').clientWidth, height = $('image').clientHeight;
  Object.assign($('cropBox').style, { left: `${rect.x * width}px`, top: `${rect.y * height}px`, width: `${rect.w * width}px`, height: `${rect.h * height}px` });
  $('cropBox').hidden = false;
}
async function startCrop() {
  const item = current(); if (!item) return;
  state.cropMode = true; state.cropDraft = item.edit.crop ? { ...item.edit.crop } : { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
  await requestPreview(); updateCropBox(); updateButtons();
}
function cancelCrop(render = true) {
  if (!state.cropMode) return;
  state.cropMode = false; state.cropDraft = null; state.cropDrag = null; $('cropBox').hidden = true;
  if (render) void requestPreview(); updateButtons();
}
function applyCrop() {
  if (!state.cropMode) return;
  const crop = { ...state.cropDraft }; state.cropMode = false; state.cropDraft = null; $('cropBox').hidden = true;
  state.fitMode = true; mutateEdit({ crop });
}
$('cropBox').addEventListener('pointerdown', (event) => {
  if (!state.cropMode) return;
  event.preventDefault(); state.cropDrag = { x: event.clientX, y: event.clientY, resize: !!event.target.closest('.resize-handle'), rect: { ...state.cropDraft }, width: $('image').clientWidth, height: $('image').clientHeight };
  $('cropBox').setPointerCapture(event.pointerId);
});
$('cropBox').addEventListener('pointermove', (event) => {
  const drag = state.cropDrag; if (!drag) return;
  const dx = (event.clientX - drag.x) / drag.width, dy = (event.clientY - drag.y) / drag.height, rect = drag.rect;
  if (drag.resize) state.cropDraft = { ...rect, w: Math.max(0.02, Math.min(1 - rect.x, rect.w + dx)), h: Math.max(0.02, Math.min(1 - rect.y, rect.h + dy)) };
  else state.cropDraft = { ...rect, x: Math.max(0, Math.min(1 - rect.w, rect.x + dx)), y: Math.max(0, Math.min(1 - rect.h, rect.y + dy)) };
  updateCropBox();
});
for (const name of ['pointerup', 'pointercancel']) $('cropBox').addEventListener(name, () => { state.cropDrag = null; });

function showModal(id) { state.focusBeforeModal = document.activeElement; $(id).classList.add('open'); $(id).querySelector('button,input,select')?.focus(); }
function closeModal(id) { $(id).classList.remove('open'); state.focusBeforeModal?.focus?.(); }
function openInfo() {
  const item = current(); if (!item) return;
  const rows = [['文件名', item.name], ['路径', item.path || '浏览器所选文件'], ['图片格式', extension(item.name).toUpperCase()], ['原始尺寸', `${item.width} × ${item.height} 像素`], ['当前画面', `${state.logicalWidth} × ${state.logicalHeight} 像素`], ['文件大小', sizeText(item.size)], ['缩放', `${Number((state.zoom * 100).toFixed(1))}%`], ['旋转', `${item.edit.rotation}°`]];
  if (item.lastModified) rows.push(['修改时间', new Date(item.lastModified).toLocaleString('zh-CN')]);
  if (item.decoded?.pageCount > 1) rows.push(['多页 TIFF', `显示第 1 页，共 ${item.decoded.pageCount} 页`]);
  $('imageInfo').replaceChildren();
  for (const [label, value] of rows) { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value; $('imageInfo').append(dt, dd); }
  showModal('infoModal');
}
function exportMenu(open) {
  $('exportMenu').hidden = !open; $('topExportBtn').setAttribute('aria-expanded', String(open));
  if (open) { const rect = $('topExportBtn').getBoundingClientRect(); $('exportMenu').style.top = `${rect.bottom + 6}px`; $('exportMenu').style.left = `${Math.min(innerWidth - 195, Math.max(8, rect.right - 185))}px`; }
}
function openExport(mode = 'single') {
  state.exportMode = mode;
  $('exportTitle').textContent = ({ single: '导出当前图片', convert: '批量转换格式', compress: '批量压缩', edit: '批量应用当前调整' })[mode];
  $('exportFormat').value = $('format').value; $('exportQuality').value = $('quality').value; $('exportQuality').nextElementSibling.textContent = `${$('quality').value}%`;
  $('exportEdge').value = mode === 'compress' ? '1920' : '0';
  $('exportHint').textContent = mode === 'single' ? '导出当前图片的调整，默认保存新副本。' : mode === 'edit' ? '给选中图片应用当前色彩、人像效果、旋转和比例裁剪；只保存副本。' : '只处理下方已勾选图片，选择一次输出目录，自动避开重名文件。';
  showModal('exportModal');
}
async function ensureNewPath(path) {
  if (state.items.some((item) => item.path && pathKey(item.path) === pathKey(path))) throw new Error('为保护原图，请选择不同的文件名保存副本');
  const entries = await listDirectory(dirName(path));
  if (entries.some((entry) => pathKey(entry.path) === pathKey(path))) throw new Error('该文件已存在。为避免覆盖，请换一个文件名');
}
async function saveOutput(blob, name, ext) {
  if (!hostAvailable()) {
    const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); return name;
  }
  const path = await chooseSavePath(name, ext); if (!path) return null;
  await ensureNewPath(path); await writeBlob(path, blob); return path;
}
async function saveSingle({ mime = $('format').value, quality = Number($('quality').value) / 100, edge = Number($('maxWidth').value) } = {}) {
  const item = current(); if (!item || state.busy) return;
  setBusy(true, '正在生成图片副本…');
  let canvas;
  try {
    const edit = clone(item.edit); edit.maxEdge = edge;
    canvas = await renderImage(await getDecoded(item), edit);
    const blob = await encodeCanvas(canvas, mime, quality), ext = mimeExtension(mime);
    const path = await saveOutput(blob, suffixName(item.name, '-副本', ext), ext);
    if (path) { status(`已保存：${path}`); toast('图片副本已保存'); } else status('已取消保存，未写入文件');
  } finally { releaseCanvas(canvas); setBusy(false); }
}
function uniqueName(name, used) {
  let candidate = name, number = 2;
  while (used.has(candidate.toLowerCase())) { candidate = name.replace(/(\.[^.]+)$/, `-${number++}$1`); }
  used.add(candidate.toLowerCase()); return candidate;
}
async function batchExport(mode, mime, quality, edge) {
  const selected = state.items.filter((item) => state.selected.has(item.id)); if (!selected.length || state.busy) return;
  const template = clone(current()?.edit || defaultEdit());
  const folder = await pickFolder('选择批量结果保存目录'); if (!folder) return;
  const entries = await listDirectory(folder.path), used = new Set(entries.map((item) => item.name.toLowerCase()));
  state.stop = false; setBusy(true, '正在批量处理…', true);
  let completed = 0;
  try {
    for (const item of selected) {
      if (state.stop) break;
      $('busyText').textContent = `正在处理 ${completed + 1} / ${selected.length} · ${item.name}`;
      const edit = mode === 'edit' ? clone(template) : clone(item.edit);
      if (mode !== 'edit') { edit.maxEdge = edge; if (mode === 'compress') edit.scale = Math.min(edit.scale, 100); }
      else if (edge) edit.maxEdge = edge;
      let canvas;
      try {
        canvas = await renderImage(await getDecoded(item), edit);
        const blob = await encodeCanvas(canvas, mime, quality), ext = mimeExtension(mime);
        const name = uniqueName(suffixName(item.name, mode === 'compress' ? '-压缩' : mode === 'edit' ? '-已调整' : '-转换', ext), used);
        const path = joinPath(folder.path, name);
        if (state.items.some((source) => source.path && pathKey(source.path) === pathKey(path))) throw new Error('目标路径与原图重叠，已停止');
        const latest = await listDirectory(folder.path);
        if (latest.some((entry) => pathKey(entry.path) === pathKey(path))) throw new Error('输出目录出现重名文件，已停止以避免覆盖');
        await writeBlob(path, blob); completed++;
      } finally { releaseCanvas(canvas); pruneCache(); }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    status(`${state.stop ? '已停止' : '批量完成'}：已保存 ${completed} / ${selected.length} 张 · ${folder.path}`); toast(`已保存 ${completed} 张副本`);
  } catch (error) { throw new Error(`批量处理停止，已保存 ${completed} 张：${errorMessage(error)}`); }
  finally { setBusy(false); }
}
function openPdf(items) {
  state.pdfItems = [...items]; if (!items.length) return;
  $('pdfList').replaceChildren();
  for (const item of items) { const row = document.createElement('div'); row.className = 'pdf-item'; const img = document.createElement('img'); img.alt = ''; if (item.thumbUrl) img.src = item.thumbUrl; const text = document.createElement('span'); text.textContent = item.name; row.append(img, text); $('pdfList').append(row); }
  showModal('pdfModal');
}
async function exportPdf() {
  if (state.busy || !state.pdfItems.length) return;
  closeModal('pdfModal'); setBusy(true, '正在生成 PDF…');
  try {
    const images = [];
    for (const [index, item] of state.pdfItems.entries()) {
      $('busyText').textContent = `准备 PDF 第 ${index + 1} / ${state.pdfItems.length} 页…`;
      const edit = clone(item.edit); edit.maxEdge = Math.min(edit.maxEdge || 3200, 3200); edit.scale = Math.min(edit.scale, 100);
      const canvas = await renderImage(await getDecoded(item), edit);
      try {
        const blob = await encodeCanvas(canvas, 'image/jpeg', 0.93);
        if (images.reduce((sum, image) => sum + image.jpeg.length, 0) + blob.size > 180 * 1024 * 1024) throw new Error('PDF 内容过大，请分成多个 PDF 导出');
        images.push({ width: canvas.width, height: canvas.height, jpeg: new Uint8Array(await blob.arrayBuffer()) });
      }
      finally { releaseCanvas(canvas); pruneCache(); }
    }
    const bytes = buildPdf(images, $('pdfPage').value, $('pdfOrientation').value);
    const path = await saveOutput(new Blob([bytes], { type: 'application/pdf' }), '图片合集.pdf', 'pdf');
    status(path ? `PDF 已保存：${path}` : '已取消 PDF 保存，未写入文件'); if (path) toast('PDF 已导出');
  } finally { setBusy(false); }
}

$('openBtn').addEventListener('click', run(openImages)); $('emptyOpen').addEventListener('click', run(openImages)); $('folderBtn').addEventListener('click', run(openFolder));
$('fileFallback').addEventListener('change', run(async () => {
  const files = Array.from($('fileFallback').files || []); $('fileFallback').value = '';
  if (files.length) { $('trayTitle').textContent = '所选图片'; await setItems(files.map((file) => ({ file, name: file.name, size: file.size, mime: mimeFor(file.name), lastModified: file.lastModified }))); }
}));
$('backBtn').addEventListener('click', run(() => navigate(-1))); $('forwardBtn').addEventListener('click', run(() => navigate(1)));
$('editBtn').addEventListener('click', () => toggleEditor()); $('toolToggle').addEventListener('click', () => toggleEditor(false)); $('trayToggle').addEventListener('click', toggleTray);
$('infoBtn').addEventListener('click', openInfo); $('infoClose').addEventListener('click', () => closeModal('infoModal'));
$('topExportBtn').addEventListener('click', () => exportMenu($('exportMenu').hidden)); $('exportImageMenu').addEventListener('click', () => { exportMenu(false); openExport(); });
$('exportPdfMenu').addEventListener('click', () => { exportMenu(false); openPdf(current() ? [current()] : []); });
$('saveBtn').addEventListener('click', run(() => saveSingle())); $('exportBtn').addEventListener('click', () => openExport());
$('exportCancel').addEventListener('click', () => closeModal('exportModal'));
$('exportConfirm').addEventListener('click', run(async () => {
  const mode = state.exportMode, mime = $('exportFormat').value, quality = Number($('exportQuality').value) / 100, edge = Number($('exportEdge').value);
  closeModal('exportModal');
  if (mode === 'single') await saveSingle({ mime, quality, edge }); else await batchExport(mode, mime, quality, edge);
}));
$('exportQuality').addEventListener('input', () => { $('exportQuality').nextElementSibling.textContent = `${$('exportQuality').value}%`; });
$('quality').addEventListener('input', () => { $('quality').nextElementSibling.textContent = `${$('quality').value}%`; });
$('cropStart').addEventListener('click', run(startCrop)); $('cropApply').addEventListener('click', applyCrop); $('cropCancel').addEventListener('click', () => cancelCrop());
$('rotateLeft').addEventListener('click', () => rotate(-90)); $('rotateRight').addEventListener('click', () => rotate(90));
$('flipBtn').addEventListener('click', () => { if (current()) { cancelCrop(false); mutateEdit({ flipX: !current().edit.flipX, crop: null }); } });
for (const key of [...editKeys, 'resizePct']) {
  const input = $(key), property = key === 'resizePct' ? 'scale' : key;
  let transaction = false;
  input.addEventListener('pointerdown', () => { if (current()) { saveHistory(); transaction = true; } });
  input.addEventListener('input', () => {
    const item = current(); if (!item) return;
    if (!transaction) { saveHistory(); transaction = true; }
    item.edit[property] = Number(input.value); input.nextElementSibling.textContent = `${input.value}${property === 'scale' ? '%' : ''}`;
    updateButtons(); if (property !== 'scale') void requestPreview();
  });
  input.addEventListener('change', () => { transaction = false; });
}
$('maxWidth').addEventListener('change', () => mutateEdit({ maxEdge: Number($('maxWidth').value) }));
for (const button of document.querySelectorAll('[data-filter]')) button.addEventListener('click', () => mutateEdit({ effect: button.dataset.filter }));
$('beautyReset').addEventListener('click', () => mutateEdit({ whiten: 0, soften: 0 }));
$('undoBtn').addEventListener('click', () => { const item = current(); if (!item?.history.length) return; cancelCrop(false); item.edit = item.history.pop(); syncControls(); updateButtons(); void requestPreview(); });
$('resetBtn').addEventListener('click', () => { cancelCrop(false); mutateEdit(defaultEdit()); state.fitMode = true; });
$('zoomIn').addEventListener('click', () => zoomTo(state.zoom * 125)); $('zoomOut').addEventListener('click', () => zoomTo(state.zoom * 80)); $('zoomFit').addEventListener('click', () => { state.fitMode = true; applyZoom(); });
$('zoomPercent').addEventListener('change', () => zoomTo(Number($('zoomPercent').value.replace('%', ''))));
$('zoomPercent').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); $('zoomPercent').blur(); } });
$('image').addEventListener('dblclick', () => { state.fitMode ? zoomTo(100) : (state.fitMode = true, applyZoom()); });
$('canvasWrap').addEventListener('wheel', (event) => { if (event.ctrlKey || event.metaKey) { event.preventDefault(); zoomTo(state.zoom * (event.deltaY < 0 ? 110 : 90)); } }, { passive: false });
new ResizeObserver(() => { if (state.fitMode) applyZoom(); exportMenu(false); }).observe($('stage'));
$('selectAllBtn').addEventListener('click', () => { for (const item of state.items) state.selected.add(item.id); renderThumbs(); });
$('clearSelectionBtn').addEventListener('click', () => { state.selected.clear(); renderThumbs(); });
$('batchConvertBtn').addEventListener('click', () => openExport('convert')); $('batchResizeBtn').addEventListener('click', () => openExport('compress')); $('batchEditBtn').addEventListener('click', () => openExport('edit'));
$('batchPdfBtn').addEventListener('click', () => openPdf(state.items.filter((item) => state.selected.has(item.id))));
$('pdfCancel').addEventListener('click', () => closeModal('pdfModal')); $('pdfConfirm').addEventListener('click', run(exportPdf));
$('cancelBatch').addEventListener('click', () => { state.stop = true; $('cancelBatch').disabled = true; $('cancelBatch').textContent = '正在完成当前图片…'; });
$('themeBtn').addEventListener('click', () => { const dark = document.documentElement.classList.toggle('dark'); localStorage.setItem('image-tools-theme', dark ? 'dark' : 'light'); });
for (const modal of document.querySelectorAll('.modal-shade')) modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(modal.id); });
document.addEventListener('click', (event) => { if (!$('exportMenu').hidden && !$('exportMenu').contains(event.target) && !$('topExportBtn').contains(event.target)) exportMenu(false); });
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { for (const modal of document.querySelectorAll('.modal-shade.open')) closeModal(modal.id); exportMenu(false); cancelCrop(); return; }
  const modal = document.querySelector('.modal-shade.open');
  if (modal && event.key === 'Tab') {
    const focusable = [...modal.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')], first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  if (modal || event.target.closest('input,select,textarea,[contenteditable=true]') || state.busy) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); void run(openImages)(); }
  else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void run(() => saveSingle())(); }
  else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); $('undoBtn').click(); }
  else if (event.key === 'ArrowLeft') { event.preventDefault(); void run(() => navigate(-1))(); }
  else if (event.key === 'ArrowRight') { event.preventDefault(); void run(() => navigate(1))(); }
  else if (!event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 't') toggleTray();
  else if (!event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'e') toggleEditor();
  else if (event.key === '+' || event.key === '=') zoomTo(state.zoom * 125);
  else if (event.key === '-') zoomTo(state.zoom * 80);
});
for (const name of ['dragenter', 'dragover']) $('stage').addEventListener(name, (event) => { event.preventDefault(); });
$('stage').addEventListener('drop', (event) => {
  event.preventDefault(); if (state.busy) return;
  const files = [...(event.dataTransfer?.files || [])];
  if (files.length) void run(async () => { $('trayTitle').textContent = '拖入的图片'; await setItems(files.map((file) => ({ file, name: file.name, size: file.size, mime: mimeFor(file.name), lastModified: file.lastModified }))); })();
});
if (localStorage.getItem('image-tools-theme') === 'dark') document.documentElement.classList.add('dark');
status(hostAvailable() ? '本地处理 · 原图安全保留' : '浏览器预览 · 可查看与下载副本；同目录浏览需在 OTools 使用');
updateButtons();
// Exposes only a readiness marker for automation, not mutable application state.
document.documentElement.dataset.ready = 'true';
