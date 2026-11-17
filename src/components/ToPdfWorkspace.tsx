import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  ArrowDown,
  Trash2,
  Plus,
  Download,
  AlertCircle,
  Loader2,
  FileCheck2,
  Image as ImageIcon,
  FileText,
} from 'lucide-react';
import type { SessionExportItem } from '../types/pdf';
import {
  buildDocumentPrintCss,
  DOCUMENT_FONT_LINKS_HTML,
  formatBytes,
  getPaperMetrics,
  htmlDocumentToPdf,
  imagesToPdf,
  paginateHtmlToPageFragments,
  triggerDownload,
} from '../utils/pdfEngine';
import {
  parseDocxToHtml,
  type DocumentBaseStyle,
  type DocumentMarginsMm,
} from '../utils/docxParser';
import { FileDropzone } from './FileDropzone';

interface ToPdfWorkspaceProps {
  onExported: (item: SessionExportItem) => void;
}

type ConvertMode = 'images' | 'document';

interface ImageItem {
  id: string;
  name: string;
  sizeBytes: number;
  dataUrl: string;
  width: number;
  height: number;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function simpleMarkdownToHtml(md: string): string {
  const lines = md.split(/\r?\n/);
  const htmlParts: string[] = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      htmlParts.push('</ul>');
      inList = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      closeList();
      continue;
    }
    if (line.startsWith('### ')) {
      closeList();
      htmlParts.push(`<h3>${escapeHtml(line.slice(4))}</h3>`);
    } else if (line.startsWith('## ')) {
      closeList();
      htmlParts.push(`<h2>${escapeHtml(line.slice(3))}</h2>`);
    } else if (line.startsWith('# ')) {
      closeList();
      htmlParts.push(`<h1>${escapeHtml(line.slice(2))}</h1>`);
    } else if (/^[-*]\s+/.test(line)) {
      if (!inList) {
        htmlParts.push('<ul>');
        inList = true;
      }
      htmlParts.push(`<li>${escapeHtml(line.replace(/^[-*]\s+/, ''))}</li>`);
    } else {
      closeList();
      const formatted = escapeHtml(line).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      htmlParts.push(`<p>${formatted}</p>`);
    }
  }
  closeList();
  return htmlParts.join('\n');
}

export function ToPdfWorkspace({ onExported }: ToPdfWorkspaceProps) {
  const [mode, setMode] = useState<ConvertMode>('images');

  // Image mode state
  const [images, setImages] = useState<ImageItem[]>([]);
  const [imgPageSize, setImgPageSize] = useState<'fit' | 'a4' | 'letter'>('a4');
  const [imgOrientation, setImgOrientation] = useState<'auto' | 'portrait' | 'landscape'>('auto');
  const [marginMm, setMarginMm] = useState<number>(10);

  // Document mode state
  const [docSource, setDocSource] = useState<{
    name: string;
    sizeBytes: number;
    kind: string;
    html: string;
    marginsMm?: DocumentMarginsMm;
    baseStyle?: DocumentBaseStyle;
  } | null>(null);
  const [docPageSize, setDocPageSize] = useState<'a4' | 'letter'>('a4');
  const [docOrientation, setDocOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [useDocMargins, setUseDocMargins] = useState<boolean>(true);
  const [paginatedPages, setPaginatedPages] = useState<string[]>([]);
  const [isPaginating, setIsPaginating] = useState(false);

  const [outputName, setOutputName] = useState('hasil-konversi');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<{
    filename: string;
    pageCount: number;
    sizeBytes: number;
    url: string;
  } | null>(null);

  const addImageInputRef = useRef<HTMLInputElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const [previewContainerWidth, setPreviewContainerWidth] = useState<number>(640);

  const activeDocMargins =
    useDocMargins && docSource?.marginsMm ? docSource.marginsMm : undefined;

  useEffect(() => {
    const el = previewContainerRef.current;
    if (!el) return;
    const updateWidth = () => {
      if (el.clientWidth > 0) {
        setPreviewContainerWidth(el.clientWidth);
      }
    };
    updateWidth();
    const ro = new ResizeObserver(() => updateWidth());
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode, docSource]);

  useEffect(() => {
    let cancelled = false;
    if (!docSource) {
      setPaginatedPages([]);
      return;
    }
    setIsPaginating(true);
    paginateHtmlToPageFragments(docSource.html, {
      pageSize: docPageSize,
      orientation: docOrientation,
      marginMm,
      marginsMm: activeDocMargins,
      baseStyle: docSource.baseStyle,
    })
      .then((pages) => {
        if (!cancelled) setPaginatedPages(pages);
      })
      .catch(() => {
        if (!cancelled) setPaginatedPages([docSource.html]);
      })
      .finally(() => {
        if (!cancelled) setIsPaginating(false);
      });

    return () => {
      cancelled = true;
    };
  }, [docSource, docPageSize, docOrientation, marginMm, useDocMargins]);

  const readImageDimensions = (file: File): Promise<ImageItem> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        if (typeof dataUrl !== 'string') {
          reject(new Error('Gagal membaca gambar.'));
          return;
        }
        const img = new Image();
        img.onload = () => {
          resolve({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name: file.name,
            sizeBytes: file.size,
            dataUrl,
            width: img.naturalWidth || img.width,
            height: img.naturalHeight || img.height,
          });
        };
        img.onerror = () => reject(new Error(`Gambar "${file.name}" tidak valid.`));
        img.src = dataUrl;
      };
      reader.onerror = () => reject(new Error(`Gagal membaca berkas "${file.name}".`));
      reader.readAsDataURL(file);
    });

  const handleImagesSelected = async (files: File[]) => {
    setErrorMsg(null);
    setSuccessInfo(null);
    const valid: ImageItem[] = [];
    for (const f of files) {
      if (!f.type.startsWith('image/')) {
        setErrorMsg(`Berkas "${f.name}" bukan gambar (PNG, JPG, WebP).`);
        continue;
      }
      try {
        valid.push(await readImageDimensions(f));
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Gagal memuat gambar.');
      }
    }
    if (valid.length > 0) {
      setImages((prev) => [...prev, ...valid]);
      if (images.length === 0) {
        setOutputName(valid[0].name.replace(/\.[^.]+$/, ''));
      }
    }
  };

  const handleLoadSampleImages = async () => {
    setErrorMsg(null);
    setSuccessInfo(null);
    const makeCanvasImage = (title: string, accent: string, name: string): ImageItem => {
      const c = document.createElement('canvas');
      c.width = 900;
      c.height = 1200;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = accent;
      ctx.fillRect(60, 80, 780, 12);
      ctx.fillStyle = '#18181b';
      ctx.font = 'bold 36px sans-serif';
      ctx.fillText(title, 60, 160);
      ctx.fillStyle = '#52525b';
      ctx.font = '22px sans-serif';
      ctx.fillText('Lampiran visual contoh untuk konversi Gambar ke PDF.', 60, 210);
      ctx.strokeStyle = '#d4d4d8';
      ctx.lineWidth = 2;
      ctx.strokeRect(60, 270, 780, 640);
      ctx.fillStyle = '#f4f4f5';
      ctx.fillRect(62, 272, 776, 636);
      ctx.fillStyle = '#3f3f46';
      ctx.font = '20px monospace';
      ctx.fillText('900 x 1200 px · Rasio 3:4', 310, 590);
      return {
        id: `sample-${Date.now()}-${name}`,
        name,
        sizeBytes: 42000,
        dataUrl: c.toDataURL('image/png'),
        width: 900,
        height: 1200,
      };
    };

    setImages([
      makeCanvasImage('HALAMAN FOTO 01', '#2563eb', 'Halaman_Foto_01.png'),
      makeCanvasImage('HALAMAN FOTO 02', '#0f766e', 'Halaman_Foto_02.png'),
    ]);
    setOutputName('kumpulan-gambar');
  };

  const handleDocumentSelected = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setErrorMsg(null);
    setSuccessInfo(null);
    setIsProcessing(true);
    setProgressText('Membaca isi dokumen...');

    try {
      const lower = file.name.toLowerCase();
      let html = '';
      let kind = 'Dokumen';

      let parsedMargins: DocumentMarginsMm | undefined;
      let parsedBaseStyle: DocumentBaseStyle | undefined;

      if (lower.endsWith('.docx')) {
        kind = 'Word (.docx)';
        const buffer = await file.arrayBuffer();
        const parsed = await parseDocxToHtml(buffer);
        html = parsed.html || '<p>(Dokumen Word kosong)</p>';
        if (parsed.pageSize) setDocPageSize(parsed.pageSize);
        if (parsed.orientation) setDocOrientation(parsed.orientation);
        parsedMargins = parsed.marginsMm;
        parsedBaseStyle = parsed.baseStyle;
        setUseDocMargins(Boolean(parsed.marginsMm));
      } else if (lower.endsWith('.md')) {
        kind = 'Markdown (.md)';
        const text = await file.text();
        html = simpleMarkdownToHtml(text);
        setUseDocMargins(false);
      } else if (lower.endsWith('.html') || lower.endsWith('.htm')) {
        kind = 'HTML';
        const raw = await file.text();
        const bodyMatch = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        html = bodyMatch ? bodyMatch[1] : raw;
        setUseDocMargins(false);
      } else if (lower.endsWith('.txt')) {
        kind = 'Teks Polos (.txt)';
        const text = await file.text();
        html = text
          .split(/\r?\n\r?\n/)
          .map((p) => `<p>${escapeHtml(p).replace(/\r?\n/g, '<br/>')}</p>`)
          .join('\n');
        setUseDocMargins(false);
      } else {
        setErrorMsg('Format belum didukung. Gunakan berkas .docx, .txt, .md, atau .html.');
        return;
      }

      setDocSource({
        name: file.name,
        sizeBytes: file.size,
        kind,
        html,
        marginsMm: parsedMargins,
        baseStyle: parsedBaseStyle,
      });
      setOutputName(file.name.replace(/\.[^.]+$/, ''));
    } catch {
      setErrorMsg('Gagal memproses berkas dokumen. Pastikan berkas .docx atau teks tidak rusak.');
    } finally {
      setIsProcessing(false);
      setProgressText(null);
    }
  };

  const handleLoadSampleDocument = () => {
    setErrorMsg(null);
    setSuccessInfo(null);
    setUseDocMargins(false);
    const sampleMd = `# Nota Dinas Operasional Mingguan

**Nomor**: 042/ND-OPS/XI/2026
**Kepada**: Seluruh Koordinator Unit

## 1. Ringkasan Aktivitas
Seluruh alur digitalisasi arsip dan pengolahan dokumen internal kini berjalan menggunakan workspace lokal di browser untuk menjaga keamanan data.

## 2. Daftar Tindak Lanjut
- Menggabungkan berkas lampiran kontrak ke dalam satu dokumen induk.
- Memisahkan lembar persetujuan halaman 3 untuk tanda tangan digital.
- Mengarsipkan salinan PDF berformat A4 secara berkala setiap Jumat.

Silakan lakukan peninjauan sebelum dokumen ini dikonversi menjadi PDF.`;

    setDocSource({
      name: 'Nota_Dinas_Operasional.md',
      sizeBytes: sampleMd.length,
      kind: 'Markdown (.md)',
      html: simpleMarkdownToHtml(sampleMd),
    });
    setOutputName('Nota_Dinas_Operasional');
  };

  const moveImage = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= images.length) return;
    setImages((prev) => {
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return next;
    });
  };

  const handleConvert = async () => {
    setErrorMsg(null);
    setSuccessInfo(null);
    setIsProcessing(true);

    try {
      const cleanName = (outputName.trim() || 'hasil-konversi').replace(/\.pdf$/i, '');
      const filename = `${cleanName}.pdf`;

      if (mode === 'images') {
        if (images.length === 0) return;
        setProgressText(`Menyusun gambar 1 dari ${images.length}...`);
        const bytes = await imagesToPdf(
          images,
          { pageSize: imgPageSize, orientation: imgOrientation, marginMm },
          (cur, tot) => setProgressText(`Menyusun gambar ${cur} dari ${tot}...`)
        );
        const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
        const url = triggerDownload(blob, filename);

        setSuccessInfo({
          filename,
          pageCount: images.length,
          sizeBytes: blob.size,
          url,
        });
        onExported({
          id: `exp-${Date.now()}`,
          filename,
          tool: 'to-pdf',
          sizeBytes: blob.size,
          pageCount: images.length,
          blobUrl: url,
          createdAt: Date.now(),
        });
      } else {
        if (!docSource) return;
        setProgressText('Merender halaman dokumen...');
        const res = await htmlDocumentToPdf(
          docSource.html,
          {
            pageSize: docPageSize,
            orientation: docOrientation,
            marginMm,
            marginsMm: activeDocMargins,
            baseStyle: docSource.baseStyle,
          },
          (pct) => setProgressText(`Mengompilasi halaman PDF (${pct}%)...`),
          paginatedPages
        );
        const blob = new Blob([new Uint8Array(res.bytes)], { type: 'application/pdf' });
        const url = triggerDownload(blob, filename);

        setSuccessInfo({
          filename,
          pageCount: res.pageCount,
          sizeBytes: blob.size,
          url,
        });
        onExported({
          id: `exp-${Date.now()}`,
          filename,
          tool: 'to-pdf',
          sizeBytes: blob.size,
          pageCount: res.pageCount,
          blobUrl: url,
          createdAt: Date.now(),
        });
      }
    } catch {
      setErrorMsg('Gagal mengonversi berkas menjadi PDF.');
    } finally {
      setIsProcessing(false);
      setProgressText(null);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 pb-4 border-b border-zinc-200">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
            Konversi ke PDF
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Ubah kumpulan gambar atau dokumen Word (.docx) dan teks menjadi PDF siap cetak.
          </p>
        </div>

        {/* Mode Switcher */}
        <div className="flex items-center gap-1 p-1 bg-zinc-200/70 rounded-md">
          <button
            type="button"
            onClick={() => {
              setMode('images');
              setErrorMsg(null);
              setSuccessInfo(null);
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded flex items-center gap-1.5 transition-colors whitespace-nowrap ${
              mode === 'images'
                ? 'bg-white text-zinc-900 border border-zinc-200'
                : 'text-zinc-600 hover:text-zinc-900'
            }`}
          >
            <ImageIcon className="w-3.5 h-3.5" />
            <span>Gambar ke PDF</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('document');
              setErrorMsg(null);
              setSuccessInfo(null);
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded flex items-center gap-1.5 transition-colors whitespace-nowrap ${
              mode === 'document'
                ? 'bg-white text-zinc-900 border border-zinc-200'
                : 'text-zinc-600 hover:text-zinc-900'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Word / Teks ke PDF</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-start gap-2.5 p-3.5 rounded-md border border-red-200 bg-red-50 text-xs text-red-700">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {successInfo && (
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-md border border-emerald-200 bg-emerald-50/70">
          <div className="flex items-center gap-3">
            <FileCheck2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <div>
              <div className="text-sm font-medium text-zinc-900">
                Konversi berhasil: {successInfo.filename}
              </div>
              <div className="text-xs font-mono tabular-nums text-zinc-600 mt-0.5">
                {successInfo.pageCount} halaman · {formatBytes(successInfo.sizeBytes)}
              </div>
            </div>
          </div>
          <a
            href={successInfo.url}
            download={successInfo.filename}
            className="px-3.5 py-2 text-xs font-medium bg-emerald-700 text-white rounded-md hover:bg-emerald-800 flex items-center gap-1.5 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Unduh Ulang</span>
          </a>
        </div>
      )}

      {mode === 'images' ? (
        images.length === 0 ? (
          <FileDropzone
            accept="image/png,image/jpeg,image/webp"
            multiple
            title="Seret dan lepas gambar (PNG, JPG, WebP)"
            description="Setiap gambar akan dijadikan satu halaman PDF sesuai urutan yang Anda atur."
            formatHint="Format: PNG, JPG, JPEG, WebP · Banyak gambar sekaligus"
            onFilesSelected={handleImagesSelected}
            onLoadSample={handleLoadSampleImages}
            sampleLabel="Muat Contoh Gambar"
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            <div className="lg:col-span-2 bg-white border border-zinc-200 rounded-lg divide-y divide-zinc-200">
              <div className="px-4 py-3 bg-zinc-50/70 flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-600">
                  Daftar Gambar ({images.length})
                </span>
                <div className="flex items-center gap-2">
                  <input
                    ref={addImageInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files) handleImagesSelected(Array.from(e.target.files));
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => addImageInputRef.current?.click()}
                    className="text-xs font-medium text-[#E5322D] hover:underline flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Tambah Gambar</span>
                  </button>
                  <span className="text-zinc-300">|</span>
                  <button
                    type="button"
                    onClick={() => setImages([])}
                    className="text-xs text-zinc-500 hover:text-red-600"
                  >
                    Bersihkan
                  </button>
                </div>
              </div>

              {images.map((img, idx) => (
                <div key={img.id} className="p-3.5 flex items-center gap-3.5">
                  <div className="w-6 text-center font-mono text-xs tabular-nums text-zinc-400">
                    {String(idx + 1).padStart(2, '0')}
                  </div>
                  <div className="w-12 h-14 border border-zinc-200 rounded bg-zinc-50 overflow-hidden shrink-0 flex items-center justify-center">
                    <img
                      src={img.dataUrl}
                      alt={img.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-zinc-900 truncate">
                      {img.name}
                    </div>
                    <div className="text-xs font-mono tabular-nums text-zinc-500 mt-0.5">
                      {img.width} × {img.height} px · {formatBytes(img.sizeBytes)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => moveImage(idx, -1)}
                      className="p-1.5 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 rounded disabled:opacity-30"
                      title="Pindah ke atas"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === images.length - 1}
                      onClick={() => moveImage(idx, 1)}
                      className="p-1.5 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 rounded disabled:opacity-30"
                      title="Pindah ke bawah"
                    >
                      <ArrowDown className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setImages((prev) => prev.filter((x) => x.id !== img.id))}
                      className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded"
                      title="Hapus gambar"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-white border border-zinc-200 rounded-lg p-5 space-y-4">
              <h2 className="text-sm font-semibold text-zinc-900">Tata Letak PDF</h2>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-zinc-700">
                  Ukuran Kertas
                </label>
                <select
                  value={imgPageSize}
                  onChange={(e) => setImgPageSize(e.target.value as 'fit' | 'a4' | 'letter')}
                  className="w-full px-3 py-2 text-xs border border-zinc-200 rounded-md bg-white focus:outline-none focus:border-[#E5322D]"
                >
                  <option value="a4">A4 (210 × 297 mm)</option>
                  <option value="letter">Letter (216 × 279 mm)</option>
                  <option value="fit">Sesuai Ukuran Gambar</option>
                </select>
              </div>

              {imgPageSize !== 'fit' && (
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-zinc-700">
                    Orientasi Halaman
                  </label>
                  <select
                    value={imgOrientation}
                    onChange={(e) =>
                      setImgOrientation(e.target.value as 'auto' | 'portrait' | 'landscape')
                    }
                    className="w-full px-3 py-2 text-xs border border-zinc-200 rounded-md bg-white focus:outline-none focus:border-[#E5322D]"
                  >
                    <option value="auto">Otomatis per Gambar</option>
                    <option value="portrait">Potret (Tegak)</option>
                    <option value="landscape">Lanskap (Mendatar)</option>
                  </select>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-zinc-700">
                  Margin Halaman
                </label>
                <select
                  value={marginMm}
                  onChange={(e) => setMarginMm(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs border border-zinc-200 rounded-md bg-white focus:outline-none focus:border-[#E5322D]"
                >
                  <option value={0}>Tanpa Margin (0 mm)</option>
                  <option value={10}>Standar (10 mm)</option>
                  <option value={20}>Lebar (20 mm)</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-zinc-700">
                  Nama Berkas Hasil
                </label>
                <div className="flex items-center border border-zinc-200 rounded-md overflow-hidden focus-within:border-[#E5322D]">
                  <input
                    type="text"
                    value={outputName}
                    onChange={(e) => setOutputName(e.target.value)}
                    className="flex-1 px-3 py-2 text-xs text-zinc-900 bg-white focus:outline-none min-w-0"
                  />
                  <span className="px-2.5 py-2 text-xs font-mono text-zinc-500 bg-zinc-50 border-l border-zinc-200">
                    .pdf
                  </span>
                </div>
              </div>

              <button
                type="button"
                disabled={isProcessing || images.length === 0}
                onClick={handleConvert}
                className="w-full py-3 px-4 text-sm font-semibold bg-[#E5322D] text-white rounded-md hover:bg-[#C8231E] disabled:opacity-40 flex items-center justify-center gap-2 transition-colors"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{progressText || 'Memproses...'}</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>Konversi & Unduh PDF</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )
      ) : !docSource ? (
        <FileDropzone
          accept=".docx,.txt,.md,.html,.htm"
          title="Unggah berkas Word (.docx) atau Teks"
          description="Isi dokumen akan dikonversi dan dipaginasi rapi menjadi halaman PDF standar."
          formatHint="Format: .DOCX, .TXT, .MD, .HTML"
          onFilesSelected={handleDocumentSelected}
          onLoadSample={handleLoadSampleDocument}
          sampleLabel="Muat Contoh Nota Dinas"
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* Document Content Preview */}
          <div className="lg:col-span-2 bg-white border border-zinc-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 bg-zinc-50/70 border-b border-zinc-200 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-medium text-zinc-900 truncate">
                  {docSource.name}
                </div>
                <div className="text-xs font-mono tabular-nums text-zinc-500">
                  {docSource.kind} · {formatBytes(docSource.sizeBytes)}
                  {paginatedPages.length > 0 ? ` · ${paginatedPages.length} halaman siap ekspor` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDocSource(null)}
                className="text-xs text-zinc-500 hover:text-zinc-900 whitespace-nowrap"
              >
                Ganti Berkas
              </button>
            </div>

            <div
              ref={previewContainerRef}
              className="p-4 sm:p-5 max-h-[640px] overflow-y-auto overflow-x-hidden bg-zinc-100/80 space-y-5"
            >
              {isPaginating ? (
                <div className="py-16 flex flex-col items-center justify-center gap-2 text-xs text-zinc-500">
                  <Loader2 className="w-5 h-5 animate-spin text-[#E5322D]" />
                  <span>Menghitung tata letak halaman PDF...</span>
                </div>
              ) : (
                (() => {
                  const metrics = getPaperMetrics({
                    pageSize: docPageSize,
                    orientation: docOrientation,
                    marginMm,
                    marginsMm: activeDocMargins,
                    baseStyle: docSource.baseStyle,
                  });
                  const printCss = buildDocumentPrintCss(docSource.baseStyle);
                  const availableWidth = Math.max(240, previewContainerWidth - 48);
                  const previewScale = Math.min(0.75, Math.max(0.25, availableWidth / metrics.pageWPx));
                  const scaledW = Math.round(metrics.pageWPx * previewScale);
                  const scaledH = Math.round(metrics.pageHPx * previewScale);

                  return paginatedPages.map((pageHtml, idx) => {
                    const srcDoc = `<!doctype html><html><head><meta charset="utf-8"/>${DOCUMENT_FONT_LINKS_HTML}<style>${printCss}html,body{width:${metrics.pageWPx}px;height:${metrics.pageHPx}px;overflow:hidden;background:#ffffff;}#sheet{width:${metrics.pageWPx}px;height:${metrics.pageHPx}px;padding:${metrics.marginTopPx}px ${metrics.marginRightPx}px ${metrics.marginBottomPx}px ${metrics.marginLeftPx}px;overflow:hidden;background:#ffffff;}</style></head><body><div id="sheet">${pageHtml}</div></body></html>`;
                    return (
                      <div key={idx} className="flex flex-col items-center">
                        <div
                          className="flex items-center justify-between mb-1.5 text-[11px] font-mono tabular-nums text-zinc-500"
                          style={{ width: scaledW }}
                        >
                          <span>Halaman {String(idx + 1).padStart(2, '0')}</span>
                          <span>
                            {docPageSize.toUpperCase()} · {docOrientation === 'portrait' ? 'Potret' : 'Lanskap'}
                          </span>
                        </div>
                        <div
                          className="bg-white border border-zinc-300 overflow-hidden"
                          style={{ width: scaledW, height: scaledH }}
                        >
                          <iframe
                            title={`Pratinjau halaman ${idx + 1}`}
                            srcDoc={srcDoc}
                            sandbox="allow-same-origin"
                            scrolling="no"
                            style={{
                              width: metrics.pageWPx,
                              height: metrics.pageHPx,
                              transform: `scale(${previewScale})`,
                              transformOrigin: 'top left',
                              border: 0,
                              pointerEvents: 'none',
                            }}
                          />
                        </div>
                      </div>
                    );
                  });
                })()
              )}
            </div>
          </div>

          {/* Document PDF Options */}
          <div className="bg-white border border-zinc-200 rounded-lg p-5 space-y-4">
            <h2 className="text-sm font-semibold text-zinc-900">Pengaturan Halaman</h2>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-zinc-700">
                Ukuran Kertas
              </label>
              <select
                value={docPageSize}
                onChange={(e) => setDocPageSize(e.target.value as 'a4' | 'letter')}
                className="w-full px-3 py-2 text-xs border border-zinc-200 rounded-md bg-white focus:outline-none focus:border-[#E5322D]"
              >
                <option value="a4">A4 (210 × 297 mm)</option>
                <option value="letter">Letter (216 × 279 mm)</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-zinc-700">
                Orientasi
              </label>
              <select
                value={docOrientation}
                onChange={(e) =>
                  setDocOrientation(e.target.value as 'portrait' | 'landscape')
                }
                className="w-full px-3 py-2 text-xs border border-zinc-200 rounded-md bg-white focus:outline-none focus:border-[#E5322D]"
              >
                <option value="portrait">Potret (Tegak)</option>
                <option value="landscape">Lanskap (Mendatar)</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-zinc-700">
                Margin Halaman
              </label>
              <select
                value={useDocMargins && docSource.marginsMm ? 'doc' : String(marginMm)}
                onChange={(e) => {
                  if (e.target.value === 'doc') {
                    setUseDocMargins(true);
                  } else {
                    setUseDocMargins(false);
                    setMarginMm(Number(e.target.value));
                  }
                }}
                className="w-full px-3 py-2 text-xs border border-zinc-200 rounded-md bg-white focus:outline-none focus:border-[#E5322D]"
              >
                {docSource.marginsMm && (
                  <option value="doc">
                    Sesuai Dokumen Word ({docSource.marginsMm.top} / {docSource.marginsMm.right} /{' '}
                    {docSource.marginsMm.bottom} / {docSource.marginsMm.left} mm)
                  </option>
                )}
                <option value="10">Rapat (10 mm)</option>
                <option value="15">Standar (15 mm)</option>
                <option value="22">Lebar (22 mm)</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-zinc-700">
                Nama Berkas Hasil
              </label>
              <div className="flex items-center border border-zinc-200 rounded-md overflow-hidden focus-within:border-[#E5322D]">
                <input
                  type="text"
                  value={outputName}
                  onChange={(e) => setOutputName(e.target.value)}
                  className="flex-1 px-3 py-2 text-xs text-zinc-900 bg-white focus:outline-none min-w-0"
                />
                <span className="px-2.5 py-2 text-xs font-mono text-zinc-500 bg-zinc-50 border-l border-zinc-200">
                  .pdf
                </span>
              </div>
            </div>

            <button
              type="button"
              disabled={isProcessing || isPaginating}
              onClick={handleConvert}
              className="w-full py-3 px-4 text-sm font-semibold bg-[#E5322D] text-white rounded-md hover:bg-[#C8231E] disabled:opacity-40 flex items-center justify-center gap-2 transition-colors"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{progressText || 'Mengonversi...'}</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>Konversi & Unduh PDF</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
