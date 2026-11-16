const BASE = Object.freeze({ rotation: 0, flipX: false, crop: null, brightness: 0, contrast: 0, saturation: 0, warmth: 0, whiten: 0, soften: 0, effect: 'none', scale: 100, maxEdge: 0 });
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number(n) || 0));
export const defaultEdit = () => ({ ...BASE });

export function normalizeEdit(edit = {}) {
  const value = { ...BASE, ...edit };
  value.rotation = ((Math.round(Number(value.rotation) || 0) % 360) + 360) % 360;
  if (value.rotation % 90) value.rotation = 0;
  for (const key of ['brightness', 'contrast', 'saturation', 'warmth']) value[key] = clamp(value[key], -100, 100);
  for (const key of ['whiten', 'soften']) value[key] = clamp(value[key], 0, 100);
  value.scale = clamp(Number(value.scale) || 100, 1, 400);
  value.maxEdge = Math.max(0, Number(value.maxEdge) || 0);
  value.effect = ['none', 'fresh', 'warm', 'soft', 'mono', 'retro'].includes(value.effect) ? value.effect : 'none';
  if (value.crop) {
    const x = clamp(value.crop.x, 0, 0.999999), y = clamp(value.crop.y, 0, 0.999999);
    value.crop = { x, y, w: clamp(value.crop.w, 0.000001, 1 - x), h: clamp(value.crop.h, 0.000001, 1 - y) };
  }
  return value;
}

export function orientedSize(decoded, edit = {}) {
  const rotated = normalizeEdit(edit).rotation % 180;
  return { width: rotated ? decoded.height : decoded.width, height: rotated ? decoded.width : decoded.height };
}

export function cropRectToPixels(width, height, crop) {
  if (!crop) return { x: 0, y: 0, width, height };
  const x = Math.min(width - 1, Math.round(clamp(crop.x, 0, 1) * width));
  const y = Math.min(height - 1, Math.round(clamp(crop.y, 0, 1) * height));
  return { x, y, width: Math.max(1, Math.min(width - x, Math.round(clamp(crop.w, 0, 1) * width))), height: Math.max(1, Math.min(height - y, Math.round(clamp(crop.h, 0, 1) * height))) };
}

export function resizeDimensions(width, height, edit = {}, maxPreview = 0) {
  if (!(width > 0 && height > 0)) throw new Error('图片尺寸无效');
  const value = normalizeEdit(edit), oriented = orientedSize({ width, height }, value);
  const crop = cropRectToPixels(oriented.width, oriented.height, value.crop);
  let factor = value.scale / 100;
  // A maximum edge is a reduction ceiling, never an implicit enlargement.
  if (value.maxEdge > 0) factor = Math.min(factor, 1, value.maxEdge / Math.max(crop.width, crop.height));
  if (maxPreview > 0) factor = Math.min(factor, 1, maxPreview / Math.max(crop.width, crop.height));
  return { width: Math.max(1, Math.round(crop.width * factor)), height: Math.max(1, Math.round(crop.height * factor)) };
}

export function skinWeight(r, g, b) {
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  return r > g && g > b && r > 70 && g > 35 && chroma > 12 && chroma < 155 ? Math.min(1, (r - b) / 100) : 0;
}

function pixel(r, g, b, a, value) {
  const skin = skinWeight(r, g, b), whiten = value.whiten / 100 * skin * 34;
  const lift = value.brightness * 1.7, contrast = (value.contrast + 100) / 100;
  r = (r + lift - 128) * contrast + 128;
  g = (g + lift - 128) * contrast + 128;
  b = (b + lift - 128) * contrast + 128;
  const luma = r * 0.299 + g * 0.587 + b * 0.114, saturation = (value.saturation + 100) / 100;
  r = luma + (r - luma) * saturation + value.warmth * 0.28 + whiten;
  g = luma + (g - luma) * saturation + whiten * 0.96;
  b = luma + (b - luma) * saturation - value.warmth * 0.28 + whiten * 0.9;
  if (value.effect === 'fresh') { g += 3; b += 7; }
  if (value.effect === 'warm') { r += 10; g += 3; b -= 8; }
  if (value.effect === 'mono') r = g = b = r * 0.299 + g * 0.587 + b * 0.114;
  if (value.effect === 'retro') { r = r * 0.92 + 12; g = g * 0.86 + 8; b = b * 0.72 + 5; }
  if (value.effect === 'soft') { r = r * 0.94 + 10; g = g * 0.94 + 10; b = b * 0.94 + 10; }
  return { r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255), a };
}

export const adjustPixel = (r, g, b, a, edit = {}) => pixel(r, g, b, a, normalizeEdit(edit));

/** A small skin-weighted bilateral filter: suppress local texture without blurring edges/backgrounds. */
export function processPixelBuffer(pixels, width, height, edit = {}) {
  const value = normalizeEdit(edit);
  const source = value.soften ? new Uint8ClampedArray(pixels) : pixels;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    let r = source[i], g = source[i + 1], b = source[i + 2];
    const blend = value.soften / 100 * skinWeight(r, g, b) * 0.7;
    if (blend > 0 && source[i + 3] > 0) {
      let sumR = 0, sumG = 0, sumB = 0, total = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
        const j = (yy * width + xx) * 4;
        if (!source[j + 3]) continue;
        const difference = Math.abs(source[j] - r) + Math.abs(source[j + 1] - g) + Math.abs(source[j + 2] - b);
        const weight = Math.max(0, 1 - difference / 65) * (dx || dy ? 1 : 2);
        sumR += source[j] * weight; sumG += source[j + 1] * weight; sumB += source[j + 2] * weight; total += weight;
      }
      if (total) { r += (sumR / total - r) * blend; g += (sumG / total - g) * blend; b += (sumB / total - b) * blend; }
    }
    const adjusted = pixel(r, g, b, source[i + 3], value);
    pixels[i] = adjusted.r; pixels[i + 1] = adjusted.g; pixels[i + 2] = adjusted.b;
    // Alpha is intentionally left unchanged.
  }
  return pixels;
}

function canvasOf(width, height) {
  if (width * height > 40_000_000 || width > 16384 || height > 16384) throw new Error('图片过大，请先缩小至 4000 万像素以内');
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  return canvas;
}

export async function renderImage(decoded, edit = {}, { preview = false, maxPreview = 1500, applyResize = true, applyCrop = true } = {}) {
  const value = normalizeEdit(edit);
  if (!applyCrop) value.crop = null;
  if (!applyResize) { value.scale = 100; value.maxEdge = 0; }
  const oriented = orientedSize(decoded, value), crop = cropRectToPixels(oriented.width, oriented.height, value.crop);
  const size = resizeDimensions(decoded.width, decoded.height, value, preview ? maxPreview : 0);
  const output = canvasOf(size.width, size.height), ctx = output.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('无法创建图片画布');
  ctx.imageSmoothingQuality = 'high';
  // Transform directly into the output; no full-resolution intermediate canvas.
  ctx.save();
  ctx.scale(size.width / crop.width, size.height / crop.height);
  ctx.translate(-crop.x, -crop.y);
  ctx.translate(oriented.width / 2, oriented.height / 2);
  if (value.flipX) ctx.scale(-1, 1);
  ctx.rotate(value.rotation * Math.PI / 180);
  ctx.drawImage(decoded.source, -decoded.width / 2, -decoded.height / 2, decoded.width, decoded.height);
  ctx.restore();
  if (value.brightness || value.contrast || value.saturation || value.warmth || value.whiten || value.soften || value.effect !== 'none') {
    const data = ctx.getImageData(0, 0, size.width, size.height);
    processPixelBuffer(data.data, size.width, size.height, value);
    ctx.putImageData(data, 0, 0);
  }
  return output;
}

export async function encodeCanvas(canvas, mime = 'image/jpeg', quality = 0.88) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) throw new Error('请选择 JPG、PNG 或 WebP 格式');
  let target = canvas;
  if (mime === 'image/jpeg') {
    target = canvasOf(canvas.width, canvas.height);
    const ctx = target.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, target.width, target.height); ctx.drawImage(canvas, 0, 0);
  }
  try {
    const blob = await new Promise((resolve) => target.toBlob(resolve, mime, clamp(quality, 0.1, 1)));
    if (!blob || blob.type !== mime) throw new Error('当前环境不支持该图片编码格式');
    return blob;
  } finally { if (target !== canvas) releaseCanvas(target); }
}

export function releaseCanvas(canvas) { if (canvas) { canvas.width = 0; canvas.height = 0; } }

const scriptLoads = new Map();
function loadScript(file) {
  const url = new URL(`./vendor/${file}`, import.meta.url).href;
  if (!scriptLoads.has(url)) scriptLoads.set(url, new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = url;
    script.onload = resolve; script.onerror = () => { scriptLoads.delete(url); script.remove(); reject(new Error('离线解码器加载失败，请重新安装插件')); };
    document.head.appendChild(script);
  }));
  return scriptLoads.get(url);
}

function checkSize(width, height) {
  if (!(width > 0 && height > 0) || width * height > 80_000_000 || Math.max(width, height) > 32768) throw new Error('图片尺寸过大或无效（最多支持 8000 万像素）');
}

export async function decodeImage(blob, name = '') {
  if (!blob?.size) throw new Error('图片文件为空');
  if (blob.size > 160 * 1024 * 1024) throw new Error('图片文件过大（最多支持 160 MB）');
  if (/\.(tif|tiff)$/i.test(name) || blob.type === 'image/tiff') {
    await loadScript('pako.min.js'); await loadScript('utif.js');
    const buffer = await blob.arrayBuffer(), pages = globalThis.UTIF.decode(buffer);
    const frame = pages.find((page) => page.t256 && page.t257);
    if (!frame) throw new Error('TIFF 中没有可读取的图像');
    checkSize(Number(frame.t256[0]), Number(frame.t257[0]));
    globalThis.UTIF.decodeImage(buffer, frame);
    const canvas = canvasOf(frame.width, frame.height);
    canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(globalThis.UTIF.toRGBA8(frame)), frame.width, frame.height), 0, 0);
    return { source: canvas, width: frame.width, height: frame.height, animated: false, pageCount: pages.length, dispose: () => releaseCanvas(canvas) };
  }
  if (/\.(heic|heif)$/i.test(name) || /image\/hei[cf]/.test(blob.type)) {
    await loadScript('heic2any.min.js');
    const result = await globalThis.heic2any({ blob, toType: 'image/png', multiple: false });
    return decodeImage(Array.isArray(result) ? result[0] : result, 'converted.png');
  }
  const url = URL.createObjectURL(blob), image = new Image();
  try {
    image.decoding = 'async'; image.src = url; await image.decode(); checkSize(image.naturalWidth, image.naturalHeight);
    return { source: image, url, width: image.naturalWidth, height: image.naturalHeight, animated: /\.(gif|apng|webp)$/i.test(name), dispose: () => { image.src = ''; URL.revokeObjectURL(url); } };
  } catch (error) { URL.revokeObjectURL(url); throw new Error(`图片无法解码：${error.message || error}`); }
}
