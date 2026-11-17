import React, { useState } from 'react';
import JSZip from 'jszip';
import {
  Download,
  AlertCircle,
  Loader2,
  FileCheck2,
  Archive,
  Check,
  RefreshCw,
} from 'lucide-react';
import type { PageThumbnail, SessionExportItem } from '../types/pdf';
import {
  createSamplePdfBytes,
  formatBytes,
  formatPageSelectionToRange,
  parsePageRanges,
  renderAllThumbnails,
  splitPdfBySelection,
  splitPdfIntoGroups,
  triggerDownload,
} from '../utils/pdfEngine';
import { FileDropzone } from './FileDropzone';

interface SplitWorkspaceProps {
  onExported: (item: SessionExportItem) => void;
}

type SplitMode = 'extract' | 'interval' | 'burst';

export function SplitWorkspace({ onExported }: SplitWorkspaceProps) {
  const [sourceFile, setSourceFile] = useState<{
    name: string;
    bytes: Uint8Array;
    sizeBytes: number;
  } | null>(null);
  const [thumbnails, setThumbnails] = useState<PageThumbnail[]>([]);
  const [renderProgress, setRenderProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);

  const [mode, setMode] = useState<SplitMode>('extract');
  const [selectedPages, setSelectedPages] = useState<number[]>([]);
  const [rangeText, setRangeText] = useState('');
  const [intervalCount, setIntervalCount] = useState(2);

  const [isSplitting, setIsSplitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [splitResults, setSplitResults] = useState<
    Array<{ name: string; sizeBytes: number; pageCount: number; url: string }>
  >([]);
  const [zipResult, setZipResult] = useState<{
    name: string;
    sizeBytes: number;
    url: string;
  } | null>(null);

  const loadPdf = async (name: string, bytes: Uint8Array) => {
    setErrorMsg(null);
    setSplitResults([]);
    setZipResult(null);
    setSourceFile({ name, bytes, sizeBytes: bytes.byteLength });
    setThumbnails([]);
    setRenderProgress({ current: 0, total: 1 });

    try {
      const thumbs = await renderAllThumbnails(bytes, 0.35, (current, total) => {
        setRenderProgress({ current, total });
      });
      setThumbnails(thumbs);
      const initialPages = thumbs.length > 0 ? [1] : [];
      setSelectedPages(initialPages);
      setRangeText(formatPageSelectionToRange(initialPages));
    } catch {
      setErrorMsg('Gagal membaca berkas PDF. Pastikan berkas valid dan tidak terkunci kata sandi.');
      setSourceFile(null);
    } finally {
      setRenderProgress(null);
    }
  };

  const handleFilesSelected = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      setErrorMsg(`Berkas "${file.name}" bukan format PDF.`);
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    await loadPdf(file.name, bytes);
  };

  const handleLoadSample = async () => {
    const bytes = await createSamplePdfBytes('laporan');
    await loadPdf('Laporan_Proyek_Q4.pdf', bytes);
  };

  const togglePageSelection = (pageNum: number) => {
    if (mode !== 'extract') setMode('extract');
    setSelectedPages((prev) => {
      const exists = prev.includes(pageNum);
      const next = exists
        ? prev.filter((p) => p !== pageNum)
        : [...prev, pageNum].sort((a, b) => a - b);
      setRangeText(formatPageSelectionToRange(next));
      return next;
    });
  };

  const handleRangeInputChange = (val: string) => {
    setRangeText(val);
    if (thumbnails.length > 0) {
      const parsed = parsePageRanges(val, thumbnails.length);
      setSelectedPages(parsed);
    }
  };

  const selectAllPages = () => {
    const all = thumbnails.map((t) => t.pageNumber);
    setSelectedPages(all);
    setRangeText(formatPageSelectionToRange(all));
  };

  const handleSplit = async () => {
    if (!sourceFile || thumbnails.length === 0) return;
    setErrorMsg(null);
    setSplitResults([]);
    setZipResult(null);
    setIsSplitting(true);

    const baseName = sourceFile.name.replace(/\.pdf$/i, '');

    try {
      if (mode === 'extract') {
        if (selectedPages.length === 0) {
          setErrorMsg('Pilih minimal satu halaman untuk diekstrak.');
          return;
        }
        const outBytes = await splitPdfBySelection(sourceFile.bytes, selectedPages);
        const filename = `${baseName}_ekstrak.pdf`;
        const blob = new Blob([new Uint8Array(outBytes)], { type: 'application/pdf' });
        const url = triggerDownload(blob, filename);

        setSplitResults([
          {
            name: filename,
            sizeBytes: blob.size,
            pageCount: selectedPages.length,
            url,
          },
        ]);

        onExported({
          id: `exp-${Date.now()}`,
          filename,
          tool: 'split',
          sizeBytes: blob.size,
          pageCount: selectedPages.length,
          blobUrl: url,
          createdAt: Date.now(),
        });
      } else {
        const total = thumbnails.length;
        const step = mode === 'burst' ? 1 : Math.max(1, intervalCount);
        const groups: number[][] = [];
        for (let start = 1; start <= total; start += step) {
          const group: number[] = [];
          for (let p = start; p < start + step && p <= total; p++) {
            group.push(p);
          }
          groups.push(group);
        }

        const outputs = await splitPdfIntoGroups(sourceFile.bytes, groups, baseName);
        const zip = new JSZip();
        const resultItems: Array<{
          name: string;
          sizeBytes: number;
          pageCount: number;
          url: string;
        }> = [];

        for (const out of outputs) {
          zip.file(out.name, out.bytes);
          const blob = new Blob([new Uint8Array(out.bytes)], { type: 'application/pdf' });
          resultItems.push({
            name: out.name,
            sizeBytes: blob.size,
            pageCount: out.pageCount,
            url: URL.createObjectURL(blob),
          });
        }

        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const zipFilename = `${baseName}_terpisah.zip`;
        const zipUrl = triggerDownload(zipBlob, zipFilename);

        setSplitResults(resultItems);
        setZipResult({
          name: zipFilename,
          sizeBytes: zipBlob.size,
          url: zipUrl,
        });

        onExported({
          id: `exp-${Date.now()}`,
          filename: zipFilename,
          tool: 'split',
          sizeBytes: zipBlob.size,
          pageCount: total,
          blobUrl: zipUrl,
          createdAt: Date.now(),
        });
      }
    } catch {
      setErrorMsg('Terjadi kesalahan saat memisahkan halaman PDF.');
    } finally {
      setIsSplitting(false);
    }
  };

  const previewGroupsCount =
    mode === 'extract'
      ? selectedPages.length > 0
        ? 1
        : 0
      : mode === 'burst'
        ? thumbnails.length
        : Math.ceil(thumbnails.length / Math.max(1, intervalCount));

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 pb-4 border-b border-zinc-200">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
            Pisah & Ekstrak Halaman PDF
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Pilih halaman spesifik, pisahkan per beberapa halaman, atau pecah setiap halaman menjadi arsip ZIP.
          </p>
        </div>

        {sourceFile && (
          <button
            type="button"
            onClick={() => {
              setSourceFile(null);
              setThumbnails([]);
              setSplitResults([]);
              setZipResult(null);
            }}
            className="px-3.5 py-2 text-xs font-medium bg-white border border-zinc-200 text-zinc-700 rounded-md hover:bg-zinc-50 flex items-center gap-1.5 whitespace-nowrap"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Ganti Berkas</span>
          </button>
        )}
      </div>

      {errorMsg && (
        <div className="flex items-start gap-2.5 p-3.5 rounded-md border border-red-200 bg-red-50 text-xs text-red-700">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {!sourceFile ? (
        <FileDropzone
          accept=".pdf,application/pdf"
          title="Unggah berkas PDF untuk dipisahkan"
          description="Lihat pratinjau seluruh halaman secara visual dan pilih bagian mana yang ingin diekstrak."
          formatHint="Format: .PDF · Pemrosesan lokal"
          onFilesSelected={handleFilesSelected}
          onLoadSample={handleLoadSample}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* Page Thumbnail Grid */}
          <div className="lg:col-span-2 bg-white border border-zinc-200 rounded-lg p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-zinc-200">
              <div className="min-w-0">
                <div className="text-sm font-medium text-zinc-900 truncate">
                  {sourceFile.name}
                </div>
                <div className="text-xs font-mono tabular-nums text-zinc-500 mt-0.5">
                  {thumbnails.length} halaman · {formatBytes(sourceFile.sizeBytes)}
                </div>
              </div>
              {mode === 'extract' && thumbnails.length > 0 && (
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={selectAllPages}
                    className="text-blue-600 hover:underline font-medium"
                  >
                    Pilih Semua
                  </button>
                  <span className="text-zinc-300">|</span>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPages([]);
                      setRangeText('');
                    }}
                    className="text-zinc-500 hover:text-zinc-800"
                  >
                    Batal Pilih
                  </button>
                </div>
              )}
            </div>

            {renderProgress ? (
              <div className="py-16 flex flex-col items-center justify-center gap-3">
                <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                <div className="text-xs font-mono tabular-nums text-zinc-600">
                  Merender halaman {renderProgress.current} dari {renderProgress.total}...
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3.5">
                {thumbnails.map((thumb) => {
                  const isSelected =
                    mode !== 'extract' || selectedPages.includes(thumb.pageNumber);
                  return (
                    <button
                      key={thumb.pageNumber}
                      type="button"
                      onClick={() => togglePageSelection(thumb.pageNumber)}
                      className={`group relative text-left border rounded-md p-2 transition-colors ${
                        mode === 'extract' && isSelected
                          ? 'border-[#E5322D] bg-red-50/40'
                          : 'border-zinc-200 bg-zinc-50/40 hover:border-zinc-300'
                      }`}
                    >
                      <div className="aspect-[3/4] bg-white border border-zinc-200/80 rounded overflow-hidden flex items-center justify-center">
                        <img
                          src={thumb.dataUrl}
                          alt={`Halaman ${thumb.pageNumber}`}
                          className={`w-full h-full object-contain transition-opacity ${
                            mode === 'extract' && !isSelected ? 'opacity-50' : 'opacity-100'
                          }`}
                        />
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs">
                        <span className="font-mono tabular-nums text-zinc-600">
                          Hal. {String(thumb.pageNumber).padStart(2, '0')}
                        </span>
                        {mode === 'extract' && isSelected && (
                          <span className="w-4 h-4 rounded bg-[#E5322D] text-white flex items-center justify-center">
                            <Check className="w-3 h-3" />
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Split Controls & Output */}
          <div className="space-y-4">
            <div className="bg-white border border-zinc-200 rounded-lg p-5 space-y-4">
              <h2 className="text-sm font-semibold text-zinc-900">
                Metode Pemisahan
              </h2>

              <div className="space-y-2">
                {[
                  {
                    id: 'extract' as const,
                    title: 'Ekstrak Halaman Pilihan',
                    desc: 'Gabungkan halaman terpilih menjadi 1 PDF baru',
                  },
                  {
                    id: 'interval' as const,
                    title: 'Pisah per N Halaman',
                    desc: 'Pecah dokumen secara merata ke beberapa PDF',
                  },
                  {
                    id: 'burst' as const,
                    title: 'Pisah Setiap Halaman',
                    desc: 'Satu berkas PDF terpisah untuk tiap halaman',
                  },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setMode(opt.id)}
                    className={`w-full p-3 text-left rounded-md border transition-colors ${
                      mode === opt.id
                        ? 'border-[#E5322D] bg-red-50/40'
                        : 'border-zinc-200 hover:bg-zinc-50'
                    }`}
                  >
                    <div className="text-xs font-semibold text-zinc-900">
                      {opt.title}
                    </div>
                    <div className="text-[11px] text-zinc-500 mt-0.5">
                      {opt.desc}
                    </div>
                  </button>
                ))}
              </div>

              {mode === 'extract' && (
                <div className="space-y-1.5 pt-2 border-t border-zinc-200">
                  <label
                    htmlFor="split-range"
                    className="block text-xs font-medium text-zinc-700"
                  >
                    Rentang Halaman
                  </label>
                  <input
                    id="split-range"
                    type="text"
                    value={rangeText}
                    onChange={(e) => handleRangeInputChange(e.target.value)}
                    placeholder="Contoh: 1-3, 5"
                    className="w-full px-3 py-2 text-xs font-mono border border-zinc-200 rounded-md focus:outline-none focus:border-blue-600"
                  />
                  <p className="text-[11px] text-zinc-500">
                    Klik thumbnail di kiri atau ketik nomor/rentang halaman dipisah koma.
                  </p>
                </div>
              )}

              {mode === 'interval' && (
                <div className="space-y-1.5 pt-2 border-t border-zinc-200">
                  <label
                    htmlFor="split-interval"
                    className="block text-xs font-medium text-zinc-700"
                  >
                    Jumlah Halaman per Berkas
                  </label>
                  <input
                    id="split-interval"
                    type="number"
                    min={1}
                    max={Math.max(1, thumbnails.length)}
                    value={intervalCount}
                    onChange={(e) =>
                      setIntervalCount(Math.max(1, Number.parseInt(e.target.value, 10) || 1))
                    }
                    className="w-full px-3 py-2 text-xs font-mono tabular-nums border border-zinc-200 rounded-md focus:outline-none focus:border-blue-600"
                  />
                </div>
              )}

              <div className="pt-2 border-t border-zinc-200 flex justify-between text-xs text-zinc-600">
                <span>Estimasi berkas hasil</span>
                <span className="font-mono tabular-nums font-medium text-zinc-900">
                  {previewGroupsCount} {previewGroupsCount > 1 ? 'berkas (ZIP)' : 'berkas PDF'}
                </span>
              </div>

              <button
                type="button"
                disabled={
                  isSplitting ||
                  thumbnails.length === 0 ||
                  (mode === 'extract' && selectedPages.length === 0)
                }
                onClick={handleSplit}
                className="w-full py-3 px-4 text-sm font-semibold bg-[#E5322D] text-white rounded-lg hover:bg-[#C8231E] disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
              >
                {isSplitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Memproses Pemisahan...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>
                      {mode === 'extract'
                        ? 'Ekstrak & Unduh PDF'
                        : 'Pisahkan & Unduh ZIP'}
                    </span>
                  </>
                )}
              </button>
            </div>

            {/* Results List */}
            {splitResults.length > 0 && (
              <div className="bg-white border border-emerald-200 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-emerald-800">
                  <FileCheck2 className="w-4 h-4 text-emerald-600" />
                  <span>Hasil Pemisahan Siap Diunduh</span>
                </div>

                {zipResult && (
                  <a
                    href={zipResult.url}
                    download={zipResult.name}
                    className="w-full py-2 px-3 text-xs font-medium bg-emerald-700 text-white rounded-md hover:bg-emerald-800 flex items-center justify-center gap-2"
                  >
                    <Archive className="w-3.5 h-3.5" />
                    <span>Unduh Semua ({zipResult.name})</span>
                  </a>
                )}

                <ul className="divide-y divide-zinc-200 max-h-56 overflow-y-auto">
                  {splitResults.map((res) => (
                    <li
                      key={res.name}
                      className="py-2 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-zinc-800 truncate">
                          {res.name}
                        </div>
                        <div className="text-[11px] font-mono tabular-nums text-zinc-500">
                          {res.pageCount} hal · {formatBytes(res.sizeBytes)}
                        </div>
                      </div>
                      <a
                        href={res.url}
                        download={res.name}
                        className="p-1.5 text-zinc-500 hover:text-blue-600 shrink-0"
                        title={`Unduh ${res.name}`}
                      >
                        <Download className="w-3.5 h-3.5" />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
