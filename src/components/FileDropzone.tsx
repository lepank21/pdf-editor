import React, { useRef, useState } from 'react';
import { Upload, Sparkles } from 'lucide-react';

interface FileDropzoneProps {
  accept: string;
  multiple?: boolean;
  title: string;
  description: string;
  formatHint: string;
  onFilesSelected: (files: File[]) => void;
  onLoadSample?: () => void;
  sampleLabel?: string;
  compact?: boolean;
}

export function FileDropzone({
  accept,
  multiple = false,
  title,
  description,
  formatHint,
  onFilesSelected,
  onLoadSample,
  sampleLabel = 'Muat Dokumen Contoh',
  compact = false,
}: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    onFilesSelected(multiple ? files : [files[0]]);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setIsDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
      className={`border-2 border-dashed rounded-xl transition-colors duration-150 ${
        isDragging
          ? 'border-[#E5322D] bg-red-50/50'
          : 'border-zinc-300 bg-white hover:border-zinc-400'
      } ${compact ? 'p-6' : 'py-14 px-6'}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <div className="flex flex-col items-center text-center max-w-lg mx-auto">
        <div
          className={`w-12 h-12 rounded-xl border flex items-center justify-center mb-4 ${
            isDragging
              ? 'border-red-300 bg-red-100 text-[#E5322D]'
              : 'border-zinc-200 bg-zinc-50 text-zinc-600'
          }`}
        >
          <Upload className="w-5 h-5" />
        </div>

        <h3 className="text-base font-semibold text-zinc-900">{title}</h3>
        <p className="text-sm text-zinc-500 mt-1.5 leading-relaxed">{description}</p>

        <div className="flex flex-wrap items-center justify-center gap-3 mt-6">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="px-7 py-3.5 text-sm font-semibold bg-[#E5322D] text-white rounded-lg hover:bg-[#C8231E] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5322D] focus-visible:ring-offset-2"
          >
            Pilih Berkas
          </button>

          {onLoadSample && (
            <button
              type="button"
              onClick={onLoadSample}
              className="px-4 py-3 text-xs font-medium bg-white text-zinc-700 border border-zinc-200 rounded-lg hover:bg-zinc-50 hover:border-zinc-300 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5 text-zinc-500" />
              <span>{sampleLabel}</span>
            </button>
          )}
        </div>

        <p className="text-[11px] font-mono text-zinc-400 mt-4">{formatHint}</p>
      </div>
    </div>
  );
}
