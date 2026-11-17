export type ToolId = 'merge' | 'split';

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
