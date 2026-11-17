import React, { useEffect, useRef, useState } from 'react';
import { X, Eraser, Upload, Check } from 'lucide-react';

interface SignatureModalProps {
  isOpen: boolean;
  savedSignatures: string[];
  onClose: () => void;
  onInsertSignature: (dataUrl: string, saveToSession: boolean) => void;
}

export function SignatureModal({
  isOpen,
  savedSignatures,
  onClose,
  onInsertSignature,
}: SignatureModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasStrokes, setHasStrokes] = useState(false);
  const [inkColor, setInkColor] = useState('#18181b');
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [activeTab, setActiveTab] = useState<'draw' | 'upload'>('draw');
  const [uploadedPreview, setUploadedPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setHasStrokes(false);
    setUploadedPreview(null);
    setActiveTab('draw');
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const getPointerPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    canvas.setPointerCapture(e.pointerId);
    const pos = getPointerPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.strokeStyle = inkColor;
    ctx.lineWidth = strokeWidth * 1.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    setIsDrawing(true);
    setHasStrokes(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const pos = getPointerPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  };

  const handlePointerUp = () => {
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setHasStrokes(false);
    }
  };

  const trimTransparentCanvas = (sourceCanvas: HTMLCanvasElement): string => {
    const ctx = sourceCanvas.getContext('2d');
    if (!ctx) return sourceCanvas.toDataURL('image/png');
    const { width, height } = sourceCanvas;
    const data = ctx.getImageData(0, 0, width, height).data;

    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const alpha = data[(y * width + x) * 4 + 3];
        if (alpha > 5) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX < minX || maxY < minY) {
      return sourceCanvas.toDataURL('image/png');
    }

    const pad = 12;
    const cropX = Math.max(0, minX - pad);
    const cropY = Math.max(0, minY - pad);
    const cropW = Math.min(width - cropX, maxX - minX + pad * 2);
    const cropH = Math.min(height - cropY, maxY - minY + pad * 2);

    const out = document.createElement('canvas');
    out.width = cropW;
    out.height = cropH;
    const outCtx = out.getContext('2d');
    outCtx?.drawImage(sourceCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
    return out.toDataURL('image/png');
  };

  const handleConfirmDraw = () => {
    if (!canvasRef.current || !hasStrokes) return;
    const dataUrl = trimTransparentCanvas(canvasRef.current);
    onInsertSignature(dataUrl, true);
  };

  const handleUploadFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setUploadedPreview(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950/40 flex items-center justify-center p-4">
      <div className="bg-white border border-zinc-200 rounded-lg w-full max-w-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-zinc-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-900">
            Sisipkan Tanda Tangan
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-zinc-400 hover:text-zinc-700 rounded transition-colors"
            aria-label="Tutup dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Segmented Mode Toggle */}
          <div className="flex items-center gap-1 p-1 bg-zinc-100 rounded-md w-fit">
            <button
              type="button"
              onClick={() => setActiveTab('draw')}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                activeTab === 'draw'
                  ? 'bg-white text-zinc-900 border border-zinc-200/80'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              Gambar Tanda Tangan
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('upload')}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                activeTab === 'upload'
                  ? 'bg-white text-zinc-900 border border-zinc-200/80'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              Unggah Gambar
            </button>
          </div>

          {activeTab === 'draw' ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-zinc-500">Warna Tinta:</span>
                  {['#18181b', '#1d4ed8', '#dc2626'].map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setInkColor(color)}
                      className={`w-5 h-5 rounded-full border transition-transform ${
                        inkColor === color
                          ? 'ring-2 ring-offset-1 ring-[#E5322D] scale-110'
                          : 'border-zinc-300'
                      }`}
                      style={{ backgroundColor: color }}
                      aria-label={`Pilih warna ${color}`}
                    />
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-zinc-500">Tebal:</span>
                  {[2, 3, 5].map((w) => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => setStrokeWidth(w)}
                      className={`px-2 py-0.5 font-mono text-[11px] rounded border ${
                        strokeWidth === w
                          ? 'border-[#E5322D] bg-red-50 text-[#E5322D]'
                          : 'border-zinc-200 text-zinc-600'
                      }`}
                    >
                      {w}px
                    </button>
                  ))}
                </div>
              </div>

              <div className="relative border border-zinc-300 rounded-md bg-zinc-50/50 overflow-hidden">
                <canvas
                  ref={canvasRef}
                  width={680}
                  height={240}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  className="w-full h-44 touch-none cursor-crosshair block"
                />
                {!hasStrokes && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-zinc-400">
                    Tulis tanda tangan Anda di area ini
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={clearCanvas}
                  className="px-3 py-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-900 border border-zinc-200 rounded-md flex items-center gap-1.5"
                >
                  <Eraser className="w-3.5 h-3.5" />
                  <span>Bersihkan</span>
                </button>
                <button
                  type="button"
                  disabled={!hasStrokes}
                  onClick={handleConfirmDraw}
                  className="px-4 py-2 text-xs font-semibold bg-[#E5322D] text-white rounded-md hover:bg-[#C8231E] disabled:opacity-40 flex items-center gap-1.5 transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Gunakan Tanda Tangan</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleUploadFile}
                className="hidden"
              />
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border border-dashed border-zinc-300 rounded-md p-6 text-center cursor-pointer hover:border-zinc-400 bg-zinc-50/40"
              >
                {uploadedPreview ? (
                  <img
                    src={uploadedPreview}
                    alt="Pratinjau tanda tangan"
                    className="max-h-32 mx-auto object-contain"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-2 text-xs text-zinc-500">
                    <Upload className="w-5 h-5 text-zinc-400" />
                    <span>Klik untuk memilih file gambar tanda tangan (PNG/JPG)</span>
                  </div>
                )}
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={!uploadedPreview}
                  onClick={() => uploadedPreview && onInsertSignature(uploadedPreview, true)}
                  className="px-4 py-2 text-xs font-semibold bg-[#E5322D] text-white rounded-md hover:bg-[#C8231E] disabled:opacity-40 transition-colors"
                >
                  Sisipkan ke Halaman
                </button>
              </div>
            </div>
          )}

          {/* Session Saved Signatures */}
          {savedSignatures.length > 0 && (
            <div className="pt-3 border-t border-zinc-200">
              <div className="text-xs font-medium text-zinc-600 mb-2">
                Tanda Tangan Tersimpan di Sesi Ini
              </div>
              <div className="grid grid-cols-3 gap-2">
                {savedSignatures.map((sig, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => onInsertSignature(sig, false)}
                    className="h-14 border border-zinc-200 rounded-md p-1.5 bg-zinc-50 hover:border-[#E5322D] hover:bg-red-50/40 transition-colors flex items-center justify-center"
                  >
                    <img
                      src={sig}
                      alt={`Tanda tangan ${idx + 1}`}
                      className="max-h-full max-w-full object-contain"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
