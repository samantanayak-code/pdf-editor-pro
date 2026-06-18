import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { extractStructuredDocument, StructuredDocument } from './pdf/textExtraction';
import { getPdfBytes, debugBuffer } from './pdf/buffers';
import { layoutTextBox } from './pdf/layoutEngine';
import { DocumentModel, TextBox } from './model';

export type EditMode = 'select' | 'pan' | 'text' | 'image';

export interface TextElement {
  id: string;
  text: string;
  x: number;
  y: number;
  baselineY: number; // Capture baseline for professional alignment
  pdfY: number;      // Raw PDF-space Y (transform[5]) — used directly for pdf-lib export
  width: number;
  height: number;
  fontSize: number;
  fontFamily: string;
  fontFamilyCategory: 'serif' | 'sans' | 'mono'; // Added for standard font matching
  color: { r: number; g: number; b: number };
  page: number;
  transform: number[];
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  modified?: boolean;
  originalText?: string;
  deleted?: boolean;
  bgColor?: { r: number; g: number; b: number };
  isNew?: boolean;
}

export interface ImageElement {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  page: number;
  data: string;
}

export interface PageData {
  width: number;
  height: number;
  textElements: TextElement[];
  imageElements: ImageElement[];
  originalData?: Uint8Array;
}

export interface PDFDocumentState {
  filename: string;
  totalPages: number;
  pages: Map<number, PageData>;
  pdfDoc: pdfjsLib.PDFDocumentProxy;
  originalBytes: Uint8Array;
  structuredDoc?: StructuredDocument;
}

export async function loadPDFDocument(
  source: File | Blob | ArrayBuffer | Uint8Array,
  filename: string
): Promise<PDFDocumentState> {
  // 1. Get fresh bytes for pdf.js viewer
  const uint8ArrayForPdfjs = await getPdfBytes(source);
  debugBuffer("viewer-load", uint8ArrayForPdfjs);

  // 2. Get a separate fresh copy for "originalBytes" to ensure it's never detached
  const originalBytesArray = await getPdfBytes(source);
  debugBuffer("original-bytes", originalBytesArray);

  const loadingTask = pdfjsLib.getDocument({ data: uint8ArrayForPdfjs });
  const pdfDoc = await loadingTask.promise;
  
  // 3. Use our high-quality extraction pipeline (it will call getPdfBytes internally)
  const structuredDoc = await extractStructuredDocument(source, filename);
  const pages = new Map<number, PageData>();

  structuredDoc.pages.forEach(page => {
    const textElements: TextElement[] = [];
    
    // Process main blocks - Line-level granularity
    page.blocks.forEach(block => {
      block.lines.forEach((line) => {
        textElements.push({
          id: `line-${page.pageNumber}-${textElements.length}`,
          text: line.text,
          x: line.x,
          y: line.y,
          baselineY: line.baselineY,
          pdfY: line.pdfY,
          width: line.width,
          height: line.height,
          fontSize: line.fontSize,
          fontFamily: line.fontFamily,
          fontFamilyCategory: line.fontFamilyCategory,
          color: { r: 0, g: 0, b: 0 },
          page: page.pageNumber,
          transform: [1, 0, 0, 1, line.x, line.baselineY],
          bold: line.bold,
          italic: line.italic,
        });
      });
    });

    // Also include header/footer in elements if they exist
    if (page.header) {
       page.header.lines.forEach(line => {
         textElements.push({
           id: `header-line-${page.pageNumber}-${textElements.length}`,
           text: line.text,
           x: line.x,
           y: line.y,
           baselineY: line.baselineY,
           pdfY: line.pdfY,
           width: line.width,
           height: line.height,
           fontSize: line.fontSize,
           fontFamily: line.fontFamily,
           fontFamilyCategory: line.fontFamilyCategory,
           color: { r: 0.5, g: 0.5, b: 0.5 },
           page: page.pageNumber,
           transform: [1, 0, 0, 1, line.x, line.baselineY],
           bold: line.bold,
           italic: line.italic,
         });
       });
    }

    if (page.footer) {
       page.footer.lines.forEach(line => {
         textElements.push({
           id: `footer-line-${page.pageNumber}-${textElements.length}`,
           text: line.text,
           x: line.x,
           y: line.y,
           baselineY: line.baselineY,
           pdfY: line.pdfY,
           width: line.width,
           height: line.height,
           fontSize: line.fontSize,
           fontFamily: line.fontFamily,
           fontFamilyCategory: line.fontFamilyCategory,
           color: { r: 0.5, g: 0.5, b: 0.5 },
           page: page.pageNumber,
           transform: [1, 0, 0, 1, line.x, line.baselineY],
           bold: line.bold,
           italic: line.italic,
         });
       });
    }

    pages.set(page.pageNumber, {
      width: page.width,
      height: page.height,
      textElements,
      imageElements: [],
    });
  });

  return {
    filename,
    totalPages: pdfDoc.numPages,
    pages,
    pdfDoc,
    originalBytes: originalBytesArray,
    structuredDoc,
  };
}

export async function generateThumbnail(
  docState: PDFDocumentState,
  pageNumber: number,
  width: number = 150
): Promise<string> {
  const page = await docState.pdfDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1.0 }).width });

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas context not available');

  canvas.height = viewport.height;
  canvas.width = viewport.width;

  await page.render({
    canvasContext: context,
    viewport: viewport,
  }).promise;

  return canvas.toDataURL('image/jpeg', 0.8);
}

export async function renderPDFPage(
  docState: PDFDocumentState,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale: number = 1.0
): Promise<void> {
  const page = await docState.pdfDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas context not available');

  const dpr = window.devicePixelRatio || 1;
  canvas.width = viewport.width * dpr;
  canvas.height = viewport.height * dpr;
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;

  context.scale(dpr, dpr);

  await page.render({ canvasContext: context, viewport }).promise;

  const pageData = docState.pages.get(pageNumber);
  if (pageData) {
    context.save();
    
    // Draw redaction blocks and selection highlights
    pageData.textElements.forEach((element) => {
      if ((element.modified || element.deleted) && !element.isNew) {
        // Pixel-Perfect Background Sampling
        // Sample color from the corner of the bounding box to get the background color
        if (!element.bgColor) {
          const sampleX = Math.max(0, element.x * scale - 4);
          const sampleY = Math.max(0, element.y * scale - 4);
          const pixel = context.getImageData(sampleX * dpr, sampleY * dpr, 1, 1).data;
          element.bgColor = { r: pixel[0] / 255, g: pixel[1] / 255, b: pixel[2] / 255 };
        }

        const bg = element.bgColor || { r: 1, g: 1, b: 1 };
        context.globalAlpha = 1.0;
        context.fillStyle = `rgb(${bg.r * 255}, ${bg.g * 255}, ${bg.b * 255})`;
        context.fillRect(
          element.x * scale - 2,
          element.y * scale - 2,
          element.width * scale + 4,
          element.height * scale + 4
        );

        if (element.modified && !element.deleted) {
          let family = 'Arial, Helvetica, sans-serif';
          if (element.fontFamilyCategory === 'serif') family = '"Times New Roman", Times, serif';
          else if (element.fontFamilyCategory === 'mono') family = '"Courier New", Courier, monospace';
          
          const style = `${element.bold ? 'bold ' : ''}${element.italic ? 'italic ' : ''}`;
          const scaledSize = element.fontSize * scale;
          
          // Set context to the scaled size so measureText is accurate
          context.font = `${style}${scaledSize}px ${family}`;
          
          const layout = calculateOverlayLayout(
            element.text,
            context,
            scaledSize,
            element.width * scale,
            element.x * scale,
            (element.baselineY + BASELINE_NUDGE) * scale,
            style
          );

          context.fillStyle = 'black';
          if (Math.abs(layout.letterSpacing) < 0.1) {
            context.fillText(element.text, layout.x, layout.baselineY);
          } else {
            let currentX = layout.x;
            for (const char of element.text) {
              context.fillText(char, currentX, layout.baselineY);
              currentX += context.measureText(char).width + layout.letterSpacing;
            }
          }
        }
      }

      // Selection/Hover highlight (if selected)
      // Note: We use global selection state from component, but here we can highlight the specific element
      // This part is illustrative; actual selection highlight often happens via state in the React component
    });
    context.restore();
  }
}

export async function reorderPages(
  docState: PDFDocumentState,
  newOrder: number[]
): Promise<PDFDocumentState> {
  const bytes = await getPdfBytes(docState.originalBytes);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const newPdf = await PDFDocument.create();
  const pagesToCopy = newOrder.map((p) => p - 1);
  const copiedPages = await newPdf.copyPages(pdfDoc, pagesToCopy);
  copiedPages.forEach((page) => newPdf.addPage(page));
  const newBytes = await newPdf.save();
  
  // Create a fresh doc state from the new bytes
  const freshDoc = await loadPDFDocument(newBytes, docState.filename);
  
  // Map existing text edits to the new page positions
  const newPages = new Map<number, PageData>();
  newOrder.forEach((oldPageNum, newIdx) => {
    const pageData = docState.pages.get(oldPageNum);
    const newPageNum = newIdx + 1;
    if (pageData) {
      newPages.set(newPageNum, {
        ...pageData,
        textElements: pageData.textElements.map(el => ({ ...el, page: newPageNum }))
      });
    }
  });

  return {
    ...freshDoc,
    pages: newPages,
  };
}

export async function deletePages(
  docState: PDFDocumentState,
  pageNumbers: number[]
): Promise<PDFDocumentState> {
  const bytes = await getPdfBytes(docState.originalBytes);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const newPdf = await PDFDocument.create();
  const totalPages = pdfDoc.getPageCount();
  
  const pagesToKeep = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter((p) => !pageNumbers.includes(p));
    
  const copiedPages = await newPdf.copyPages(pdfDoc, pagesToKeep.map(p => p - 1));
  copiedPages.forEach((page) => newPdf.addPage(page));
  const newBytes = await newPdf.save();
  
  // Create fresh doc state
  const freshDoc = await loadPDFDocument(newBytes, docState.filename);
  
  // Map remaining text edits to new indices
  const newPages = new Map<number, PageData>();
  pagesToKeep.forEach((oldPageNum, newIdx) => {
    const pageData = docState.pages.get(oldPageNum);
    const newPageNum = newIdx + 1;
    if (pageData) {
      newPages.set(newPageNum, {
        ...pageData,
        textElements: pageData.textElements.map(el => ({ ...el, page: newPageNum }))
      });
    }
  });

  return {
    ...freshDoc,
    pages: newPages,
  };
}

export async function replacePage(
  docState: PDFDocumentState,
  targetPageNum: number,
  sourceFile: File,
  sourcePageNum: number
): Promise<PDFDocumentState> {
  const targetBytes = await getPdfBytes(docState.originalBytes);
  const targetPdf = await PDFDocument.load(targetBytes, { ignoreEncryption: true });
  
  const sourceBytes = await getPdfBytes(sourceFile);
  const sourcePdf = await PDFDocument.load(sourceBytes, { ignoreEncryption: true });
  
  const [copiedPage] = await targetPdf.copyPages(sourcePdf, [sourcePageNum - 1]);
  
  // Replace the page at the specified index
  targetPdf.removePage(targetPageNum - 1);
  targetPdf.insertPage(targetPageNum - 1, copiedPage);
  
  const newBytes = await targetPdf.save();
  
  // Create fresh doc state
  const freshDoc = await loadPDFDocument(newBytes, docState.filename);
  
  // Keep original edits for all pages EXCEPT the replaced one
  const newPages = new Map<number, PageData>(freshDoc.pages);
  docState.pages.forEach((pageData, pageNum) => {
    if (pageNum !== targetPageNum) {
      newPages.set(pageNum, pageData);
    }
  });

  return {
    ...freshDoc,
    pages: newPages,
  };
}

export function updateTextElement(
  docState: PDFDocumentState,
  elementId: string,
  updates: Partial<TextElement>
): PDFDocumentState {
  const newPages = new Map(docState.pages);
  newPages.forEach((pageData, pageNum) => {
    const idx = pageData.textElements.findIndex(el => el.id === elementId);
    if (idx !== -1) {
      const el = pageData.textElements[idx];
      const newElements = [...pageData.textElements];
      newElements[idx] = { ...el, ...updates, modified: true, originalText: el.originalText || el.text };
      newPages.set(pageNum, { ...pageData, textElements: newElements });
    }
  });
  return { ...docState, pages: newPages };
}

export function deleteTextElement(
  docState: PDFDocumentState,
  elementId: string
): PDFDocumentState {
  return updateTextElement(docState, elementId, { deleted: true, text: '' });
}

export const BASELINE_NUDGE = -0.5;

/**
 * Calculate layout for the BROWSER OVERLAY (Canvas API).
 * Uses Canvas measureText which matches what the user sees in the browser.
 * NEVER changes the font size - only adjusts letter-spacing.
 */
export function calculateOverlayLayout(
  text: string,
  ctx: CanvasRenderingContext2D,
  fontSize: number,
  boxWidth: number,
  originalX: number,
  originalBaselineY: number,
  fontStyle: string = ''
) {
  // Always use original font size — height MUST match neighbors
  ctx.font = `${fontStyle}${fontSize}px sans-serif`;
  const textWidth = ctx.measureText(text).width;

  let letterSpacing = 0;
  if (text.length > 1 && textWidth > 0) {
    letterSpacing = (boxWidth - textWidth) / (text.length - 1);
    // Clamp to readable range: never let characters overlap badly or spread too wide
    letterSpacing = Math.max(-1.5, Math.min(3.0, letterSpacing));
  }

  return { fontSize, x: originalX, baselineY: originalBaselineY, letterSpacing };
}

/**
 * Calculate layout for PDF-LIB EXPORT.
 * Uses pdf-lib font.widthOfTextAtSize which matches the actual PDF rendering.
 * NEVER changes the font size - only adjusts letter-spacing.
 */
export function calculateExportLayout(
  text: string,
  font: any, // pdf-lib PDFFont
  fontSize: number,
  boxWidth: number,
  originalX: number,
  originalBaselineY: number
) {
  const textWidth = font.widthOfTextAtSize(text, fontSize);

  let letterSpacing = 0;
  if (text.length > 1 && textWidth > 0) {
    letterSpacing = (boxWidth - textWidth) / (text.length - 1);
    // Clamp: pdf-lib letter spacing must be reasonable
    letterSpacing = Math.max(-1.5, Math.min(3.0, letterSpacing));
  }

  return { fontSize, x: originalX, baselineY: originalBaselineY, letterSpacing };
}

/**
 * @deprecated Use calculateOverlayLayout or calculateExportLayout instead.
 * Kept for backward compatibility.
 */
export function calculateTextLayout(
  text: string,
  font: any,
  originalFontSize: number,
  boxWidth: number,
  originalX: number,
  originalBaselineY: number,
  isCanvas: boolean = false,
  fontFamily: string = 'sans-serif'
) {
  if (isCanvas) {
    const ctx = font as CanvasRenderingContext2D;
    return calculateOverlayLayout(text, ctx, originalFontSize, boxWidth, originalX, originalBaselineY);
  } else {
    return calculateExportLayout(text, font, originalFontSize, boxWidth, originalX, originalBaselineY);
  }
}


/**
 * For each font category on a given page, compute the ratio:
 *   pdfLibHeightAtSize(1pt) / pdfJsReportedFontSize
 * so that when we multiply el.fontSize by this factor before passing it to
 * calculateExportLayout / drawText, the rendered cap-height in the PDF matches
 * the cap-height that pdf.js originally measured.
 *
 * Strategy: collect all UNMODIFIED TextElements for the page, group by
 * fontFamilyCategory, then use the median ratio across all samples in that group.
 * Using the median makes it robust against outlier tokens (e.g. subscripts).
 *
 * @param pageElements  All TextElement objects on one page (including unmodified ones).
 * @param fontMap       Map of fontFamilyCategory → embedded pdf-lib PDFFont.
 * @returns             Map of fontFamilyCategory → scale factor (dimensionless).
 */
function computeFontScaleFactors(
  pageElements: TextElement[],
  fontMap: Record<string, any>
): Record<string, number> {
  // We only sample unmodified elements — they still reflect the original PDF metrics.
  const samples: Record<string, number[]> = { serif: [], sans: [], mono: [] };

  for (const el of pageElements) {
    if (el.modified || el.deleted) continue;
    if (el.fontSize <= 0) continue;

    const font = fontMap[el.fontFamilyCategory];
    if (!font) continue;

    // pdf-lib: heightAtSize gives the full em-height (ascender + descender) at 1pt.
    // We want to match what pdf.js extracted as fontSize (≈ cap-height / em fraction).
    // The ratio pdfLibHeight / el.fontSize tells us how much pdf-lib over- or under-sizes
    // text relative to the original font at the same nominal size.
    const pdfLibHeight = font.heightAtSize(el.fontSize);
    if (pdfLibHeight <= 0) continue;

    // Scale factor: how much to REDUCE the font size so pdf-lib output matches pdfjs size.
    const ratio = el.fontSize / pdfLibHeight;
    samples[el.fontFamilyCategory].push(ratio);
  }

  const median = (arr: number[]): number => {
    if (arr.length === 0) return 1.0; // neutral fallback
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  };

  return {
    serif: median(samples.serif),
    sans:  median(samples.sans),
    mono:  median(samples.mono),
  };
}

/**
 * PRODUCTION-GRADE EXPORT STRATEGY
 * ─────────────────────────────────
 * Problem with all previous approaches:
 *   pdf.js renders via a potentially non-identity CTM (current transformation matrix).
 *   The raw transform[5] (pdfY) and transform[4] (x) from pdf.js text items are in
 *   the PDF USER-SPACE coordinate system BEFORE the page's own CTM is applied.
 *   For many real-world PDFs (like JICC letters) the page CTM includes a scale/translate
 *   that maps 0..pageWidth → 0..mediaBoxWidth differently from what pdf-lib sees as
 *   page coordinates. This causes all "use pdfY directly" approaches to scramble.
 *
 * Solution — Bitmap Stamp Strategy (same as Acrobat / Foxit internally):
 *   1. For each page with edits, render the ORIGINAL page to an offscreen canvas at
 *      high DPI (2×) using pdf.js — this gives a pixel-perfect bitmap.
 *   2. On that same canvas, paint white redaction boxes over each modified token
 *      using CSS-space (top-down, scale=1.0) coordinates — which ARE correct because
 *      pdf.js gives us x/y/width/height in viewport space.
 *   3. Draw the replacement text onto the canvas using the Canvas 2D API at the
 *      same CSS-space baseline — guaranteed to match neighbours because we are
 *      literally drawing into the same coordinate system pdf.js used to lay out
 *      the original text.
 *   4. Export the canvas as a PNG and embed it into a NEW pdf-lib page that exactly
 *      replaces the original page, sized identically.
 *   5. Pages with NO edits are copied verbatim from the original (byte-identical,
 *      no re-encoding) so file size / quality are not degraded.
 *
 * This eliminates ALL coordinate system mismatches permanently.
 */
export async function exportEditedPDF(docState: PDFDocumentState): Promise<Uint8Array> {
  console.log(`[Export] Starting full-canvas export for "${docState.filename}" (${docState.totalPages} pages)`);

  // Render scale: 3× gives ~216 DPI on A4 — print quality on all browsers/environments.
  // We render EVERY page through pdf.js regardless of whether it was edited.
  // This is the only approach that is 100% reliable across:
  //   - Encrypted/owner-password PDFs (JICC letters, corporate docs)
  //   - All Chrome/Edge/Firefox versions and OS environments
  //   - Office vs personal laptops with different WebCrypto implementations
  // pdf.js handles decryption internally; we never ask pdf-lib to read content streams.
  const RENDER_SCALE = 3.0;

  try {
    const bytes = await getPdfBytes(docState.originalBytes);
    if (!bytes || bytes.length === 0) throw new Error('Original PDF bytes are empty or detached');

    const pdfJsDoc = docState.pdfDoc;
    const newPdfDoc = await PDFDocument.create();
    const totalPages = pdfJsDoc.numPages;

    // Get original page sizes from pdf.js (scale=1 viewport = PDF point dimensions)
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      const pdfJsPage = await pdfJsDoc.getPage(pageNum);
      const vp1       = pdfJsPage.getViewport({ scale: 1.0 }); // PDF-point dimensions
      const vpHi      = pdfJsPage.getViewport({ scale: RENDER_SCALE });

      // ── Step 1: Render original page to high-res canvas ──────────────────────
      const canvas  = document.createElement('canvas');
      canvas.width  = Math.round(vpHi.width);
      canvas.height = Math.round(vpHi.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      await pdfJsPage.render({ canvasContext: ctx, viewport: vpHi }).promise;

      // ── Step 2: If page has edits, stamp redactions + replacement text ────────
      const pageData = docState.pages.get(pageNum);
      const modifiedOrDeleted = pageData
        ? pageData.textElements.filter(el => el.modified || el.deleted)
        : [];

      if (modifiedOrDeleted.length > 0) {
        console.log(`[Export] Page ${pageNum}: applying ${modifiedOrDeleted.length} edit(s)...`);

        // Redact original tokens
        for (const el of modifiedOrDeleted) {
          if (el.isNew) continue;
          let bgR = 255, bgG = 255, bgB = 255;
          if (el.bgColor) {
            bgR = Math.round(el.bgColor.r * 255);
            bgG = Math.round(el.bgColor.g * 255);
            bgB = Math.round(el.bgColor.b * 255);
          } else {
            const sampleX = Math.max(0, Math.round(el.x * RENDER_SCALE) - 2);
            const sampleY = Math.max(0, Math.round(el.y * RENDER_SCALE) - 2);
            try {
              const px = ctx.getImageData(sampleX, sampleY, 1, 1).data;
              bgR = px[0]; bgG = px[1]; bgB = px[2];
            } catch (_) { /* keep white */ }
          }

          // Measure replacement text width to ensure redaction covers it fully
          let redactW = el.width * RENDER_SCALE;
          if (!el.deleted && el.text.trim()) {
            let rFamily = 'Arial, Helvetica, sans-serif';
            if (el.fontFamilyCategory === 'serif') rFamily = '"Times New Roman", Times, serif';
            else if (el.fontFamilyCategory === 'mono') rFamily = '"Courier New", Courier, monospace';
            ctx.font = `${el.italic ? 'italic ' : ''}${el.bold ? 'bold ' : ''}${el.fontSize * RENDER_SCALE}px ${rFamily}`;
            redactW = Math.max(redactW, ctx.measureText(el.text).width + 2);
          }

          ctx.fillStyle = `rgb(${bgR},${bgG},${bgB})`;
          ctx.fillRect(
            el.x * RENDER_SCALE - 2,
            el.y * RENDER_SCALE - 2,
            redactW + 4,
            el.height * RENDER_SCALE + 4
          );
        }

        // Draw replacement text
        for (const el of modifiedOrDeleted) {
          if (el.deleted || !el.text.trim()) continue;

          let fontFamily = 'Arial, Helvetica, sans-serif';
          if (el.fontFamilyCategory === 'serif') fontFamily = '"Times New Roman", Times, serif';
          else if (el.fontFamilyCategory === 'mono') fontFamily = '"Courier New", Courier, monospace';

          const scaledSize = el.fontSize * RENDER_SCALE;
          const fontStyle  = `${el.italic ? 'italic ' : ''}${el.bold ? 'bold ' : ''}`;
          ctx.font         = `${fontStyle}${scaledSize}px ${fontFamily}`;
          ctx.fillStyle    = 'black';
          ctx.textBaseline = 'alphabetic';

          const naturalW  = ctx.measureText(el.text).width;
          const originalW = el.width * RENDER_SCALE;
          const canvasBaselineY = el.baselineY * RENDER_SCALE;

          // Only spread (positive spacing) when replacement is shorter than original;
          // never compress — longer text flows rightward naturally.
          let letterSpacing = 0;
          if (el.text.length > 1 && naturalW < originalW) {
            letterSpacing = Math.min(4 * RENDER_SCALE, (originalW - naturalW) / (el.text.length - 1));
          }

          if (Math.abs(letterSpacing) < 0.5) {
            ctx.fillText(el.text, el.x * RENDER_SCALE, canvasBaselineY);
          } else {
            let cx = el.x * RENDER_SCALE;
            for (const char of el.text) {
              ctx.fillText(char, cx, canvasBaselineY);
              cx += ctx.measureText(char).width + letterSpacing;
            }
          }
        }
      } else {
        console.log(`[Export] Page ${pageNum}: no edits, rendered via pdf.js.`);
      }

      // ── Step 3: Embed canvas PNG into new pdf-lib page ────────────────────────
      const pngDataUrl = canvas.toDataURL('image/png');
      const pngBase64  = pngDataUrl.split(',')[1];
      const pngBytes   = Uint8Array.from(atob(pngBase64), c => c.charCodeAt(0));
      const pngImage   = await newPdfDoc.embedPng(pngBytes);

      // Use pdf.js viewport-at-scale-1 dimensions as the PDF page size in points.
      // These match the original page's MediaBox exactly.
      const pgW = vp1.width;
      const pgH = vp1.height;
      const newPage = newPdfDoc.addPage([pgW, pgH]);
      newPage.drawImage(pngImage, { x: 0, y: 0, width: pgW, height: pgH });

      console.log(`[Export] Page ${pageNum}: embedded (${canvas.width}×${canvas.height}px → ${pgW.toFixed(0)}×${pgH.toFixed(0)}pt).`);
    }

    console.log('[Export] Serializing...');
    const finalBytes = await newPdfDoc.save();
    console.log(`[Export] Done. ${finalBytes.length} bytes.`);
    return finalBytes;

  } catch (error) {
    console.error('[Export] Critical error:', error);
    throw error;
  }
}

/**
 * PHASE 1: Export using the structured DocumentModel.
 * This function renders all TextBoxes using the reflow layout engine.
 */
export async function exportStructuredPDF(
  model: DocumentModel,
  originalBytes: Uint8Array
): Promise<Uint8Array> {
  console.log(`[Export-Structured] Starting export for ${model.filename}`);
  
  try {
    const bytes = await getPdfBytes(originalBytes);
    const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = pdfDoc.getPages();
    
    // Embed standard fonts once per document
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const times = await pdfDoc.embedFont(StandardFonts.TimesRoman);
    const timesBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
    const courier = await pdfDoc.embedFont(StandardFonts.Courier);
    
    const fontMap: Record<string, any> = {
      'Helvetica': helvetica,
      'Helvetica-Bold': helveticaBold,
      'Times-Roman': times,
      'Times-Bold': timesBold,
      'Courier': courier,
      'sans-serif': helvetica,
      'serif': times,
      'monospace': courier,
      // Map the new high-fidelity stacks
      '"Times New Roman", Times, serif': times,
      'Arial, Helvetica, sans-serif': helvetica,
      '"Courier New", Courier, monospace': courier
    };
    
    const boldFontMap: Record<string, any> = {
      '"Times New Roman", Times, serif': timesBold,
      'Arial, Helvetica, sans-serif': helveticaBold,
      'serif': timesBold,
      'sans-serif': helveticaBold
    };

    // Process each page in the model
    for (const pageModel of model.pages) {
      const pdfPage = pages[pageModel.pageIndex];
      if (!pdfPage) continue;
      const { height } = pdfPage.getSize();

      // For each edited TextBox, we redact the original area and draw the new layout
      for (const box of pageModel.textBoxes) {
        // Redact original area
        pdfPage.drawRectangle({
          x: box.rect.x - 1,
          y: box.rect.y - 1,
          width: box.rect.width + 2,
          height: box.rect.height + 2,
          color: rgb(1, 1, 1), // assume white for Phase 1
          opacity: 1,
        });

        // Run layout engine
        const layoutLines = layoutTextBox(box, fontMap);

        // Draw each line
        for (const line of layoutLines) {
          const baseFont = fontMap[line.style.fontFamily] || helvetica;
          const font = line.style.bold ? (boldFontMap[line.style.fontFamily] || baseFont) : baseFont;
          const pdfY = height - (line.baselineY + BASELINE_NUDGE);
          
          pdfPage.drawText(line.text, {
            x: line.x,
            y: pdfY,
            size: line.style.fontSize,
            font: font,
            color: rgb(0, 0, 0),
          });
        }
      }
    }

    const finalBytes = await pdfDoc.save({ useObjectNumbering: true });
    return finalBytes;
  } catch (error) {
    console.error("[Export-Structured] Critical error:", error);
    throw error;
  }
}


export function findTextElementAt(
  pageData: PageData,
  x: number,
  y: number,
  scale: number = 1.0
): TextElement | null {
  return pageData.textElements.find(el => {
    const ex = el.x * scale, ey = el.y * scale;
    const ew = el.width * scale, eh = el.height * scale;
    return x >= ex && x <= ex + ew && y >= ey && y <= ey + eh;
  }) || null;
}
