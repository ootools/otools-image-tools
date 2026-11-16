const encoder = new TextEncoder();

function bytes(value) {
  return typeof value === 'string' ? encoder.encode(value) : value;
}

function concat(chunks) {
  const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/** Build a compact, dependency-free PDF. Each image is { width, height, jpeg: Uint8Array }. */
export function buildPdf(images, pageMode = 'a4', orientation = 'portrait') {
  if (!Array.isArray(images) || images.length === 0) throw new Error('至少需要一张图片');
  const objects = new Map();
  const imageIds = images.map((_, index) => 3 + index);
  const contentIds = images.map((_, index) => 3 + images.length + index * 2);
  const pageIds = images.map((_, index) => 4 + images.length + index * 2);
  const pagesId = 2;
  const catalogId = 1;
  const kids = pageIds.map((id) => `${id} 0 R`).join(' ');
  objects.set(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  objects.set(pagesId, `<< /Type /Pages /Kids [${kids}] /Count ${images.length} >>`);

  const a4 = { width: 595.28, height: 841.89 };
  images.forEach((image, index) => {
    const width = Math.trunc(image.width);
    const height = Math.trunc(image.height);
    if (!(Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)) throw new Error(`第 ${index + 1} 张图片尺寸无效`);
    const jpeg = image.jpeg instanceof Uint8Array ? image.jpeg : new Uint8Array(image.jpeg);
    if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error(`第 ${index + 1} 张图片不是有效的 JPG 数据`);
    objects.set(imageIds[index], {
      prefix: `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      stream: jpeg,
    });

    const pageScale = Math.min(1, 1440 / Math.max(width, height));
    let pageWidth = pageMode === 'image' ? width * pageScale : a4.width;
    let pageHeight = pageMode === 'image' ? height * pageScale : a4.height;
    if (pageMode === 'a4') {
      const landscape = orientation === 'landscape' || (orientation === 'portrait' && width > height);
      if (landscape && pageHeight > pageWidth) [pageWidth, pageHeight] = [pageHeight, pageWidth];
      if (!landscape && pageWidth > pageHeight) [pageWidth, pageHeight] = [pageHeight, pageWidth];
    }
    const margin = pageMode === 'image' ? 0 : 28;
    const scale = Math.min((pageWidth - 2 * margin) / width, (pageHeight - 2 * margin) / height);
    const drawWidth = width * scale;
    const drawHeight = height * scale;
    const x = (pageWidth - drawWidth) / 2;
    const y = (pageHeight - drawHeight) / 2;
    const content = encoder.encode(`q\n${drawWidth.toFixed(2)} 0 0 ${drawHeight.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm\n/Im${index + 1} Do\nQ\n`);
    objects.set(contentIds[index], {
      prefix: `<< /Length ${content.length} >>\nstream\n`,
      stream: content,
    });
    objects.set(pageIds[index], `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}] /Resources << /XObject << /Im${index + 1} ${imageIds[index]} 0 R >> >> /Contents ${contentIds[index]} 0 R >>`);
  });

  const maxId = Math.max(...objects.keys());
  const chunks = [];
  let length = 0;
  const push = (value) => {
    const chunk = bytes(value);
    chunks.push(chunk);
    length += chunk.length;
  };
  push('%PDF-1.4\n');
  push(Uint8Array.of(0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a));
  const offsets = new Array(maxId + 1).fill(0);
  for (let id = 1; id <= maxId; id += 1) {
    const body = objects.get(id);
    if (!body) throw new Error(`PDF 对象缺失：${id}`);
    offsets[id] = length;
    push(`${id} 0 obj\n`);
    if (typeof body === 'object') {
      push(body.prefix);
      push(body.stream);
      push('\nendstream\n');
    } else {
      push(`${body}\n`);
    }
    push('endobj\n');
  }
  const xrefOffset = length;
  push(`xref\n0 ${maxId + 1}\n0000000000 65535 f \n`);
  for (let id = 1; id <= maxId; id += 1) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${maxId + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  return concat(chunks);
}

export function getResizedDimensions(width, height, maxEdge = 0, scale = 1) {
  if (!(width > 0) || !(height > 0)) throw new Error('图片尺寸无效');
  let factor = Math.max(0.01, Number(scale) || 1);
  const edge = Number(maxEdge) || 0;
  if (edge > 0) factor = Math.min(factor, edge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * factor)), height: Math.max(1, Math.round(height * factor)) };
}

export function cropToPixels(width, height, crop) {
  const x = Math.max(0, Math.min(width - 1, Math.round(crop.x * width)));
  const y = Math.max(0, Math.min(height - 1, Math.round(crop.y * height)));
  const right = Math.max(x + 1, Math.min(width, Math.round((crop.x + crop.w) * width)));
  const bottom = Math.max(y + 1, Math.min(height, Math.round((crop.y + crop.h) * height)));
  return { x, y, width: right - x, height: bottom - y };
}
