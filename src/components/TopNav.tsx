import React from 'react';
import { History } from 'lucide-react';
import type { ToolId } from '../types/pdf';

interface TopNavProps {
  activeTool: ToolId | 'home';
  onNavigate: (target: ToolId | 'home') => void;
  historyCount: number;
  onOpenHistory: () => void;
}

const NAV_ITEMS: Array<{ id: ToolId; label: string }> = [
  { id: 'merge', label: 'Gabung PDF' },
  { id: 'split', label: 'Pisah PDF' },
  { id: 'compress', label: 'Kompres PDF' },
];

export function TopNav({
  activeTool,
  onNavigate,
  historyCount,
  onOpenHistory,
}: TopNavProps) {
  return (
    <header className="h-14 bg-white border-b border-zinc-200 px-4 sm:px-6 flex items-center justify-between gap-8 shrink-0">
      {/* Zone 1: Brand Wordmark */}
      <button
        type="button"
        onClick={() => onNavigate('home')}
        className="text-lg font-bold tracking-tight text-zinc-900 whitespace-nowrap shrink-0 hover:text-[#E5322D] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5322D] rounded"
      >
        Lembar<span className="text-[#E5322D]">PDF</span>
      </button>

      {/* Zone 2: 5 Single-Line Navigation Links */}
      <nav
        aria-label="Navigasi Alat PDF"
        className="hidden md:flex items-center gap-6 overflow-x-auto"
      >
        {NAV_ITEMS.map((item) => {
          const isActive = activeTool === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              className={`relative py-4 text-sm font-medium whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none ${
                isActive
                  ? 'text-[#E5322D]'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              {item.label}
              {isActive && (
                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-[#E5322D]" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Zone 3: 1 Primary Action */}
      <div className="flex items-center shrink-0">
        <button
          type="button"
          onClick={onOpenHistory}
          className="px-3.5 py-2 text-xs font-medium bg-zinc-900 text-white rounded-md hover:bg-zinc-800 transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
        >
          <History className="w-3.5 h-3.5" />
          <span>Riwayat{historyCount > 0 ? ` (${historyCount})` : ''}</span>
        </button>
      </div>
    </header>
  );
}
