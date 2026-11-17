import React, { useRef, useState } from 'react';
import {
  ArrowUp,
  ArrowDown,
  Trash2,
  Plus,
  Download,
  FileCheck2,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import type { MergeQueueItem, SessionExportItem } from '../types/pdf';
import {
  createSamplePdfBytes,
  formatBytes,
  loadPdfMetadata,
  mergePdfs,
  parsePageRanges,
  triggerDownload,
} from '../utils/pdfEngine';
import { FileDropzone } from './FileDropzone';

interface MergeWorkspaceProps {
  onExported: (item: SessionExportItem) => void;
}

export function MergeWorkspace({ onExported }: MergeWorkspaceProps) {
  const [items, setItems] = useState<MergeQueueItem[]>([]);
  const [outputName, setOutputName] = useState('dokumen-gabungan');
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<{
    filename: string;
    pageCount: number;
    sizeBytes: number;
    url: string;
  } | null>(null);

  const addInputRef = useRef<HTMLInputElement>(null);

  const addPdfFiles = async (files: File[]) => {
    setErrorMsg(null);
    setSuccessInfo(null);
    setIsLoadingFiles(true);

    try {
      const added: MergeQueueItem[] = [];
      for (const file of files) {
        if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
          setErrorMsg(`Berkas "${file.name}" bukan format PDF yang valid.`);
          continue;
        }
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const meta = await loadPdfMetadata(bytes);
        added.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name,
          sizeBytes: bytes.byteLength,
          pageCount: meta.pageCount,
          pageRange: '',
          thumbnailUrl: meta.thumbnailUrl,
          bytes,
        });
      }
      setItems((prev) => [...prev, ...added]);
    } catch {
      setErrorMsg('Gagal membaca salah satu berkas PDF. Pastikan berkas tidak rusak atau terkunci kata sandi.');
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const handleLoadSamples = async () => {
    setErrorMsg(null);
    setSuccessInfo(null);
    setIsLoadingFiles(true);
    try {
      const b1 = await createSamplePdfBytes('laporan');
      const b2 = await createSamplePdfBytes('lampiran');
      const m1 = await loadPdfMetadata(b1);
      const m2 = await loadPdfMetadata(b2);
      setItems([
        {
          id: `sample-1-${Date.now()}`,
          name: 'Laporan_Proyek_Q4.pdf',
          sizeBytes: b1.byteLength,
          pageCount: m1.pageCount,
          pageRange: '',
          thumbnailUrl: m1.thumbnailUrl,
          bytes: b1,
        },
        {
          id: `sample-2-${Date.now()}`,
          name: 'Lampiran_Teknis.pdf',
          sizeBytes: b2.byteLength,
          pageCount: m2.pageCount,
          pageRange: '',
          thumbnailUrl: m2.thumbnailUrl,
          bytes: b2,
        },
      ]);
    } catch {
      setErrorMsg('Gagal membuat dokumen contoh.');
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const moveItem = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    setItems((prev) => {
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return next;
    });
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
    setSuccessInfo(null);
  };

  const updateRange = (id: string, value: string) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, pageRange: value } : it)));
  };

  const totalSelectedPages = items.reduce((sum, it) => {
    const pages = parsePageRanges(it.pageRange, it.pageCount);
    return sum + pages.length;
  }, 0);

  const handleMerge = async () => {
    if (items.length === 0) return;
    setErrorMsg(null);
    setIsMerging(true);
    try {
      const result = await mergePdfs(items);
      if (result.pageCount === 0) {
        setErrorMsg('Rentang halaman yang dimasukkan tidak menghasilkan halaman apa pun.');
        return;
      }
      const cleanName = (outputName.trim() || 'dokumen-gabungan').replace(/\.pdf$/i, '');
      const filename = `${cleanName}.pdf`;
      const blob = new Blob([new Uint8Array(result.bytes)], { type: 'application/pdf' });
      const url = triggerDownload(blob, filename);

      setSuccessInfo({
        filename,
        pageCount: result.pageCount,
        sizeBytes: blob.size,
        url,
      });

      onExported({
        id: `exp-${Date.now()}`,
        filename,
        tool: 'merge',
        sizeBytes: blob.size,
        pageCount: result.pageCount,
        blobUrl: url,
        createdAt: Date.now(),
      });
    } catch {
      setErrorMsg('Terjadi kesalahan saat menggabungkan berkas PDF.');
    } finally {
      setIsMerging(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header Summary */}
      <div className="flex flex-wrap items-end justify-between gap-4 pb-4 border-b border-zinc-200">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
            Gabung Beberapa PDF
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Susun urutan berkas, tentukan rentang halaman opsional, dan satukan menjadi satu PDF.
          </p>
        </div>
        {items.length > 0 && (
          <div className="flex items-center gap-2">
            <input
              ref={addInputRef}
              type="file"
              accept=".pdf,application/pdf"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addPdfFiles(Array.from(e.target.files));
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => addInputRef.current?.click()}
              className="px-3.5 py-2 text-xs font-medium bg-white border border-zinc-200 text-zinc-700 rounded-md hover:bg-zinc-50 flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Tambah Berkas</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setItems([]);
                setSuccessInfo(null);
                setErrorMsg(null);
              }}
              className="px-3 py-2 text-xs font-medium text-zinc-500 hover:text-red-600 transition-colors whitespace-nowrap"
            >
              Kosongkan Daftar
            </button>
          </div>
        )}
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
                Penggabungan selesai: {successInfo.filename}
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

      {items.length === 0 && !isLoadingFiles ? (
        <FileDropzone
          accept=".pdf,application/pdf"
          multiple
          title="Seret dan lepas berkas PDF di sini"
          description="Pilih dua atau lebih berkas PDF untuk digabungkan dalam satu dokumen berurutan."
          formatHint="Format: .PDF · Semua diproses lokal di browser"
          onFilesSelected={addPdfFiles}
          onLoadSample={handleLoadSamples}
          sampleLabel="Muat 2 Contoh PDF"
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* File Queue Table/List */}
          <div className="lg:col-span-2 bg-white border border-zinc-200 rounded-lg divide-y divide-zinc-200">
            <div className="px-4 py-3 bg-zinc-50/70 flex items-center justify-between text-xs font-medium text-zinc-600">
              <span>Daftar Berkas ({items.length})</span>
              <span className="font-mono tabular-nums">
                Total keluaran: {totalSelectedPages} halaman
              </span>
            </div>

            {isLoadingFiles && (
              <div className="p-6 flex items-center gap-2.5 text-xs text-zinc-500">
                <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                <span>Membaca metadata dan pratinjau halaman pertama...</span>
              </div>
            )}

            {items.map((item, idx) => {
              const selectedCount = parsePageRanges(item.pageRange, item.pageCount).length;
              return (
                <div
                  key={item.id}
                  className="p-3.5 flex items-center gap-3.5 hover:bg-zinc-50/60 transition-colors"
                >
                  <div className="w-6 text-center font-mono text-xs tabular-nums text-zinc-400 shrink-0">
                    {String(idx + 1).padStart(2, '0')}
                  </div>

                  {/* Thumbnail */}
                  <div className="w-11 h-14 border border-zinc-200 bg-zinc-100 rounded overflow-hidden shrink-0 flex items-center justify-center">
                    {item.thumbnailUrl ? (
                      <img
                        src={item.thumbnailUrl}
                        alt={`Pratinjau ${item.name}`}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-[10px] font-mono text-zinc-400">PDF</span>
                    )}
                  </div>

                  {/* Info & Optional Range */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-zinc-900 truncate">
                      {item.name}
                    </div>
                    <div className="text-xs font-mono tabular-nums text-zinc-500 mt-0.5">
                      {item.pageCount} halaman · {formatBytes(item.sizeBytes)}
                      {item.pageRange.trim() ? ` · Terpilih ${selectedCount} hal` : ''}
                    </div>

                    <div className="mt-2 flex items-center gap-2">
                      <label className="text-[11px] text-zinc-500 whitespace-nowrap">
                        Rentang (opsional):
                      </label>
                      <input
                        type="text"
                        value={item.pageRange}
                        onChange={(e) => updateRange(item.id, e.target.value)}
                        placeholder={`Semua (1-${item.pageCount})`}
                        className="w-40 px-2 py-1 text-xs font-mono border border-zinc-200 rounded bg-white focus:outline-none focus:border-blue-600"
                      />
                    </div>
                  </div>

                  {/* Order & Delete Controls */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => moveItem(idx, -1)}
                      title="Pindah ke atas"
                      className="p-1.5 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 rounded disabled:opacity-30"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === items.length - 1}
                      onClick={() => moveItem(idx, 1)}
                      title="Pindah ke bawah"
                      className="p-1.5 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 rounded disabled:opacity-30"
                    >
                      <ArrowDown className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      title="Hapus berkas"
                      className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Export Configuration Panel */}
          <div className="bg-white border border-zinc-200 rounded-lg p-5 space-y-4">
            <h2 className="text-sm font-semibold text-zinc-900">
              Pengaturan Keluaran
            </h2>

            <div className="space-y-1.5">
              <label
                htmlFor="merge-filename"
                className="block text-xs font-medium text-zinc-700"
              >
                Nama Berkas Hasil
              </label>
              <div className="flex items-center border border-zinc-200 rounded-md overflow-hidden focus-within:border-blue-600">
                <input
                  id="merge-filename"
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

            <div className="pt-2 border-t border-zinc-200 space-y-2 text-xs">
              <div className="flex justify-between text-zinc-600">
                <span>Jumlah berkas</span>
                <span className="font-mono tabular-nums font-medium text-zinc-900">
                  {items.length} file
                </span>
              </div>
              <div className="flex justify-between text-zinc-600">
                <span>Total halaman gabungan</span>
                <span className="font-mono tabular-nums font-medium text-zinc-900">
                  {totalSelectedPages} halaman
                </span>
              </div>
            </div>

            <button
              type="button"
              disabled={items.length === 0 || totalSelectedPages === 0 || isMerging}
              onClick={handleMerge}
              className="w-full py-3 px-4 text-sm font-semibold bg-[#E5322D] text-white rounded-lg hover:bg-[#C8231E] disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
            >
              {isMerging ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Menggabungkan...</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>Gabungkan & Unduh PDF</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
