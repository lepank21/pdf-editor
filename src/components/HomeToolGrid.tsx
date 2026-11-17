import React from 'react';
import {
  Combine,
  Scissors,
  ArrowRight,
  ShieldCheck,
  Lock,
  Zap,
  CheckCircle2,
  HelpCircle,
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
];

const FAQS = [
  {
    question: 'Apakah berkas dokumen saya aman?',
    answer:
      'Sangat aman. LembarPDF memproses seluruh dokumen Anda secara lokal di dalam peramban (client-side) menggunakan WebAssembly dan pustaka browser. Berkas tidak pernah diunggah atau disimpan ke server mana pun.',
  },
  {
    question: 'Apakah ada batasan ukuran berkas atau jumlah halaman?',
    answer:
      'Tidak ada batasan buatan. Kapasitas pengolahan dokumen bergantung sepenuhnya pada memori perangkat Anda, sehingga Anda bebas menggabungkan atau memisahkan dokumen berukuran besar sekalipun.',
  },
  {
    question: 'Apakah ada watermark pada hasil ekspor PDF?',
    answer:
      'Tidak ada. Hasil berkas PDF yang Anda unduh adalah dokumen bersih tanpa watermark, tanpa logo, dan tanpa penurunan kualitas.',
  },
  {
    question: 'Apakah LembarPDF dapat digunakan di ponsel (smartphone)?',
    answer:
      'Ya! Tampilan LembarPDF dirancang responsif sehingga Anda bisa menggabungkan atau memisahkan halaman PDF langsung dari browser Android maupun iOS.',
  },
];

export function HomeToolGrid({ onSelectTool }: HomeToolGridProps) {
  return (
    <div className="max-w-5xl mx-auto py-8 sm:py-12 px-4 space-y-16">
      {/* Centered Hero Section */}
      <section className="text-center max-w-2xl mx-auto space-y-3">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900 text-balance">
          Gabung &amp; Pisah PDF Online Cepat, Gratis &amp; Privat
        </h1>
        <p className="text-sm sm:text-base text-zinc-600 leading-relaxed">
          Olah dokumen PDF Anda secara instan langsung di peramban tanpa antrean, tanpa batasan, dan tanpa pernah mengunggah berkas ke server pihak ketiga.
        </p>
      </section>

      {/* 2-Tool Action Card Grid */}
      <section aria-label="Alat Utama Pengolahan PDF">
        <div className="grid grid-cols-1 sm:grid-cols-2 max-w-2xl mx-auto gap-5">
          {TOOLS.map((tool) => {
            const Icon = tool.icon;
            return (
              <button
                key={tool.id}
                type="button"
                onClick={() => onSelectTool(tool.id)}
                className="group bg-white border border-zinc-200 rounded-lg p-6 text-left transition-all duration-150 hover:border-zinc-400 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5322D] flex flex-col justify-between shadow-xs"
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

        {/* Privacy Badge */}
        <div className="pt-6 flex items-center justify-center gap-2 text-xs text-zinc-500">
          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>
            100% pemrosesan lokal di browser · Berkas Anda tidak pernah dikirim ke internet
          </span>
        </div>
      </section>

      {/* Feature Highlights for SEO */}
      <section aria-label="Keunggulan LembarPDF" className="pt-6 border-t border-zinc-200">
        <div className="text-center max-w-xl mx-auto mb-8 space-y-1">
          <h2 className="text-xl font-bold tracking-tight text-zinc-900">
            Mengapa Menggunakan LembarPDF?
          </h2>
          <p className="text-xs sm:text-sm text-zinc-500">
            Solusi pengolahan PDF yang aman dan efisien untuk kebutuhan kerja, perkantoran, dan tugas harian.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-4xl mx-auto">
          <div className="bg-white border border-zinc-200 rounded-lg p-5 space-y-2">
            <div className="w-8 h-8 rounded-md bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
              <Lock className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-semibold text-zinc-900">Privasi &amp; Keamanan Mutlak</h3>
            <p className="text-xs text-zinc-600 leading-relaxed">
              Berkas rahasia, laporan keuangan, atau dokumen dinas Anda diproses langsung di RAM komputer tanpa melewati server eksternal.
            </p>
          </div>

          <div className="bg-white border border-zinc-200 rounded-lg p-5 space-y-2">
            <div className="w-8 h-8 rounded-md bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
              <Zap className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-semibold text-zinc-900">Kecepatan Instan Tanpa Upload</h3>
            <p className="text-xs text-zinc-600 leading-relaxed">
              Tidak perlu membuang waktu menunggu unggahan dan unduhan server. Semua proses kalkulasi PDF selesai dalam hitungan detik.
            </p>
          </div>

          <div className="bg-white border border-zinc-200 rounded-lg p-5 space-y-2">
            <div className="w-8 h-8 rounded-md bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-semibold text-zinc-900">100% Gratis Tanpa Batasan</h3>
            <p className="text-xs text-zinc-600 leading-relaxed">
              Bebas digunakan kapan saja tanpa registrasi akun, tanpa batasan kuota harian, dan bebas watermark.
            </p>
          </div>
        </div>
      </section>

      {/* FAQ Section with Semantic HTML */}
      <section aria-label="Pertanyaan yang Sering Diajukan" className="pt-6 border-t border-zinc-200">
        <div className="text-center max-w-xl mx-auto mb-8 space-y-1">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-100 text-zinc-700 text-xs font-medium mb-2">
            <HelpCircle className="w-3.5 h-3.5 text-[#E5322D]" />
            <span>Tanya Jawab</span>
          </div>
          <h2 className="text-xl font-bold tracking-tight text-zinc-900">
            Pertanyaan yang Sering Diajukan
          </h2>
          <p className="text-xs sm:text-sm text-zinc-500">
            Segala hal yang perlu Anda ketahui mengenai keamanan dan penggunaan LembarPDF.
          </p>
        </div>

        <div className="max-w-2xl mx-auto space-y-3">
          {FAQS.map((faq, idx) => (
            <details
              key={idx}
              className="group bg-white border border-zinc-200 rounded-lg p-4 transition-colors hover:border-zinc-300"
            >
              <summary className="font-medium text-sm text-zinc-900 cursor-pointer list-none flex items-center justify-between gap-3 select-none">
                <span>{faq.question}</span>
                <span className="text-zinc-400 group-open:rotate-180 transition-transform text-xs">
                  ▼
                </span>
              </summary>
              <p className="mt-2.5 text-xs text-zinc-600 leading-relaxed pt-2 border-t border-zinc-100">
                {faq.answer}
              </p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
