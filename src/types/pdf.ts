export type ToolId = 'merge' | 'split' | 'to-pdf' | 'to-word' | 'edit';

export interface SessionExportItem {
  id: string;
  filename: string;
  tool: ToolId;
  sizeBytes: number;
  pageCount?: number;
  blobUrl: string;
  createdAt: number;
}

export interface MergeQueueItem {
  id: string;
  name: string;
  sizeBytes: number;
  pageCount: number;
  pageRange: string;
  thumbnailUrl: string | null;
  bytes: Uint8Array;
}

export interface PageThumbnail {
  pageNumber: number;
  width: number;
  height: number;
  dataUrl: string;
}

export interface ExtractedBlock {
  kind: 'heading1' | 'heading2' | 'paragraph';
  text: string;
}

export interface ExtractedPageData {
  pageNumber: number;
  blocks: ExtractedBlock[];
  rawText: string;
  previewDataUrl: string;
  widthPt: number;
  heightPt: number;
}

export type EditorToolType =
  | 'select'
  | 'text'
  | 'signature'
  | 'image'
  | 'pen'
  | 'highlighter'
  | 'rect';

export interface BaseEditorElement {
  id: string;
}

export interface TextEditorElement extends BaseEditorElement {
  type: 'text';
  x: number; // normalized 0..1
  y: number; // normalized 0..1
  width: number; // normalized 0..1
  text: string;
  fontSize: number; // in PDF points at standard 595pt width
  color: string;
  bold: boolean;
  italic: boolean;
}

export interface ImageEditorElement extends BaseEditorElement {
  type: 'image' | 'signature';
  x: number; // normalized 0..1
  y: number; // normalized 0..1
  width: number; // normalized 0..1
  height: number; // normalized 0..1
  dataUrl: string;
  aspectRatio: number;
}

export interface PathEditorElement extends BaseEditorElement {
  type: 'path';
  points: Array<{ x: number; y: number }>; // normalized 0..1
  color: string;
  strokeWidth: number; // in px relative to 600px width
  opacity: number;
}

export interface RectEditorElement extends BaseEditorElement {
  type: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
  opacity: number;
}

export type EditorElement =
  | TextEditorElement
  | ImageEditorElement
  | PathEditorElement
  | RectEditorElement;

export interface EditorPageState {
  id: string;
  sourcePageIndex: number; // 0-indexed from loaded PDF
  rotation: 0 | 90 | 180 | 270; // user clockwise rotation delta
  elements: EditorElement[];
}
