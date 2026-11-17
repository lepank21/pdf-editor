import { useState } from 'react';
import { ArrowLeft, Menu, X } from 'lucide-react';
import type { SessionExportItem, ToolId } from './types/pdf';
import { TopNav } from './components/TopNav';
import { HomeToolGrid } from './components/HomeToolGrid';
import { SessionHistoryDrawer } from './components/SessionHistoryDrawer';
import { MergeWorkspace } from './components/MergeWorkspace';
import { SplitWorkspace } from './components/SplitWorkspace';
import { ToPdfWorkspace } from './components/ToPdfWorkspace';
import { ToWordWorkspace } from './components/ToWordWorkspace';
import { EditorWorkspace } from './components/EditorWorkspace';

const MOBILE_TOOLS: Array<{ id: ToolId; label: string }> = [
  { id: 'merge', label: 'Gabung PDF' },
  { id: 'split', label: 'Pisah PDF' },
  { id: 'to-pdf', label: 'Konversi ke PDF' },
  { id: 'to-word', label: 'Konversi ke Word' },
  { id: 'edit', label: 'Edit PDF' },
];

export default function App() {
  const [activeView, setActiveView] = useState<ToolId | 'home'>('home');
  const [history, setHistory] = useState<SessionExportItem[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const handleExported = (item: SessionExportItem) => {
    setHistory((prev) => [item, ...prev].slice(0, 12));
  };

  const handleClearHistory = () => {
    for (const item of history) {
      URL.revokeObjectURL(item.blobUrl);
    }
    setHistory([]);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F5F5F7] text-zinc-900">
      <TopNav
        activeTool={activeView}
        onNavigate={(target) => {
          setActiveView(target);
          setMobileNavOpen(false);
        }}
        historyCount={history.length}
        onOpenHistory={() => setIsHistoryOpen(true)}
      />

      {/* Mobile Navigation Sub-bar (only on < md) */}
      <div className="md:hidden bg-white border-b border-zinc-200 px-4 py-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setMobileNavOpen((v) => !v)}
          className="flex items-center gap-2 text-xs font-medium text-zinc-700"
        >
          {mobileNavOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          <span>{mobileNavOpen ? 'Tutup Menu Alat' : 'Pilih Alat PDF'}</span>
        </button>
        {activeView !== 'home' && (
          <button
            type="button"
            onClick={() => setActiveView('home')}
            className="text-xs font-medium text-[#E5322D] flex items-center gap-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Semua Alat</span>
          </button>
        )}
      </div>

      {mobileNavOpen && (
        <div className="md:hidden bg-white border-b border-zinc-200 px-4 py-2 flex flex-wrap gap-2">
          {MOBILE_TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setActiveView(t.id);
                setMobileNavOpen(false);
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md border ${
                activeView === t.id
                  ? 'border-[#E5322D] bg-red-50 text-[#E5322D]'
                  : 'border-zinc-200 text-zinc-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 w-full">
        {activeView === 'home' ? (
          <HomeToolGrid onSelectTool={(tool) => setActiveView(tool)} />
        ) : (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
            <div className="mb-4 hidden md:block">
              <button
                type="button"
                onClick={() => setActiveView('home')}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-900 transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Kembali ke Semua Alat</span>
              </button>
            </div>

            {activeView === 'merge' && <MergeWorkspace onExported={handleExported} />}
            {activeView === 'split' && <SplitWorkspace onExported={handleExported} />}
            {activeView === 'to-pdf' && <ToPdfWorkspace onExported={handleExported} />}
            {activeView === 'to-word' && <ToWordWorkspace onExported={handleExported} />}
            {activeView === 'edit' && <EditorWorkspace onExported={handleExported} />}
          </div>
        )}
      </main>

      <SessionHistoryDrawer
        isOpen={isHistoryOpen}
        history={history}
        onClose={() => setIsHistoryOpen(false)}
        onClearHistory={handleClearHistory}
      />
    </div>
  );
}
