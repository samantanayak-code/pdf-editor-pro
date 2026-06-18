export interface MergeOptions {
  files: ArrayBuffer[];
  pageRanges?: { fileIndex: number; pages: number[] }[];
}

export interface PaginationOptions {
  format: string;
  startNumber: number;
  position: 'header-left' | 'header-center' | 'header-right' |
            'footer-left' | 'footer-center' | 'footer-right';
  fontSize: number;
  color: { r: number; g: number; b: number };
  excludePages: number[];
  marginX: number;
  marginY: number;
}

export interface HeaderFooterSection {
  text?: string;
  logo?: ArrayBuffer;
  logoWidth?: number;
  logoHeight?: number;
  showFileName?: boolean;
  showDate?: boolean;
  position: 'left' | 'center' | 'right';
}

export interface HeaderFooterOptions {
  header?: HeaderFooterSection;
  footer?: HeaderFooterSection;
  fontSize: number;
  color: { r: number; g: number; b: number };
  marginX: number;
  marginY: number;
  fileName?: string;
  opacity?: number;
}

export interface SplitOptions {
  ranges: { start: number; end: number }[];
}

export interface RotateOptions {
  pages: number[];
  angle: 90 | 180 | 270;
}

export interface DeleteOptions {
  pages: number[];
}

export interface ExtractOptions {
  pages: number[];
}

export interface ReorderOptions {
  newOrder: number[];
}

export interface PDFProcessingResult {
  success: boolean;
  data?: Uint8Array;
  error?: string;
  pageCount?: number;
  fileSize?: number;
}
