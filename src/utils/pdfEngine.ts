import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import {
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  PageBreak,
  Paragraph,
  TextRun,
} from 'docx';
import html2canvas from 'html2canvas';
import type {
  EditorPageState,
  ExtractedBlock,
  ExtractedPageData,
  PageThumbnail,
} from '../types/pdf';
import type { DocumentBaseStyle, DocumentMarginsMm } from './docxParser';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  const value = bytes / Math.pow(k, i);
  return `${value.toLocaleString('id-ID', {
    minimumFractionDigits: i === 0 ? 0 : 1,
    maximumFractionDigits: i === 0 ? 0 : 2,
  })} ${sizes[i]}`;
}

export function triggerDownload(blob: Blob, filename: string): string {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  return url;
}

export function parsePageRanges(rangeStr: string, maxPage: number): number[] {
  const trimmed = rangeStr.trim();
  if (!trimmed) {
    return Array.from({ length: maxPage }, (_, i) => i + 1);
  }
  const result: number[] = [];
  const seen = new Set<number>();
  const parts = trimmed.split(',');

  for (const rawPart of parts) {
    const part = rawPart.trim();
    if (!part) continue;

    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-').map((s) => s.trim());
      const start = Number.parseInt(startStr, 10);
      const end = Number.parseInt(endStr, 10);
      if (Number.isNaN(start) || Number.isNaN(end)) continue;
      const clampedStart = Math.max(1, Math.min(maxPage, start));
      const clampedEnd = Math.max(1, Math.min(maxPage, end));
      const step = clampedStart <= clampedEnd ? 1 : -1;
      for (let p = clampedStart; step > 0 ? p <= clampedEnd : p >= clampedEnd; p += step) {
        if (!seen.has(p)) {
          seen.add(p);
          result.push(p);
        }
      }
    } else {
      const num = Number.parseInt(part, 10);
      if (!Number.isNaN(num) && num >= 1 && num <= maxPage && !seen.has(num)) {
        seen.add(num);
        result.push(num);
      }
    }
  }
  return result;
}

export function formatPageSelectionToRange(pages: number[]): string {
  if (pages.length === 0) return '';
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === prev + 1) {
      prev = sorted[i];
    } else {
      ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
      start = sorted[i];
      prev = sorted[i];
    }
  }
  ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
  return ranges.join(', ');
}

export async function loadPdfMetadata(bytes: Uint8Array): Promise<{
  pageCount: number;
  thumbnailUrl: string | null;
}> {
  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
  const doc = await loadingTask.promise;
  try {
    const pageCount = doc.numPages;
    let thumbnailUrl: string | null = null;
    if (pageCount > 0) {
      const page = await doc.getPage(1);
      const viewport = page.getViewport({ scale: 0.35 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const ctx = canvas.getContext('2d');
      if (ctx) {
        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
        thumbnailUrl = canvas.toDataURL('image/jpeg', 0.82);
      }
    }
    return { pageCount, thumbnailUrl };
  } finally {
    await loadingTask.destroy();
  }
}

export async function renderAllThumbnails(
  bytes: Uint8Array,
  scale = 0.4,
  onProgress?: (current: number, total: number) => void
): Promise<PageThumbnail[]> {
  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
  const doc = await loadingTask.promise;
  try {
    const total = doc.numPages;
    const thumbnails: PageThumbnail[] = [];

    for (let i = 1; i <= total; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      }
      thumbnails.push({
        pageNumber: i,
        width: viewport.width,
        height: viewport.height,
        dataUrl: canvas.toDataURL('image/jpeg', 0.85),
      });
      onProgress?.(i, total);
    }
    return thumbnails;
  } finally {
    await loadingTask.destroy();
  }
}

export async function renderSingleThumbnail(
  doc: pdfjsLib.PDFDocumentProxy,
  pageNumber: number,
  rotation = 0,
  scale = 0.28
): Promise<string> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale, rotation });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  }
  return canvas.toDataURL('image/jpeg', 0.85);
}

export async function mergePdfs(
  items: Array<{ bytes: Uint8Array; pageRange: string; pageCount: number }>
): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const merged = await PDFDocument.create();

  for (const item of items) {
    const src = await PDFDocument.load(item.bytes, { ignoreEncryption: true });
    const pagesToCopy = parsePageRanges(item.pageRange, src.getPageCount());
    if (pagesToCopy.length === 0) continue;
    const zeroBased = pagesToCopy.map((p) => p - 1);
    const copied = await merged.copyPages(src, zeroBased);
    for (const p of copied) {
      merged.addPage(p);
    }
  }

  const outBytes = await merged.save();
  return { bytes: outBytes, pageCount: merged.getPageCount() };
}

export async function splitPdfBySelection(
  bytes: Uint8Array,
  selectedPages: number[]
): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const validIndices = selectedPages
    .filter((p) => p >= 1 && p <= src.getPageCount())
    .map((p) => p - 1);

  if (validIndices.length === 0) {
    throw new Error('Tidak ada halaman valid yang dipilih untuk dipisahkan.');
  }

  const copied = await out.copyPages(src, validIndices);
  for (const p of copied) {
    out.addPage(p);
  }
  return await out.save();
}

export async function splitPdfIntoGroups(
  bytes: Uint8Array,
  groups: number[][],
  baseName: string
): Promise<Array<{ name: string; bytes: Uint8Array; pageCount: number }>> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const total = src.getPageCount();
  const results: Array<{ name: string; bytes: Uint8Array; pageCount: number }> = [];

  for (let i = 0; i < groups.length; i++) {
    const valid = groups[i].filter((p) => p >= 1 && p <= total).map((p) => p - 1);
    if (valid.length === 0) continue;
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, valid);
    for (const p of copied) {
      out.addPage(p);
    }
    const outBytes = await out.save();
    const label =
      groups[i].length === 1
        ? `hal-${groups[i][0]}`
        : `bagian-${i + 1}_hal-${groups[i][0]}-${groups[i][groups[i].length - 1]}`;
    results.push({
      name: `${baseName}_${label}.pdf`,
      bytes: outBytes,
      pageCount: copied.length,
    });
  }

  return results;
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Gagal memuat berkas gambar.'));
    img.src = src;
  });
}

async function normalizeImageToPngBytes(dataUrl: string): Promise<{
  pngBytes: Uint8Array;
  width: number;
  height: number;
}> {
  const img = await loadImageElement(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width || 1;
  canvas.height = img.naturalHeight || img.height || 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Kanvas browser tidak tersedia.');
  ctx.drawImage(img, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/png')
  );
  if (!blob) throw new Error('Gagal mengonversi gambar ke format PNG.');
  const buffer = await blob.arrayBuffer();
  return {
    pngBytes: new Uint8Array(buffer),
    width: canvas.width,
    height: canvas.height,
  };
}

export async function imagesToPdf(
  images: Array<{ dataUrl: string; width: number; height: number }>,
  options: {
    pageSize: 'fit' | 'a4' | 'letter';
    orientation: 'auto' | 'portrait' | 'landscape';
    marginMm: number;
  },
  onProgress?: (current: number, total: number) => void
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const mmToPt = 2.83465;
  const marginPt = options.marginMm * mmToPt;

  const A4_PORTRAIT: [number, number] = [595.28, 841.89];
  const LETTER_PORTRAIT: [number, number] = [612, 792];

  for (let i = 0; i < images.length; i++) {
    const item = images[i];
    const { pngBytes, width: imgW, height: imgH } = await normalizeImageToPngBytes(
      item.dataUrl
    );
    const embedded = await pdfDoc.embedPng(pngBytes);

    let pageW: number;
    let pageH: number;

    if (options.pageSize === 'fit') {
      const pxToPt = 0.75;
      pageW = imgW * pxToPt + marginPt * 2;
      pageH = imgH * pxToPt + marginPt * 2;
    } else {
      const base = options.pageSize === 'a4' ? A4_PORTRAIT : LETTER_PORTRAIT;
      const useLandscape =
        options.orientation === 'landscape' ||
        (options.orientation === 'auto' && imgW > imgH);
      pageW = useLandscape ? base[1] : base[0];
      pageH = useLandscape ? base[0] : base[1];
    }

    const page = pdfDoc.addPage([pageW, pageH]);
    const availW = Math.max(10, pageW - marginPt * 2);
    const availH = Math.max(10, pageH - marginPt * 2);
    const scale = Math.min(availW / imgW, availH / imgH);
    const drawW = imgW * scale;
    const drawH = imgH * scale;
    const x = (pageW - drawW) / 2;
    const y = (pageH - drawH) / 2;

    page.drawImage(embedded, { x, y, width: drawW, height: drawH });
    onProgress?.(i + 1, images.length);
  }

  return await pdfDoc.save();
}

export interface DocumentLayoutOptions {
  pageSize: 'a4' | 'letter';
  orientation: 'portrait' | 'landscape';
  marginMm: number;
  marginsMm?: DocumentMarginsMm;
  baseStyle?: DocumentBaseStyle;
}

export const DOCUMENT_FONT_LINKS_HTML = `
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Arimo:ital,wght@0,400;0,700;1,400;1,700&family=Caladea:ital,wght@0,400;0,700;1,400;1,700&family=Carlito:ital,wght@0,400;0,700;1,400;1,700&family=Cousine:ital,wght@0,400;0,700;1,400;1,700&family=EB+Garamond:ital,wght@0,400;0,700;1,400;1,700&family=Open+Sans:ital,wght@0,400;0,700;1,400;1,700&family=Tinos:ital,wght@0,400;0,700;1,400;1,700&display=swap" />
`;

export function getPaperMetrics(options: DocumentLayoutOptions) {
  const A4_PT: [number, number] = [595.28, 841.89];
  const LETTER_PT: [number, number] = [612, 792];
  const basePt = options.pageSize === 'a4' ? A4_PT : LETTER_PT;
  const pageWPt = options.orientation === 'landscape' ? basePt[1] : basePt[0];
  const pageHPt = options.orientation === 'landscape' ? basePt[0] : basePt[1];

  const ptToPx = 96 / 72; // 1.333333
  const mmToPt = 2.83465;

  const m = options.marginsMm ?? {
    top: options.marginMm,
    right: options.marginMm,
    bottom: options.marginMm,
    left: options.marginMm,
  };

  const marginTopPx = Math.round(m.top * mmToPt * ptToPx);
  const marginRightPx = Math.round(m.right * mmToPt * ptToPx);
  const marginBottomPx = Math.round(m.bottom * mmToPt * ptToPx);
  const marginLeftPx = Math.round(m.left * mmToPt * ptToPx);

  const pageWPx = Math.round(pageWPt * ptToPx);
  const pageHPx = Math.round(pageHPt * ptToPx);
  const contentWPx = Math.max(100, pageWPx - marginLeftPx - marginRightPx);
  const contentHPx = Math.max(100, pageHPx - marginTopPx - marginBottomPx);

  return {
    pageWPt,
    pageHPt,
    pageWPx,
    pageHPx,
    marginTopPx,
    marginRightPx,
    marginBottomPx,
    marginLeftPx,
    contentWPx,
    contentHPx,
  };
}

export function buildDocumentPrintCss(baseStyle?: DocumentBaseStyle): string {
  const fontFamily =
    baseStyle?.fontFamily ||
    '"Carlito", "Arimo", -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
  const fontSizePt = baseStyle?.fontSizePt ?? 11;
  const lineHeight = baseStyle?.lineHeight ?? '1.5';
  const paraBottomPt = baseStyle?.paraMarginBottomPt ?? 8;

  // When baseStyle comes from DOCX, inline styles carry exact heading sizes/margins;
  // avoid forcing opinionated heading/paragraph overrides.
  const headingRules = baseStyle
    ? `
  h1, h2, h3, h4, h5, h6 { margin: 0; padding: 0; font-size: inherit; font-weight: inherit; font-family: inherit; line-height: inherit; color: inherit; }
  p { margin: 0; padding: 0; }
`
    : `
  h1 { font-size: 18pt; font-weight: 700; margin: 0 0 10pt 0; color: #09090b; line-height: 1.25; }
  h2 { font-size: 14pt; font-weight: 700; margin: 14pt 0 6pt 0; color: #18181b; line-height: 1.3; }
  h3 { font-size: 12pt; font-weight: 600; margin: 10pt 0 4pt 0; color: #27272a; line-height: 1.35; }
  p { margin: 0 0 8pt 0; }
`;

  return `
  * { box-sizing: border-box; }
  h1, h2, h3, h4, h5, h6 { all: unset; display: block; box-sizing: border-box; }
  p { all: unset; display: block; box-sizing: border-box; }
  body {
    margin: 0;
    padding: 0;
    background: #ffffff;
    color: #000000;
    font-family: ${fontFamily};
    font-size: ${fontSizePt}pt;
    line-height: ${lineHeight};
    overflow-wrap: break-word;
    word-wrap: break-word;
  }
  ${headingRules}
  ul, ol { margin: 0 0 ${paraBottomPt}pt 0; padding-left: 20pt; }
  li { margin-bottom: 2pt; }
  table { width: 100%; max-width: 100%; border-collapse: collapse; margin: 6pt 0; font-size: inherit; font-family: inherit; }
  th, td { border: 1px solid #18181b; padding: 4pt 6pt; text-align: left; vertical-align: top; overflow-wrap: break-word; word-break: break-word; }
  th { background: #f4f4f5; font-weight: 700; }
  pre, code { font-family: "Courier New", "Cousine", monospace; background: #f4f4f5; padding: 2px 4px; border-radius: 3px; font-size: 9.5pt; }
  pre { padding: 8pt; overflow-x: auto; white-space: pre-wrap; }
  blockquote { margin: 8pt 0; padding-left: 10pt; border-left: 3px solid #d4d4d8; color: #52525b; }
  img { max-width: 100%; height: auto; }
  .docx-page-break { height: 0; margin: 0; padding: 0; }
`;
}

async function waitForDocReady(doc: globalThis.Document): Promise<void> {
  try {
    if (doc.fonts && doc.fonts.ready) {
      await Promise.race([
        doc.fonts.ready,
        new Promise((r) => setTimeout(r, 2500)),
      ]);
    }
  } catch {
    // ignore font loading timeout
  }
  const imgs = Array.from(doc.querySelectorAll('img'));
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve();
            return;
          }
          img.onload = () => resolve();
          img.onerror = () => resolve();
        })
    )
  );
}

export async function paginateHtmlToPageFragments(
  htmlContent: string,
  options: DocumentLayoutOptions
): Promise<string[]> {
  const metrics = getPaperMetrics(options);
  const printCss = buildDocumentPrintCss(options.baseStyle);

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.left = '-10000px';
  iframe.style.top = '0';
  iframe.style.width = `${metrics.contentWPx}px`;
  iframe.style.height = `${metrics.contentHPx}px`;
  iframe.style.border = '0';
  iframe.style.background = '#ffffff';
  document.body.appendChild(iframe);

  try {
    const doc = iframe.contentDocument;
    if (!doc) throw new Error('Gagal menyiapkan halaman pengukuran dokumen.');
    doc.open();
    doc.write(`<!doctype html>
<html>
<head><meta charset="utf-8" />${DOCUMENT_FONT_LINKS_HTML}<style>${printCss}</style></head>
<body>
  <div id="source-root" style="width:${metrics.contentWPx}px">${htmlContent}</div>
  <div id="page-probe" style="width:${metrics.contentWPx}px"></div>
</body>
</html>`);
    doc.close();

    await waitForDocReady(doc);
    await new Promise((r) => setTimeout(r, 80));

    const sourceRoot = doc.getElementById('source-root');
    const probe = doc.getElementById('page-probe');
    if (!sourceRoot || !probe) return [htmlContent];

    interface FlowUnit {
      kind: 'node' | 'break' | 'table-row' | 'list-item';
      html: string;
      listTag?: 'ul' | 'ol';
    }

    const units: FlowUnit[] = [];
    const childElements = Array.from(sourceRoot.children);

    for (const el of childElements) {
      if (el.classList.contains('docx-page-break')) {
        units.push({ kind: 'break', html: '' });
      } else if (el.tagName === 'TABLE') {
        const rows = Array.from(el.querySelectorAll(':scope > tbody > tr, :scope > tr'));
        if (rows.length > 1) {
          for (const tr of rows) {
            units.push({ kind: 'table-row', html: tr.outerHTML });
          }
        } else {
          units.push({ kind: 'node', html: el.outerHTML });
        }
      } else if (el.tagName === 'UL' || el.tagName === 'OL') {
        const items = Array.from(el.children);
        if (items.length > 1) {
          const listTag = el.tagName.toLowerCase() as 'ul' | 'ol';
          for (const li of items) {
            units.push({ kind: 'list-item', html: li.outerHTML, listTag });
          }
        } else {
          units.push({ kind: 'node', html: el.outerHTML });
        }
      } else {
        units.push({ kind: 'node', html: el.outerHTML });
      }
    }

    sourceRoot.style.display = 'none';

    const pages: string[] = [];
    let currentUnits: FlowUnit[] = [];

    const serializeUnits = (list: FlowUnit[]): string => {
      const parts: string[] = [];
      let i = 0;
      while (i < list.length) {
        const u = list[i];
        if (u.kind === 'table-row') {
          const rows: string[] = [];
          while (i < list.length && list[i].kind === 'table-row') {
            rows.push(list[i].html);
            i++;
          }
          parts.push(`<table style="width:100%;border-collapse:collapse;margin:6pt 0"><tbody>${rows.join('')}</tbody></table>`);
        } else if (u.kind === 'list-item') {
          const tag = u.listTag || 'ul';
          const items: string[] = [];
          while (i < list.length && list[i].kind === 'list-item' && list[i].listTag === tag) {
            items.push(list[i].html);
            i++;
          }
          parts.push(`<${tag}>${items.join('')}</${tag}>`);
        } else {
          parts.push(u.html);
          i++;
        }
      }
      return parts.join('\n');
    };

    for (const unit of units) {
      if (unit.kind === 'break') {
        if (currentUnits.length > 0) {
          pages.push(serializeUnits(currentUnits));
          currentUnits = [];
        } else {
          pages.push('<p>&nbsp;</p>');
        }
        continue;
      }

      const candidate = [...currentUnits, unit];
      probe.innerHTML = serializeUnits(candidate);
      const measuredHeight = probe.scrollHeight;

      if (measuredHeight > metrics.contentHPx && currentUnits.length > 0) {
        pages.push(serializeUnits(currentUnits));
        currentUnits = [unit];
      } else {
        currentUnits = candidate;
      }
    }

    if (currentUnits.length > 0) {
      pages.push(serializeUnits(currentUnits));
    }

    return pages.length > 0 ? pages : [htmlContent];
  } finally {
    document.body.removeChild(iframe);
  }
}

export async function htmlDocumentToPdf(
  htmlContent: string,
  options: DocumentLayoutOptions,
  onProgress?: (percent: number) => void,
  precomputedPages?: string[]
): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const metrics = getPaperMetrics(options);
  const printCss = buildDocumentPrintCss(options.baseStyle);
  onProgress?.(10);

  const pageFragments =
    precomputedPages && precomputedPages.length > 0
      ? precomputedPages
      : await paginateHtmlToPageFragments(htmlContent, options);

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.left = '-10000px';
  iframe.style.top = '0';
  iframe.style.width = `${metrics.pageWPx}px`;
  iframe.style.height = `${metrics.pageHPx}px`;
  iframe.style.border = '0';
  iframe.style.background = '#ffffff';
  document.body.appendChild(iframe);

  try {
    const doc = iframe.contentDocument;
    if (!doc) throw new Error('Gagal menyiapkan dokumen render.');
    doc.open();
    doc.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
${DOCUMENT_FONT_LINKS_HTML}
<style>
  ${printCss}
  html, body {
    width: ${metrics.pageWPx}px;
    height: ${metrics.pageHPx}px;
    overflow: hidden;
    background: #ffffff;
  }
  #sheet-root {
    width: ${metrics.pageWPx}px;
    height: ${metrics.pageHPx}px;
    padding: ${metrics.marginTopPx}px ${metrics.marginRightPx}px ${metrics.marginBottomPx}px ${metrics.marginLeftPx}px;
    background: #ffffff;
    overflow: hidden;
  }
</style>
</head>
<body><div id="sheet-root"></div></body>
</html>`);
    doc.close();

    const sheetRoot = doc.getElementById('sheet-root');
    if (!sheetRoot) throw new Error('Gagal menyiapkan lembar halaman.');

    await waitForDocReady(doc);

    const pdfDoc = await PDFDocument.create();

    for (let i = 0; i < pageFragments.length; i++) {
      sheetRoot.innerHTML = pageFragments[i];
      await waitForDocReady(doc);
      await new Promise((r) => setTimeout(r, 100));

      const pageCanvas = await html2canvas(sheetRoot, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
        width: metrics.pageWPx,
        height: metrics.pageHPx,
        windowWidth: metrics.pageWPx,
        windowHeight: metrics.pageHPx,
      });

      const blob = await new Promise<Blob | null>((res) =>
        pageCanvas.toBlob((b) => res(b), 'image/png')
      );
      if (blob) {
        const pngBytes = new Uint8Array(await blob.arrayBuffer());
        const embedded = await pdfDoc.embedPng(pngBytes);
        const pdfPage = pdfDoc.addPage([metrics.pageWPt, metrics.pageHPt]);
        pdfPage.drawImage(embedded, {
          x: 0,
          y: 0,
          width: metrics.pageWPt,
          height: metrics.pageHPt,
        });
      }

      const pct = Math.round(15 + ((i + 1) / pageFragments.length) * 80);
      onProgress?.(pct);
    }

    onProgress?.(98);
    const outBytes = await pdfDoc.save();
    return { bytes: outBytes, pageCount: pdfDoc.getPageCount() };
  } finally {
    document.body.removeChild(iframe);
  }
}

export async function extractPdfForWord(
  bytes: Uint8Array,
  onProgress?: (current: number, total: number) => void
): Promise<ExtractedPageData[]> {
  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
  const doc = await loadingTask.promise;
  try {
    const total = doc.numPages;
    const rawPages: Array<{
      pageNumber: number;
      lines: Array<{ y: number; text: string; fontSize: number }>;
      previewDataUrl: string;
      widthPt: number;
      heightPt: number;
    }> = [];

    const allFontSizes: number[] = [];

    for (let i = 1; i <= total; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent();

      const items = textContent.items.filter(
        (item): item is typeof item & { str: string; transform: number[]; height: number } =>
          'str' in item && typeof item.str === 'string' && item.str.trim().length > 0
      );

      // Group text items into horizontal lines
      const linesMap: Array<{
        y: number;
        parts: Array<{ x: number; str: string; fontSize: number }>;
      }> = [];

      for (const item of items) {
        const x = item.transform[4];
        const y = item.transform[5];
        const fontSize = Math.abs(item.transform[0]) || item.height || 11;
        allFontSizes.push(fontSize);

        const existingLine = linesMap.find((l) => Math.abs(l.y - y) <= Math.max(3, fontSize * 0.35));
        if (existingLine) {
          existingLine.parts.push({ x, str: item.str, fontSize });
        } else {
          linesMap.push({ y, parts: [{ x, str: item.str, fontSize }] });
        }
      }

      // Sort top-to-bottom (higher Y first in PDF coordinates)
      linesMap.sort((a, b) => b.y - a.y);

      const lines = linesMap.map((line) => {
        line.parts.sort((a, b) => a.x - b.x);
        const text = line.parts.map((p) => p.str).join(' ').replace(/\s+/g, ' ').trim();
        const avgFont =
          line.parts.reduce((acc, p) => acc + p.fontSize, 0) / Math.max(1, line.parts.length);
        return { y: line.y, text, fontSize: avgFont };
      });

      // Render crisp preview for visual mode and UI preview
      const previewScale = Math.min(1.5, 900 / Math.max(1, viewport.width));
      const previewViewport = page.getViewport({ scale: previewScale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(previewViewport.width));
      canvas.height = Math.max(1, Math.floor(previewViewport.height));
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: previewViewport, canvas }).promise;
      }

      rawPages.push({
        pageNumber: i,
        lines,
        previewDataUrl: canvas.toDataURL('image/png'),
        widthPt: viewport.width,
        heightPt: viewport.height,
      });
      onProgress?.(i, total);
    }

    // Determine median body font size across entire PDF
    allFontSizes.sort((a, b) => a - b);
    const medianFont =
      allFontSizes.length > 0 ? allFontSizes[Math.floor(allFontSizes.length / 2)] : 11;

    return rawPages.map((p) => {
      const blocks: ExtractedBlock[] = [];
      let currentParagraph = '';
      let prevY: number | null = null;

      const flushParagraph = () => {
        if (currentParagraph.trim()) {
          blocks.push({ kind: 'paragraph', text: currentParagraph.trim() });
          currentParagraph = '';
        }
      };

      for (const line of p.lines) {
        if (!line.text) continue;
        const isH1 = line.fontSize >= medianFont * 1.45 && line.text.length < 140;
        const isH2 = !isH1 && line.fontSize >= medianFont * 1.2 && line.text.length < 140;

        if (isH1 || isH2) {
          flushParagraph();
          blocks.push({ kind: isH1 ? 'heading1' : 'heading2', text: line.text });
          prevY = line.y;
          continue;
        }

        const gap = prevY !== null ? prevY - line.y : 0;
        if (prevY !== null && gap > line.fontSize * 1.85) {
          flushParagraph();
        }
        currentParagraph = currentParagraph ? `${currentParagraph} ${line.text}` : line.text;
        prevY = line.y;
      }
      flushParagraph();

      return {
        pageNumber: p.pageNumber,
        blocks,
        rawText: blocks.map((b) => b.text).join('\n\n'),
        previewDataUrl: p.previewDataUrl,
        widthPt: p.widthPt,
        heightPt: p.heightPt,
      };
    });
  } finally {
    await loadingTask.destroy();
  }
}

export async function buildDocxFromPdf(
  pages: ExtractedPageData[],
  mode: 'structured' | 'visual',
  editedTexts?: Record<number, string>
): Promise<Blob> {
  const children: Paragraph[] = [];

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];

    if (mode === 'visual') {
      const res = await fetch(page.previewDataUrl);
      const buffer = await res.arrayBuffer();
      const maxWidthPx = 600;
      const aspect = page.heightPt / Math.max(1, page.widthPt);
      const targetWidth = maxWidthPx;
      const targetHeight = Math.round(maxWidthPx * aspect);

      children.push(
        new Paragraph({
          children: [
            new ImageRun({
              type: 'png',
              data: new Uint8Array(buffer),
              transformation: {
                width: targetWidth,
                height: targetHeight,
              },
            }),
          ],
          spacing: { after: 120 },
        })
      );
    } else {
      const overrideText = editedTexts?.[page.pageNumber];
      if (overrideText !== undefined) {
        const paragraphs = overrideText.split(/\n{2,}/).filter((s) => s.trim().length > 0);
        if (paragraphs.length === 0) {
          children.push(new Paragraph({ children: [new TextRun('')] }));
        } else {
          for (const para of paragraphs) {
            children.push(
              new Paragraph({
                children: [new TextRun({ text: para.trim(), size: 22 })],
                spacing: { after: 160, line: 276 },
              })
            );
          }
        }
      } else if (page.blocks.length === 0) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `[Halaman ${page.pageNumber} tidak mengandung teks yang dapat diekstrak]`,
                italics: true,
                color: '71717A',
              }),
            ],
          })
        );
      } else {
        for (const block of page.blocks) {
          if (block.kind === 'heading1') {
            children.push(
              new Paragraph({
                text: block.text,
                heading: HeadingLevel.HEADING_1,
                spacing: { before: 200, after: 120 },
              })
            );
          } else if (block.kind === 'heading2') {
            children.push(
              new Paragraph({
                text: block.text,
                heading: HeadingLevel.HEADING_2,
                spacing: { before: 160, after: 100 },
              })
            );
          } else {
            children.push(
              new Paragraph({
                children: [new TextRun({ text: block.text, size: 22 })],
                spacing: { after: 160, line: 276 },
              })
            );
          }
        }
      }
    }

    if (i < pages.length - 1) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  return await Packer.toBlob(doc);
}

function hexToRgb(hex: string) {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0');
  const num = Number.parseInt(full, 16);
  return rgb(((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255);
}

function isWinAnsiSafe(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 255 && code !== 8211 && code !== 8212 && code !== 8216 && code !== 8217 && code !== 8220 && code !== 8221) {
      return false;
    }
  }
  return true;
}

async function renderTextToPngBytes(
  text: string,
  fontSizePt: number,
  colorHex: string,
  bold: boolean,
  italic: boolean,
  maxWidthPt: number
): Promise<{ pngBytes: Uint8Array; widthPt: number; heightPt: number }> {
  const scale = 3;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Kanvas tidak tersedia.');

  const fontSpec = `${italic ? 'italic ' : ''}${bold ? '700 ' : '400 '}${fontSizePt * scale}px "Plus Jakarta Sans", sans-serif`;
  ctx.font = fontSpec;
  const lines = text.split('\n');
  const lineHeightPx = fontSizePt * scale * 1.25;
  const maxWidthPx = Math.max(40, maxWidthPt * scale);

  canvas.width = Math.ceil(maxWidthPx);
  canvas.height = Math.ceil(Math.max(1, lines.length) * lineHeightPx + 8 * scale);

  ctx.font = fontSpec;
  ctx.fillStyle = colorHex;
  ctx.textBaseline = 'top';

  lines.forEach((line, idx) => {
    ctx.fillText(line, 0, idx * lineHeightPx, maxWidthPx);
  });

  const blob = await new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), 'image/png'));
  if (!blob) throw new Error('Gagal merender teks.');
  return {
    pngBytes: new Uint8Array(await blob.arrayBuffer()),
    widthPt: canvas.width / scale,
    heightPt: canvas.height / scale,
  };
}

export async function exportEditedPdf(
  sourceBytes: Uint8Array,
  editorPages: EditorPageState[]
): Promise<Uint8Array> {
  const srcDoc = await PDFDocument.load(sourceBytes, { ignoreEncryption: true });
  const outDoc = await PDFDocument.create();

  const fontRegular = await outDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await outDoc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await outDoc.embedFont(StandardFonts.HelveticaOblique);
  const fontBoldItalic = await outDoc.embedFont(StandardFonts.HelveticaBoldOblique);

  for (const pageState of editorPages) {
    const srcPage = srcDoc.getPage(pageState.sourcePageIndex);
    const origRotation = ((srcPage.getRotation().angle % 360) + 360) % 360;
    const totalCwRotation = (origRotation + pageState.rotation) % 360;

    const { width: rawW, height: rawH } = srcPage.getSize();
    const embeddedPage = await outDoc.embedPage(srcPage);

    const swapDims = totalCwRotation === 90 || totalCwRotation === 270;
    const targetW = swapDims ? rawH : rawW;
    const targetH = swapDims ? rawW : rawH;

    const outPage = outDoc.addPage([targetW, targetH]);

    if (totalCwRotation === 0) {
      outPage.drawPage(embeddedPage, { x: 0, y: 0, rotate: degrees(0) });
    } else if (totalCwRotation === 90) {
      outPage.drawPage(embeddedPage, { x: 0, y: rawW, rotate: degrees(-90) });
    } else if (totalCwRotation === 180) {
      outPage.drawPage(embeddedPage, { x: rawW, y: rawH, rotate: degrees(180) });
    } else if (totalCwRotation === 270) {
      outPage.drawPage(embeddedPage, { x: rawH, y: 0, rotate: degrees(90) });
    }

    // Scale factor relative to a standard 595pt reference width so font & stroke match UI preview
    const ptScale = targetW / 595;

    for (const el of pageState.elements) {
      if (el.type === 'rect') {
        const rx = el.x * targetW;
        const rw = el.width * targetW;
        const rh = el.height * targetH;
        const ry = targetH - el.y * targetH - rh;
        const effectiveFillOpacity =
          el.fillColor !== 'transparent'
            ? (el.fillOpacity ?? (el.isWhiteout ? 1 : el.opacity * 0.25))
            : 0;
        outPage.drawRectangle({
          x: rx,
          y: ry,
          width: rw,
          height: rh,
          borderColor: el.strokeColor !== 'transparent' ? hexToRgb(el.strokeColor) : undefined,
          borderWidth: el.strokeWidth * ptScale,
          borderOpacity: el.opacity,
          color: el.fillColor !== 'transparent' ? hexToRgb(el.fillColor) : undefined,
          opacity: effectiveFillOpacity,
        });
      } else if (el.type === 'path') {
        if (el.points.length < 2) continue;
        const strokeColor = hexToRgb(el.color);
        const thickness = Math.max(0.75, el.strokeWidth * ptScale);
        for (let i = 1; i < el.points.length; i++) {
          const p1 = el.points[i - 1];
          const p2 = el.points[i];
          outPage.drawLine({
            start: { x: p1.x * targetW, y: targetH - p1.y * targetH },
            end: { x: p2.x * targetW, y: targetH - p2.y * targetH },
            thickness,
            color: strokeColor,
            opacity: el.opacity,
          });
        }
      } else if (el.type === 'image' || el.type === 'signature') {
        const { pngBytes } = await normalizeImageToPngBytes(el.dataUrl);
        const embeddedImg = await outDoc.embedPng(pngBytes);
        const ix = el.x * targetW;
        const iw = el.width * targetW;
        const ih = el.height * targetH;
        const iy = targetH - el.y * targetH - ih;
        outPage.drawImage(embeddedImg, { x: ix, y: iy, width: iw, height: ih });
      } else if (el.type === 'text') {
        if (!el.text.trim()) continue;
        const fontSizePt = el.fontSize * ptScale;
        const tx = el.x * targetW;
        const tyTop = targetH - el.y * targetH;
        const boxWidthPt = el.width * targetW;

        if (isWinAnsiSafe(el.text)) {
          const chosenFont =
            el.bold && el.italic
              ? fontBoldItalic
              : el.bold
                ? fontBold
                : el.italic
                  ? fontItalic
                  : fontRegular;
          const lines = el.text.split('\n');
          const lineH = fontSizePt * 1.25;
          lines.forEach((line, idx) => {
            outPage.drawText(line, {
              x: tx,
              y: tyTop - fontSizePt * 0.9 - idx * lineH,
              size: fontSizePt,
              font: chosenFont,
              color: hexToRgb(el.color),
              maxWidth: boxWidthPt,
              lineHeight: lineH,
            });
          });
        } else {
          const rendered = await renderTextToPngBytes(
            el.text,
            fontSizePt,
            el.color,
            el.bold,
            el.italic,
            boxWidthPt
          );
          const embeddedTextImg = await outDoc.embedPng(rendered.pngBytes);
          outPage.drawImage(embeddedTextImg, {
            x: tx,
            y: tyTop - rendered.heightPt,
            width: rendered.widthPt,
            height: rendered.heightPt,
          });
        }
      }
    }
  }

  return await outDoc.save();
}

export async function createSamplePdfBytes(variant: 'laporan' | 'lampiran' = 'laporan'): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);

  if (variant === 'laporan') {
    const pagesContent = [
      {
        title: 'RINGKASAN EKSEKUTIF PROYEK Q4',
        subtitle: 'Dokumen Uji LembarPDF — Halaman 1 dari 3',
        body: [
          'Dokumen ini dibuat secara lokal di browser untuk menguji fitur pemisahan,',
          'penggabungan, konversi ke Microsoft Word (.docx), serta penyuntingan PDF.',
          '',
          '1. Target Operasional',
          'Seluruh pemrosesan berkas dilakukan tanpa koneksi ke server eksternal,',
          'sehingga kerahasiaan data internal perusahaan tetap terjaga sepenuhnya.',
          '',
          '2. Indikator Kinerja Utama',
          '- Efisiensi waktu penyusunan dokumen meningkat hingga 64 persen.',
          '- Pengurangan ketergantungan pada aplikasi desktop berbayar.',
          '- Dukungan penuh format gambar, teks, tanda tangan, dan anotasi.',
        ],
      },
      {
        title: 'ANALISIS ANGGARAN & ALOKASI SUMBER DAYA',
        subtitle: 'Dokumen Uji LembarPDF — Halaman 2 dari 3',
        body: [
          'Bagian ini memuat rincian alokasi operasional untuk triwulan berjalan.',
          'Anda dapat mencoba menghapus, memutar, atau menambahkan tanda tangan',
          'pada area kosong di bagian bawah halaman ini menggunakan Edit PDF.',
          '',
          'Ringkasan Pos Pengeluaran:',
          '- Infrastruktur Pengembangan Lokal : Rp 12.500.000',
          '- Pengadaan Perangkat Uji Dokumen  : Rp  8.200.000',
          '- Pelatihan Staf Administrasi      : Rp  4.800.000',
        ],
      },
      {
        title: 'LEMBAR PENGESAHAN & CATATAN AKHIR',
        subtitle: 'Dokumen Uji LembarPDF — Halaman 3 dari 3',
        body: [
          'Silakan bubuhkan tanda tangan digital atau coretan stabilo di bawah ini.',
          '',
          'Disetujui oleh,',
          '',
          '',
          '_______________________________',
          'Kepala Divisi Operasional',
        ],
      },
    ];

    for (const p of pagesContent) {
      const page = doc.addPage([595.28, 841.89]);
      page.drawRectangle({
        x: 48,
        y: 760,
        width: 499,
        height: 2,
        color: rgb(0.145, 0.388, 0.922),
      });
      page.drawText(p.title, { x: 48, y: 780, size: 16, font: bold, color: rgb(0.09, 0.09, 0.11) });
      page.drawText(p.subtitle, { x: 48, y: 740, size: 10, font: regular, color: rgb(0.45, 0.45, 0.5) });

      let y = 700;
      for (const line of p.body) {
        if (line.trim()) {
          page.drawText(line, { x: 48, y, size: 11.5, font: regular, color: rgb(0.15, 0.15, 0.18) });
        }
        y -= 20;
      }
    }
  } else {
    const page = doc.addPage([595.28, 841.89]);
    page.drawText('LAMPIRAN TEKNIS PENDUKUNG', {
      x: 48,
      y: 780,
      size: 16,
      font: bold,
      color: rgb(0.09, 0.09, 0.11),
    });
    page.drawText('Berkas kedua untuk simulasi Gabung PDF (Merge).', {
      x: 48,
      y: 748,
      size: 11,
      font: regular,
      color: rgb(0.32, 0.32, 0.36),
    });
    page.drawRectangle({
      x: 48,
      y: 620,
      width: 499,
      height: 100,
      borderColor: rgb(0.83, 0.83, 0.85),
      borderWidth: 1,
      color: rgb(0.98, 0.98, 0.99),
    });
    page.drawText('Catatan Lampiran: Dokumen ini siap digabungkan dengan berkas utama.', {
      x: 64,
      y: 665,
      size: 11,
      font: regular,
      color: rgb(0.15, 0.15, 0.18),
    });
  }

  return await doc.save();
}
