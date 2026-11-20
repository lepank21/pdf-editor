import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PageThumbnail } from '../types/pdf';

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

export async function compressPdf(
  bytes: Uint8Array,
  level: 'low' | 'medium' | 'high',
  onProgress?: (current: number, total: number) => void
): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const qualityMap = { low: 0.85, medium: 0.65, high: 0.40 };
  const scaleMap   = { low: 1.0,  medium: 0.9,  high: 0.75 };
  const quality = qualityMap[level];
  const scale   = scaleMap[level];

  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
  const srcDoc = await loadingTask.promise;
  const total  = srcDoc.numPages;
  const outDoc = await PDFDocument.create();

  for (let i = 1; i <= total; i++) {
    const page = await srcDoc.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas   = document.createElement('canvas');
    canvas.width   = Math.max(1, Math.floor(viewport.width));
    canvas.height  = Math.max(1, Math.floor(viewport.height));
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;

    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob((b) => res(b), 'image/jpeg', quality)
    );
    if (!blob) continue;
    const jpegBytes = new Uint8Array(await blob.arrayBuffer());
    const img = await outDoc.embedJpg(jpegBytes);

    // Keep original page dimensions in PDF points
    const origViewport = page.getViewport({ scale: 1.0 });
    const wPt = origViewport.width  * (72 / 96);
    const hPt = origViewport.height * (72 / 96);
    const outPage = outDoc.addPage([wPt, hPt]);
    outPage.drawImage(img, { x: 0, y: 0, width: wPt, height: hPt });
    onProgress?.(i, total);
  }

  await loadingTask.destroy();
  const outBytes = await outDoc.save();
  return { bytes: outBytes, pageCount: total };
}

export async function createSamplePdfBytes(variant: 'laporan' | 'lampiran' = 'laporan'): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);

  if (variant === 'laporan') {
    const pagesContent = [
      {
        title: 'RINGKASAN EKSEKUTIF PROYEK',
        subtitle: 'Dokumen Uji LembarPDF — Halaman 1 dari 3',
        body: [
          'Dokumen ini dibuat secara lokal di browser untuk menguji fitur pemisahan',
          'dan penggabungan dokumen PDF secara aman dan privat.',
          '',
          '1. Target Operasional',
          'Seluruh pemrosesan berkas dilakukan tanpa koneksi ke server eksternal,',
          'sehingga kerahasiaan data internal perusahaan tetap terjaga sepenuhnya.',
          '',
          '2. Indikator Kinerja Utama',
          '- Efisiensi waktu penyusunan dokumen meningkat hingga 64 persen.',
          '- Pengurangan ketergantungan pada aplikasi desktop berbayar.',
          '- Proses pengolahan 100% berlangsung di sisi peramban (client-side).',
        ],
      },
      {
        title: 'ANALISIS ANGGARAN & ALOKASI SUMBER DAYA',
        subtitle: 'Dokumen Uji LembarPDF — Halaman 2 dari 3',
        body: [
          'Bagian ini memuat rincian alokasi operasional untuk triwulan berjalan.',
          'Anda dapat mencoba memisahkan halaman ini menggunakan menu Pisah PDF.',
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
          'Dokumen contoh selesai.',
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
