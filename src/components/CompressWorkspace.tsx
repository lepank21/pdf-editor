import React, { useState, useCallback } from 'react';
import { FileDown, CheckCircle2, AlertCircle, RotateCcw, Info } from 'lucide-react';
import type { SessionExportItem } from '../types/pdf';
import { compressPdf, formatBytes, triggerDownload } from '../utils/pdfEngine';
import { FileDropzone } from './FileDropzone';

interface CompressWorkspaceProps {
  onExported: (item: SessionExportItem) => void;
}

type Level = 'low' | 'medium' | 'high';
type Phase = 'idle' | 'compressing' | 'done' | 'error';

const LEVELS: Array<{
  id: Level;
  label: string;
  desc: string;
  badge: string;
  badgeColor: string;
  activeClass: string;
}> = [
  {
    id: 'low',
    label: 'Ringan',
    desc: 'Kualitas terjaga. Kompresi ~15–25%.',
    badge: 'Kualitas Tinggi',
    badgeColor: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    activeClass: 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-400',
  },
  {
    id: 'medium',
    label: 'Sedang',
    desc: 'Keseimbangan ukuran & kualitas. Kompresi ~40–55%.',
    badge: 'Direkomendasikan',
    badgeColor: 'text-blue-700 bg-blue-50 border-blue-200',
    activeClass: 'border-blue-500 bg-blue-50 ring-2 ring-blue-400',
  },
  {
    id: 'high',
    label: 'Tinggi',
    desc: 'Ukuran terkecil. Cocok untuk email & upload cepat. Kompresi ~60–75%.',
    badge: 'Ukuran Terkecil',
    badgeColor: 'text-purple-700 bg-purple-50 border-purple-200',
    activeClass: 'border-purple-500 bg-purple-50 ring-2 ring-purple-400',
  },
];

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function CompressWorkspace({ onExported }: CompressWorkspaceProps) {
  const [file, setFile]           = useState<File | null>(null);
  const [fileBytes, setFileBytes] = useState<Uint8Array | null>(null);
  const [level, setLevel]         = useState<Level>('medium');
  const [phase, setPhase]         = useState<Phase>('idle');
  const [progress, setProgress]   = useState({ current: 0, total: 0 });
  const [error, setError]         = useState<string | null>(null);
  const [result, setResult]       = useState<{
    bytes: Uint8Array;
    pageCount: number;
    origSize: number;
    compSize: number;
    filename: string;
    blobUrl: string;
  } | null>(null);

  const handleFilesSelected = useCallback((files: File[]) => {
    const f = files[0];
    if (!f) return;
    if (f.type !== 'application/pdf') {
      setError('Hanya berkas PDF yang didukung.');
      return;
    }
    setError(null);
    setResult(null);
    setPhase('idle');
    setFile(f);
    const reader = new FileReader();
    reader.onload = (e) => {
      setFileBytes(new Uint8Array(e.target!.result as ArrayBuffer));
    };
    reader.readAsArrayBuffer(f);
  }, []);

  const handleCompress = useCallback(async () => {
    if (!fileBytes || !file) return;
    setPhase('compressing');
    setError(null);
    setProgress({ current: 0, total: 0 });
    try {
      const { bytes, pageCount } = await compressPdf(fileBytes, level, (cur, tot) =>
        setProgress({ current: cur, total: tot })
      );
      const blob    = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
      const blobUrl = URL.createObjectURL(blob);
      const baseName = file.name.replace(/\.pdf$/i, '');
      const filename = `${baseName}_kompres.pdf`;
      setResult({ bytes, pageCount, origSize: file.size, compSize: bytes.byteLength, filename, blobUrl });
      setPhase('done');
      onExported({
        id: generateId(),
        filename,
        tool: 'compress',
        sizeBytes: bytes.byteLength,
        pageCount,
        blobUrl,
        createdAt: Date.now(),
      });
    } catch (e: unknown) {
      setPhase('error');
      setError(e instanceof Error ? e.message : 'Gagal mengompres PDF. Coba lagi.');
    }
  }, [fileBytes, file, level, onExported]);

  const handleDownload = () => {
    if (!result) return;
    triggerDownload(new Blob([result.bytes.buffer as ArrayBuffer], { type: 'application/pdf' }), result.filename);
  };

  const handleReset = () => {
    if (result?.blobUrl) URL.revokeObjectURL(result.blobUrl);
    setFile(null);
    setFileBytes(null);
    setResult(null);
    setPhase('idle');
    setError(null);
    setProgress({ current: 0, total: 0 });
  };

  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  const reduction =
    result && result.origSize > 0
      ? Math.round(((result.origSize - result.compSize) / result.origSize) * 100)
      : 0;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-xl font-bold tracking-tight text-zinc-900">Kompres PDF</h1>
        <p className="text-sm text-zinc-500">
          Kurangi ukuran berkas PDF langsung di browser tanpa mengunggah ke server.
        </p>
      </div>

      {/* Dropzone — hidden when result is shown */}
      {phase !== 'done' && (
        <FileDropzone
          accept=".pdf,application/pdf"
          multiple={false}
          title={file ? file.name : 'Unggah Berkas PDF'}
          description={
            file
              ? `${formatBytes(file.size)} · Berkas siap dikompres`
              : 'Seret berkas PDF ke sini, atau klik tombol di bawah untuk memilih berkas dari komputer Anda.'
          }
          formatHint={file ? '' : 'PDF · Ukuran maks. bergantung pada RAM perangkat'}
          onFilesSelected={handleFilesSelected}
          compact={!!file}
        />
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Level Selector + Compress button */}
      {file && phase === 'idle' && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-zinc-700">Pilih Tingkat Kompresi</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {LEVELS.map((lv) => {
              const isActive = level === lv.id;
              return (
                <button
                  key={lv.id}
                  type="button"
                  onClick={() => setLevel(lv.id)}
                  className={`text-left rounded-lg border p-4 transition-all focus-visible:outline-none focus-visible:ring-2 ${
                    isActive ? lv.activeClass : 'border-zinc-200 bg-white hover:border-zinc-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-sm font-semibold text-zinc-900">{lv.label}</span>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${lv.badgeColor}`}>
                      {lv.badge}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500 leading-relaxed">{lv.desc}</p>
                </button>
              );
            })}
          </div>

          <div className="flex items-start gap-2 text-xs text-zinc-500 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2.5">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-zinc-400" />
            <span>
              Hasil terbaik pada PDF yang banyak mengandung gambar atau foto. PDF berisi teks murni
              mungkin tidak terkompres secara signifikan.
            </span>
          </div>

          <button
            type="button"
            onClick={handleCompress}
            className="w-full py-2.5 text-sm font-semibold bg-[#E5322D] hover:bg-red-700 text-white rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5322D]"
          >
            Kompres PDF Sekarang
          </button>
        </div>
      )}

      {/* Progress */}
      {phase === 'compressing' && (
        <div className="space-y-3 bg-white border border-zinc-200 rounded-lg p-5">
          <p className="text-sm font-medium text-zinc-700">
            Mengompres halaman {progress.current} dari {progress.total}…
          </p>
          <div className="w-full bg-zinc-100 rounded-full h-2 overflow-hidden">
            <div
              className="h-2 bg-[#E5322D] rounded-full transition-all duration-200"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs text-zinc-400 tabular-nums">{pct}%</p>
        </div>
      )}

      {/* Result */}
      {phase === 'done' && result && (
        <div className="space-y-4">
          <div className="flex items-center gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 font-medium">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>PDF berhasil dikompres!</span>
          </div>

          <div className="bg-white border border-zinc-200 rounded-lg p-5 space-y-4">
            <p className="text-sm font-semibold text-zinc-900">Perbandingan Ukuran</p>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="space-y-0.5">
                <p className="text-[11px] text-zinc-400">Sebelum</p>
                <p className="text-sm font-semibold text-zinc-700 tabular-nums">
                  {formatBytes(result.origSize)}
                </p>
              </div>
              <div className="flex items-center justify-center">
                <span className="text-xs font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1 tabular-nums">
                  −{reduction}%
                </span>
              </div>
              <div className="space-y-0.5">
                <p className="text-[11px] text-zinc-400">Sesudah</p>
                <p className="text-sm font-semibold text-zinc-700 tabular-nums">
                  {formatBytes(result.compSize)}
                </p>
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="relative h-3 bg-zinc-100 rounded-full overflow-hidden">
                <div
                  className="h-3 bg-emerald-400 rounded-full"
                  style={{ width: `${Math.max(5, 100 - reduction)}%` }}
                />
              </div>
              <p className="text-[11px] text-zinc-400">
                {result.pageCount} halaman · {result.filename}
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={handleDownload}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold bg-[#E5322D] hover:bg-red-700 text-white rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5322D]"
            >
              <FileDown className="w-4 h-4" />
              Unduh PDF Terkompres
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 rounded-lg transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Kompres Berkas Lain
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
