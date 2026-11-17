import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import {
  MousePointer2,
  Type,
  PenLine,
  ImagePlus,
  Highlighter,
  Square,
  Signature,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Copy,
  Trash2,
  ArrowUp,
  ArrowDown,
  Download,
  RefreshCw,
  Loader2,
  AlertCircle,
  FileCheck2,
  Bold,
  Italic,
} from 'lucide-react';
import type {
  EditorElement,
  EditorPageState,
  EditorToolType,
  ImageEditorElement,
  PathEditorElement,
  RectEditorElement,
  SessionExportItem,
  TextEditorElement,
} from '../types/pdf';
import {
  createSamplePdfBytes,
  exportEditedPdf,
  formatBytes,
  renderSingleThumbnail,
  triggerDownload,
} from '../utils/pdfEngine';
import { FileDropzone } from './FileDropzone';
import { SignatureModal } from './SignatureModal';

interface EditorWorkspaceProps {
  onExported: (item: SessionExportItem) => void;
}

const COLOR_SWATCHES = ['#18181b', '#2563eb', '#dc2626', '#16a34a', '#d97706', '#ffffff'];
const HIGHLIGHT_SWATCHES = ['#facc15', '#4ade80', '#60a5fa', '#f472b6'];

export function EditorWorkspace({ onExported }: EditorWorkspaceProps) {
  const [sourceFile, setSourceFile] = useState<{
    name: string;
    bytes: Uint8Array;
    sizeBytes: number;
  } | null>(null);
  const [pdfDocProxy, setPdfDocProxy] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState<EditorPageState[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [activePageId, setActivePageId] = useState<string | null>(null);

  // History for Undo/Redo
  const [undoStack, setUndoStack] = useState<EditorPageState[][]>([]);
  const [redoStack, setRedoStack] = useState<EditorPageState[][]>([]);

  // Tool & Selection State
  const [activeTool, setActiveTool] = useState<EditorToolType>('select');
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(1);

  // Default tool properties
  const [drawColor, setDrawColor] = useState('#2563eb');
  const [highlightColor, setHighlightColor] = useState('#facc15');
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [defaultFontSize, setDefaultFontSize] = useState(14);
  const [defaultTextColor, setDefaultTextColor] = useState('#18181b');

  // Interactive canvas drawing / dragging state
  const [draftPath, setDraftPath] = useState<PathEditorElement | null>(null);
  const [draftRect, setDraftRect] = useState<RectEditorElement | null>(null);
  const [dragState, setDragState] = useState<{
    mode: 'move' | 'resize';
    elementId: string;
    startX: number;
    startY: number;
    origEl: EditorElement;
    snapshot: EditorPageState[];
  } | null>(null);

  // Signature modal & saved signatures
  const [isSignatureOpen, setIsSignatureOpen] = useState(false);
  const [savedSignatures, setSavedSignatures] = useState<string[]>([]);

  // Page dimensions on screen
  const [pageViewportSize, setPageViewportSize] = useState<{ width: number; height: number }>({
    width: 595,
    height: 842,
  });
  const [isRenderingPage, setIsRenderingPage] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<{
    filename: string;
    sizeBytes: number;
    pageCount: number;
    url: string;
  } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const rectOriginRef = useRef<{ x: number; y: number } | null>(null);

  const activePageIndex = pages.findIndex((p) => p.id === activePageId);
  const activePage = activePageIndex >= 0 ? pages[activePageIndex] : null;
  const selectedElement =
    activePage?.elements.find((el) => el.id === selectedElementId) ?? null;

  const commitPagesChange = useCallback(
    (updater: (prev: EditorPageState[]) => EditorPageState[], recordHistory = true) => {
      setPages((prev) => {
        const next = updater(prev);
        if (recordHistory) {
          setUndoStack((u) => [...u.slice(-24), prev]);
          setRedoStack([]);
        }
        return next;
      });
    },
    []
  );

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((u) => u.slice(0, -1));
    setRedoStack((r) => [...r, pages]);
    setPages(previous);
    setSelectedElementId(null);
    if (previous.length > 0 && !previous.some((p) => p.id === activePageId)) {
      setActivePageId(previous[0].id);
    }
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((r) => r.slice(0, -1));
    setUndoStack((u) => [...u, pages]);
    setPages(next);
    setSelectedElementId(null);
    if (next.length > 0 && !next.some((p) => p.id === activePageId)) {
      setActivePageId(next[0].id);
    }
  };

  // Cleanup PDF proxy on unmount or file change
  useEffect(() => {
    return () => {
      pdfDocProxy?.cleanup();
    };
  }, [pdfDocProxy]);

  const loadPdfDocument = async (name: string, bytes: Uint8Array) => {
    setErrorMsg(null);
    setSuccessInfo(null);
    setSelectedElementId(null);
    setEditingTextId(null);
    setUndoStack([]);
    setRedoStack([]);

    try {
      const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
      setPdfDocProxy(doc);
      setSourceFile({ name, bytes, sizeBytes: bytes.byteLength });

      const initialPages: EditorPageState[] = Array.from(
        { length: doc.numPages },
        (_, idx) => ({
          id: `page-${idx + 1}-${Date.now()}`,
          sourcePageIndex: idx,
          rotation: 0,
          elements: [],
        })
      );
      setPages(initialPages);
      setActivePageId(initialPages[0]?.id ?? null);

      const thumbs: Record<string, string> = {};
      for (const p of initialPages) {
        thumbs[p.id] = await renderSingleThumbnail(doc, p.sourcePageIndex + 1);
      }
      setThumbnails(thumbs);
    } catch {
      setErrorMsg('Gagal membuka berkas PDF. Pastikan berkas valid dan tidak terenkripsi.');
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
    await loadPdfDocument(file.name, bytes);
  };

  const handleLoadSample = async () => {
    const bytes = await createSamplePdfBytes('laporan');
    await loadPdfDocument('Laporan_Proyek_Q4.pdf', bytes);
  };

  // Render active page on center canvas
  useEffect(() => {
    let cancelled = false;
    let renderTask: pdfjsLib.RenderTask | null = null;

    const render = async () => {
      if (!pdfDocProxy || !activePage || !canvasRef.current) return;
      setIsRenderingPage(true);

      try {
        const page = await pdfDocProxy.getPage(activePage.sourcePageIndex + 1);
        if (cancelled) return;

        const baseRotation = page.rotate || 0;
        const totalRotation = (baseRotation + activePage.rotation) % 360;

        // Logical display scale (base width ~680px * zoom)
        const unscaledViewport = page.getViewport({ scale: 1, rotation: totalRotation });
        const displayScale = (640 / unscaledViewport.width) * zoom;
        const displayViewport = page.getViewport({
          scale: displayScale,
          rotation: totalRotation,
        });

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const renderViewport = page.getViewport({
          scale: displayScale * dpr,
          rotation: totalRotation,
        });

        const canvas = canvasRef.current;
        canvas.width = Math.max(1, Math.floor(renderViewport.width));
        canvas.height = Math.max(1, Math.floor(renderViewport.height));

        setPageViewportSize({
          width: displayViewport.width,
          height: displayViewport.height,
        });

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          renderTask = page.render({
            canvasContext: ctx,
            viewport: renderViewport,
            canvas,
          });
          await renderTask.promise;
        }
      } catch {
        // Ignore cancelled renders
      } finally {
        if (!cancelled) setIsRenderingPage(false);
      }
    };

    render();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pdfDocProxy, activePage?.sourcePageIndex, activePage?.rotation, zoom]);

  // Page management handlers
  const rotatePage = async (pageId: string) => {
    const target = pages.find((p) => p.id === pageId);
    if (!target) return;
    const nextRotation = ((target.rotation + 90) % 360) as 0 | 90 | 180 | 270;

    commitPagesChange((prev) =>
      prev.map((p) => (p.id === pageId ? { ...p, rotation: nextRotation } : p))
    );

    if (pdfDocProxy) {
      const page = await pdfDocProxy.getPage(target.sourcePageIndex + 1);
      const thumbUrl = await renderSingleThumbnail(
        pdfDocProxy,
        target.sourcePageIndex + 1,
        (page.rotate + nextRotation) % 360
      );
      setThumbnails((prev) => ({ ...prev, [pageId]: thumbUrl }));
    }
  };

  const movePage = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= pages.length) return;
    commitPagesChange((prev) => {
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return next;
    });
  };

  const duplicatePage = (index: number) => {
    const orig = pages[index];
    if (!orig) return;
    const newId = `page-dup-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const copy: EditorPageState = {
      id: newId,
      sourcePageIndex: orig.sourcePageIndex,
      rotation: orig.rotation,
      elements: orig.elements.map((el) => ({
        ...el,
        id: `${el.id}-c-${Math.random().toString(36).slice(2, 5)}`,
      })),
    };
    commitPagesChange((prev) => {
      const next = [...prev];
      next.splice(index + 1, 0, copy);
      return next;
    });
    if (thumbnails[orig.id]) {
      setThumbnails((prev) => ({ ...prev, [newId]: thumbnails[orig.id] }));
    }
    setActivePageId(newId);
  };

  const deletePage = (pageId: string) => {
    if (pages.length <= 1) return;
    const idx = pages.findIndex((p) => p.id === pageId);
    commitPagesChange((prev) => prev.filter((p) => p.id !== pageId));
    if (activePageId === pageId) {
      const fallback = pages[idx + 1] ?? pages[idx - 1];
      setActivePageId(fallback?.id ?? null);
    }
    setSelectedElementId(null);
  };

  // Element updates
  const updateElement = (elementId: string, patch: Partial<EditorElement>, record = true) => {
    if (!activePage) return;
    commitPagesChange(
      (prev) =>
        prev.map((p) =>
          p.id !== activePage.id
            ? p
            : {
                ...p,
                elements: p.elements.map((el) =>
                  el.id === elementId ? ({ ...el, ...patch } as EditorElement) : el
                ),
              }
        ),
      record
    );
  };

  const deleteSelectedElement = () => {
    if (!activePage || !selectedElementId) return;
    commitPagesChange((prev) =>
      prev.map((p) =>
        p.id !== activePage.id
          ? p
          : { ...p, elements: p.elements.filter((el) => el.id !== selectedElementId) }
      )
    );
    setSelectedElementId(null);
    setEditingTextId(null);
  };

  // Insert signature or image
  const insertImageDataUrl = (dataUrl: string, kind: 'image' | 'signature') => {
    if (!activePage) return;
    const img = new Image();
    img.onload = () => {
      const aspect = (img.naturalHeight || 100) / Math.max(1, img.naturalWidth || 100);
      const normW = kind === 'signature' ? 0.28 : 0.3;
      const pageAspect = pageViewportSize.width / Math.max(1, pageViewportSize.height);
      const normH = Math.min(0.45, normW * aspect * pageAspect);

      const newEl: EditorElement = {
        id: `${kind}-${Date.now()}`,
        type: kind,
        x: 0.35,
        y: 0.4,
        width: normW,
        height: normH,
        dataUrl,
        aspectRatio: aspect,
      };

      commitPagesChange((prev) =>
        prev.map((p) =>
          p.id === activePage.id ? { ...p, elements: [...p.elements, newEl] } : p
        )
      );
      setSelectedElementId(newEl.id);
      setActiveTool('select');
    };
    img.src = dataUrl;
  };

  const handleUploadImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        insertImageDataUrl(reader.result, 'image');
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Overlay normalized coordinate helper
  const getNormalizedCoords = (clientX: number, clientY: number) => {
    const rect = overlayRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    };
  };

  const handleOverlayPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!activePage || !overlayRef.current) return;
    if (e.target !== overlayRef.current && activeTool === 'select') return;

    const { x, y } = getNormalizedCoords(e.clientX, e.clientY);

    if (activeTool === 'select') {
      setSelectedElementId(null);
      setEditingTextId(null);
      return;
    }

    if (activeTool === 'text') {
      const newText: TextEditorElement = {
        id: `txt-${Date.now()}`,
        type: 'text',
        x: Math.min(0.75, x),
        y: Math.min(0.92, y),
        width: 0.28,
        text: 'Teks baru',
        fontSize: defaultFontSize,
        color: defaultTextColor,
        bold: false,
        italic: false,
      };
      commitPagesChange((prev) =>
        prev.map((p) =>
          p.id === activePage.id ? { ...p, elements: [...p.elements, newText] } : p
        )
      );
      setSelectedElementId(newText.id);
      setEditingTextId(newText.id);
      setActiveTool('select');
      return;
    }

    if (activeTool === 'pen' || activeTool === 'highlighter') {
      overlayRef.current.setPointerCapture(e.pointerId);
      const isHighlight = activeTool === 'highlighter';
      setDraftPath({
        id: `path-${Date.now()}`,
        type: 'path',
        points: [{ x, y }],
        color: isHighlight ? highlightColor : drawColor,
        strokeWidth: isHighlight ? 14 : strokeWidth,
        opacity: isHighlight ? 0.35 : 1,
      });
      return;
    }

    if (activeTool === 'rect') {
      overlayRef.current.setPointerCapture(e.pointerId);
      rectOriginRef.current = { x, y };
      setDraftRect({
        id: `rect-${Date.now()}`,
        type: 'rect',
        x,
        y,
        width: 0,
        height: 0,
        strokeColor: drawColor,
        fillColor: drawColor,
        strokeWidth: 2,
        opacity: 0.85,
      });
    }
  };

  const handleOverlayPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!overlayRef.current) return;
    const { x, y } = getNormalizedCoords(e.clientX, e.clientY);

    if (draftPath) {
      setDraftPath((prev) =>
        prev ? { ...prev, points: [...prev.points, { x, y }] } : null
      );
      return;
    }

    if (draftRect && rectOriginRef.current) {
      const ox = rectOriginRef.current.x;
      const oy = rectOriginRef.current.y;
      setDraftRect((prev) =>
        prev
          ? {
              ...prev,
              x: Math.min(ox, x),
              y: Math.min(oy, y),
              width: Math.abs(x - ox),
              height: Math.abs(y - oy),
            }
          : null
      );
      return;
    }

    if (dragState && activePage) {
      const dx = x - dragState.startX;
      const dy = y - dragState.startY;
      const orig = dragState.origEl;

      if (dragState.mode === 'move') {
        if (orig.type === 'text' || orig.type === 'image' || orig.type === 'signature' || orig.type === 'rect') {
          updateElement(
            orig.id,
            {
              x: Math.max(0, Math.min(0.95, orig.x + dx)),
              y: Math.max(0, Math.min(0.95, orig.y + dy)),
            },
            false
          );
        } else if (orig.type === 'path') {
          updateElement(
            orig.id,
            {
              points: orig.points.map((pt) => ({
                x: Math.max(0, Math.min(1, pt.x + dx)),
                y: Math.max(0, Math.min(1, pt.y + dy)),
              })),
            },
            false
          );
        }
      } else if (dragState.mode === 'resize') {
        if (orig.type === 'image' || orig.type === 'signature') {
          const newW = Math.max(0.05, Math.min(0.9, orig.width + dx));
          const pageAspect = pageViewportSize.width / Math.max(1, pageViewportSize.height);
          const newH = newW * orig.aspectRatio * pageAspect;
          updateElement(orig.id, { width: newW, height: newH }, false);
        } else if (orig.type === 'rect') {
          updateElement(
            orig.id,
            {
              width: Math.max(0.02, Math.min(1 - orig.x, orig.width + dx)),
              height: Math.max(0.02, Math.min(1 - orig.y, orig.height + dy)),
            },
            false
          );
        } else if (orig.type === 'text') {
          updateElement(
            orig.id,
            {
              width: Math.max(0.1, Math.min(1 - orig.x, orig.width + dx)),
            },
            false
          );
        }
      }
    }
  };

  const handleOverlayPointerUp = () => {
    if (draftPath && activePage) {
      if (draftPath.points.length >= 2) {
        commitPagesChange((prev) =>
          prev.map((p) =>
            p.id === activePage.id ? { ...p, elements: [...p.elements, draftPath] } : p
          )
        );
      }
      setDraftPath(null);
    }

    if (draftRect && activePage) {
      if (draftRect.width > 0.01 && draftRect.height > 0.01) {
        commitPagesChange((prev) =>
          prev.map((p) =>
            p.id === activePage.id ? { ...p, elements: [...p.elements, draftRect] } : p
          )
        );
        setSelectedElementId(draftRect.id);
      }
      setDraftRect(null);
      rectOriginRef.current = null;
    }

    if (dragState) {
      setUndoStack((u) => [...u.slice(-24), dragState.snapshot]);
      setRedoStack([]);
      setDragState(null);
    }
  };

  const startElementDrag = (
    e: React.PointerEvent,
    el: EditorElement,
    mode: 'move' | 'resize'
  ) => {
    if (activeTool !== 'select' || !overlayRef.current) return;
    e.stopPropagation();
    setSelectedElementId(el.id);
    if (editingTextId && editingTextId !== el.id) {
      setEditingTextId(null);
    }
    const { x, y } = getNormalizedCoords(e.clientX, e.clientY);
    setDragState({
      mode,
      elementId: el.id,
      startX: x,
      startY: y,
      origEl: el,
      snapshot: pages,
    });
  };

  const handleExport = async () => {
    if (!sourceFile || pages.length === 0) return;
    setErrorMsg(null);
    setIsExporting(true);
    try {
      const outBytes = await exportEditedPdf(sourceFile.bytes, pages);
      const base = sourceFile.name.replace(/\.pdf$/i, '');
      const filename = `${base}_diedit.pdf`;
      const blob = new Blob([new Uint8Array(outBytes)], { type: 'application/pdf' });
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
        tool: 'edit',
        sizeBytes: blob.size,
        pageCount: pages.length,
        blobUrl: url,
        createdAt: Date.now(),
      });
    } catch {
      setErrorMsg('Gagal menyimpan hasil penyuntingan PDF.');
    } finally {
      setIsExporting(false);
    }
  };

  if (!sourceFile) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="pb-4 border-b border-zinc-200">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
            Edit Dokumen PDF
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Tambahkan teks, tanda tangan, gambar, coretan stabilo, serta putar, hapus, atau susun ulang halaman PDF.
          </p>
        </div>

        {errorMsg && (
          <div className="flex items-start gap-2.5 p-3.5 rounded-md border border-red-200 bg-red-50 text-xs text-red-700">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        <FileDropzone
          accept=".pdf,application/pdf"
          title="Buka berkas PDF di Studio Editor"
          description="Sunting isi halaman secara visual dan kelola urutan halaman tanpa mengirim dokumen ke server."
          formatHint="Format: .PDF · Mendukung teks, tanda tangan, gambar, coretan, & rotasi halaman"
          onFilesSelected={handleFilesSelected}
          onLoadSample={handleLoadSample}
        />
      </div>
    );
  }

  const allPaths = [
    ...(activePage?.elements.filter((el): el is PathEditorElement => el.type === 'path') ?? []),
    ...(draftPath ? [draftPath] : []),
  ];

  const allRects = [
    ...(activePage?.elements.filter((el): el is RectEditorElement => el.type === 'rect') ?? []),
    ...(draftRect ? [draftRect] : []),
  ];

  const displayScaleRatio = pageViewportSize.width / 595;

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] min-h-[600px] bg-white border border-zinc-200 rounded-lg overflow-hidden">
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={handleUploadImage}
      />

      {/* Top Studio Toolbar */}
      <div className="px-3 py-2 border-b border-zinc-200 bg-zinc-50/70 flex flex-wrap items-center justify-between gap-2 shrink-0">
        {/* Tool Buttons */}
        <div className="flex flex-wrap items-center gap-1">
          {[
            { id: 'select' as const, label: 'Pilih', icon: MousePointer2 },
            { id: 'text' as const, label: 'Teks', icon: Type },
            { id: 'pen' as const, label: 'Pena', icon: PenLine },
            { id: 'highlighter' as const, label: 'Stabilo', icon: Highlighter },
            { id: 'rect' as const, label: 'Kotak', icon: Square },
          ].map((tool) => {
            const Icon = tool.icon;
            const isActive = activeTool === tool.id;
            return (
              <button
                key={tool.id}
                type="button"
                onClick={() => {
                  setActiveTool(tool.id);
                  setEditingTextId(null);
                }}
                className={`px-2.5 py-1.5 text-xs font-medium rounded flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-[#E5322D] text-white'
                    : 'bg-white text-zinc-700 border border-zinc-200 hover:bg-zinc-100'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tool.label}</span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => setIsSignatureOpen(true)}
            className="px-2.5 py-1.5 text-xs font-medium rounded bg-white text-zinc-700 border border-zinc-200 hover:bg-zinc-100 flex items-center gap-1.5 whitespace-nowrap"
          >
            <Signature className="w-3.5 h-3.5" />
            <span>Tanda Tangan</span>
          </button>

          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            className="px-2.5 py-1.5 text-xs font-medium rounded bg-white text-zinc-700 border border-zinc-200 hover:bg-zinc-100 flex items-center gap-1.5 whitespace-nowrap"
          >
            <ImagePlus className="w-3.5 h-3.5" />
            <span>Gambar</span>
          </button>
        </div>

        {/* Right Controls: Undo/Redo, Zoom, Export */}
        <div className="flex items-center gap-2">
          <div className="flex items-center border border-zinc-200 rounded bg-white">
            <button
              type="button"
              disabled={undoStack.length === 0}
              onClick={handleUndo}
              title="Urungkan (Undo)"
              className="p-1.5 text-zinc-600 hover:text-zinc-900 disabled:opacity-30"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              disabled={redoStack.length === 0}
              onClick={handleRedo}
              title="Ulangi (Redo)"
              className="p-1.5 text-zinc-600 hover:text-zinc-900 border-l border-zinc-200 disabled:opacity-30"
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-center border border-zinc-200 rounded bg-white">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.6, Number((z - 0.15).toFixed(2))))}
              className="p-1.5 text-zinc-600 hover:text-zinc-900"
              title="Perkecil"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="px-2 text-xs font-mono tabular-nums text-zinc-700 border-x border-zinc-200">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(1.8, Number((z + 0.15).toFixed(2))))}
              className="p-1.5 text-zinc-600 hover:text-zinc-900"
              title="Perbesar"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              setSourceFile(null);
              setPages([]);
              setSuccessInfo(null);
            }}
            className="px-2.5 py-1.5 text-xs font-medium bg-white border border-zinc-200 text-zinc-700 rounded hover:bg-zinc-100 flex items-center gap-1 whitespace-nowrap"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Ganti</span>
          </button>

          <button
            type="button"
            disabled={isExporting}
            onClick={handleExport}
            className="px-4 py-1.5 text-xs font-semibold bg-[#E5322D] text-white rounded hover:bg-[#C8231E] disabled:opacity-40 flex items-center gap-1.5 whitespace-nowrap"
          >
            {isExporting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Menyimpan...</span>
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5" />
                <span>Simpan & Unduh PDF</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Feedback Banner if needed */}
      {successInfo && (
        <div className="px-4 py-2 bg-emerald-50 border-b border-emerald-200 flex items-center justify-between text-xs shrink-0">
          <div className="flex items-center gap-2 text-emerald-800">
            <FileCheck2 className="w-4 h-4 text-emerald-600" />
            <span>
              Tersimpan: <strong>{successInfo.filename}</strong> ({successInfo.pageCount} halaman ·{' '}
              {formatBytes(successInfo.sizeBytes)})
            </span>
          </div>
          <a
            href={successInfo.url}
            download={successInfo.filename}
            className="font-medium text-emerald-700 hover:underline"
          >
            Unduh Ulang
          </a>
        </div>
      )}

      {errorMsg && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-200 flex items-center gap-2 text-xs text-red-700 shrink-0">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* 3-Pane Studio Body */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        {/* Left Pane: Page Manager */}
        <div className="w-full lg:w-52 max-h-48 lg:max-h-none border-b lg:border-b-0 lg:border-r border-zinc-200 bg-zinc-50/50 flex flex-col shrink-0">
          <div className="px-3 py-2.5 border-b border-zinc-200 flex items-center justify-between text-xs">
            <span className="font-medium text-zinc-700">Halaman</span>
            <span className="font-mono tabular-nums text-zinc-500">
              {pages.length} hal
            </span>
          </div>

          <div className="flex-1 overflow-x-auto lg:overflow-x-hidden lg:overflow-y-auto p-2.5 flex lg:block gap-2.5 lg:space-y-2.5">
            {pages.map((p, idx) => {
              const isActive = p.id === activePageId;
              return (
                <div
                  key={p.id}
                  onClick={() => {
                    setActivePageId(p.id);
                    setSelectedElementId(null);
                    setEditingTextId(null);
                  }}
                  className={`w-36 lg:w-auto shrink-0 p-2 rounded-md border cursor-pointer transition-colors ${
                    isActive
                      ? 'border-[#E5322D] bg-white'
                      : 'border-zinc-200 bg-white/80 hover:border-zinc-300'
                  }`}
                >
                  <div className="aspect-[3/4] bg-zinc-100 border border-zinc-200/80 rounded overflow-hidden flex items-center justify-center">
                    {thumbnails[p.id] ? (
                      <img
                        src={thumbnails[p.id]}
                        alt={`Halaman ${idx + 1}`}
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <span className="text-[11px] font-mono text-zinc-400">
                        Hal {idx + 1}
                      </span>
                    )}
                  </div>

                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-[11px] font-mono tabular-nums font-medium text-zinc-700">
                      {String(idx + 1).padStart(2, '0')}
                      {p.elements.length > 0 ? ` · ${p.elements.length} obj` : ''}
                    </span>

                    <div
                      className="flex items-center gap-0.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => movePage(idx, -1)}
                        title="Naikkan halaman"
                        className="p-1 text-zinc-500 hover:text-zinc-900 disabled:opacity-25"
                      >
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === pages.length - 1}
                        onClick={() => movePage(idx, 1)}
                        title="Turunkan halaman"
                        className="p-1 text-zinc-500 hover:text-zinc-900 disabled:opacity-25"
                      >
                        <ArrowDown className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => rotatePage(p.id)}
                        title="Putar 90°"
                        className="p-1 text-zinc-500 hover:text-blue-600"
                      >
                        <RotateCw className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => duplicatePage(idx)}
                        title="Duplikasi halaman"
                        className="p-1 text-zinc-500 hover:text-zinc-900"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        disabled={pages.length <= 1}
                        onClick={() => deletePage(p.id)}
                        title="Hapus halaman"
                        className="p-1 text-zinc-400 hover:text-red-600 disabled:opacity-25"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Center Pane: Interactive PDF Canvas */}
        <div className="flex-1 bg-zinc-100 overflow-auto p-6 flex items-start justify-center">
          <div
            className="relative bg-white border border-zinc-300 select-none shrink-0"
            style={{
              width: pageViewportSize.width,
              height: pageViewportSize.height,
            }}
          >
            <canvas
              ref={canvasRef}
              className="block w-full h-full pointer-events-none"
            />

            {isRenderingPage && (
              <div className="absolute top-2 right-2 bg-white/90 border border-zinc-200 rounded px-2 py-1 flex items-center gap-1.5 text-[11px] text-zinc-600">
                <Loader2 className="w-3 h-3 animate-spin text-[#E5322D]" />
                <span>Merender...</span>
              </div>
            )}

            {/* Interactive Overlay Layer */}
            <div
              ref={overlayRef}
              onPointerDown={handleOverlayPointerDown}
              onPointerMove={handleOverlayPointerMove}
              onPointerUp={handleOverlayPointerUp}
              onPointerCancel={handleOverlayPointerUp}
              className={`absolute inset-0 ${
                activeTool === 'text'
                  ? 'cursor-text'
                  : activeTool === 'pen' || activeTool === 'highlighter' || activeTool === 'rect'
                    ? 'cursor-crosshair'
                    : 'cursor-default'
              }`}
            >
              {/* SVG Layer for Paths and Rectangles */}
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                className="absolute inset-0 w-full h-full pointer-events-none"
              >
                {allRects.map((r) => (
                  <rect
                    key={r.id}
                    x={r.x * 100}
                    y={r.y * 100}
                    width={r.width * 100}
                    height={r.height * 100}
                    stroke={r.strokeColor}
                    strokeWidth={(r.strokeWidth / 595) * 100}
                    fill={r.fillColor}
                    fillOpacity={r.opacity * 0.25}
                    strokeOpacity={r.opacity}
                  />
                ))}
                {allPaths.map((p) => {
                  const pts = p.points.map((pt) => `${pt.x * 100},${pt.y * 100}`).join(' ');
                  return (
                    <polyline
                      key={p.id}
                      points={pts}
                      fill="none"
                      stroke={p.color}
                      strokeWidth={(p.strokeWidth / 595) * 100}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeOpacity={p.opacity}
                    />
                  );
                })}
              </svg>

              {/* Clickable Hitboxes for Rects when Select Tool is Active */}
              {activeTool === 'select' &&
                activePage?.elements
                  .filter((el): el is RectEditorElement => el.type === 'rect')
                  .map((r) => {
                    const isSelected = selectedElementId === r.id;
                    return (
                      <div
                        key={`hit-${r.id}`}
                        onPointerDown={(e) => startElementDrag(e, r, 'move')}
                        style={{
                          left: `${r.x * 100}%`,
                          top: `${r.y * 100}%`,
                          width: `${r.width * 100}%`,
                          height: `${r.height * 100}%`,
                        }}
                        className={`absolute cursor-move ${
                          isSelected ? 'ring-1 ring-blue-600' : 'hover:ring-1 hover:ring-blue-300'
                        }`}
                      >
                        {isSelected && (
                          <div
                            onPointerDown={(e) => startElementDrag(e, r, 'resize')}
                            className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-blue-600 border border-white rounded-xs cursor-nwse-resize"
                          />
                        )}
                      </div>
                    );
                  })}

              {/* Clickable Hitboxes for Freehand Paths */}
              {activeTool === 'select' &&
                activePage?.elements
                  .filter((el): el is PathEditorElement => el.type === 'path')
                  .map((p) => {
                    if (p.points.length === 0) return null;
                    const xs = p.points.map((pt) => pt.x);
                    const ys = p.points.map((pt) => pt.y);
                    const minX = Math.min(...xs);
                    const maxX = Math.max(...xs);
                    const minY = Math.min(...ys);
                    const maxY = Math.max(...ys);
                    const isSelected = selectedElementId === p.id;
                    return (
                      <div
                        key={`hit-${p.id}`}
                        onPointerDown={(e) => startElementDrag(e, p, 'move')}
                        style={{
                          left: `${Math.max(0, minX - 0.01) * 100}%`,
                          top: `${Math.max(0, minY - 0.01) * 100}%`,
                          width: `${Math.max(0.03, maxX - minX + 0.02) * 100}%`,
                          height: `${Math.max(0.03, maxY - minY + 0.02) * 100}%`,
                        }}
                        className={`absolute cursor-move ${
                          isSelected
                            ? 'border border-dashed border-blue-600 bg-blue-500/5'
                            : 'hover:border hover:border-dashed hover:border-blue-300'
                        }`}
                      />
                    );
                  })}

              {/* Images & Signatures */}
              {activePage?.elements
                .filter(
                  (el): el is ImageEditorElement =>
                    el.type === 'image' || el.type === 'signature'
                )
                .map((el) => {
                  const isSelected = selectedElementId === el.id;
                  return (
                    <div
                      key={el.id}
                      onPointerDown={(e) => startElementDrag(e, el, 'move')}
                      style={{
                        left: `${el.x * 100}%`,
                        top: `${el.y * 100}%`,
                        width: `${el.width * 100}%`,
                        height: `${el.height * 100}%`,
                      }}
                      className={`absolute cursor-move ${
                        isSelected
                          ? 'ring-1 ring-blue-600 bg-blue-500/5'
                          : 'hover:ring-1 hover:ring-blue-300'
                      }`}
                    >
                      <img
                        src={el.dataUrl}
                        alt={el.type === 'signature' ? 'Tanda tangan' : 'Gambar'}
                        draggable={false}
                        className="w-full h-full object-contain pointer-events-none"
                      />
                      {isSelected && (
                        <div
                          onPointerDown={(e) => startElementDrag(e, el, 'resize')}
                          className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-blue-600 border border-white rounded-xs cursor-nwse-resize"
                        />
                      )}
                    </div>
                  );
                })}

              {/* Text Elements */}
              {activePage?.elements
                .filter((el): el is TextEditorElement => el.type === 'text')
                .map((el) => {
                  const isSelected = selectedElementId === el.id;
                  const isEditing = editingTextId === el.id;
                  return (
                    <div
                      key={el.id}
                      onPointerDown={(e) => startElementDrag(e, el, 'move')}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setSelectedElementId(el.id);
                        setEditingTextId(el.id);
                      }}
                      style={{
                        left: `${el.x * 100}%`,
                        top: `${el.y * 100}%`,
                        width: `${el.width * 100}%`,
                        fontSize: `${el.fontSize * displayScaleRatio}px`,
                        lineHeight: 1.25,
                        color: el.color,
                        fontWeight: el.bold ? 700 : 400,
                        fontStyle: el.italic ? 'italic' : 'normal',
                      }}
                      className={`absolute cursor-move ${
                        isSelected
                          ? 'ring-1 ring-blue-600 bg-white/40'
                          : 'hover:ring-1 hover:ring-blue-300'
                      }`}
                    >
                      {isEditing ? (
                        <textarea
                          autoFocus
                          value={el.text}
                          rows={Math.max(1, el.text.split('\n').length)}
                          onPointerDown={(e) => e.stopPropagation()}
                          onChange={(e) => updateElement(el.id, { text: e.target.value }, false)}
                          onBlur={() => setEditingTextId(null)}
                          className="w-full bg-white/95 p-0.5 border border-blue-500 rounded-xs focus:outline-none resize-none"
                          style={{
                            fontSize: 'inherit',
                            lineHeight: 'inherit',
                            color: 'inherit',
                            fontWeight: 'inherit',
                            fontStyle: 'inherit',
                          }}
                        />
                      ) : (
                        <div className="whitespace-pre-wrap break-words px-0.5">
                          {el.text || 'Teks kosong'}
                        </div>
                      )}

                      {isSelected && !isEditing && (
                        <div
                          onPointerDown={(e) => startElementDrag(e, el, 'resize')}
                          className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-blue-600 border border-white rounded-xs cursor-ew-resize"
                        />
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        </div>

        {/* Right Pane: Contextual Inspector */}
        <div className="w-full lg:w-64 max-h-60 lg:max-h-none border-t lg:border-t-0 lg:border-l border-zinc-200 bg-white p-4 overflow-y-auto shrink-0 space-y-5">
          {selectedElement ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-2.5 border-b border-zinc-200">
                <span className="text-xs font-semibold text-zinc-900">
                  {selectedElement.type === 'text'
                    ? 'Properti Teks'
                    : selectedElement.type === 'signature'
                      ? 'Properti Tanda Tangan'
                      : selectedElement.type === 'image'
                        ? 'Properti Gambar'
                        : 'Properti Anotasi'}
                </span>
                <button
                  type="button"
                  onClick={deleteSelectedElement}
                  className="text-xs text-red-600 hover:underline flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Hapus</span>
                </button>
              </div>

              {selectedElement.type === 'text' && (
                <div className="space-y-3.5">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-zinc-700">
                      Isi Teks
                    </label>
                    <textarea
                      rows={3}
                      value={selectedElement.text}
                      onChange={(e) =>
                        updateElement(selectedElement.id, { text: e.target.value })
                      }
                      className="w-full px-2.5 py-2 text-xs border border-zinc-200 rounded-md focus:outline-none focus:border-blue-600"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-700 font-medium">Ukuran Huruf</span>
                      <span className="font-mono tabular-nums text-zinc-500">
                        {selectedElement.fontSize} pt
                      </span>
                    </div>
                    <input
                      type="range"
                      min={8}
                      max={48}
                      value={selectedElement.fontSize}
                      onChange={(e) =>
                        updateElement(selectedElement.id, {
                          fontSize: Number(e.target.value),
                        })
                      }
                      className="w-full accent-blue-600"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        updateElement(selectedElement.id, { bold: !selectedElement.bold })
                      }
                      className={`px-2.5 py-1.5 text-xs rounded border flex items-center gap-1 ${
                        selectedElement.bold
                          ? 'border-blue-600 bg-blue-50 text-blue-700'
                          : 'border-zinc-200 text-zinc-700'
                      }`}
                    >
                      <Bold className="w-3.5 h-3.5" />
                      <span>Tebal</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        updateElement(selectedElement.id, {
                          italic: !selectedElement.italic,
                        })
                      }
                      className={`px-2.5 py-1.5 text-xs rounded border flex items-center gap-1 ${
                        selectedElement.italic
                          ? 'border-blue-600 bg-blue-50 text-blue-700'
                          : 'border-zinc-200 text-zinc-700'
                      }`}
                    >
                      <Italic className="w-3.5 h-3.5" />
                      <span>Miring</span>
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    <span className="block text-xs font-medium text-zinc-700">
                      Warna Teks
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {COLOR_SWATCHES.filter((c) => c !== '#ffffff').map((color) => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => updateElement(selectedElement.id, { color })}
                          className={`w-6 h-6 rounded-full border ${
                            selectedElement.color === color
                              ? 'ring-2 ring-offset-1 ring-blue-600'
                              : 'border-zinc-300'
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {(selectedElement.type === 'image' ||
                selectedElement.type === 'signature') && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-700 font-medium">Lebar Elemen</span>
                      <span className="font-mono tabular-nums text-zinc-500">
                        {Math.round(selectedElement.width * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={8}
                      max={85}
                      value={Math.round(selectedElement.width * 100)}
                      onChange={(e) => {
                        const newW = Number(e.target.value) / 100;
                        const pageAspect =
                          pageViewportSize.width / Math.max(1, pageViewportSize.height);
                        updateElement(selectedElement.id, {
                          width: newW,
                          height: newW * selectedElement.aspectRatio * pageAspect,
                        });
                      }}
                      className="w-full accent-blue-600"
                    />
                  </div>
                  <p className="text-[11px] text-zinc-500 leading-relaxed">
                    Seret elemen langsung di halaman atau tarik titik sudut kanan bawah untuk mengubah ukuran.
                  </p>
                </div>
              )}

              {(selectedElement.type === 'path' || selectedElement.type === 'rect') && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <span className="block text-xs font-medium text-zinc-700">
                      Warna
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {[...COLOR_SWATCHES.filter((c) => c !== '#ffffff'), '#facc15'].map(
                        (color) => {
                          const current =
                            selectedElement.type === 'path'
                              ? selectedElement.color
                              : selectedElement.strokeColor;
                          return (
                            <button
                              key={color}
                              type="button"
                              onClick={() =>
                                updateElement(
                                  selectedElement.id,
                                  selectedElement.type === 'path'
                                    ? { color }
                                    : { strokeColor: color, fillColor: color }
                                )
                              }
                              className={`w-6 h-6 rounded-full border ${
                                current === color
                                  ? 'ring-2 ring-offset-1 ring-blue-600'
                                  : 'border-zinc-300'
                              }`}
                              style={{ backgroundColor: color }}
                            />
                          );
                        }
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              <div className="pb-2.5 border-b border-zinc-200">
                <h2 className="text-xs font-semibold text-zinc-900">
                  Pengaturan Alat Aktif
                </h2>
                <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">
                  {activeTool === 'select' &&
                    'Klik elemen di halaman untuk memindahkan atau mengubah properti. Klik dua kali teks untuk menyunting.'}
                  {activeTool === 'text' &&
                    'Klik di bagian mana saja pada halaman PDF untuk menempatkan kotak teks baru.'}
                  {activeTool === 'pen' &&
                    'Seret kursor di atas halaman untuk membuat coretan bebas.'}
                  {activeTool === 'highlighter' &&
                    'Seret kursor di atas teks untuk menandai dengan stabilo transparan.'}
                  {activeTool === 'rect' &&
                    'Seret di atas halaman untuk membuat kotak penanda.'}
                </p>
              </div>

              {(activeTool === 'pen' || activeTool === 'rect') && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <span className="block text-xs font-medium text-zinc-700">
                      Warna Garis
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {COLOR_SWATCHES.filter((c) => c !== '#ffffff').map((color) => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => setDrawColor(color)}
                          className={`w-6 h-6 rounded-full border ${
                            drawColor === color
                              ? 'ring-2 ring-offset-1 ring-blue-600'
                              : 'border-zinc-300'
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>
                  {activeTool === 'pen' && (
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs">
                        <span className="text-zinc-700 font-medium">Ketebalan Pena</span>
                        <span className="font-mono tabular-nums text-zinc-500">
                          {strokeWidth} px
                        </span>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={10}
                        value={strokeWidth}
                        onChange={(e) => setStrokeWidth(Number(e.target.value))}
                        className="w-full accent-blue-600"
                      />
                    </div>
                  )}
                </div>
              )}

              {activeTool === 'highlighter' && (
                <div className="space-y-1.5">
                  <span className="block text-xs font-medium text-zinc-700">
                    Warna Stabilo
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {HIGHLIGHT_SWATCHES.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setHighlightColor(color)}
                        className={`w-6 h-6 rounded-full border ${
                          highlightColor === color
                            ? 'ring-2 ring-offset-1 ring-blue-600'
                            : 'border-zinc-300'
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {activeTool === 'text' && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-700 font-medium">Ukuran Default</span>
                      <span className="font-mono tabular-nums text-zinc-500">
                        {defaultFontSize} pt
                      </span>
                    </div>
                    <input
                      type="range"
                      min={10}
                      max={36}
                      value={defaultFontSize}
                      onChange={(e) => setDefaultFontSize(Number(e.target.value))}
                      className="w-full accent-blue-600"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <span className="block text-xs font-medium text-zinc-700">
                      Warna Default
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {COLOR_SWATCHES.filter((c) => c !== '#ffffff').map((color) => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => setDefaultTextColor(color)}
                          className={`w-6 h-6 rounded-full border ${
                            defaultTextColor === color
                              ? 'ring-2 ring-offset-1 ring-blue-600'
                              : 'border-zinc-300'
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {activePage && (
                <div className="pt-3 border-t border-zinc-200 space-y-2">
                  <div className="text-xs font-medium text-zinc-700">
                    Halaman Aktif ({activePageIndex + 1} / {pages.length})
                  </div>
                  <button
                    type="button"
                    onClick={() => rotatePage(activePage.id)}
                    className="w-full py-2 px-3 text-xs font-medium bg-zinc-50 border border-zinc-200 text-zinc-700 rounded-md hover:bg-zinc-100 flex items-center justify-center gap-1.5"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                    <span>Putar Halaman 90°</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <SignatureModal
        isOpen={isSignatureOpen}
        savedSignatures={savedSignatures}
        onClose={() => setIsSignatureOpen(false)}
        onInsertSignature={(dataUrl, saveToSession) => {
          if (saveToSession) {
            setSavedSignatures((prev) =>
              prev.includes(dataUrl) ? prev : [dataUrl, ...prev.slice(0, 5)]
            );
          }
          setIsSignatureOpen(false);
          insertImageDataUrl(dataUrl, 'signature');
        }}
      />
    </div>
  );
}
