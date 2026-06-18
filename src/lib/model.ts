// src/lib/model.ts

/**
 * Core data model for the Acrobat‑Pro‑style in‑browser PDF editor.
 * All UI state, export logic and layout engine share these types.
 * The model is deliberately lightweight – it uses plain JS objects
 * (no MobX / Redux specific classes) so it can be persisted in
 * localStorage or sent to a backend if needed.
 */

export type TextSpanStyle = {
  /** Font family identifier – we expose a small set of web‑safe families */
  fontFamily: 'Times New Roman' | 'Helvetica' | 'Courier New' | string;
  /** Font size in points */
  fontSize: number;
  /** Hex colour, e.g. "#000000" */
  color: string;
  /** Optional typographic toggles */
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
};

/** A run of characters that share the same style */
export type TextSpan = {
  text: string;
  style: TextSpanStyle;
};

/** Paragraph consists of an ordered list of spans. */
export type Paragraph = {
  spans: TextSpan[];
};

export type TextBoxAlignment = 'left' | 'center' | 'right';
export type LineSpacing = 'single' | 'oneHalf' | 'double';

/**
 * TextBox – the atomic editable region that maps to a rectangular area
 * on a PDF page.  It holds one or more paragraphs, alignment and line‑
 * spacing information.
 */
export type TextBox = {
  /** Unique identifier – UUID or short string */
  id: string;
  /** Zero‑based page index */
  pageIndex: number;
  /** Position and size in PDF user‑space coordinates (points) */
  rect: { x: number; y: number; width: number; height: number };
  /** Paragraphs inside the box – order matters */
  paragraphs: Paragraph[];
  /** Horizontal alignment for the whole box */
  alignment: TextBoxAlignment;
  /** Line‑spacing multiplier */
  lineSpacing: LineSpacing;
};

/** Image element inserted by the user */
export type ImageElement = {
  id: string;
  pageIndex: number;
  src: string; // data URL or Object URL
  rect: { x: number; y: number; width: number; height: number };
};

/** Simple geometric line or rectangle */
export type ShapeElement = {
  id: string;
  pageIndex: number;
  type: 'line' | 'rectangle';
  /** Stroke colour in hex */
  color: string;
  /** Stroke width in points */
  thickness: number;
  /** Geometry – for a line we use start/end, for rectangle we use
   *  x, y, width, height.
   */
  geometry:
    | { x1: number; y1: number; x2: number; y2: number } // line
    | { x: number; y: number; width: number; height: number }; // rectangle
};

/** Header / footer definition applied to a range of pages */
export type HeaderFooter = {
  /** Left, centre and right sections – each can be empty */
  left?: string;
  centre?: string;
  right?: string;
  /** Font used for the text */
  fontFamily: string;
  fontSize: number;
  color: string;
  /** Pages this header/footer applies to – inclusive range */
  pageRange: { start: number; end: number };
};

/** Watermark definition */
export type Watermark = {
  text: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  opacity: number; // 0‑1
  rotationDeg: number; // e.g. 45 for diagonal
  /** Pages to apply – same schema as HeaderFooter */
  pageRange: { start: number; end: number };
};

/** Redaction – either over text or a graphic region */
export type Redaction = {
  id: string;
  pageIndex: number;
  type: 'text' | 'graphic';
  /** Rectangular zones that must be painted solid and removed */
  rects: { x: number; y: number; width: number; height: number }[];
  /** Fill colour – typically black or white */
  fillColor: string;
};

/** Complete page model – aggregates every editable element */
export type PageModel = {
  pageIndex: number;
  width: number;
  height: number;
  textBoxes: TextBox[];
  images: ImageElement[];
  shapes: ShapeElement[];
  redactions: Redaction[];
  /** Header / footer are optional – they are rendered on export */
  header?: HeaderFooter;
  footer?: HeaderFooter;
  /** Watermarks are optional */
  watermarks?: Watermark[];
};

/** Whole document model */
export type DocumentModel = {
  /** Original filename – kept for export naming */
  filename: string;
  /** Array indexed by page number (0‑based) */
  pages: PageModel[];
  /** Global settings that affect the whole document */
  settings?: {
    /** Default font family used when the user creates a new box */
    defaultFontFamily: string;
    /** Default font size */
    defaultFontSize: number;
    /** Default colour */
    defaultColor: string;
  };
};

/** Utility – generate a simple UUID‑like identifier */
export const generateId = (): string =>
  'xxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
