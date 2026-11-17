import React from 'react';
import {
  Combine,
  Scissors,
  FilePlus2,
  FileText,
  PenTool,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import type { ToolId } from '../types/pdf';

interface HomeToolGridProps {
  onSelectTool: (tool: ToolId) => void;
}

const TOOLS: Array<{
  id: ToolId;
  title: string;
  description: string;
  formats: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  iconBg: string;
}> = [
  {
    id: 'merge',
    title: 'Gabung PDF',
    description:
      'Satukan beberapa berkas PDF sekaligus sesuai urutan yang Anda inginkan dalam hitungan detik.',
    formats: 'PDF + PDF',
    icon: Combine,
    iconColor: 'text-[#E5322D]',
    iconBg: 'bg-red-50 border-red-200/70',
  },
  {
    id: 'split',
    title: 'Pisah PDF',
    description:
      'Ekstrak halaman pilihan, pisahkan per beberapa halaman, atau pecah tiap halaman menjadi berkas terpisah.',
    formats: 'PDF · ZIP',
    icon: Scissors,
    iconColor: 'text-amber-600',
    iconBg: 'bg-amber-50 border-amber-200/70',
  },
  {
    id: 'to-pdf',
    title: 'Konversi ke PDF',
    description:
      'Ubah dokumen Word (.docx), gambar (PNG, JPG, WebP), atau teks menjadi PDF dengan format tetap terjaga.',
    formats: 'DOCX · IMG · TXT',
    icon: FilePlus2,
    iconColor: 'text-emerald-600',
    iconBg: 'bg-emerald-50 border-emerald-200/70',
  },
  {
    id: 'to-word',
    title: 'Konversi ke Word',
    description:
      'Ekstrak teks terstruktur atau layout halaman dari dokumen PDF ke format Microsoft Word (.docx).',
    formats: 'PDF → DOCX',
    icon: FileText,
    iconColor: 'text-blue-600',
    iconBg: 'bg-blue-50 border-blue-200/70',
  },
  {
    id: 'edit',
    title: 'Edit PDF',
    description:
      'Tambahkan teks, tanda tangan digital, gambar, stabilo, serta putar, hapus, dan susun ulang halaman.',
    formats: 'Editor Kanvas',
    icon: PenTool,
    iconColor: 'text-violet-600',
    iconBg: 'bg-violet-50 border-violet-200/70',
  },
];

export function HomeToolGrid({ onSelectTool }: HomeToolGridProps) {
  return (
    <div className="max-w-5xl mx-auto py-8 sm:py-12 px-4 space-y-10">
      {/* Centered Hero */}
      <div className="text-center max-w-2xl mx-auto space-y-3">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900 text-balance">
          Semua alat yang Anda butuhkan untuk mengolah PDF
        </h1>
        <p className="text-sm sm:text-base text-zinc-600 leading-relaxed">
          Gabungkan, pisahkan, konversi, dan edit dokumen PDF Anda secara instan langsung di browser tanpa mengunggah berkas ke server.
        </p>
      </div>

      {/* 5-Tool Card Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {TOOLS.map((tool) => {
          const Icon = tool.icon;
          return (
            <button
              key={tool.id}
              type="button"
              onClick={() => onSelectTool(tool.id)}
              className="group bg-white border border-zinc-200 rounded-lg p-6 text-left transition-all duration-150 hover:border-zinc-400 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5322D] flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div
                    className={`w-11 h-11 rounded-lg border flex items-center justify-center ${tool.iconBg}`}
                  >
                    <Icon className={`w-5 h-5 ${tool.iconColor}`} />
                  </div>
                  <span className="text-[11px] font-mono text-zinc-400">
                    {tool.formats}
                  </span>
                </div>

                <h2 className="mt-4 text-base font-semibold text-zinc-900 group-hover:text-[#E5322D] transition-colors">
                  {tool.title}
                </h2>
                <p className="mt-1.5 text-xs text-zinc-500 leading-relaxed">
                  {tool.description}
                </p>
              </div>

              <div className="mt-5 pt-3 border-t border-zinc-100 flex items-center justify-between text-xs font-medium text-zinc-700 group-hover:text-[#E5322D]">
                <span>Buka Alat</span>
                <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
              </div>
            </button>
          );
        })}
      </div>

      {/* Subtle Privacy Footer Note */}
      <div className="pt-4 flex items-center justify-center gap-2 text-xs text-zinc-500">
        <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
        <span>
          100% pemrosesan lokal di perangkat Anda · Berkas dokumen tidak pernah meninggalkan browser
        </span>
      </div>
    </div>
  );
}
