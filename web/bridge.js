export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'jfif', 'png', 'apng', 'webp', 'bmp', 'gif', 'avif', 'ico', 'svg', 'tif', 'tiff', 'heic', 'heif'];
export const baseName = (path) => String(path || '').split(/[\\/]/).filter(Boolean).pop() || '';
export function dirName(path) {
  const text = String(path || ''), split = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'));
  if (split < 0) return '';
  if (split === 0) return text[0];
  if (split === 2 && text[1] === ':') return text.slice(0, 3);
  return text.slice(0, split);
}
export function joinPath(directory, name) {
  const sep = String(directory).includes('\\') ? '\\' : '/';
  return directory.replace(/[\\/]+$/, '') + sep + name;
}
export const extension = (name) => String(name || '').split('.').pop().toLowerCase();
export const isImage = (item) => item.kind !== 'directory' && IMAGE_EXTENSIONS.includes(extension(item.name || item.path));
export function mimeFor(name) {
  return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', png: 'image/png', apng: 'image/png', webp: 'image/webp', bmp: 'image/bmp', gif: 'image/gif', avif: 'image/avif', ico: 'image/x-icon', svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic', heif: 'image/heif' })[extension(name)] || 'application/octet-stream';
}
export function pathKey(path) {
  const value = String(path).replace(/\\/g, '/').replace(/\/$/, '');
  return /^[a-z]:/i.test(value) || value.startsWith('//') ? value.toLowerCase() : value;
}
export function normalizeMeta(raw) {
  const item = typeof raw === 'string' ? { path: raw } : { ...raw };
  item.name ||= baseName(item.path);
  item.mime = item.mime?.startsWith('image/') ? item.mime : mimeFor(item.name);
  return item;
}
function contexts() {
  const result = [window];
  for (const name of ['parent', 'top']) { try { if (window[name] && !result.includes(window[name])) result.push(window[name]); } catch { /* isolated webview */ } }
  return result;
}
function nativeInvoke() {
  for (const view of contexts()) {
    try { if (typeof view.__TAURI_INTERNALS__?.invoke === 'function') return view.__TAURI_INTERNALS__.invoke.bind(view.__TAURI_INTERNALS__); } catch { /* cross-origin parent */ }
  }
  return null;
}
function wrapper() {
  for (const view of contexts()) {
    try { const api = view.otools || view.utools; if (api?.dialog && typeof api.readHostFile === 'function') return api; } catch { /* cross-origin parent */ }
  }
  return null;
}
export const hostAvailable = () => !!nativeInvoke() || !!wrapper();
async function invoke(command, params) {
  const fn = nativeInvoke();
  if (!fn) throw new Error('此功能需要在 OTools 桌面端打开插件');
  return fn(command, params);
}
export const bytesFromBase64 = (value) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
function toBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
}
const pathOf = (raw) => typeof raw === 'string' ? raw : raw?.path || null;
export async function pickImages() {
  const options = { title: '打开图片', multiple: true, directory: false, filters: [{ name: '图片', extensions: IMAGE_EXTENSIONS }] };
  const api = wrapper();
  const result = api ? await api.dialog.open(options) : await invoke('tools_webview_pick_files', { options });
  return (Array.isArray(result) ? result : result ? [result] : []).map(normalizeMeta).filter((item) => item.path);
}
export async function pickFolder(title = '选择图片文件夹') {
  const api = wrapper();
  const result = api ? await api.dialog.open({ title, directory: true, multiple: false }) : await invoke('tools_webview_pick_folder', { options: { title } });
  const path = pathOf(Array.isArray(result) ? result[0] : result);
  return path ? { path, name: baseName(path) || path } : null;
}
export async function listDirectory(path) {
  // Existing OTools list_dir returns one level only; no recursive scan.
  const result = await invoke('tools_webview_list_dir', { path });
  return (result || []).map(normalizeMeta);
}
export async function readBlob(item) {
  if (item.file) return item.file;
  const api = wrapper(), data = api ? await api.readHostFile(item.path) : await invoke('tools_webview_read_file', { path: item.path });
  if (!data?.dataBase64) throw new Error('文件内容为空或不可读取');
  item.size = Number(data.size || item.size || 0);
  item.mime = mimeFor(item.name);
  item.lastModified = data.lastModified || item.lastModified;
  return new Blob([bytesFromBase64(data.dataBase64)], { type: item.mime });
}
export async function chooseSavePath(name, ext) {
  const api = wrapper();
  const filters = [{ name: ext === 'pdf' ? 'PDF 文档' : '图片', extensions: [ext] }];
  const raw = api ? await api.dialog.save({ title: '另存为', defaultPath: name, filters }) : await invoke('tools_webview_pick_save_path', { options: { title: '另存为', suggestedName: name, filters } });
  const path = pathOf(raw);
  if (!path) return null;
  const allowed = ext === 'jpg' ? ['jpg', 'jpeg', 'jfif'] : [ext];
  if (!allowed.includes(extension(path))) throw new Error(`保存路径的扩展名必须为 .${ext}，请重新选择`);
  return path;
}
export async function writeBlob(path, blob) {
  const request = { path, dataBase64: toBase64(new Uint8Array(await blob.arrayBuffer())) };
  const api = wrapper();
  if (api && typeof api.writeHostFile === 'function') return api.writeHostFile(request);
  return invoke('tools_webview_write_file', { request });
}

/** 宿主 PANEL 粘贴图片派发的关键词（见宿主 features/plugin-input/delivery.ts）。 */
export const PANEL_IMAGE_KEYWORD = 'panel-image';

/**
 * 把宿主派发的图片载荷转成 setItems 可直接消费的条目。
 * image: { dataUrl, mimeType, name }；payload.dataUrl 形如 data:image/png;base64,xxx。
 */
export function imagePayloadToMeta(image) {
  const dataUrl = String(image?.dataUrl || '');
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw new Error('粘贴的图片数据无效');
  const bytes = bytesFromBase64(dataUrl.slice(comma + 1));
  const mime = String(image?.mimeType || '').startsWith('image/') ? image.mimeType : dataUrl.slice(5, comma).split(';')[0];
  const name = String(image?.name || '').trim() || `clipboard.${mime.split('/')[1] || 'png'}`;
  const file = new File([bytes], name, { type: mime, lastModified: Date.now() });
  return { file, name, mime, size: bytes.length, lastModified: file.lastModified };
}

/**
 * 订阅宿主 PANEL 图片输入。无宿主 API（浏览器预览）时返回空清理函数，静默不可用。
 * 收到 panel-image 派发时把图片交给 handler(meta, query)。返回 unlisten。
 */
export async function onPanelImage(handler) {
  for (const view of contexts()) {
    try {
      const api = view.otools || view.utools;
      if (api && typeof api.onOtoolsKeyword === 'function') {
        return api.onOtoolsKeyword((items) => {
          for (const item of items || []) {
            if (String(item?.keyword || '').toLowerCase() !== PANEL_IMAGE_KEYWORD) continue;
            const image = item.payload?.image;
            if (!image?.dataUrl) continue;
            let meta;
            try { meta = imagePayloadToMeta(image); } catch { continue; }
            handler(meta, String(item.payload?.query || ''));
          }
        });
      }
    } catch { /* cross-origin parent */ }
  }
  return () => {};
}
