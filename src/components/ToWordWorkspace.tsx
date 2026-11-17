import React, { useState } from 'react';
import {
  Download,
  AlertCircle,
  Loader2,
  FileCheck2,
  RefreshCw,
} from 'lucide-react';
import type { ExtractedPageData, SessionExportItem } from '../types/pdf';
import {
  buildDocxFromPdf,
  createSamplePdfBytes,
  extractPdfForWord,
  formatBytes,
  triggerDownload,
} from '../utils/pdfEngine';
import { FileDropzone } from './FileDropzone';

interface ToWordWorkspaceProps {
  onExported: (item: SessionExportItem) => void;
}

export function ToWordWorkspace({ onExported }: ToWordWorkspaceProps) {
  const [sourceFile, setSourceFile] = useState<{
    name: string;
    sizeBytes: number;
  } | null>(null);
  const [pages, setPages] = useState<ExtractedPageData[]>([]);
  const [editedTexts, setEditedTexts] = useState<Record<number, string>>({});
  const [extractProgress, setExtractProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);

  const [wordMode, setWordMode] = useState<'structured' | 'visual'>('structured');
  const [outputName, setOutputName] = useState('dokumen-word');
  const [isExporting, setIsExporting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<{
    filename: string;
    sizeBytes: number;
    pageCount: number;
    url: string;
  } | null>(null);

  const loadPdfForExtraction = async (name: string, bytes: Uint8Array) => {
    setErrorMsg(null);
    setSuccessInfo(null);
    setEditedTexts({});
    setSourceFile({ name, sizeBytes: bytes.byteLength });
    setOutputName(name.replace(/\.pdf$/i, ''));
    setPages([]);
    setExtractProgress({ current: 0, total: 1 });

    try {
      const extracted = await extractPdfForWord(bytes, (current, total) => {
        setExtractProgress({ current, total });
      });
      setPages(extracted);
    } catch {
      setErrorMsg('Gagal mengekstrak berkas PDF. Pastikan berkas tidak rusak atau terkunci kata sandi.');
      setSourceFile(null);
    } finally {
      setExtractProgress(null);
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
    await loadPdfForExtraction(file.name, bytes);
  };

  const handleLoadSample = async () => {
    const bytes = await createSamplePdfBytes('laporan');
    await loadPdfForExtraction('Laporan_Proyek_Q4.pdf', bytes);
  };

  const handleExportDocx = async () => {
    if (pages.length === 0) return;
    setErrorMsg(null);
    setIsExporting(true);
    try {
      const blob = await buildDocxFromPdf(pages, wordMode, editedTexts);
      const cleanName = (outputName.trim() || 'dokumen-word').replace(/\.docx$/i, '');
      const filename = `${cleanName}.docx`;
      const url = triggerDownload(blob, filename);

      setSuccessInfo({
        filename,
        sizeBytes: blob.size,
        pageCount: pages.length,
        url,
      });

      onExported({
        id: `exp-${Date.now()}`,
        filename,
        tool: 'to-word',
        sizeBytes: blob.size,
        pageCount: pages.length,
        blobUrl: url,
        createdAt: Date.now(),
      });
    } catch {
      setErrorMsg('Terjadi kesalahan saat menyusun berkas Word (.docx).');
    } finally {
      setIsExporting(false);
    }
  };

  const totalExtractedChars = pages.reduce(
    (acc, p) => acc + (editedTexts[p.pageNumber] ?? p.rawText).length,
    0
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 pb-4 border-b border-zinc-200">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
            Konversi PDF ke Word (.docx)
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Ekstrak judul dan paragraf PDF menjadi dokumen Microsoft Word yang dapat disunting.
          </p>
        </div>

        {sourceFile && (
          <button
            type="button"
            onClick={() => {
              setSourceFile(null);
              setPages([]);
              setSuccessInfo(null);
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

      {successInfo && (
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-md border border-emerald-200 bg-emerald-50/70">
          <div className="flex items-center gap-3">
            <FileCheck2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <div>
              <div className="text-sm font-medium text-zinc-900">
                Berkas Word siap: {successInfo.filename}
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

      {!sourceFile ? (
        <FileDropzone
          accept=".pdf,application/pdf"
          title="Unggah berkas PDF untuk dikonversi ke Word"
          description="Pilih mode Teks Terstruktur untuk hasil yang bisa diketik ulang, atau mode Gambar Halaman untuk menjaga tata letak persis."
          formatHint="Keluaran: .DOCX (kompatibel Microsoft Word & Google Docs)"
          onFilesSelected={handleFilesSelected}
          onLoadSample={handleLoadSample}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* Preview / Editable Extraction Area */}
          <div className="lg:col-span-2 bg-white border border-zinc-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 bg-zinc-50/70 border-b border-zinc-200 flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-sm font-medium text-zinc-900 truncate">
                  {sourceFile.name}
                </div>
                <div className="text-xs font-mono tabular-nums text-zinc-500">
                  {pages.length} halaman · {formatBytes(sourceFile.sizeBytes)} ·{' '}
                  {totalExtractedChars.toLocaleString('id-ID')} karakter teks
                </div>
              </div>
            </div>

            {extractProgress ? (
              <div className="py-16 flex flex-col items-center justify-center gap-3">
                <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                <div className="text-xs font-mono tabular-nums text-zinc-600">
                  Menganalisis halaman {extractProgress.current} dari {extractProgress.total}...
                </div>
              </div>
            ) : (
              <div className="divide-y divide-zinc-200 max-h-[600px] overflow-y-auto">
                {pages.map((page) => (
                  <div key={page.pageNumber} className="p-4 space-y-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono font-medium text-zinc-700">
                        Halaman {String(page.pageNumber).padStart(2, '0')}
                      </span>
                      <span className="font-mono tabular-nums text-zinc-400">
                        {Math.round(page.widthPt)} × {Math.round(page.heightPt)} pt
                      </span>
                    </div>

                    {wordMode === 'structured' ? (
                      <textarea
                        rows={Math.min(10, Math.max(4, page.rawText.split('\n').length + 1))}
                        value={editedTexts[page.pageNumber] ?? page.rawText}
                        onChange={(e) =>
                          setEditedTexts((prev) => ({
                            ...prev,
                            [page.pageNumber]: e.target.value,
                          }))
                        }
                        placeholder="Halaman ini tidak memiliki lapisan teks yang terbaca. Anda dapat mengetik teks manual atau gunakan mode Gambar Halaman."
                        className="w-full p-3 text-xs text-zinc-800 bg-zinc-50/60 border border-zinc-200 rounded-md leading-relaxed focus:outline-none focus:border-blue-600 focus:bg-white"
                      />
                    ) : (
                      <div className="border border-zinc-200 rounded bg-zinc-50 p-3 flex justify-center">
                        <img
                          src={page.previewDataUrl}
                          alt={`Pratinjau halaman ${page.pageNumber}`}
                          className="max-h-72 object-contain border border-zinc-200 bg-white"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Conversion Controls */}
          <div className="bg-white border border-zinc-200 rounded-lg p-5 space-y-4">
            <h2 className="text-sm font-semibold text-zinc-900">Mode Konversi Word</h2>

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setWordMode('structured')}
                className={`w-full p-3 text-left rounded-md border transition-colors ${
                  wordMode === 'structured'
                    ? 'border-[#E5322D] bg-red-50/40'
                    : 'border-zinc-200 hover:bg-zinc-50'
                }`}
              >
                <div className="text-xs font-semibold text-zinc-900">
                  Teks Terstruktur (Dapat Disunting)
                </div>
                <div className="text-[11px] text-zinc-500 mt-0.5 leading-relaxed">
                  Mengekstrak judul dan paragraf menjadi teks asli Word. Anda juga bisa meninjau & menyunting teks di sebelah kiri sebelum ekspor.
                </div>
              </button>

              <button
                type="button"
                onClick={() => setWordMode('visual')}
                className={`w-full p-3 text-left rounded-md border transition-colors ${
                  wordMode === 'visual'
                    ? 'border-[#E5322D] bg-red-50/40'
                    : 'border-zinc-200 hover:bg-zinc-50'
                }`}
              >
                <div className="text-xs font-semibold text-zinc-900">
                  Layout Gambar Halaman
                </div>
                <div className="text-[11px] text-zinc-500 mt-0.5 leading-relaxed">
                  Menyematkan tampilan visual tiap halaman ke dalam .docx. Cocok untuk PDF hasil pindaian (scan) atau tabel rumit.
                </div>
              </button>
            </div>

            <div className="space-y-1.5 pt-2 border-t border-zinc-200">
              <label className="block text-xs font-medium text-zinc-700">
                Nama Berkas Hasil
              </label>
              <div className="flex items-center border border-zinc-200 rounded-md overflow-hidden focus-within:border-blue-600">
                <input
                  type="text"
                  value={outputName}
                  onChange={(e) => setOutputName(e.target.value)}
                  className="flex-1 px-3 py-2 text-xs text-zinc-900 bg-white focus:outline-none min-w-0"
                />
                <span className="px-2.5 py-2 text-xs font-mono text-zinc-500 bg-zinc-50 border-l border-zinc-200">
                  .docx
                </span>
              </div>
            </div>

            <button
              type="button"
              disabled={isExporting || pages.length === 0}
              onClick={handleExportDocx}
              className="w-full py-3 px-4 text-sm font-semibold bg-[#E5322D] text-white rounded-lg hover:bg-[#C8231E] disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {isExporting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Menyusun .docx...</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>Ekspor & Unduh Word (.docx)</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
