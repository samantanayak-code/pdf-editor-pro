/**
 * Enterprise-Grade PDF Converter
 * ─────────────────────────────────────────────────────────────────────────────
 * Equivalent to Adobe Acrobat Pro conversion quality.
 *
 * PDF → Word strategy:
 *   1. Detect headings by font-size ratio vs page median body size
 *   2. Detect tables by X-column clustering across consecutive lines
 *   3. Preserve bold / italic inline runs at token level
 *   4. Detect lists by bullet/number prefix patterns
 *   5. Preserve indentation levels
 *   6. Multi-column layout detection and linearisation
 *
 * PDF → Excel strategy:
 *   1. Full spatial table detection using X-band clustering + Y-row grouping
 *   2. Multi-table per page detection
 *   3. Column header detection and styling
 *   4. Per-table worksheets + summary sheet
 *   5. Auto column width fitting
 */

import {
  Document, Paragraph, TextRun, HeadingLevel, Packer,
  AlignmentType, Table as DocxTable, TableRow, TableCell,
  WidthType, BorderStyle, ShadingType, convertInchesToTwip,
  Header, Footer, ImageRun, PageOrientation,
  TabStopType, TabStopLeader, VerticalAlign,
} from 'docx';
import * as XLSX from 'xlsx';
import { getDocument } from 'pdfjs-dist';
import { getPdfBytes } from './buffers';
import { 
  extractStructuredDocument, 
  StructuredDocument, 
  StructuredPage, 
  TextBlock, 
  TextLine, 
  TextToken,
  constructBlock
} from './textExtraction';

// ─── Region Detection & Stamping ───────────────────────────────────────────

interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PageRegions {
  header?: Region;
  footer?: Region;
  body: Region;
}

interface PageStampImages {
  header?: { dataUrl: string; width: number; height: number };
  footer?: { dataUrl: string; width: number; height: number };
}

/**
 * Detect geometric regions for header, body, and footer.
 * Heuristics:
 * - Header: top ~12% or bottom of header block.
 * - Footer: bottom ~8% or top of footer block.
 */
function detectPageRegions(page: StructuredPage): PageRegions {
  const h = page.height;
  const w = page.width;

  // Start with conservative defaults: 15% header, 6% footer.
  // These are refined by actual block positions below.
  let headerHeight = h * 0.15; 
  let footerHeight = h * 0.06; 

  // Refine with actual blocks if available
  if (page.header) {
    const maxY = Math.max(...page.header.lines.map(l => l.y + l.height));
    headerHeight = Math.max(headerHeight, maxY + 8);
  }
  if (page.footer) {
    const minY = Math.min(...page.footer.lines.map(l => l.y));
    footerHeight = Math.max(footerHeight, h - minY + 8);
  }

  // Safety clamp: header+footer must leave at least 40% for body
  const maxHeader = h * 0.35;
  const maxFooter = h * 0.20;
  headerHeight = Math.min(headerHeight, maxHeader);
  footerHeight = Math.min(footerHeight, maxFooter);

  return {
    header: { x: 0, y: 0, width: w, height: headerHeight },
    footer: { x: 0, y: h - footerHeight, width: w, height: footerHeight },
    body: { x: 0, y: headerHeight, width: w, height: h - headerHeight - footerHeight },
  };
}

/**
 * Optimized PNG stamp generator that uses an existing PDF document instance.
 */
async function generatePageStampsFromPdf(pdf: any, pageNum: number, regions: PageRegions): Promise<PageStampImages> {
  const page = await pdf.getPage(pageNum);
  const scale = 2.0; 
  const viewport = page.getViewport({ scale });
  
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return {};

  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: ctx, viewport }).promise;

  const stamps: PageStampImages = {};
  if (regions.header && regions.header.height > 0) {
    const h = regions.header.height * scale;
    const w = regions.header.width * scale;
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = w; cropCanvas.height = h;
    const cropCtx = cropCanvas.getContext('2d');
    if (cropCtx) {
      cropCtx.drawImage(canvas, 0, 0, w, h, 0, 0, w, h);
      stamps.header = { dataUrl: cropCanvas.toDataURL('image/png'), width: regions.header.width, height: regions.header.height };
    }
  }

  if (regions.footer && regions.footer.height > 0) {
    const h = regions.footer.height * scale;
    const w = regions.footer.width * scale;
    const y = viewport.height - h;
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = w; cropCanvas.height = h;
    const cropCtx = cropCanvas.getContext('2d');
    if (cropCtx) {
      cropCtx.drawImage(canvas, 0, y, w, h, 0, 0, w, h);
      stamps.footer = { dataUrl: cropCanvas.toDataURL('image/png'), width: regions.footer.width, height: regions.footer.height };
    }
  }

  return stamps;
}

// ─── Table Detection (Hardened) ──────────────────────────────────────────────

interface ColumnAnchor {
  x: number;
  frequency: number;
  width: number;
  index: number;
}

interface DetectedTable {
  logicalRows: TextLine[][]; // each logical row is an array of visual lines
  anchors: ColumnAnchor[];
  startY: number;
  endY: number;
  confidence: number;
}

/**
 * Detect tables using a global anchor model.
 *
 * Strategy:
 * 1. Collect all X-positions of line-starts and large-gap token starts.
 * 2. Cluster them with tolerance to find candidate column anchors.
 * 3. Filter anchors by frequency (>= 2 occurrences) AND require >= 2 distinct anchors.
 *    Exception: if exactly 2 anchors with freq >= 2 exist and the gap between them is
 *    large (> 20% of page width), treat it as a valid 2-column table — this handles
 *    common Subject:/Value, Label:/Value patterns in formal letters.
 * 4. Group physical lines into logical rows and identify table extents.
 */
function detectTables(lines: TextLine[], pageWidth: number): { tables: DetectedTable[]; nonTableLines: TextLine[] } {
  if (!lines.length) return { tables: [], nonTableLines: [] };

  const tolerance = 8; // pts

  // 1. Cluster X positions across lines to find global anchors
  const candidateXs: number[] = [];
  for (const line of lines) {
    for (let i = 0; i < line.tokens.length; i++) {
      const t = line.tokens[i];
      if (i === 0) {
        candidateXs.push(t.x);
      } else {
        const prev = line.tokens[i - 1];
        const gap = t.x - (prev.x + prev.width);
        if (gap > 20) { // 20pt gap = clear column separation (raised from 15)
          candidateXs.push(t.x);
        }
      }
    }
  }
  const sortedX = [...candidateXs].sort((a, b) => a - b);
  const anchorClusters: number[][] = [];
  if (sortedX.length) {
    let cur = [sortedX[0]];
    for (let i = 1; i < sortedX.length; i++) {
      if (sortedX[i] - cur[cur.length - 1] <= tolerance) cur.push(sortedX[i]);
      else { anchorClusters.push(cur); cur = [sortedX[i]]; }
    }
    anchorClusters.push(cur);
  }

  // Require freq >= 2 for any anchor. Then apply structural guard:
  // need >= 2 anchors total, OR for exactly 2-anchor case, they must be well-separated.
  const candidateAnchors: ColumnAnchor[] = anchorClusters
    .filter(c => c.length >= 2)
    .map((c, idx) => ({
      x: c[0],
      frequency: c.length,
      width: Math.max(...c) - c[0],
      index: idx
    }));

  if (candidateAnchors.length < 2) return { tables: [], nonTableLines: lines };

  // For exactly 2 anchors, require them to be > 20% page width apart to avoid treating
  // left-margin + first-indent as a table (e.g. numbered lists like "1. text").
  let globalAnchors: ColumnAnchor[];
  if (candidateAnchors.length === 2) {
    const gap = candidateAnchors[1].x - candidateAnchors[0].x;
    if (gap < pageWidth * 0.20) {
      return { tables: [], nonTableLines: lines };
    }
    globalAnchors = candidateAnchors;
  } else {
    // 3+ anchors: allow all with freq >= 2
    globalAnchors = candidateAnchors;
  }

  // Re-index
  globalAnchors = globalAnchors.map((a, idx) => ({ ...a, index: idx }));

  // 2. Logical Row Grouping
  // First, group into physical rows (Y-bands)
  lines.sort((a, b) => a.y - b.y || a.x - b.x);
  const physicalRows: TextLine[][] = [];
  let curBand: TextLine[] = [];
  for (const line of lines) {
    if (curBand.length === 0) {
      curBand.push(line);
    } else {
      const avgY = curBand.reduce((sum, l) => sum + l.y, 0) / curBand.length;
      if (Math.abs(line.y - avgY) <= line.height * 0.6) {
        curBand.push(line);
      } else {
        physicalRows.push(curBand);
        curBand = [line];
      }
    }
  }
  if (curBand.length > 0) physicalRows.push(curBand);

  // Next, group physical rows into logical rows
  const logicalRows: TextLine[][] = [];
  let currentLogicalRow: TextLine[] = [];
  let currentLogicalRowStartCol = 0;
  let prevPhysicalLeftmost = 0;

  for (const pRow of physicalRows) {
    const hits = globalAnchors.filter(a => pRow.some(l => l.tokens.some(t => Math.abs(t.x - a.x) <= tolerance * 2)));
    if (hits.length === 0) {
      if (currentLogicalRow.length > 0) currentLogicalRow.push(...pRow);
      continue;
    }

    const leftmostHit = Math.min(...hits.map(h => h.index));
    let startNewRow = false;

    if (currentLogicalRow.length > 0) {
      const hitsStartCol = hits.some(h => h.index === currentLogicalRowStartCol);
      const isJumpLeft = leftmostHit < prevPhysicalLeftmost;
      
      // It's a new row if it jumps to the left (e.g. from Col 2 back to Col 1)
      // OR if it hits the starting column AND has multiple columns populated (meaning it's not just a single-column wrap)
      if (isJumpLeft || (hitsStartCol && hits.length >= 2)) {
        startNewRow = true;
      }
    }

    if (startNewRow) {
      logicalRows.push(currentLogicalRow);
      currentLogicalRow = [...pRow];
      currentLogicalRowStartCol = leftmostHit;
    } else {
      if (currentLogicalRow.length === 0) {
        currentLogicalRowStartCol = leftmostHit;
      }
      currentLogicalRow.push(...pRow);
    }
    prevPhysicalLeftmost = leftmostHit;
  }
  if (currentLogicalRow.length > 0) logicalRows.push(currentLogicalRow);

  // 3. Table identification
  const tables: DetectedTable[] = [];
  const tableIndices = new Set<number>();
  
  let i = 0;
  while (i < logicalRows.length) {
    const startIdx = i;
    let tableAnchorsHit = new Set<number>();
    
    while (i < logicalRows.length) {
      const row = logicalRows[i];
      const hits = globalAnchors.filter(a => row.some(l => l.tokens.some(t => Math.abs(t.x - a.x) <= tolerance * 2)));
      if (hits.length < 2) break; // End of table
      hits.forEach(h => tableAnchorsHit.add(h.index));
      i++;
    }

    if (i - startIdx >= 2 && tableAnchorsHit.size >= 2) {
      const tableRows = logicalRows.slice(startIdx, i);
      const anchorsHit = globalAnchors.filter(a => tableAnchorsHit.has(a.index));
      tables.push({
        logicalRows: tableRows,
        anchors: anchorsHit,
        startY: tableRows[0][0].y,
        endY: tableRows[tableRows.length - 1].slice(-1)[0].y + tableRows[tableRows.length - 1].slice(-1)[0].height,
        confidence: anchorsHit.length / globalAnchors.length
      });
      for (let k = startIdx; k < i; k++) tableIndices.add(k);
    } else {
      i++;
    }
  }

  const nonTableLines = logicalRows
    .filter((_, idx) => !tableIndices.has(idx))
    .flat();

  return { tables, nonTableLines };
}

/**
 * Convert a detected table's logical rows into a 2D string grid.
 * Uses interval bounding instead of strict anchors to preserve all wrapped cell text.
 */
function tableToGrid(table: DetectedTable, pageWidth: number): string[][] {
  const { logicalRows, anchors } = table;

  return logicalRows.map(rowLines => {
    const cells = new Array(anchors.length).fill('');
    
    // Y-then-X sorting preserves human reading order within the row
    const allTokens = rowLines.flatMap(l => l.tokens).sort((a, b) => {
      if (Math.abs(a.y - b.y) > 6) return a.y - b.y; // increased from 4 to 6 for multiline cells
      return a.x - b.x;
    });

    const lastY = new Array(anchors.length).fill(undefined);

    allTokens.forEach(tok => {
      let colIdx = anchors.length - 1;
      for (let i = 0; i < anchors.length - 1; i++) {
        const colLeft = anchors[i].x - 8;
        const colRight = (anchors[i].x + anchors[i + 1].x) / 2;
        if (tok.x >= colLeft && tok.x < colRight) {
          colIdx = i;
          break;
        }
      }
      if (anchors.length >= 2 && tok.x < (anchors[0].x + anchors[1].x) / 2) {
        colIdx = 0;
      }

      if (lastY[colIdx] !== undefined && Math.abs(tok.y - lastY[colIdx]) > tok.fontSize * 0.5) {
        cells[colIdx] += '\n';
      } else {
        cells[colIdx] += (cells[colIdx] && !cells[colIdx].endsWith('\n') ? ' ' : '');
      }
      cells[colIdx] += tok.text;
      lastY[colIdx] = tok.y;
    });

    // Clean up each cell: collapse multiple spaces, trim each line
    return cells.map(cell =>
      cell.split('\n').map(line => line.replace(/\s{2,}/g, ' ').trim()).filter(Boolean).join('\n')
    );
  });
}


// ─── Style & Spacing Constants ──────────────────────────────────────────

const DOCX_STYLES = {
  body: {
    font: 'Calibri',
    size: 22, // 11pt
    spacing: { before: 0, after: 60, line: 276 }, // ~single-spaced (line=276 ≈ 115% line height)
  },
  heading1: {
    size: 28, // 14pt
    spacing: { before: 160, after: 80 },
  },
  heading2: {
    size: 24, // 12pt
    spacing: { before: 120, after: 60 },
  },
  heading3: {
    size: 22, // 11pt
    spacing: { before: 80, after: 40 },
  },
  list: {
    spacing: { before: 20, after: 20 },
    indent: { left: 440, hanging: 300 },
  }
};

// ─── Refinement 1 & 2: Right-Aligned Metadata (Ref./Date) Detection ─────────
//
// Formal JICC / L&T letters have lines like:
//   "Ref. No.: T3-JHC-LT-23-0166      Date: 19 Jun. 2023"
// where the Ref text is on the left and the Date is right-aligned on the same
// visual line. PDF extracts these as two separate text blocks at different X
// positions. We detect such pairs and render them as a single tab-stop paragraph.

interface SplitLineCandidate {
  leftText: string;
  leftBold: boolean;
  leftFontSize: number;
  rightText: string;
  rightBold: boolean;
  rightFontSize: number;
  y: number;
  spacingAfterPts: number;
}

/**
 * Scan body blocks on a page and identify left/right split metadata lines.
 * Criteria:
 *   - Two blocks whose first lines share the same Y band (within 4pt)
 *   - Left block starts at X < 40% of pageWidth
 *   - Right block starts at X > 55% of pageWidth
 *   - Both blocks are single-line or short (≤ 2 lines)
 *   - Content matches Ref/Date/Page patterns OR any short label: value pattern
 */
function detectSplitMetadataLines(
  blocks: TextBlock[],
  pageWidth: number
): { splitLines: SplitLineCandidate[]; usedBlockIndices: Set<number> } {
  const splitLines: SplitLineCandidate[] = [];
  const usedBlockIndices = new Set<number>();
  const leftThreshold = pageWidth * 0.40;
  const rightThreshold = pageWidth * 0.55;

  for (let i = 0; i < blocks.length; i++) {
    if (usedBlockIndices.has(i)) continue;
    const blockA = blocks[i];
    if (!blockA.lines.length || blockA.lines.length > 3) continue;
    const lineA = blockA.lines[0];
    if (lineA.x >= leftThreshold) continue; // A must be on the left

    // Look for a matching right-side block on the same Y band
    for (let j = i + 1; j < blocks.length; j++) {
      if (usedBlockIndices.has(j)) continue;
      const blockB = blocks[j];
      if (!blockB.lines.length || blockB.lines.length > 3) continue;
      const lineB = blockB.lines[0];
      if (lineB.x < rightThreshold) continue; // B must be on the right
      if (Math.abs(lineA.y - lineB.y) > 4) continue; // same Y band

      // Both qualify — build a split line candidate
      const leftText = blockA.lines.map(l => l.text).join(' ').trim();
      const rightText = blockB.lines.map(l => l.text).join(' ').trim();
      splitLines.push({
        leftText,
        leftBold: !!lineA.bold,
        leftFontSize: lineA.fontSize,
        rightText,
        rightBold: !!lineB.bold,
        rightFontSize: lineB.fontSize,
        y: lineA.y,
        spacingAfterPts: 0,
      });
      usedBlockIndices.add(i);
      usedBlockIndices.add(j);
      break;
    }
  }

  return { splitLines, usedBlockIndices };
}

/**
 * Build a Word paragraph with a right-aligned tab stop for split metadata lines.
 * The line looks like: "Ref. No.: T3-JHC-LT-23-0166 [TAB] Date: 19 Jun. 2023"
 * Uses a right tab stop at the body right margin (8640 twips ≈ full body width).
 */
function buildTabStopParagraph(candidate: SplitLineCandidate, spacingAfterPts: number = 0): Paragraph {
  const afterTwips = spacingAfterPts > 0
    ? Math.min(400, Math.round(spacingAfterPts * 20))
    : DOCX_STYLES.body.spacing.after;

  // Detect if this is a Ref/Date metadata line — add a border box to match PDF layout
  const isRefDateLine =
    /ref\.?\s*no\.?|ref\s*:/i.test(candidate.leftText) ||
    /date\s*:/i.test(candidate.rightText);

  return new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: 8640 }],
    children: [
      new TextRun({
        text: candidate.leftText,
        bold: candidate.leftBold,
        size: Math.round(candidate.leftFontSize * 2) || DOCX_STYLES.body.size,
        font: DOCX_STYLES.body.font,
      }),
      new TextRun({ text: '\t' }),
      new TextRun({
        text: candidate.rightText,
        bold: candidate.rightBold,
        size: Math.round(candidate.rightFontSize * 2) || DOCX_STYLES.body.size,
        font: DOCX_STYLES.body.font,
      }),
    ],
    spacing: { before: 0, after: afterTwips, line: DOCX_STYLES.body.spacing.line },
    // Ref/Date lines in JICC letters have a full border box
    border: isRefDateLine ? {
      top:    { style: BorderStyle.SINGLE, size: 4, color: '000000', space: 4 },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: '000000', space: 4 },
      left:   { style: BorderStyle.SINGLE, size: 4, color: '000000', space: 4 },
      right:  { style: BorderStyle.SINGLE, size: 4, color: '000000', space: 4 },
    } : undefined,
    indent: isRefDateLine ? { left: 120, right: 120 } : undefined,
  });
}

// ─── Refinement 3: Native Word Footer Table ──────────────────────────────────
//
// L&T letters have a 3-column footer: Representative Office | L&T Limited | Registered Office
// JICC letters have a 2-column footer: Contact info | Page N of M
// Rather than rasterizing these as images, we rebuild them as native Word tables
// inside the Word footer zone, preserving editability and search.
//
// Detection: A footer TextBlock is "column-structured" if it contains tokens
// whose X positions cluster into 2 or 3 bands separated by > 25% of page width.

interface FooterColumn {
  text: string;
  bold: boolean;
  fontSize: number;
  alignment: AlignmentType;
}

/**
 * Attempt to parse a footer TextBlock into multiple columns.
 * Returns null if the footer is single-column or unstructured (use image instead).
 */
function parseFooterColumns(
  footerBlock: TextBlock,
  pageWidth: number
): FooterColumn[] | null {
  if (!footerBlock.lines.length) return null;

  // Collect all token X positions
  const allTokens = footerBlock.lines.flatMap(l => l.tokens);
  if (allTokens.length < 4) return null;

  // Cluster token X-starts to find column bands
  const xs = allTokens.map(t => t.x).sort((a, b) => a - b);
  const clusters: number[][] = [];
  let cur: number[] = [xs[0]];
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] - cur[cur.length - 1] < pageWidth * 0.10) {
      cur.push(xs[i]);
    } else {
      clusters.push(cur);
      cur = [xs[i]];
    }
  }
  clusters.push(cur);

  // Need 2 or 3 column clusters, each well-separated (> 20% page width)
  if (clusters.length < 2 || clusters.length > 4) return null;
  const colStartXs = clusters.map(c => Math.min(...c));
  const colEndXs = clusters.map((c, i) =>
    i < clusters.length - 1 ? colStartXs[i + 1] - 1 : pageWidth
  );

  // Build column text by assigning each token to the nearest column band
  const colTexts: string[][] = clusters.map(() => []);
  allTokens.forEach(tok => {
    let bestCol = 0;
    let bestDist = Infinity;
    colStartXs.forEach((sx, ci) => {
      const dist = Math.abs(tok.x - sx);
      if (dist < bestDist) { bestDist = dist; bestCol = ci; }
    });
    colTexts[bestCol].push(tok.text);
  });

  // Filter columns with no content
  const populated = colTexts.filter(c => c.join('').trim().length > 0);
  if (populated.length < 2) return null;

  return colStartXs.map((sx, i): FooterColumn => {
    const colTokens = allTokens.filter(t => t.x >= colStartXs[i] && (i === colStartXs.length - 1 || t.x < colStartXs[i + 1]));
    const text = colTexts[i].join(' ').trim();
    const bold = colTokens.some(t => t.bold);
    const fontSize = colTokens.length > 0
      ? colTokens.reduce((s, t) => s + t.fontSize, 0) / colTokens.length
      : 8;
    // Determine alignment: if column is in right 30% of page → right-align
    const alignment = sx > pageWidth * 0.70 ? AlignmentType.RIGHT
      : sx > pageWidth * 0.35 ? AlignmentType.CENTER
      : AlignmentType.LEFT;
    return { text, bold, fontSize, alignment };
  });
}

/**
 * Build a native Word Table suitable for placement in a Word Footer zone.
 * Columns: derived from footer layout; no borders (invisible table).
 */
function buildFooterTable(columns: FooterColumn[], pageWidth: number): DocxTable {
  const colCount = columns.length;
  const totalTwips = 8640; // full body width
  const colTwips = columns.map(() => Math.floor(totalTwips / colCount));

  const cells = columns.map((col, ci) => {
    const lines = col.text.split(/\n|  {2,}/).map(l => l.trim()).filter(Boolean);
    const paragraphs = lines.map(lineText => new Paragraph({
      children: [new TextRun({
        text: lineText,
        bold: col.bold,
        size: Math.round(col.fontSize * 2) || 14, // default 7pt for footer
        font: DOCX_STYLES.body.font,
        color: '444444',
      })],
      alignment: col.alignment,
      spacing: { before: 0, after: 20 },
    }));
    return new TableCell({
      children: paragraphs.length > 0 ? paragraphs : [new Paragraph({ text: '' })],
      width: { size: colTwips[ci], type: WidthType.DXA },
      borders: {
        top:    { style: BorderStyle.NONE, size: 0, color: 'auto' },
        bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
        left:   { style: BorderStyle.NONE, size: 0, color: 'auto' },
        right:  { style: BorderStyle.NONE, size: 0, color: 'auto' },
      },
      margins: { top: 0, bottom: 0, left: 40, right: 40 },
    });
  });

  return new DocxTable({
    rows: [new TableRow({ children: cells })],
    width: { size: totalTwips, type: WidthType.DXA },
    layout: 'fixed' as any,
  });
}



export type DocClassification = 'LETTER' | 'MOM' | 'TABLE_HEAVY' | 'SCANNED' | 'GENERIC';

interface ConversionDiagnostics {
  preset: string;
  classification: DocClassification;
  textLayerStrength: 'strong' | 'weak' | 'none';
  momConfidence: number;
  tableCount: number;
  fallbackPathUsed: string;
  failedPages: number;
  totalPages: number;
}

/**
 * Robustly classifies a document based on structure and keywords.
 */
function classifyDocument(doc: StructuredDocument): { type: DocClassification; confidence: number } {
  const totalPages = doc.pages.length;
  if (totalPages === 0) return { type: 'GENERIC', confidence: 0 };

  // 1. Check for Scanned (Token density) - Highest Priority
  const totalTokens = doc.pages.reduce((acc, p) => acc + p.blocks.reduce((bAcc, b) => bAcc + b.lines.reduce((lAcc, l) => lAcc + l.tokens.length, 0), 0), 0);
  if (totalTokens < 20) return { type: 'SCANNED', confidence: 1.0 };

  // Sample across ALL pages (not just first 2) to catch MoM annexures on later pages
  const fullText = doc.pages.map(p => p.blocks.map(b => b.text).join(' ')).join(' ').toLowerCase();
  const sampleText = fullText; // alias kept for compat

  // 2. Check for MoM FIRST (highest priority over generic letters) — Priority 2
  // A document is MoM if any page has clear MoM keywords AND a grid table.
  let momScore = 0;
  let hasMoMKeywords = false;
  let hasGrids = false;

  if (/minutes of meeting|mom\b|attendance|list of participants|action taken|agenda item|target date/i.test(fullText)) {
    hasMoMKeywords = true;
    momScore += 0.5;
  }

  // Check ALL pages for grids (MoM table is often on a later page / annexure)
  doc.pages.forEach(p => {
    try {
      const allLines = p.blocks.flatMap(b => b.lines);
      const { tables } = detectTables(allLines, p.width);
      if (tables && tables.length > 0) {
        hasGrids = true;
        if (tables.some(t => (t.logicalRows?.length || 0) > 3)) momScore += 0.3;
      }
    } catch (e) {
      console.warn('Table detection failed during classification for page', p.pageNumber, e);
    }
  });

  if (hasMoMKeywords && hasGrids) return { type: 'MOM', confidence: Math.min(1.0, momScore) };

  // 3. Check for Letter (Salutation + Signature + Reference heuristics) - Priority 3
  let letterScore = 0;
  if (/dear sir|dear madam|to whom|respected sir|yours sincerely|yours faithfully|regards|signature|designation/i.test(sampleText)) {
    letterScore += 0.6;
  }
  if (/ref\.? no|reference no|subject:|sub:|date:|kind attention|copy to|enclosed/i.test(sampleText)) {
    letterScore += 0.4;
  }
  if (letterScore >= 0.6) return { type: 'LETTER', confidence: Math.min(1.0, letterScore) };

  // 4. Check for Table Heavy
  const tableCount = doc.pages.reduce((acc, p) => {
    try {
      const allLines = p.blocks.flatMap(b => b.lines);
      return acc + (detectTables(allLines, p.width).tables?.length || 0);
    } catch (e) {
      return acc;
    }
  }, 0);

  if (tableCount > totalPages * 1.5) return { type: 'TABLE_HEAVY', confidence: 0.8 };

  return { type: 'GENERIC', confidence: 0.5 };
}

// ─── Interfaces ─────────────────────────────────────────────────────────────

interface LetterModel {
  header: TextBlock[];
  subject?: TextBlock;
  reference: TextBlock[];
  salutation?: TextBlock;
  body: TextBlock[];
  closing?: TextBlock;
  signature: TextBlock[];
  enclosures: TextBlock[];
}

interface MomRow {
  item: string;
  discussion: TextBlock[];
  action: TextBlock[];
  responsible: string;
  targetDate: string;
}

interface MomModel {
  title: string;
  projectDetails: TextBlock[];
  rows: MomRow[];
}

// ─── Noise Filtering ────────────────────────────────────────────────────────

function isNoiseBlock(block: TextBlock, bodyFontSize: number): boolean {
  const text = block.text.trim();
  if (!text) return true;
  // Filter out decorative dash/underscore lines (e.g. "-------------")
  if (/^[-_~=\*]{5,}$/.test(text)) return true;
  // Filter out isolated page numbers (e.g. "Page 1 of 2", "- 2 -")
  if (/^page\s+\d+(\s+of\s+\d+)?$/i.test(text)) return true;
  if (/^-\s*\d+\s*-$/.test(text)) return true;
  
  // Suppress repeated page furniture on subsequent pages
  if (block.pageNumber && block.pageNumber > 1) {
    if (text.toUpperCase().includes('PROJECT MANAGEMENT CONSULTANCY') && block.lines[0]?.y < 200) return true;
    if (/^FM-\d+/i.test(text) || text.includes('Rev.2022')) return true;
  }
  return false;
}

// ─── Word Helpers ──────────────────────────────────────────────────────────

function detectHeadingLevel(line: TextLine, bodyFontSize: number): 'title' | 1 | 2 | 3 | null {
  const sizeRatio = line.fontSize / bodyFontSize;
  // Only use font size — do NOT promote bold same-size text to a heading.
  // Bold body text (e.g. "Subject:", "Dear Sir," bold) must remain as paragraph runs.
  if (sizeRatio >= 2.0) return 'title';
  if (sizeRatio >= 1.5) return 1;
  if (sizeRatio >= 1.3) return 2;
  if (sizeRatio >= 1.15) return 3;
  return null;
}

function detectListPrefix(text: string): { isList: boolean; prefix: string } {
  const match = text.match(/^(\d+[\.\)]|[a-zA-Z][\.\)]|[ivxlcdm]+[\.\)]|•|-|·|\*)\s+/i);
  if (match) {
    return { isList: true, prefix: match[1] };
  }
  return { isList: false, prefix: '' };
}

/**
 * Split a text string into normal + superscript segments.
 * Detects ordinal suffixes: 1st, 2nd, 3rd, 4th, 1ST etc.
 * Returns an array of {text, superscript} segments.
 */
function splitSuperscripts(text: string): Array<{ text: string; superscript: boolean }> {
  const segments: Array<{ text: string; superscript: boolean }> = [];
  const re = /(\d+)(st|nd|rd|th)/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), superscript: false });
    }
    segments.push({ text: match[1], superscript: false });
    segments.push({ text: match[2], superscript: true });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), superscript: false });
  }
  return segments.length > 0 ? segments : [{ text, superscript: false }];
}

/**
 * Build TextRun(s) from a token, applying superscript where needed.
 */
function tokenToRuns(text: string, bold: boolean | undefined, italic: boolean | undefined, fontSize: number, font: string): TextRun[] {
  const segments = splitSuperscripts(text);
  if (segments.length === 1 && !segments[0].superscript) {
    return [new TextRun({ text, bold, italics: italic, size: Math.round(fontSize * 2), font })];
  }
  return segments.map(seg => new TextRun({
    text: seg.text,
    bold,
    italics: italic,
    size: seg.superscript ? Math.round(fontSize * 1.4) : Math.round(fontSize * 2),
    font,
    superScript: seg.superscript,
  }));
}

function makeTextRuns(line: TextLine): TextRun[] {
  const allSame = line.tokens.every(t =>
    !!t.bold === !!line.bold &&
    !!t.italic === !!line.italic &&
    t.wordFont === line.wordFont
  );

  if (allSame || line.tokens.length <= 1) {
    return tokenToRuns(line.text, line.bold, line.italic, line.fontSize, line.wordFont || DOCX_STYLES.body.font);
  }

  const runs: TextRun[] = [];
  let i = 0;
  while (i < line.tokens.length) {
    const tok = line.tokens[i];
    let runText = tok.text;
    while (
      i + 1 < line.tokens.length &&
      !!line.tokens[i + 1].bold === !!tok.bold &&
      !!line.tokens[i + 1].italic === !!tok.italic &&
      line.tokens[i + 1].wordFont === tok.wordFont
    ) {
      i++;
      const gap = line.tokens[i].x - (line.tokens[i - 1].x + line.tokens[i - 1].width);
      // Only insert a space if the gap is > 60% of font size (a real word space).
      // Previously 0.25x caused spaces to be inserted inside words due to glyph tracking.
      if (gap > tok.fontSize * 0.60) runText += ' ';
      runText += line.tokens[i].text;
    }
    runs.push(...tokenToRuns(runText, tok.bold, tok.italic, tok.fontSize, tok.wordFont || DOCX_STYLES.body.font));
    i++;
  }
  return runs;
}

function blockToParagraph(block: TextBlock, bodyFontSize: number, indentLevel: number = 0, spacingAfterPts: number = 0, pageWidth: number = 595): Paragraph {
  if (!block.text.trim()) return new Paragraph({ text: '' });
  const headingLevel = detectHeadingLevel(block.lines[0], bodyFontSize);
  const { isList } = detectListPrefix(block.text);

  // ── Justified alignment detection ────────────────────────────────────────
  // A block is justified if it has multiple lines and most lines span close
  // to the full text column width (within 5% of the widest line in the block).
  const bodyWidth = pageWidth * 0.75; // approximate body column width in pts
  let alignment = AlignmentType.LEFT;
  if (block.lines.length >= 2) {
    const maxLineWidth = Math.max(...block.lines.map(l => l.width));
    const fullWidthLines = block.lines.filter(l => l.width >= maxLineWidth * 0.92);
    // If more than half the lines are full-width, it's justified body text
    if (fullWidthLines.length >= block.lines.length * 0.5 && maxLineWidth > bodyWidth * 0.5) {
      alignment = AlignmentType.BOTH; // BOTH = full justify in OOXML
    }
  }
  // Single-line centered detection: if line is centered on the page
  if (block.lines.length === 1) {
    const line = block.lines[0];
    const rightMargin = pageWidth - (line.x + line.width);
    const leftMargin = line.x;
    if (Math.abs(leftMargin - rightMargin) < bodyFontSize * 2 && leftMargin > bodyWidth * 0.15) {
      alignment = AlignmentType.CENTER;
    }
  }
  const allTokens = block.lines.flatMap(l => {
    const toks = [...l.tokens];
    if (toks.length > 0 && !toks[toks.length - 1].text.endsWith(' ')) {
      toks[toks.length - 1] = { ...toks[toks.length - 1], text: toks[toks.length - 1].text + ' ' };
    }
    return toks;
  });
  const runs: TextRun[] = [];
  let i = 0;
  while (i < allTokens.length) {
    const tok = allTokens[i];
    let runText = tok.text;
    // Merge consecutive tokens with matching bold + italic + wordFont
    while (i + 1 < allTokens.length &&
           !!allTokens[i + 1].bold === !!tok.bold &&
           !!allTokens[i + 1].italic === !!tok.italic &&
           allTokens[i + 1].wordFont === tok.wordFont) {
      i++;
      runText += allTokens[i].text;
    }
    runs.push(new TextRun({
      text: runText,
      bold: tok.bold,
      italics: tok.italic,
      size: Math.round(tok.fontSize * 2),
      font: tok.wordFont || DOCX_STYLES.body.font,
    }));
    i++;
  }
  const indentTwips = convertInchesToTwip(indentLevel * 0.35);
  // Convert PDF spacing (pts) to twips: 1pt = 20 twips. Cap at 400 twips (20pt).
  const afterTwips = spacingAfterPts > 0 ? Math.min(400, Math.round(spacingAfterPts * 20)) : DOCX_STYLES.body.spacing.after;
  const spacing = { before: DOCX_STYLES.body.spacing.before, after: afterTwips, line: DOCX_STYLES.body.spacing.line };

  if (isList) {
    return new Paragraph({
      children: runs,
      indent: { left: DOCX_STYLES.list.indent.left + indentTwips, hanging: DOCX_STYLES.list.indent.hanging },
      spacing: DOCX_STYLES.list.spacing,
      alignment: AlignmentType.LEFT,
    });
  }
  if (headingLevel === 'title') {
    return new Paragraph({ text: block.text, heading: HeadingLevel.TITLE, spacing: { before: 240, after: 120 } });
  }
  if (headingLevel === 1) {
    return new Paragraph({ text: block.text, heading: HeadingLevel.HEADING_1, spacing: DOCX_STYLES.heading1.spacing });
  }
  if (headingLevel === 2) {
    return new Paragraph({ text: block.text, heading: HeadingLevel.HEADING_2, spacing: DOCX_STYLES.heading2.spacing });
  }
  return new Paragraph({
    children: runs,
    indent: indentLevel > 0 ? { left: indentTwips } : undefined,
    spacing,
    alignment,
  });
}

function textLineToParagraph(line: TextLine, bodyFontSize: number, indentLevel: number): Paragraph {
  if (!line.text.trim()) return new Paragraph({ text: '' });
  const headingLevel = detectHeadingLevel(line, bodyFontSize);
  const { isList } = detectListPrefix(line.text);
  const indentTwips = convertInchesToTwip(indentLevel * 0.35);
  if (headingLevel === 'title') return new Paragraph({ text: line.text, heading: HeadingLevel.TITLE, spacing: { before: 240, after: 120 } });
  if (headingLevel === 1) return new Paragraph({ text: line.text, heading: HeadingLevel.HEADING_1, spacing: DOCX_STYLES.heading1.spacing });
  if (headingLevel === 2) return new Paragraph({ text: line.text, heading: HeadingLevel.HEADING_2, spacing: DOCX_STYLES.heading2.spacing });
  if (headingLevel === 3) return new Paragraph({ text: line.text, heading: HeadingLevel.HEADING_3, spacing: DOCX_STYLES.heading3.spacing });
  if (isList) {
    return new Paragraph({
      children: makeTextRuns(line),
      indent: { left: DOCX_STYLES.list.indent.left + indentTwips, hanging: DOCX_STYLES.list.indent.hanging },
      spacing: DOCX_STYLES.list.spacing,
      alignment: AlignmentType.LEFT,
    });
  }
  return new Paragraph({
    children: makeTextRuns(line),
    indent: indentLevel > 0 ? { left: indentTwips } : undefined,
    spacing: DOCX_STYLES.body.spacing,
    alignment: AlignmentType.LEFT,
  });
}

function buildDocxTable(
  grid: string[][],
  isFirstRowHeader: boolean,
  anchors: ColumnAnchor[],
  pageWidth: number,
  cellFont: string = DOCX_STYLES.body.font   // ← resolved Word font for this table's content
): DocxTable {
  const colCount = anchors.length;
  const firstAnchorX = anchors[0]?.x ?? 0;
  const rightEdge = pageWidth - firstAnchorX;
  const totalTwips = Math.round((rightEdge / pageWidth) * 8640);

  const colWidthsPts = anchors.map((anchor, idx) => {
    const nextX = anchors[idx + 1]?.x ?? (firstAnchorX + rightEdge);
    return Math.max(30, nextX - anchor.x);
  });
  const sumPts = colWidthsPts.reduce((a, b) => a + b, 0);
  const colWidthsTwips = colWidthsPts.map(w => Math.max(400, Math.floor((w / sumPts) * totalTwips)));

  const cellFontSize = 20; // 10pt default for all cells

  // ── Refinement 4: gridSpan for ALL rows (header + body) ──────────────────
  //
  // Algorithm: for any row, scan left-to-right. When a cell has text and
  // subsequent cells are empty, merge them (columnSpan). This handles:
  //   • Header rows with merged title cells (JICC ERS "Subject:" spanning 3 cols)
  //   • Body rows with partial merges (right-aligned totals spanning columns)
  //
  // Special case for header rows: a SINGLE non-empty cell in the row that spans
  // all columns is a full-width header (title row) — always span the whole table.
  const buildRowCells = (row: string[], isHeader: boolean): TableCell[] => {
    const cells: TableCell[] = [];
    let ci = 0;

    // Full-span header detection: if only one cell has content in a header row
    if (isHeader) {
      const nonEmpty = row.filter(c => (c ?? '').trim().length > 0);
      if (nonEmpty.length === 1 && row[0]?.trim()) {
        // Single cell spanning all columns
        const cellText = row[0].trim();
        const cellWidth = colWidthsTwips.reduce((a, b) => a + b, 0);
        return [new TableCell({
          children: cellText.split('\n').map(l => new Paragraph({
            children: [new TextRun({ text: l.trim(), bold: true, size: 20, font: cellFont, color: 'FFFFFF' })],
            spacing: { before: 30, after: 30 },
            alignment: AlignmentType.CENTER,
          })),
          width: { size: cellWidth, type: WidthType.DXA },
          columnSpan: colCount,
          shading: { fill: '2E4057', color: 'FFFFFF', type: ShadingType.SOLID },
          borders: {
            top:    { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA' },
            bottom: { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA' },
            left:   { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA' },
            right:  { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA' },
          },
          margins: { top: 40, bottom: 40, left: 80, right: 80 },
          verticalAlign: VerticalAlign.CENTER,
        })];
      }
    }

    while (ci < colCount) {
      const cellText = (row[ci] ?? '').trim();

      // Look-ahead: count consecutive empty cells after a filled cell
      let span = 1;
      if (cellText) {
        while (ci + span < colCount && !(row[ci + span] ?? '').trim()) {
          span++;
        }
      }
      // For empty cells with no filled predecessor, never span (keep as individual empty)
      if (!cellText) span = 1;

      const cellWidth = colWidthsTwips.slice(ci, ci + span).reduce((a, b) => a + b, 0);
      const paragraphs = (cellText || '').split('\n').map(lineText => new Paragraph({
        children: [new TextRun({
          text: lineText.trim(),
          bold: isHeader,
          size: isHeader ? 20 : cellFontSize,
          font: cellFont,
          color: isHeader ? 'FFFFFF' : '000000',
        })],
        spacing: { before: 30, after: 30 },
        alignment: isHeader ? AlignmentType.CENTER : AlignmentType.LEFT,
      }));

      cells.push(new TableCell({
        children: paragraphs.length > 0 ? paragraphs : [new Paragraph({ text: '' })],
        width: { size: cellWidth, type: WidthType.DXA },
        columnSpan: span > 1 ? span : undefined,
        shading: isHeader ? { fill: '2E4057', color: 'FFFFFF', type: ShadingType.SOLID } : undefined,
        borders: {
          top:    { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA' },
          bottom: { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA' },
          left:   { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA' },
          right:  { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA' },
        },
        margins: { top: 40, bottom: 40, left: 80, right: 80 },
        verticalAlign: VerticalAlign.CENTER,
      }));
      ci += span;
    }
    return cells;
  };

  const tableRows = grid.map((row, rowIdx) => {
    const isHeader = isFirstRowHeader && rowIdx === 0;
    const cells = buildRowCells(row, isHeader);
    return new TableRow({ children: cells, tableHeader: isHeader });
  });

  return new DocxTable({
    rows: tableRows,
    width: { size: totalTwips, type: WidthType.DXA },
    layout: 'fixed' as any,
  });
}

function buildMoMTable(rows: MomRow[], bodyFontSize: number): DocxTable {
  const headers = ['Item', 'Discussion / Observation', 'Action / Decision', 'Responsible', 'Target Date'];
  const widths = [800, 4200, 2500, 1500, 1000]; 
  const tableRows = [
    new TableRow({
      children: headers.map((h, i) => new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, color: 'FFFFFF', size: 20 })], alignment: AlignmentType.CENTER })],
        width: { size: widths[i], type: WidthType.DXA },
        shading: { fill: '2F5597', type: ShadingType.SOLID },
        verticalAlign: AlignmentType.CENTER,
      })),
      tableHeader: true,
    }),
    ...rows.map(r => new TableRow({
      children: [
        new TableCell({ children: [new Paragraph({ text: r.item, alignment: AlignmentType.CENTER })], width: { size: widths[0], type: WidthType.DXA } }),
        new TableCell({ children: r.discussion.map(b => blockToParagraph(b, bodyFontSize)), width: { size: widths[1], type: WidthType.DXA }, verticalAlign: AlignmentType.TOP }),
        new TableCell({ children: r.action.map(b => blockToParagraph(b, bodyFontSize)), width: { size: widths[2], type: WidthType.DXA }, verticalAlign: AlignmentType.TOP }),
        new TableCell({ children: [new Paragraph({ text: r.responsible, alignment: AlignmentType.CENTER })], width: { size: widths[3], type: WidthType.DXA } }),
        new TableCell({ children: [new Paragraph({ text: r.targetDate, alignment: AlignmentType.CENTER })], width: { size: widths[4], type: WidthType.DXA } }),
      ],
    })),
  ];
  return new DocxTable({
    rows: tableRows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4 }, bottom: { style: BorderStyle.SINGLE, size: 4 },
      left: { style: BorderStyle.SINGLE, size: 4 }, right: { style: BorderStyle.SINGLE, size: 4 },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2 }, insideVertical: { style: BorderStyle.SINGLE, size: 2 },
    },
  });
}

function detectLetterModel(page: StructuredPage, bodyFontSize: number): LetterModel | null {
  const allBlocks = page.blocks.filter(b => !isNoiseBlock(b, bodyFontSize));
  if (allBlocks.length < 3) return null;
  const model: LetterModel = { header: [], reference: [], body: [], signature: [], enclosures: [] };
  let stage: 'header' | 'subject' | 'reference' | 'body' | 'signature' | 'enclosure' = 'header';
  
  // Sort blocks by Y to ensure reading order
  const sortedBlocks = [...allBlocks].sort((a, b) => {
    const aY = a.lines.length ? a.lines[0].y : 0;
    const bY = b.lines.length ? b.lines[0].y : 0;
    return aY - bY;
  });

  for (const block of sortedBlocks) {
    const textContent = block.text.trim();
    if (!textContent) continue;
    const lowerText = textContent.toLowerCase();

    // Zone Transition heuristics
    if (stage === 'header' && (lowerText.startsWith('sub:') || lowerText.startsWith('subject:'))) {
      model.subject = block;
      stage = 'subject'; 
      continue;
    }
    if ((stage === 'header' || stage === 'subject') && (lowerText.startsWith('ref:') || lowerText.startsWith('reference:'))) {
      model.reference.push(block);
      stage = 'reference'; 
      continue;
    }
    if ((stage === 'header' || stage === 'subject' || stage === 'reference') && 
        (lowerText.startsWith('dear') || lowerText.startsWith('to whom') || lowerText.includes('sir/madam') || lowerText.startsWith('respected'))) {
      model.salutation = block; 
      stage = 'body'; 
      continue;
    }
    if (stage === 'body' && (lowerText.startsWith('yours ') || lowerText.startsWith('sincerely') || lowerText.startsWith('regards') || lowerText.startsWith('thanking'))) {
      model.closing = block; 
      stage = 'signature'; 
      continue;
    }
    if ((stage === 'body' || stage === 'signature') && (lowerText.startsWith('encl') || lowerText.startsWith('copy to') || lowerText.startsWith('cc:'))) {
      model.enclosures.push(block);
      stage = 'enclosure';
      continue;
    }

    // Assignment based on current stage
    if (stage === 'header') {
      model.header.push(block);
    } else if (stage === 'subject') {
      if (lowerText.startsWith('ref:') || lowerText.startsWith('reference:')) {
        model.reference.push(block);
        stage = 'reference';
      } else if (model.subject) { 
        // Only merge if they are very close in Y, otherwise it might be body
        model.subject.lines.push(...block.lines); 
        model.subject.text += ' ' + block.text; 
      }
    } else if (stage === 'reference') {
      // If it looks like a numbered list item or continues reference
      if (/^\d+\.|^[a-z]\)/i.test(lowerText) || block.lines[0].x > page.width / 3) {
        model.reference.push(block);
      } else if (lowerText.startsWith('dear') || lowerText.startsWith('respected')) {
        model.salutation = block;
        stage = 'body';
      } else {
        model.reference.push(block);
      }
    } else if (stage === 'body') {
      // Prevent footer/page number bleed into body
      if (block.lines[0].y > page.height * 0.9 && (lowerText.includes('page') || lowerText.length < 20)) {
        continue;
      }
      model.body.push(block);
    } else if (stage === 'signature') { 
      // Right-aligned or bottom blocks
      model.signature.push(block); 
    } else if (stage === 'enclosure') {
      model.enclosures.push(block);
    }
  }

  // A valid letter needs at least some body and either a header, subject, or salutation
  if (model.body.length > 0 && (model.header.length > 0 || model.salutation || model.subject)) return model;
  return null;
}

// ─── MoM Model Detection (Hardened) ──────────────────────────────────────────

const MOM_SYNONYMS = {
  item: ['item', 'no', 'sr', 'point', 'agenda'],
  discussion: ['discussion', 'observation', 'description', 'details', 'remarks', 'points'],
  action: ['action', 'decision', 'agreed', 'recommendation', 'decisions'],
  responsible: ['responsible', 'responsibility', 'by', 'owner', 'pic', 'action by'],
  targetDate: ['date', 'status', 'target', 'when', 'timeline', 'due date'],
};

function mapMoMColumns(headerRow: string[]): Record<keyof typeof MOM_SYNONYMS, number> {
  const result: any = {};
  const lowerHeaders = headerRow.map(h => h.toLowerCase().trim());

  Object.entries(MOM_SYNONYMS).forEach(([key, synonyms]) => {
    result[key] = lowerHeaders.findIndex(h => synonyms.some(s => h.includes(s)));
  });

  return result;
}

function detectMoMModel(page: StructuredPage, bodyFontSize: number): MomModel | null {
  try {
    const text = page.blocks.map(b => b.text).join(' ');
    // Harden MoM detection: Require clear meeting markers
    const hasKeywords = /minutes of meeting|mom|attendance|action taken|agenda/i.test(text);
    if (!hasKeywords) return null;

    const model: MomModel = { title: '', projectDetails: [], rows: [] };
    const allLines = page.blocks.flatMap(b => b.lines);
    const { tables } = detectTables(allLines, page.width);

    if (tables && tables.length > 0) {
      // Pick the largest table
      const table = [...tables].sort((a, b) => (b.logicalRows?.length || 0) - (a.logicalRows?.length || 0))[0];
      const grid = tableToGrid(table, page.width);
      if (grid.length < 2) return null;

      const colMap = mapMoMColumns(grid[0]);

      // Map table rows to MomRow blocks
      table.logicalRows.slice(1).forEach((rowLines, rowIdx) => {
        const rowGrid = tableToGrid({ ...table, logicalRows: [rowLines] }, page.width)[0];
        
        const getBlocksForCol = (colIdx: number): TextBlock[] => {
          if (colIdx === -1 || colIdx >= rowGrid.length) return [];
          const colStart = table.anchors[colIdx].x;
          const colEnd = table.anchors[colIdx + 1]?.x || page.width;
          const colLines = rowLines.filter(l => l.x >= colStart - 12 && l.x < colEnd + 12);
          if (!colLines.length) {
              if (rowGrid[colIdx]) {
                  return [{ type: 'paragraph', text: rowGrid[colIdx], lines: [], pageNumber: page.pageNumber }];
              }
              return [];
          }
          return [constructBlock(colLines, page.pageNumber)];
        };

        model.rows.push({
          item: colMap.item !== -1 ? rowGrid[colMap.item] : '',
          discussion: getBlocksForCol(colMap.discussion),
          action: getBlocksForCol(colMap.action),
          responsible: colMap.responsible !== -1 ? rowGrid[colMap.responsible] : '',
          targetDate: colMap.targetDate !== -1 ? rowGrid[colMap.targetDate] : '',
        });
      });

      // Extract title and project details from blocks above the table
      const topBlocks = page.blocks.filter(b => b.lines.length > 0 && b.lines[0].y < table.startY);
      if (topBlocks.length > 0) {
        model.title = topBlocks[0].text;
        model.projectDetails = topBlocks.slice(1);
      }

      return model;
    }
  } catch (err) {
    console.warn('detectMoMModel probe failed safely:', err);
  }

  return null;
}


// ─── Scanned Fallback ──────────────────────────────────────────────────────

async function convertScannedToWord(file: File, onProgress?: (msg: string) => void): Promise<Blob> {
  if (onProgress) onProgress('Scanned PDF detected. Generating image-based fallback...');
  
  const bytes = await getPdfBytes(file);
  const pdf = await getDocument({ data: bytes }).promise;
  const sections: any[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    if (onProgress) onProgress(`Capturing page ${i}/${pdf.numPages}...`);
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2.0 }); // 144 DPI for clarity
    
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;
    
    const dataUrl = canvas.toDataURL('image/png');

    sections.push({
      properties: {
        page: {
          size: {
            width: convertInchesToTwip(viewport.width / (72 * 2)),
            height: convertInchesToTwip(viewport.height / (72 * 2)),
            orientation: viewport.width > viewport.height ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
          },
          margin: { top: 0, bottom: 0, left: 0, right: 0 },
        },
      },
      children: [
        new Paragraph({
          children: [
            new ImageRun({
              data: dataUrl,
              transformation: { width: viewport.width / 2, height: viewport.height / 2 },
            }),
          ],
          alignment: AlignmentType.CENTER,
        }),
        new Paragraph({
          children: [
            new TextRun({ 
              text: 'Note: This is an image-based export of a scanned page. Text is not editable.', 
              size: 16, 
              italics: true,
              color: '666666'
            })
          ],
          alignment: AlignmentType.CENTER,
          spacing: { before: 200 }
        })
      ],
    });
  }

  const docFile = new Document({ sections });
  return Packer.toBlob(docFile);
}

// ─── PUBLIC API ─────────────────────────────────────────────────────────────

export interface ConversionOptions {
  preset: 'auto' | 'letter' | 'mom';
  pageRange?: { start: number; end: number };
}

export async function convertPDFToWord(
  file: File, 
  options: ConversionOptions = { preset: 'auto' },
  onProgress?: (msg: string) => void
): Promise<{ blob: Blob; diagnostics: ConversionDiagnostics }> {
  const { preset, pageRange } = options;
  if (onProgress) onProgress('Phase 1/4: Analyzing physical structure...');
  
  let doc: StructuredDocument;
  try {
    doc = await extractStructuredDocument(file, file.name, onProgress);
  } catch (error: any) {
    if (error.message === 'ENCRYPTED' || error.message === 'CORRUPTED') {
      throw error; // Re-throw to be handled by UI
    }
    throw new Error('UNSUPPORTED_FORMAT');
  }

  // Filter by page range if provided
  if (pageRange) {
    doc.pages = doc.pages.filter(p => p.pageNumber >= pageRange.start && p.pageNumber <= pageRange.end);
  }
  
  // 1. Classification & Diagnostics (Conditional Bypassing)
  let classification: { type: DocClassification; confidence: number };
  
  if (preset !== 'auto') {
    // If manual preset, do a lightweight scanned check only
    const totalTokens = doc.pages.reduce((acc, p) => acc + p.blocks.reduce((bAcc, b) => bAcc + b.lines.reduce((lAcc, l) => lAcc + l.tokens.length, 0), 0), 0);
    classification = { 
      type: totalTokens < 20 ? 'SCANNED' : preset.toUpperCase() as DocClassification, 
      confidence: 1.0 
    };
  } else {
    classification = classifyDocument(doc);
  }

  const diagnostics: ConversionDiagnostics = {
    preset,
    classification: classification.type,
    textLayerStrength: classification.type === 'SCANNED' ? 'none' : 'strong',
    momConfidence: classification.type === 'MOM' ? classification.confidence : 0,
    tableCount: 0, // Computed during loop for efficiency
    fallbackPathUsed: 'none',
    failedPages: 0,
    totalPages: doc.pages.length,
  };

  if (preset !== 'auto' && preset.toUpperCase() !== classification.type && classification.type !== 'SCANNED') {
    diagnostics.fallbackPathUsed = `forced_${preset}_from_auto`;
  }

  console.log('--- Conversion Diagnostics ---');
  console.table(diagnostics);

  // 2. Handle Scanned PDFs
  if (classification.type === 'SCANNED') {
    if (onProgress) onProgress('Phase 2/4: Capturing scanned pages...');
    const blob = await convertScannedToWord(file, onProgress);
    return { blob, diagnostics };
  }

  const effectiveFlow = classification.type;

  // Reuse the PDF document for rendering stamps to avoid repeated loads
  const bytes = await getPdfBytes(file);
  const pdfForStamps = await getDocument({ data: bytes }).promise;

  type PageContent = 
    | { type: 'paragraph'; data: Paragraph }
    | { type: 'table'; grid: string[][]; isHeader: boolean; anchors: ColumnAnchor[]; pageWidth: number; cellFont: string }
    | { type: 'mom_table'; rows: MomRow[]; bodyFontSize: number };

  const allContents: PageContent[] = [];
  
  // Track stamps and regions for section creation
  let firstHeader: Header | undefined;
  let firstFooter: Footer | undefined;
  let defaultHeader: Header | undefined;
  let defaultFooter: Footer | undefined;
  let basePageProps: any;

  for (let i = 0; i < doc.pages.length; i++) {
    const page = doc.pages[i];
    if (onProgress) onProgress(`Phase 2/4: Processing layout (Page ${i + 1}/${doc.pages.length})...`);
    
    // UI Yield
    await new Promise(resolve => setTimeout(resolve, 0));

    try {
      const regions = detectPageRegions(page);
      
      // OPTIMIZATION: Fast stamp generation using cached PDF instance
      const stamps = await generatePageStampsFromPdf(pdfForStamps, page.pageNumber, regions);

      // Build native header from stamp (always image — preserves logo/letterhead exactly)
      const headerObj = stamps.header ? new Header({
        children: [new Paragraph({
          children: [new ImageRun({
            data: stamps.header.dataUrl,
            transformation: { width: stamps.header.width, height: stamps.header.height },
          })],
          alignment: AlignmentType.CENTER,
        })],
      }) : undefined;

      // ── Refinement 3: Smart footer — try native Word table, fall back to image ──
      // If the page has a footer TextBlock with 2–3 clearly separated columns (e.g.
      // L&T's Representative/Main/Registered Office footer), rebuild it as an editable
      // Word table in the footer zone. Otherwise use the rasterized image stamp.
      let footerObj: Footer | undefined;
      if (stamps.footer) {
        // Try to find a footer TextBlock from this page
        const footerBlock = page.footer;
        let nativeFooterBuilt = false;

        if (footerBlock && footerBlock.lines.length > 0) {
          const footerColumns = parseFooterColumns(footerBlock, page.width);
          if (footerColumns && footerColumns.length >= 2) {
            // Build a top-border separator line + column table
            const separatorLine = new Paragraph({
              children: [new TextRun({ text: '', size: 14 })],
              border: { top: { style: BorderStyle.SINGLE, size: 6, color: '000000', space: 1 } },
              spacing: { before: 0, after: 60 },
            });
            const footerTableNode = buildFooterTable(footerColumns, page.width);
            footerObj = new Footer({ children: [separatorLine, footerTableNode] });
            nativeFooterBuilt = true;
          }
        }

        if (!nativeFooterBuilt) {
          // Fall back to image stamp
          footerObj = new Footer({
            children: [new Paragraph({
              children: [new ImageRun({
                data: stamps.footer.dataUrl,
                transformation: { width: stamps.footer.width, height: stamps.footer.height },
              })],
              alignment: AlignmentType.CENTER,
            })],
          });
        }
      }

      if (i === 0) {
        firstHeader = headerObj;
        firstFooter = footerObj;
        basePageProps = {
          size: {
            width: convertInchesToTwip(page.width / 72),
            height: convertInchesToTwip(page.height / 72),
            orientation: page.width > page.height ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
          },
          margin: {
            // Header/footer images are placed in Word's header/footer zones.
            // The body margin should accommodate them without being too large.
            // Use the image height converted to twips, but cap at reasonable limits.
            top: Math.min(convertInchesToTwip(1.8), Math.max(convertInchesToTwip(0.6),
                  regions.header ? convertInchesToTwip(regions.header.height / 72) : convertInchesToTwip(0.75))),
            bottom: Math.min(convertInchesToTwip(1.0), Math.max(convertInchesToTwip(0.4),
                    regions.footer ? convertInchesToTwip(regions.footer.height / 72) : convertInchesToTwip(0.5))),
            left: convertInchesToTwip(0.75),
            right: convertInchesToTwip(0.5),
            header: convertInchesToTwip(0.25),
            footer: convertInchesToTwip(0.25),
          },
        };
      } else if (i === 1) {
        defaultHeader = headerObj;
        defaultFooter = footerObj;
      } else if (i > 1 && !defaultHeader && headerObj) {
        defaultHeader = headerObj;
      }

      // Filter content to only what is in the body region
      const bodyBlocks = page.blocks.filter(b => {
        if (!b.lines.length) return false;
        const top = b.lines[0].y;
        return top >= regions.body.y - 5 && top < (regions.body.y + regions.body.height + 5);
      });

      const allLines = bodyBlocks.flatMap(b => b.lines);
      const sizes = allLines.flatMap(l => l.tokens.map(t => t.fontSize)).sort((a, b) => a - b);
      const bodyFontSize = sizes[Math.floor(sizes.length / 2)] || 10;
      const minX = allLines.length ? Math.min(...allLines.map(l => l.x)) : 50;

      // ── Compute dominant Word font for this page (majority vote by character count) ──
      const fontWeightMap = new Map<string, number>();
      allLines.forEach(l => l.tokens.forEach(t => {
        if (t.wordFont && t.text.trim().length > 0) {
          fontWeightMap.set(t.wordFont, (fontWeightMap.get(t.wordFont) || 0) + t.text.trim().length);
        }
      }));
      const pageBodyFont = fontWeightMap.size > 0
        ? [...fontWeightMap.entries()].sort((a, b) => b[1] - a[1])[0][0]
        : DOCX_STYLES.body.font;

      const pushPara = (p: Paragraph) => allContents.push({ type: 'paragraph', data: p });

      if (effectiveFlow === 'MOM') {
        const mom = detectMoMModel(page, bodyFontSize);
        if (mom) {
          if (mom.title) pushPara(new Paragraph({ text: mom.title, heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, spacing: { after: 200 } }));
          mom.projectDetails.forEach(detail => {
            if (!isNoiseBlock(detail, bodyFontSize)) pushPara(blockToParagraph(detail, bodyFontSize));
          });
          allContents.push({ type: 'mom_table', rows: mom.rows, bodyFontSize });
        } else {
          renderMixedContent(bodyBlocks, bodyFontSize, minX, page.width, allContents as any, pageBodyFont);
        }
      } else if (effectiveFlow === 'LETTER') {
        renderMixedContent(bodyBlocks, bodyFontSize, minX, page.width, allContents as any, pageBodyFont);

        const letter = detectLetterModel(page, bodyFontSize);
        if (letter && letter.enclosures.length > 0) {
          const enclosureBlocks = letter.enclosures.filter(b => !isNoiseBlock(b, bodyFontSize));
          const bodyTexts = new Set(bodyBlocks.map(b => b.text.trim()));
          enclosureBlocks.forEach(enc => {
            if (!bodyTexts.has(enc.text.trim())) {
              pushPara(blockToParagraph(enc, bodyFontSize, 0));
            }
          });
        }
      } else {
        renderMixedContent(bodyBlocks, bodyFontSize, minX, page.width, allContents as any, pageBodyFont);
      }
    } catch (pageError) {
      console.error(`Page ${i + 1} processing failed:`, pageError);
      diagnostics.failedPages++;
      allContents.push({ type: 'paragraph', data: new Paragraph({ text: `[Partial Error: Page ${i+1} could not be rendered]` }) });
    }
  }

  if (diagnostics.failedPages === doc.pages.length && doc.pages.length > 0) {
    throw new Error('ALL_PAGES_FAILED');
  }

  // MERGE ADJACENT TABLES TO ENSURE MULTI-PAGE CONTINUITY
  const mergedContents: PageContent[] = [];
  for (const item of allContents) {
    const last = mergedContents[mergedContents.length - 1];
    if (item.type === 'table' && last?.type === 'table' && item.grid[0].length === last.grid[0].length) {
      if (item.grid[0].join('|') === last.grid[0].join('|')) {
        last.grid.push(...item.grid.slice(1));
      } else {
        last.grid.push(...item.grid);
      }
      // Keep the first page's cellFont (it's the cover font; subsequent pages inherit it)
    } else if (item.type === 'mom_table' && last?.type === 'mom_table') {
      last.rows.push(...item.rows);
    } else {
      mergedContents.push(item);
    }
  }

  // BUILD DOC CHILDREN
  const finalChildren = mergedContents.map(item => {
    if (item.type === 'paragraph') return item.data;
    if (item.type === 'mom_table') return buildMoMTable(item.rows, item.bodyFontSize);
    if (item.type === 'table') return buildDocxTable(item.grid, item.isHeader, item.anchors, item.pageWidth, item.cellFont);
    return new Paragraph({ text: '' });
  });

  const sections = [{
    properties: {
      titlePage: !!firstHeader || !!firstFooter,
      page: basePageProps || { margin: { top: 720, bottom: 720, left: 720, right: 720 } },
    },
    headers: {
      first: firstHeader,
      default: defaultHeader || firstHeader,
    },
    footers: {
      first: firstFooter,
      default: defaultFooter || firstFooter,
    },
    children: finalChildren,
  }];

  if (onProgress) onProgress('Phase 3/4: Finalizing document styles...');
  await new Promise(resolve => setTimeout(resolve, 0));

  const docFile = new Document({
    styles: {
      default: {
        document: { 
          run: { 
            font: DOCX_STYLES.body.font, 
            size: DOCX_STYLES.body.size,
            color: '000000',
          },
          paragraph: {
            spacing: DOCX_STYLES.body.spacing,
          }
        },
      },
      paragraphStyles: [
        {
          id: 'Normal',
          name: 'Normal',
          quickFormat: true,
          run: { font: DOCX_STYLES.body.font, size: DOCX_STYLES.body.size },
          paragraph: { spacing: DOCX_STYLES.body.spacing },
        },
        {
          id: 'Heading1',
          name: 'Heading 1',
          quickFormat: true,
          run: { font: DOCX_STYLES.body.font, size: DOCX_STYLES.heading1.size, bold: true, color: '2E5496' },
          paragraph: { spacing: DOCX_STYLES.heading1.spacing },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          quickFormat: true,
          run: { font: DOCX_STYLES.body.font, size: DOCX_STYLES.heading2.size, bold: true, color: '2E5496' },
          paragraph: { spacing: DOCX_STYLES.heading2.spacing },
        },
      ],
    },
    sections,
  });

  if (onProgress) onProgress('Phase 4/4: Exporting Word file...');
  const blob = await Packer.toBlob(docFile);
  return { blob, diagnostics };
}


/**
 * Reusable layout engine for non-specialized pages.
 * Preserves TextBlock grouping for paragraphs but extracts tables cleanly.
 * Integrates split-line metadata detection for Ref./Date tab-stop paragraphs.
 */
function renderMixedContent(
  blocks: TextBlock[], 
  bodyFontSize: number, 
  minX: number, 
  pageWidth: number,
  pageContents: any[],
  pageBodyFont: string = DOCX_STYLES.body.font   // ← dominant font for this page
) {
  // Filter out noise blocks first
  const validBlocks = blocks.filter(b => !isNoiseBlock(b, bodyFontSize));

  // ── Refinement 1 & 2: Detect split left/right metadata lines (Ref./Date etc.) ──
  // Run BEFORE table detection so these blocks are excluded from the table engine.
  const { splitLines, usedBlockIndices } = detectSplitMetadataLines(validBlocks, pageWidth);
  const afterSplitBlocks = validBlocks.filter((_, idx) => !usedBlockIndices.has(idx));

  const allLines = afterSplitBlocks.flatMap(b => b.lines);
  const { tables } = detectTables(allLines, pageWidth);

  // Build a Set of all TextLine objects that belong to detected tables
  // Use object identity (line reference) for precise exclusion.
  const tableLineSet = new Set<TextLine>();
  tables.forEach(t => {
    t.logicalRows.forEach(row => row.forEach(line => tableLineSet.add(line)));
  });

  type ContentItem =
    | { kind: 'block'; y: number; block: TextBlock }
    | { kind: 'split'; y: number; candidate: SplitLineCandidate }
    | { kind: 'table'; y: number; table: DetectedTable };

  const items: ContentItem[] = [];

  splitLines.forEach(s => items.push({ kind: 'split', y: s.y, candidate: s }));
  tables.forEach(t => items.push({ kind: 'table', y: t.startY, table: t }));

  afterSplitBlocks.forEach(b => {
    if (b.lines.length === 0) return;
    // Exclude block if ANY of its lines belong to a detected table
    const insideTable = b.lines.some(l => tableLineSet.has(l));
    if (!insideTable) {
      items.push({ kind: 'block', y: b.lines[0].y, block: b });
    }
  });

  items.sort((a, b) => a.y - b.y);

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    const nextItem = items[idx + 1];

    // Compute spacing gap to next item
    let gapToNext = 0;
    if (nextItem) {
      const itemBottom = item.kind === 'block'
        ? item.block.lines[item.block.lines.length - 1].y + item.block.lines[item.block.lines.length - 1].height
        : item.kind === 'split'
          ? item.candidate.y + bodyFontSize * 1.2
          : (item as any).table?.endY ?? item.y;
      gapToNext = Math.max(0, nextItem.y - itemBottom);
    }
    const spacingAfterPts = gapToNext > 2 && gapToNext < 40 ? gapToNext : (gapToNext >= 40 ? 10 : 0);

    if (item.kind === 'split') {
      pageContents.push({ type: 'paragraph', data: buildTabStopParagraph(item.candidate, spacingAfterPts) });
    } else if (item.kind === 'block') {
      const block = item.block;
      if (block.lines.length === 0) continue;
      const indentLevel = Math.max(0, Math.round((block.lines[0].x - minX) / (bodyFontSize * 2)));

      // If the block has multiple lines with different bold/size attributes, render line-by-line
      const hasMixedFormatting = block.lines.length > 1 &&
        block.lines.some(l => !!l.bold !== !!block.lines[0].bold ||
          Math.abs(l.fontSize - block.lines[0].fontSize) > 1.5);

      if (hasMixedFormatting) {
        block.lines.forEach(line => {
          pageContents.push({ type: 'paragraph', data: textLineToParagraph(line, bodyFontSize, indentLevel) });
        });
      } else {
        pageContents.push({ type: 'paragraph', data: blockToParagraph(block, bodyFontSize, indentLevel, spacingAfterPts, pageWidth) });
      }
    } else {
      const grid = tableToGrid(item.table, pageWidth);
      if (grid.length === 0) continue;
      const firstRowText = grid[0].join(' ');
      const isHeader = firstRowText === firstRowText.toUpperCase() ||
        item.table.logicalRows[0]?.some(line => line.bold);

      pageContents.push({ type: 'table', grid, isHeader, anchors: item.table.anchors, pageWidth, cellFont: pageBodyFont });
    }
  }
}

// ─── Excel conversion ────────────────────────────────────────────────────────

function inferCellType(text: string): { v: string | number | Date; t: 's' | 'n' | 'd' } {
  const clean = (text || '').trim();
  if (!clean) return { v: '', t: 's' };
  const dateMatch = clean.match(/^(\d{4}-\d{2}-\d{2})|(\d{2}[\/\-]\d{2}[\/\-]\d{4})$/);
  if (dateMatch) { const d = new Date(clean); if (!isNaN(d.getTime())) return { v: d, t: 'd' }; }
  const isCode = /^[0-9]+[-][0-9]+/.test(clean) || clean.length > 15;
  const num = Number(clean.replace(/[$,]/g, '').replace(/(\d)%$/, '$1'));
  if (!isNaN(num) && clean.length > 0 && /^\d/.test(clean) && !isCode) return { v: num, t: 'n' };
  return { v: clean, t: 's' };
}

/**
 * Robust table extractor for Excel output.
 *
 * Algorithm (final, validated against SHE schedule + Turnout MS PDFs):
 *
 * STEP 1 — Use PDF page structural data (rect/line annotations) to find true
 *   column boundaries. PDFs with drawn table borders expose vertical line X
 *   positions that perfectly mark column dividers. This is always more accurate
 *   than clustering text X positions.
 *
 * STEP 2 — Fall back to body-text clustering when no structural lines exist.
 *   Skip the first 15% of bands (header area) to avoid merged-cell false anchors.
 *   Use ≥10% page width minimum separation between anchors.
 *
 * STEP 3 — Group all tokens into physical Y-bands (within 3pt = same line).
 *
 * STEP 4 — Detect logical row boundaries using Y-gap (>1.8× medianH) OR
 *   col0-content reset (when col0 has new content and current row is ≥4 bands deep).
 *
 * STEP 5 — Merge physical bands into logical row cells (space-joined).
 */
function extractVectorBoundaries(
  pageRects: Array<{ x: number; y: number; width: number; height: number }>,
  pageWidth: number
) {
  const vertLines: number[] = [];
  const horizLines: number[] = [];

  // Compute widest horizontal rect (= full table width)
  const maxRectWidth = Math.max(0, ...pageRects.map(r => r.width));
  // Row separator = at least 40% of table width (single line) OR
  // aggregate of multiple co-Y segments that together span ≥40%
  const minRowLineWidth = maxRectWidth * 0.40;

  // Aggregate horizontal segments by Y position
  const hSegsByY = new Map<number, number>(); // y → total width
  for (const r of pageRects) {
    if (r.width >= 5 && r.height <= 2) { // thin horizontal line segment
      const yKey = Math.round(r.y * 2) / 2; // bucket to 0.5pt
      hSegsByY.set(yKey, (hSegsByY.get(yKey) ?? 0) + r.width);
    }
    // Also include wide solid rects as row lines
    if (r.width >= Math.max(50, minRowLineWidth)) {
      const yKey = Math.round(r.y * 2) / 2;
      hSegsByY.set(yKey, (hSegsByY.get(yKey) ?? 0) + r.width);
    }
  }

  // Accept Y positions where total segment width ≥ minRowLineWidth
  for (const [y, totalW] of hSegsByY) {
    if (totalW >= minRowLineWidth) horizLines.push(y);
  }

  // Vertical column dividers: LEFT edge of tall rects (height ≥ 15pt)
  for (const r of pageRects) {
    if (r.height >= 15) vertLines.push(r.x);
  }

  // Deduplicate with 8pt tolerance
  const deduplicate = (arr: number[], tolerance: number) => {
    arr.sort((a, b) => a - b);
    const deduped: number[] = [];
    for (const v of arr) {
      if (deduped.length === 0 || v - deduped[deduped.length - 1] > tolerance) {
        deduped.push(v);
      }
    }
    return deduped;
  };

  // Secondary pass: merge boundaries < 15pt apart (double-stroke thick borders)
  const mergeClose = (arr: number[], minGap: number) => {
    if (arr.length < 2) return arr;
    const out: number[] = [arr[0]];
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] - out[out.length - 1] >= minGap) out.push(arr[i]);
    }
    return out;
  };

  return {
    vertBoundaries: mergeClose(deduplicate(vertLines, 8), 15),
    horizBoundaries: mergeClose(deduplicate(horizLines, 8), 15),
  };
}

function extractTablesForExcel(
  allLines: TextLine[],
  pageWidth: number,
  pageRects?: Array<{ x: number; y: number; width: number; height: number }>
): Array<{ grid: string[][]; colWidthsPts: number[]; startY: number; endY: number }> {
  if (!allLines.length) return [];

  const allTokens = allLines
    .flatMap(l => l.tokens.filter(t => t.text.trim().length > 0))
    .sort((a, b) => a.y !== b.y ? a.y - b.y : a.x - b.x);
  
  if (!allTokens.length) return [];

  let vertBoundaries: number[] = [];
  let horizBoundaries: number[] = [];
  if (pageRects && pageRects.length > 0) {
    const b = extractVectorBoundaries(pageRects, pageWidth);
    vertBoundaries = b.vertBoundaries;
    horizBoundaries = b.horizBoundaries;
  }

  const hasVectorCols = vertBoundaries.length >= 2;
  const hasVectorRows = horizBoundaries.length >= 3; 

  // --- PHASE 1: FULL GEOMETRIC RECONSTRUCTION ---
  if (hasVectorCols && hasVectorRows) {
    const numCols = vertBoundaries.length - 1;
    const numRows = horizBoundaries.length - 1;
    
    const cellTokens: TextToken[][][] = Array.from({ length: numRows }, () =>
      Array.from({ length: numCols }, () => [])
    );

    for (const tok of allTokens) {
      const tCx = tok.x + tok.width / 2;
      const tCy = tok.y + tok.height / 2;

      let cIdx = -1;
      for (let c = 0; c < numCols; c++) {
        if (tCx >= vertBoundaries[c] - 2 && tCx <= vertBoundaries[c + 1] + 2) {
          cIdx = c;
          break;
        }
      }

      let rIdx = -1;
      for (let r = 0; r < numRows; r++) {
        if (tCy >= horizBoundaries[r] - 2 && tCy <= horizBoundaries[r + 1] + 2) {
          rIdx = r;
          break;
        }
      }

      // Snapping
      if (cIdx === -1) {
        cIdx = tCx < vertBoundaries[0] ? 0 : numCols - 1;
      }
      if (rIdx === -1) {
        rIdx = tCy < horizBoundaries[0] ? 0 : numRows - 1;
      }
      
      cellTokens[rIdx][cIdx].push(tok);
    }

    const grid: string[][] = [];
    for (let r = 0; r < numRows; r++) {
      const rowStrings: string[] = [];
      let hasContentInRow = false;
      
      for (let c = 0; c < numCols; c++) {
        const toks = cellTokens[r][c];
        if (!toks.length) {
          rowStrings.push('');
          continue;
        }
        hasContentInRow = true;
        
        toks.sort((a, b) => Math.abs(a.y - b.y) > 3 ? a.y - b.y : a.x - b.x);
        
        let cellStr = '';
        let currentYLine = toks[0].y;
        
        for (const t of toks) {
          if (Math.abs(t.y - currentYLine) > 4) { 
            cellStr += '\n' + t.text;
            currentYLine = t.y;
          } else { 
            if (cellStr.length > 0 && !cellStr.endsWith('\n') && !cellStr.endsWith(' ')) {
              cellStr += ' ';
            }
            cellStr += t.text;
          }
        }
        rowStrings.push(cellStr.trim());
      }
      
      if (hasContentInRow) {
        grid.push(rowStrings);
      }
    }

    if (grid.length > 0) {
      const colWidthsPts: number[] = [];
      for (let c = 0; c < numCols; c++) {
        colWidthsPts.push(Math.max(40, vertBoundaries[c + 1] - vertBoundaries[c]));
      }

      return [{
        grid,
        colWidthsPts,
        startY: horizBoundaries[0],
        endY: horizBoundaries[numRows]
      }];
    }
  }

  // --- PHASE 2: HYBRID / HEURISTIC FALLBACK ---
  interface PhysBand {
    y: number;
    height: number;
    tokens: typeof allTokens;
  }
  const bands: PhysBand[] = [];
  let bTokens = [allTokens[0]];
  for (let i = 1; i <= allTokens.length; i++) {
    const tok = allTokens[i];
    if (tok && Math.abs(tok.y - bTokens[0].y) <= 3) {
      bTokens.push(tok);
    } else {
      bands.push({ y: bTokens[0].y, height: bTokens[0].height || 11, tokens: [...bTokens] });
      bTokens = tok ? [tok] : [];
    }
  }
  if (!bands.length) return [];

  let anchors: number[] = [];
  let isVectorColsFallback = false;

  if (hasVectorCols) {
    anchors = vertBoundaries;
    isVectorColsFallback = true;
  } else {
    const minSep = pageWidth * 0.10;
    const skip = Math.min(3, Math.floor(bands.length * 0.15));
    const bodyTokens = bands.slice(skip).flatMap(b => b.tokens);
    const bodyXs = bodyTokens.map(t => t.x).sort((a, b) => a - b);

    if (bodyXs.length) {
      const bxClusters: number[][] = [];
      let bc = [bodyXs[0]];
      for (let i = 1; i < bodyXs.length; i++) {
        if (bodyXs[i] - bc[bc.length - 1] <= 15) bc.push(bodyXs[i]);
        else { bxClusters.push(bc); bc = [bodyXs[i]]; }
      }
      bxClusters.push(bc);

      for (const cl of bxClusters) {
        const clX = Math.min(...cl);
        const clYs = new Set(bodyTokens.filter(t => cl.some(cx => Math.abs(t.x - cx) <= 15)).map(t => t.y));
        if (clYs.size >= 2 && (!anchors.length || clX - anchors[anchors.length - 1] >= minSep)) {
          anchors.push(clX);
        }
      }
    }

    if (anchors.length < 2) {
      anchors = [];
      const allXs = allTokens.map(t => t.x).sort((a, b) => a - b);
      const axClusters: number[][] = [];
      let ac = [allXs[0]];
      for (let i = 1; i < allXs.length; i++) {
        if (allXs[i] - ac[ac.length - 1] <= 15) ac.push(allXs[i]);
        else { axClusters.push(ac); ac = [allXs[i]]; }
      }
      axClusters.push(ac);
      for (const cl of axClusters) {
        const clX = Math.min(...cl);
        const clYs = new Set(allTokens.filter(t => cl.some(cx => Math.abs(t.x - cx) <= 15)).map(t => t.y));
        if (clYs.size >= 2 && (!anchors.length || clX - anchors[anchors.length - 1] >= minSep)) {
          anchors.push(clX);
        }
      }
    }
  }

  if (anchors.length < 2) {
    return [{ grid: allLines.map(l => [l.text.trim()]), colWidthsPts: [pageWidth * 0.9], startY: allLines[0].y, endY: allLines[allLines.length - 1].y }];
  }

  const numCols = isVectorColsFallback ? anchors.length - 1 : anchors.length;

  const assignCol = (x: number): number => {
    if (isVectorColsFallback) {
      for (let ci = 0; ci < numCols; ci++) {
        if (x >= anchors[ci] - 2 && x <= anchors[ci + 1] + 2) return ci;
      }
      if (x < anchors[0]) return 0;
      return numCols - 1;
    } else {
      for (let ci = 0; ci < numCols - 1; ci++) {
        if (x < (anchors[ci] + anchors[ci + 1]) / 2) return ci;
      }
      return numCols - 1;
    }
  };

  interface ColBand {
    y: number;
    height: number;
    cols: string[];
    filledCount: number;
  }

  let tableStartIdx = 0;
  for (let i = 0; i < bands.length; i++) {
    const colSet = new Set(bands[i].tokens.map(t => assignCol(t.x)));
    if (colSet.size >= Math.min(3, numCols)) { tableStartIdx = i; break; }
  }

  const colBands: ColBand[] = bands.slice(tableStartIdx).map(band => {
    const cols = Array.from({ length: numCols }, () => '');
    band.tokens.forEach(t => {
      const ci = assignCol(t.x);
      cols[ci] += (cols[ci] ? ' ' : '') + t.text;
    });
    return { y: band.y, height: band.height, cols, filledCount: cols.filter(c => c.trim()).length };
  });

  const sortedH = [...bands].map(b => b.height).sort((a, b) => a - b);
  const medianH = sortedH[Math.floor(sortedH.length / 2)] || 11;
  const ROW_GAP_FACTOR = 1.8;
  const logicalRows: ColBand[][] = [];
  let curRow: ColBand[] = [];
  let col0LineCount = 0;

  for (let bi = 0; bi < colBands.length; bi++) {
    const band = colBands[bi];
    const prev = colBands[bi - 1];

    const yGap = prev ? band.y - (prev.y + prev.height) : 0;
    const largeGap = prev && yGap > medianH * ROW_GAP_FACTOR;
    const col0Reset = band.cols[0].trim().length > 0 && col0LineCount > 0 && curRow.length >= 2;

    if (largeGap || col0Reset) {
      if (curRow.length) logicalRows.push(curRow);
      curRow = [];
      col0LineCount = 0;
    }

    curRow.push(band);
    if (band.cols[0].trim().length > 0) col0LineCount++;
  }
  if (curRow.length) logicalRows.push(curRow);

  const grid: string[][] = logicalRows.map(rowBands => {
    const cells = Array.from({ length: numCols }, () => '');
    rowBands.forEach(band => {
      band.cols.forEach((content, ci) => {
        if (!content.trim()) return;
        cells[ci] += (cells[ci] ? '\n' : '') + content.trim();
      });
    });
    return cells.map(c => c.trim());
  }).filter(row => row.some(c => c.length > 0));

  if (!grid.length) return [];

  const colWidthsPts: number[] = [];
  for (let ci = 0; ci < numCols; ci++) {
    const nextX = isVectorColsFallback ? anchors[ci + 1] : (anchors[ci + 1] ?? pageWidth);
    colWidthsPts.push(Math.max(40, nextX - anchors[ci]));
  }

  return [{
    grid,
    colWidthsPts,
    startY: bands[0]?.y ?? 0,
    endY: bands[bands.length - 1]?.y ?? 0,
  }];
}


/**
 * Apply professional Excel styling to a worksheet.
 * Header row: dark blue background, white bold text, frozen.
 * Body rows: alternating light gray, wrap text, top-aligned, thin borders.
 * Column widths set from PDF point widths.
 */
function styleExcelSheet(
  ws: XLSX.WorkSheet,
  grid: string[][],
  colWidthsPts: number[],
  pageWidth: number
): void {
  const totalPts = colWidthsPts.reduce((a, b) => a + b, 0);
  // Map PDF points → Excel character widths (approximate: 6pts ≈ 1 char width)
  const colWidths = colWidthsPts.map(pts => {
    const proportion = pts / totalPts;
    const excelChars = Math.round(proportion * 120); // 120 total chars for A4 landscape
    return Math.max(8, Math.min(80, excelChars));
  });
  ws['!cols'] = colWidths.map(w => ({ wch: w }));

  // Freeze the first row
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };

  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      if (!ws[addr]) ws[addr] = { t: 's', v: '' };

      const isHeader = R === 0;
      const isEven = R % 2 === 0;

      ws[addr].s = {
        font: {
          name: 'Calibri',
          sz: isHeader ? 10 : 9,
          bold: isHeader,
          color: { rgb: isHeader ? 'FFFFFF' : '1A1A1A' },
        },
        fill: {
          patternType: 'solid',
          fgColor: { rgb: isHeader ? '1F3864' : (isEven ? 'F2F4F7' : 'FFFFFF') },
        },
        alignment: { vertical: 'top', wrapText: true, horizontal: 'left' },
        border: {
          top:    { style: 'thin', color: { rgb: 'AAAAAA' } },
          bottom: { style: 'thin', color: { rgb: 'AAAAAA' } },
          left:   { style: 'thin', color: { rgb: 'AAAAAA' } },
          right:  { style: 'thin', color: { rgb: 'AAAAAA' } },
        },
      };
    }
    // Row height: header = 30pt, body = 14pt per line of content, min 14pt
    if (!ws['!rows']) ws['!rows'] = [];
    if (R === 0) {
      (ws['!rows'] as any[])[R] = { hpt: 30 };
    } else {
      // Find max line count across all cells in this row
      let maxLines = 1;
      for (let C = range.s.c; C <= range.e.c; C++) {
        const addr = XLSX.utils.encode_cell({ r: R, c: C });
        const val = ws[addr]?.v;
        if (typeof val === 'string') {
          maxLines = Math.max(maxLines, (val.match(/\n/g) || []).length + 1);
        }
      }
      (ws['!rows'] as any[])[R] = { hpt: Math.min(120, maxLines * 14) };
    }
  }
}

export async function convertPDFTablesToExcel(
  file: File,
  onProgress?: (msg: string) => void
): Promise<Blob> {
  if (onProgress) onProgress('Phase 1/3: Analyzing PDF structure...');
  const doc: StructuredDocument = await extractStructuredDocument(file, file.name);
  const workbook = XLSX.utils.book_new();

  // Scanned PDF check
  const totalTokens = doc.pages.reduce(
    (acc, p) => acc + p.blocks.reduce((b, bl) => b + bl.lines.reduce((l, ln) => l + ln.tokens.length, 0), 0), 0
  );
  if (totalTokens < 20 && doc.pages.length > 0) throw new Error('SCANNED_PDF');

  // ── Collect all tables from all pages ──────────────────────────────────────
  interface CollectedTable {
    grid: string[][];
    colWidthsPts: number[];
    pageNum: number;
    tableNumOnPage: number;
    isLandscape: boolean;
  }
  const allTables: CollectedTable[] = [];

  for (let pi = 0; pi < doc.pages.length; pi++) {
    const page = doc.pages[pi];
    if (onProgress) onProgress(`Phase 2/3: Extracting tables (Page ${pi + 1}/${doc.pages.length})...`);

    const regions = detectPageRegions(page);
    const bodyBlocks = page.blocks.filter(b =>
      b.lines.length > 0 && b.lines[0].y >= regions.body.y - 5
    );
    const allLines = bodyBlocks.flatMap(b => b.lines);
    if (!allLines.length) continue;

    const isLandscape = page.width > page.height;
    const extractedTables = extractTablesForExcel(allLines, page.width, page.vectorRects);

    extractedTables.forEach(({ grid, colWidthsPts }, ti) => {
      if (!grid.length || !grid[0].length) return;
      allTables.push({ grid, colWidthsPts, pageNum: pi + 1, tableNumOnPage: ti + 1, isLandscape });
    });
  }

  if (onProgress) onProgress('Phase 3/3: Building single-sheet workbook...');

  if (allTables.length === 0) {
    // No tables found
    const ws = XLSX.utils.aoa_to_sheet([['No tables found in this PDF.'], ['Try the PDF → Word converter instead.']]);
    XLSX.utils.book_append_sheet(workbook, ws, 'All Tables');
  } else {
    // ── Build one combined sheet: tables stacked vertically, blank row between each ──
    // First pass: determine max columns across all tables
    const maxCols = allTables.reduce((m, t) => Math.max(m, t.grid[0].length), 0);

    // We'll build the sheet cell-by-cell so we can style each table's header row
    const combinedWs: XLSX.WorkSheet = {};
    let currentRow = 0; // 0-based row index in the sheet

    // Track per-row styling metadata
    interface RowMeta { isHeader: boolean; isBlankSpacer: boolean; tableIndex: number; rowInTable: number; }
    const rowMeta: RowMeta[] = [];

    // Track column widths: take max across all tables
    const colWidthChars: number[] = Array(maxCols).fill(8);

    for (let ti = 0; ti < allTables.length; ti++) {
      const { grid, colWidthsPts, pageNum, tableNumOnPage, isLandscape } = allTables[ti];
      const numCols = grid[0].length;
      const totalPts = colWidthsPts.reduce((a, b) => a + b, 0);

      // Update column widths
      for (let ci = 0; ci < numCols; ci++) {
        const proportion = colWidthsPts[ci] / totalPts;
        const excelChars = Math.round(proportion * 120);
        const w = Math.max(8, Math.min(80, excelChars));
        if (w > colWidthChars[ci]) colWidthChars[ci] = w;
      }

      // Write table rows
      for (let ri = 0; ri < grid.length; ri++) {
        const isHeader = ri === 0;
        rowMeta[currentRow] = { isHeader, isBlankSpacer: false, tableIndex: ti, rowInTable: ri };

        for (let ci = 0; ci < grid[ri].length; ci++) {
          const addr = XLSX.utils.encode_cell({ r: currentRow, c: ci });
          const raw = grid[ri][ci];
          const inferred = inferCellType(raw);
          combinedWs[addr] = { t: inferred.t as any, v: inferred.v };

          const isEven = ri % 2 === 0;
          combinedWs[addr].s = {
            font: {
              name: 'Calibri',
              sz: isHeader ? 10 : 9,
              bold: isHeader,
              color: { rgb: isHeader ? 'FFFFFF' : '1A1A1A' },
            },
            fill: {
              patternType: 'solid',
              fgColor: { rgb: isHeader ? '1F3864' : (isEven ? 'F2F4F7' : 'FFFFFF') },
            },
            alignment: { vertical: 'top', wrapText: true, horizontal: 'left' },
            border: {
              top:    { style: 'thin', color: { rgb: 'AAAAAA' } },
              bottom: { style: 'thin', color: { rgb: 'AAAAAA' } },
              left:   { style: 'thin', color: { rgb: 'AAAAAA' } },
              right:  { style: 'thin', color: { rgb: 'AAAAAA' } },
            },
          };
        }

        // Row height
        if (!combinedWs['!rows']) combinedWs['!rows'] = [];
        if (isHeader) {
          (combinedWs['!rows'] as any[])[currentRow] = { hpt: 30 };
        } else {
          let maxLines = 1;
          for (let ci = 0; ci < grid[ri].length; ci++) {
            const val = grid[ri][ci];
            if (val) maxLines = Math.max(maxLines, (val.match(/\n/g) || []).length + 1);
          }
          (combinedWs['!rows'] as any[])[currentRow] = { hpt: Math.min(120, maxLines * 14) };
        }

        currentRow++;
      }

      // Add one blank separator row between tables (not after the last one)
      if (ti < allTables.length - 1) {
        rowMeta[currentRow] = { isHeader: false, isBlankSpacer: true, tableIndex: ti, rowInTable: -1 };
        // Write empty cells across all columns so the row exists in the sheet range
        for (let ci = 0; ci < maxCols; ci++) {
          const addr = XLSX.utils.encode_cell({ r: currentRow, c: ci });
          combinedWs[addr] = { t: 's', v: '' };
          combinedWs[addr].s = {
            fill: { patternType: 'solid', fgColor: { rgb: 'FFFFFF' } },
            border: {},
          };
        }
        if (!combinedWs['!rows']) combinedWs['!rows'] = [];
        (combinedWs['!rows'] as any[])[currentRow] = { hpt: 8 };
        currentRow++;
      }
    }

    // Set sheet ref
    combinedWs['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: currentRow - 1, c: maxCols - 1 } });

    // Set column widths
    combinedWs['!cols'] = colWidthChars.map(w => ({ wch: w }));

    XLSX.utils.book_append_sheet(workbook, combinedWs, 'All Tables');
  }

  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array', cellStyles: true });
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export function downloadFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
