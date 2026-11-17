import React from 'react';
import { X, Download, Trash2, FileText } from 'lucide-react';
import type { SessionExportItem } from '../types/pdf';
import { formatBytes } from '../utils/pdfEngine';

interface SessionHistoryDrawerProps {
  isOpen: boolean;
  history: SessionExportItem[];
  onClose: () => void;
  onClearHistory: () => void;
}

const TOOL_NAMES: Record<SessionExportItem['tool'], string> = {
  merge: 'Gabung PDF',
  split: 'Pisah PDF',
  'to-pdf': 'Konversi ke PDF',
  'to-word': 'Konversi ke Word',
  edit: 'Edit PDF',
};

export function SessionHistoryDrawer({
  isOpen,
  history,
  onClose,
  onClearHistory,
}: SessionHistoryDrawerProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-zinc-950/35" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm bg-white border-l border-zinc-200 h-full flex flex-col">
        <div className="h-14 px-5 border-b border-zinc-200 flex items-center justify-between shrink-0">
          <h2 className="text-sm font-semibold text-zinc-900">
            Riwayat Ekspor Sesi Ini
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-800 rounded"
            aria-label="Tutup riwayat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {history.length === 0 ? (
            <div className="py-16 text-center space-y-2">
              <FileText className="w-8 h-8 text-zinc-300 mx-auto" />
              <p className="text-xs text-zinc-500">
                Belum ada berkas yang diekspor pada sesi ini.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-zinc-200">
              {history.map((item) => (
                <li
                  key={item.id}
                  className="py-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-zinc-900 truncate">
                      {item.filename}
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-zinc-500 mt-0.5">
                      {TOOL_NAMES[item.tool]} · {formatBytes(item.sizeBytes)}
                      {item.pageCount ? ` · ${item.pageCount} hal` : ''}
                    </div>
                  </div>
                  <a
                    href={item.blobUrl}
                    download={item.filename}
                    className="px-2.5 py-1.5 text-xs font-medium bg-zinc-100 hover:bg-zinc-200 text-zinc-800 rounded flex items-center gap-1 shrink-0"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Unduh</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>

        {history.length > 0 && (
          <div className="p-4 border-t border-zinc-200 bg-zinc-50 shrink-0">
            <button
              type="button"
              onClick={onClearHistory}
              className="w-full py-2 text-xs font-medium text-zinc-600 hover:text-red-600 border border-zinc-200 bg-white rounded-md flex items-center justify-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Bersihkan Riwayat</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
