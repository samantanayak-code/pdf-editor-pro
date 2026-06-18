import { getDocument } from 'pdfjs-dist';
import { getPdfBytes, debugBuffer } from './buffers';

// ─── Font Resolution Engine ──────────────────────────────────────────────────
//
// PDF fonts have internal names like "BCDEEE+TimesNewRomanPSMT" or "Arial-BoldMT".
// We must map these to Word-compatible font names that Microsoft Word can render.
//
// Strategy (in priority order):
//   1. Strip the subset prefix (6 uppercase letters + "+") to get the base name
//   2. Normalise separators (hyphens/commas/spaces → canonical form)
//   3. Match against a comprehensive lookup table of known PDF→Word font names
//   4. If no exact match, parse the base name to extract family + style traits
//   5. Fall back to the css fontFamily category (serif/sans/mono) → safe system font

/**
 * Comprehensive PDF font name → Word font name mapping.
 * Covers all fonts commonly found in Indian government, railway, and infrastructure PDFs.
 */
const FONT_NAME_MAP: Record<string, string> = {
  // ── Times New Roman family ─────────────────────────────────────────────────
  'timesnewroman':          'Times New Roman',
  'timesnewromanps':        'Times New Roman',
  'timesnewromanpsmt':      'Times New Roman',
  'timesnewroman-bold':     'Times New Roman',
  'timesnewroman-boldmt':   'Times New Roman',
  'timesnewroman-italic':   'Times New Roman',
  'timesnewroman-italicmt': 'Times New Roman',
  'timesnewroman-bolditalic':'Times New Roman',
  'times-roman':            'Times New Roman',
  'times-bold':             'Times New Roman',
  'times-italic':           'Times New Roman',
  'times-bolditalic':       'Times New Roman',
  'timesmt':                'Times New Roman',
  // ── Arial family ───────────────────────────────────────────────────────────
  'arial':                  'Arial',
  'arialmt':                'Arial',
  'arial-bold':             'Arial',
  'arial-boldmt':           'Arial',
  'arial-italic':           'Arial',
  'arial-italicmt':         'Arial',
  'arial-bolditalic':       'Arial',
  'arial-bolditalicmt':     'Arial',
  'arialnarrow':            'Arial Narrow',
  'arialnarrow-bold':       'Arial Narrow',
  'arialnmt':               'Arial Narrow',
  // ── Helvetica family ───────────────────────────────────────────────────────
  'helvetica':              'Arial',
  'helvetica-bold':         'Arial',
  'helvetica-oblique':      'Arial',
  'helvetica-boldoblique':  'Arial',
  'helveticaneue':          'Arial',
  'helveticaneue-bold':     'Arial',
  'helveticaneue-light':    'Arial',
  'helveticaneue-medium':   'Arial',
  // ── Calibri family ─────────────────────────────────────────────────────────
  'calibri':                'Calibri',
  'calibri-bold':           'Calibri',
  'calibri-italic':         'Calibri',
  'calibri-bolditalic':     'Calibri',
  'calibri-light':          'Calibri Light',
  // ── Cambria family ─────────────────────────────────────────────────────────
  'cambria':                'Cambria',
  'cambria-bold':           'Cambria',
  'cambria-italic':         'Cambria',
  'cambria-bolditalic':     'Cambria',
  'cambriamath':            'Cambria Math',
  // ── Garamond family ────────────────────────────────────────────────────────
  'garamond':               'Garamond',
  'garamond-bold':          'Garamond',
  'garamond-italic':        'Garamond',
  'ebgaramond':             'Garamond',
  // ── Georgia family ─────────────────────────────────────────────────────────
  'georgia':                'Georgia',
  'georgia-bold':           'Georgia',
  'georgia-italic':         'Georgia',
  'georgia-bolditalic':     'Georgia',
  // ── Verdana family ─────────────────────────────────────────────────────────
  'verdana':                'Verdana',
  'verdana-bold':           'Verdana',
  'verdana-italic':         'Verdana',
  'verdana-bolditalic':     'Verdana',
  // ── Tahoma family ──────────────────────────────────────────────────────────
  'tahoma':                 'Tahoma',
  'tahoma-bold':            'Tahoma',
  // ── Trebuchet family ───────────────────────────────────────────────────────
  'trebuchetms':            'Trebuchet MS',
  'trebuchetms-bold':       'Trebuchet MS',
  'trebuchetms-italic':     'Trebuchet MS',
  'trebuchetms-bolditalic': 'Trebuchet MS',
  // ── Courier family ─────────────────────────────────────────────────────────
  'couriernew':             'Courier New',
  'couriernewps':           'Courier New',
  'couriernewpsmt':         'Courier New',
  'couriernew-bold':        'Courier New',
  'couriernew-boldmt':      'Courier New',
  'couriernew-italic':      'Courier New',
  'couriernew-bolditalic':  'Courier New',
  'courier':                'Courier New',
  'courier-bold':           'Courier New',
  'courier-oblique':        'Courier New',
  'courier-boldoblique':    'Courier New',
  // ── Symbol / Wingdings ─────────────────────────────────────────────────────
  'symbol':                 'Symbol',
  'wingdings':              'Wingdings',
  'wingdings2':             'Wingdings 2',
  'wingdings3':             'Wingdings 3',
  // ── Palatino family ────────────────────────────────────────────────────────
  'palatino':               'Palatino Linotype',
  'palatinolinotype':       'Palatino Linotype',
  'palatinolinotype-bold':  'Palatino Linotype',
  'bookantiqua':            'Book Antiqua',
  // ── Book Antiqua / Palatino ────────────────────────────────────────────────
  'palatino-roman':         'Palatino Linotype',
  'palatino-bold':          'Palatino Linotype',
  'palatino-italic':        'Palatino Linotype',
  // ── Century family ─────────────────────────────────────────────────────────
  'centuryschoolbook':      'Century Schoolbook',
  'century':                'Century',
  'centurygothic':          'Century Gothic',
  'centurygothic-bold':     'Century Gothic',
  'centurygothic-italic':   'Century Gothic',
  // ── Franklin Gothic family ─────────────────────────────────────────────────
  'franklingothicmedium':   'Franklin Gothic Medium',
  'franklingothic-medium':  'Franklin Gothic Medium',
  // ── Gill Sans family ───────────────────────────────────────────────────────
  'gillsans':               'Gill Sans MT',
  'gillsans-bold':          'Gill Sans MT',
  'gillsansmt':             'Gill Sans MT',
  // ── Myriad family ──────────────────────────────────────────────────────────
  'myriadpro':              'Arial',  // Myriad Pro not in Windows; Arial is closest
  'myriadpro-bold':         'Arial',
  'myriadpro-it':           'Arial',
  'myriadpro-boldit':       'Arial',
  // ── Minion family ──────────────────────────────────────────────────────────
  'minionpro':              'Times New Roman',
  'minionpro-bold':         'Times New Roman',
  'minionpro-it':           'Times New Roman',
  // ── Frutiger / Univers ─────────────────────────────────────────────────────
  'frutiger':               'Arial',
  'univers':                'Arial',
  // ── Open Sans ──────────────────────────────────────────────────────────────
  'opensans':               'Arial',
  'opensans-bold':          'Arial',
  'opensans-semibold':      'Arial',
  'opensans-light':         'Arial',
  // ── Roboto ─────────────────────────────────────────────────────────────────
  'roboto':                 'Arial',
  'roboto-bold':            'Arial',
  'roboto-medium':          'Arial',
  'roboto-light':           'Arial',
  // ── Lato ───────────────────────────────────────────────────────────────────
  'lato':                   'Arial',
  'lato-bold':              'Arial',
  'lato-light':             'Arial',
  // ── Noto Sans / Noto Serif ────────────────────────────────────────────────
  'notosans':               'Arial',
  'notosans-bold':          'Arial',
  'notosans-regular':       'Arial',
  'notoserif':              'Times New Roman',
  'notoserif-bold':         'Times New Roman',
  // ── Source Sans / Source Serif ────────────────────────────────────────────
  'sourcesanspro':          'Arial',
  'sourcesanspro-bold':     'Arial',
  'sourceserifpro':         'Times New Roman',
  // ── Segoe UI ───────────────────────────────────────────────────────────────
  'segoeui':                'Segoe UI',
  'segoeui-bold':           'Segoe UI',
  'segoeui-italic':         'Segoe UI',
  'segoeuisemibold':        'Segoe UI Semibold',
  // ── Consolas / Monaco ──────────────────────────────────────────────────────
  'consolas':               'Consolas',
  'monaco':                 'Courier New',
  'lucidaconsole':          'Lucida Console',
  'lucidatypewriter':       'Lucida Console',
  // ── DejaVu / Liberation ───────────────────────────────────────────────────
  'dejavusans':             'Arial',
  'dejavuserif':            'Times New Roman',
  'dejavusansmono':         'Courier New',
  'liberationsans':         'Arial',
  'liberationserif':        'Times New Roman',
  'liberationmono':         'Courier New',
};

/**
 * Normalise a raw PDF font name to a lookup key.
 * Examples:
 *   "BCDEEE+TimesNewRomanPS-BoldMT" → "timesnewromanps-boldmt"
 *   "ArialMT"                        → "arialmt"
 *   "Helvetica-Bold"                 → "helvetica-bold"
 */
function normaliseFontName(raw: string): string {
  // 1. Strip subset prefix: 6 uppercase letters followed by "+"
  const stripped = raw.replace(/^[A-Z]{6}\+/, '');
  // 2. Lowercase, remove all spaces and commas
  return stripped.toLowerCase().replace(/[\s,]+/g, '');
}

/**
 * Extract style traits (bold, italic) from raw PDF font name.
 * Works for fonts where the CSS fontFamily is generic (e.g. "sans-serif")
 * but the fontName contains "-Bold", "-Italic", etc.
 */
function extractStyleFromFontName(raw: string): { bold: boolean; italic: boolean } {
  const lower = raw.toLowerCase();
  const bold = /bold|black|heavy|demi|semibold|medium(?!italic)|extrabold|ultrabold/.test(lower);
  const italic = /italic|oblique|slant/.test(lower);
  return { bold, italic };
}

/**
 * Resolve a PDF font name to the best available Microsoft Word font name.
 * Also returns corrected bold/italic flags based on the full font name.
 */
export function resolvePdfFont(rawFontName: string, cssFontFamily: string): {
  wordFont: string;
  bold: boolean;
  italic: boolean;
} {
  const key = normaliseFontName(rawFontName);

  // 1. Direct lookup in our map
  if (FONT_NAME_MAP[key]) {
    const style = extractStyleFromFontName(rawFontName);
    return { wordFont: FONT_NAME_MAP[key], ...style };
  }

  // 2. Prefix match — try progressively shorter keys by stripping style suffixes
  //    e.g. "timesnewroman-bolditalicmt" → try "timesnewroman-bolditalic" → "timesnewroman"
  const suffixesToStrip = [
    '-bolditalicmt', '-boldobliquemt', '-bolditalic', '-boldoblique',
    '-boldmt', '-bold', '-italicmt', '-italic', '-obliqueamt', '-oblique',
    '-regularmt', '-regular', '-roman', 'mt', 'ps', 'psmt',
  ];
  let candidate = key;
  for (const suffix of suffixesToStrip) {
    if (candidate.endsWith(suffix)) {
      candidate = candidate.slice(0, -suffix.length);
      if (FONT_NAME_MAP[candidate]) {
        const style = extractStyleFromFontName(rawFontName);
        return { wordFont: FONT_NAME_MAP[candidate], ...style };
      }
    }
  }

  // 3. Substring match — if any map key is contained in our normalised name
  //    e.g. "myriadproregularsemiextended" contains "myriadpro"
  for (const [mapKey, mapVal] of Object.entries(FONT_NAME_MAP)) {
    if (key.includes(mapKey) && mapKey.length > 4) {
      const style = extractStyleFromFontName(rawFontName);
      return { wordFont: mapVal, ...style };
    }
  }

  // 4. Fall back to CSS font family category
  const lowerCss = cssFontFamily.toLowerCase();
  const style = extractStyleFromFontName(rawFontName);
  if (lowerCss.includes('mono') || lowerCss.includes('courier')) {
    return { wordFont: 'Courier New', ...style };
  }
  if (lowerCss.includes('serif')) {
    return { wordFont: 'Times New Roman', ...style };
  }
  // Default: Arial (safe cross-platform sans-serif)
  return { wordFont: 'Arial', ...style };
}

export interface TextToken {
  text: string;
  x: number;
  y: number;
  baselineY: number;
  pdfY: number;
  width: number;
  height: number;
  fontSize: number;
  fontName: string;
  fontFamily: string;
  fontFamilyCategory: 'serif' | 'sans' | 'mono';
  bold?: boolean;
  italic?: boolean;
  scaleX?: number;
  /** Resolved Word-compatible font name (e.g. "Times New Roman", "Arial") */
  wordFont: string;
}

export interface TextLine {
  tokens: TextToken[];
  text: string;
  x: number;
  y: number;
  baselineY: number;
  pdfY: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: string;
  fontFamilyCategory: 'serif' | 'sans' | 'mono';
  bold?: boolean;
  italic?: boolean;
  /** Dominant Word-compatible font name for this line (majority vote of tokens) */
  wordFont: string;
}

export interface TextBlock {
  type: 'paragraph' | 'heading' | 'list' | 'table-row';
  lines: TextLine[];
  text: string;
  pageNumber: number;
}

export interface StructuredPage {
  pageNumber: number;
  width: number;
  height: number;
  blocks: TextBlock[];
  header?: TextBlock;
  footer?: TextBlock;
  vectorRects?: Array<{ x: number; y: number; width: number; height: number }>;
}

export interface StructuredDocument {
  filename: string;
  pages: StructuredPage[];
}

const BULLET_RE = /^[\u2022\u2023\u25E6\u2043\u2219•◦▪▸\-\*]\s+/;
const NUMBERED_RE = /^(\d+[\.\)]\s+|[a-z][\.\)]\s+)/i;
const CLAUSE_RE = /^(\d+(\.\d+)*[\.\)]|\([a-z]\)|\([ivx]+\)|[a-z]\.)\s+/i;

function isListStart(text: string): boolean {
  const trimmed = text.trim();
  return BULLET_RE.test(trimmed) || NUMBERED_RE.test(trimmed) || CLAUSE_RE.test(trimmed);
}

/**
 * Extracts a structured document model from a PDF source.
 * Implements heuristics for word/line/block reconstruction.
 */
export async function extractStructuredDocument(
  source: File | Blob | ArrayBuffer | Uint8Array,
  filename: string,
  onProgress?: (msg: string) => void
): Promise<StructuredDocument> {
  const bytes = await getPdfBytes(source);
  debugBuffer("text-extract-load", bytes);
  
  let pdf;
  try {
    if (onProgress) onProgress('Loading PDF engine...');
    pdf = await getDocument({ data: bytes }).promise;
  } catch (error: any) {
    console.error('PDF Load Error:', error);
    if (error.name === 'PasswordException' || error.message?.includes('password')) {
      throw new Error('ENCRYPTED');
    }
    if (error.name === 'InvalidPDFException' || error.message?.includes('Invalid PDF')) {
      throw new Error('CORRUPTED');
    }
    throw new Error('UNSUPPORTED_FORMAT');
  }

  const totalPages = pdf.numPages;
  const structuredPages: StructuredPage[] = [];

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    try {
      if (onProgress) onProgress(`Extracting text layer (Page ${pageNum}/${totalPages})...`);
      
      // Artificial yield to keep UI responsive
      await new Promise(resolve => setTimeout(resolve, 5));

      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.0 });
      const textContent = await page.getTextContent();

      // Extract vector graphics/lines/rects for robust table boundaries
      const opList = await page.getOperatorList();
      const vectorRects: Array<{ x: number; y: number; width: number; height: number }> = [];

      // Safe fallback/reference for low-level PDF.js drawing operators
      const OPS = {
        save: 2,
        restore: 3,
        transform: 21,
        moveTo: 13,
        lineTo: 14,
        curveTo: 15,
        closePath: 18,
        rectangle: 19,
        constructPath: 91,
      };

      let ctm = [1, 0, 0, 1, 0, 0];
      const ctmStack: number[][] = [];

      const multiplyMatrix = (m1: number[], m2: number[]): number[] => {
        return [
          m1[0] * m2[0] + m1[2] * m2[1],
          m1[1] * m2[0] + m1[3] * m2[1],
          m1[0] * m2[2] + m1[2] * m2[3],
          m1[1] * m2[2] + m1[3] * m2[3],
          m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
          m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
        ];
      };

      const transformPoint = (x: number, y: number, matrix: number[]) => {
        return {
          x: matrix[0] * x + matrix[2] * y + matrix[4],
          y: matrix[1] * x + matrix[3] * y + matrix[5],
        };
      };

      for (let i = 0; i < opList.fnArray.length; i++) {
        const fn = opList.fnArray[i];
        const args = opList.argsArray[i];

        if (fn === OPS.save) {
          ctmStack.push([...ctm]);
        } else if (fn === OPS.restore) {
          const popped = ctmStack.pop();
          if (popped) ctm = popped;
        } else if (fn === OPS.transform) {
          ctm = multiplyMatrix(ctm, args);
        } else if (fn === OPS.rectangle) {
          const x = args[0];
          const y = args[1];
          const w = args[2];
          const h = args[3];
          
          const p1 = transformPoint(x, y, ctm);
          const p2 = transformPoint(x + w, y + h, ctm);

          const pageY1 = viewport.height - p1.y;
          const pageY2 = viewport.height - p2.y;

          vectorRects.push({
            x: Math.min(p1.x, p2.x),
            y: Math.min(pageY1, pageY2),
            width: Math.abs(p2.x - p1.x),
            height: Math.abs(pageY2 - pageY1),
          });
        } else if (fn === OPS.constructPath) {
          if (!Array.isArray(args) || args.length < 2) continue;
          const [subOps, subCoords] = args;
          if (!subOps || !subCoords) continue;

          let opsArray: any;
          if (typeof subOps[Symbol.iterator] === 'function') {
            opsArray = subOps;
          } else if (typeof subOps === 'number') {
            opsArray = [subOps];
          } else {
            continue;
          }

          let coordIdx = 0;
          let lastX = 0;
          let lastY = 0;

          for (const subOp of opsArray) {
            if (subOp === OPS.moveTo) {
              if (coordIdx + 1 >= subCoords.length) break;
              const x = subCoords[coordIdx++];
              const y = subCoords[coordIdx++];
              lastX = x;
              lastY = y;
            } else if (subOp === OPS.lineTo) {
              if (coordIdx + 1 >= subCoords.length) break;
              const x = subCoords[coordIdx++];
              const y = subCoords[coordIdx++];

              const p1 = transformPoint(lastX, lastY, ctm);
              const p2 = transformPoint(x, y, ctm);

              const pageY1 = viewport.height - p1.y;
              const pageY2 = viewport.height - p2.y;

              const minX = Math.min(p1.x, p2.x);
              const minY = Math.min(pageY1, pageY2);
              const width = Math.abs(p2.x - p1.x);
              const height = Math.abs(pageY2 - pageY1);

              vectorRects.push({
                x: minX,
                y: minY,
                width: width === 0 ? 1 : width,
                height: height === 0 ? 1 : height,
              });

              lastX = x;
              lastY = y;
            } else if (subOp === OPS.rectangle) {
              if (coordIdx + 3 >= subCoords.length) break;
              const x = subCoords[coordIdx++];
              const y = subCoords[coordIdx++];
              const w = subCoords[coordIdx++];
              const h = subCoords[coordIdx++];

              const p1 = transformPoint(x, y, ctm);
              const p2 = transformPoint(x + w, y + h, ctm);

              const pageY1 = viewport.height - p1.y;
              const pageY2 = viewport.height - p2.y;

              vectorRects.push({
                x: Math.min(p1.x, p2.x),
                y: Math.min(pageY1, pageY2),
                width: Math.abs(p2.x - p1.x),
                height: Math.abs(pageY2 - pageY1),
              });
            } else if (subOp === OPS.curveTo) {
              coordIdx += 6;
            } else if (subOp === OPS.closePath) {
              // noop
            }
          }
        }
      }
      
      // 1. Convert pdf.js items to raw tokens with better metrics
      // ... (rest of token logic remains same)
    const rawTokens: TextToken[] = textContent.items.flatMap((item: any) => {
      const str = item.str;
      if (!str || str.trim().length === 0) return [];

      const transform = item.transform;
      // fontSize from the transform matrix scale components
      const scaleX = Math.abs(transform[0]);
      const scaleY = Math.abs(transform[3]);
      const fontSize = Math.max(scaleX, scaleY);

      // transform[5] is the raw PDF-space Y (bottom-up origin).
      // We keep it verbatim on every token so the export pipeline can use it
      // directly with pdf-lib without any coordinate re-inversion.
      const rawPdfY = transform[5];

      const baselineY = viewport.height - transform[5];
      const height = fontSize * 1.2;
      const y = baselineY - fontSize * 0.85; // ascender heuristic

      const style = (textContent.styles as any)[item.fontName];
      const fontFamily = style?.fontFamily || 'sans-serif';

      // ── Font resolution: use resolvePdfFont for authoritative name + style ──
      const resolved = resolvePdfFont(item.fontName || '', fontFamily);
      const isBold = resolved.bold;
      const isItalic = resolved.italic;
      const wordFont = resolved.wordFont;

      let category: 'serif' | 'sans' | 'mono' = 'sans';
      const lowerFont = wordFont.toLowerCase();
      if (lowerFont.includes('times') || lowerFont.includes('georgia') ||
          lowerFont.includes('garamond') || lowerFont.includes('palatino') ||
          lowerFont.includes('cambria') || lowerFont.includes('century') ||
          lowerFont.includes('book antiqua') || lowerFont.includes('serif')) {
        category = 'serif';
      } else if (lowerFont.includes('courier') || lowerFont.includes('consolas') ||
                 lowerFont.includes('mono') || lowerFont.includes('lucida console')) {
        category = 'mono';
      }

      // Use the actual pdf.js measured width directly
      const itemWidth = item.width;

      const parts = str.split(/(\s+)/);
      const totalChars = str.length || 1;
      let currentX = transform[4];

      return parts.map(part => {
        const partWidth = (part.length / totalChars) * itemWidth;
        const token: TextToken = {
          text: part,
          x: currentX,
          y,
          baselineY,
          pdfY: rawPdfY,
          width: partWidth,
          height,
          fontSize,
          fontName: item.fontName,
          fontFamily,
          fontFamilyCategory: category,
          bold: isBold,
          italic: isItalic,
          scaleX: scaleX / Math.max(fontSize, 1),
          wordFont,
        };
        currentX += partWidth;
        return token;
      }).filter(t => t.text.length > 0);
    });

    // 2. Group tokens into Lines
    // Sort primarily by Y (top to bottom), then by X (left to right)
    rawTokens.sort((a, b) => Math.abs(a.y - b.y) < 2 ? a.x - b.x : a.y - b.y);

    const lines: TextLine[] = [];
    let currentLineTokens: TextToken[] = [];
    
    for (const token of rawTokens) {
      if (currentLineTokens.length === 0) {
        currentLineTokens.push(token);
        continue;
      }

      const lastToken = currentLineTokens[currentLineTokens.length - 1];
      const yDiff = Math.abs(token.y - lastToken.y);
      
      // Heuristic: If Y is very close (within 25% of font size), it's the same line
      if (yDiff < token.fontSize * 0.25) {
        currentLineTokens.push(token);
      } else {
        lines.push(constructLine(currentLineTokens));
        currentLineTokens = [token];
      }
    }
    if (currentLineTokens.length > 0) lines.push(constructLine(currentLineTokens));

    // 3. Group lines into Blocks (Paragraphs)
    const blocks: TextBlock[] = [];
    let currentBlockLines: TextLine[] = [];

    // Keywords that always force a new block when they START a line
    const FORCED_BREAK_STARTS = /^(dear\s+sir|dear\s+madam|sincerely|yours\s+sincerely|yours\s+faithfully|regards|copy\s+to|encl|attachment|note:|subject:|sub:|reference:|ref:|kind\s+attention)/i;

    // A "short standalone line" is any line under 80 chars that is not a
    // clear sentence continuation (doesn't start lowercase mid-sentence).
    const isShortStandaloneLine = (l: TextLine) =>
      l.text.trim().length < 80 && !/^[a-z]/.test(l.text.trim());

    for (const line of lines) {
      if (currentBlockLines.length === 0) {
        currentBlockLines.push(line);
        continue;
      }

      const lastLine = currentBlockLines[currentBlockLines.length - 1];
      const vGap = Math.abs(line.y - (lastLine.y + lastLine.height));

      // ── Force a new block when ───────────────────────────────────────────
      // (A) This line starts with a salutation/closing keyword
      const startsWithKeyword = FORCED_BREAK_STARTS.test(line.text.trim());

      // (B) The current block started with a salutation keyword → it's done
      const lastLineIsKeyword = FORCED_BREAK_STARTS.test(currentBlockLines[0].text.trim());

      // (C) Significant X-position shift (> 3em) — different layout region
      const xShift = Math.abs(line.x - currentBlockLines[0].x);
      const allBlockLinesShort = currentBlockLines.every(l => l.text.trim().length < 80);
      const significantXShift = xShift > line.fontSize * 3 && !allBlockLinesShort;

      // (D) Address-block detection: consecutive short lines at same X with
      //     single-spaced gaps (ratio 0.5–0.85). These are individual address
      //     lines and MUST each be their own paragraph.
      //     Real measured gaps: 6-7pt gap, 11pt height → ratio ~0.6
      //     Body paragraph continuation gaps: ratio > 1.0
      const gapRatio = vGap / lastLine.height;
      const isAddressLine = allBlockLinesShort &&
        isShortStandaloneLine(lastLine) &&
        isShortStandaloneLine(line) &&
        gapRatio < 0.85 &&                      // single-spaced address gap
        gapRatio > 0.0 &&                       // not same line
        Math.abs(line.x - lastLine.x) < line.fontSize * 3; // same column

      // ── Merge condition ──────────────────────────────────────────────────
      const smallGap = vGap < lastLine.height * 1.5;

      const blockStartX = currentBlockLines[0].x;
      const isNewListItem = isListStart(line.text) &&
        (line.x <= blockStartX + line.fontSize * 0.5);

      const shouldSplit = !smallGap ||
        isNewListItem ||
        startsWithKeyword ||
        lastLineIsKeyword ||
        significantXShift ||
        isAddressLine;

      if (!shouldSplit) {
        currentBlockLines.push(line);
      } else {
        const block = constructBlock(currentBlockLines, pageNum);
        if (block.text.trim().length > 0) blocks.push(block);
        currentBlockLines = [line];
      }
    }
    if (currentBlockLines.length > 0) {
      const block = constructBlock(currentBlockLines, pageNum);
      if (block.text.trim().length > 0) {
        blocks.push(block);
      }
    }

    // 4. Header/Footer Detection (Basic position-based)
    const pageBlocks: TextBlock[] = [];
    let header: TextBlock | undefined;
    let footer: TextBlock | undefined;

    blocks.forEach(block => {
      const topBoundary = viewport.height * 0.1;
      const bottomBoundary = viewport.height * 0.9;
      
      if (block.lines[0].y < topBoundary && block.text.length < 100) {
        header = block;
      } else if (block.lines[0].y > bottomBoundary && block.text.length < 100) {
        footer = block;
      } else {
        pageBlocks.push(block);
      }
    });

    structuredPages.push({
      pageNumber: pageNum,
      width: viewport.width,
      height: viewport.height,
      blocks: pageBlocks,
      header,
      footer,
      vectorRects,
    });
    } catch (pageError) {
    console.warn(`Failed to extract page ${pageNum}:`, pageError);
    // Push an empty page to maintain page count / document structure
    structuredPages.push({
      pageNumber: pageNum,
      width: 595, // Default A4
      height: 842,
      blocks: [{ type: 'paragraph', text: `[Conversion Error on Page ${pageNum}]`, lines: [], pageNumber: pageNum }],
    });
    }
    }

  return { filename, pages: structuredPages };
}

function constructLine(tokens: TextToken[]): TextLine {
  // Sort tokens by X to be sure
  tokens.sort((a, b) => a.x - b.x);
  
  let text = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (i > 0) {
      const prev = tokens[i - 1];
      const gap = t.x - (prev.x + prev.width);
      // Add a space if there's a significant visual gap and neither token is already whitespace
      if (gap > t.fontSize * 0.08 && !/^\s/.test(t.text) && !/\s$/.test(text)) {
        text += ' ';
      }
    }
    text += t.text;
  }

  // Normalize spaces (e.g., replace multiple spaces with single space)
  text = text.replace(/\s+/g, ' ').trim();

  const minX = Math.min(...tokens.map(t => t.x));
  const minY = Math.min(...tokens.map(t => t.y));
  const maxX = Math.max(...tokens.map(t => t.x + t.width));
  const maxY = Math.max(...tokens.map(t => t.y + t.height));
  const avgBaselineY = tokens.reduce((acc, t) => acc + t.baselineY, 0) / tokens.length;
  const avgFontSize = tokens.reduce((acc, t) => acc + t.fontSize, 0) / tokens.length;
  // Use the median pdfY across tokens — robust against mixed-size tokens on the same line.
  const sortedPdfY = [...tokens.map(t => t.pdfY)].sort((a, b) => a - b);
  const midIdx = Math.floor(sortedPdfY.length / 2);
  const medianPdfY = sortedPdfY.length % 2 !== 0
    ? sortedPdfY[midIdx]
    : (sortedPdfY[midIdx - 1] + sortedPdfY[midIdx]) / 2;
  
  // Use the most frequent font family in the line
  const familyMap = new Map<string, number>();
  const categoryMap = new Map<'serif' | 'sans' | 'mono', number>();
  
  tokens.forEach(t => {
    familyMap.set(t.fontFamily, (familyMap.get(t.fontFamily) || 0) + 1);
    categoryMap.set(t.fontFamilyCategory, (categoryMap.get(t.fontFamilyCategory) || 0) + 1);
  });
  
  const dominantFamily = [...familyMap.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const dominantCategory = [...categoryMap.entries()].sort((a, b) => b[1] - a[1])[0][0];

  // Dominant wordFont: majority vote weighted by character count (longer tokens count more)
  const wordFontMap = new Map<string, number>();
  tokens.forEach(t => {
    const weight = t.text.trim().length || 1;
    wordFontMap.set(t.wordFont, (wordFontMap.get(t.wordFont) || 0) + weight);
  });
  const dominantWordFont = [...wordFontMap.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'Arial';

  return {
    tokens,
    text,
    x: minX,
    y: minY,
    baselineY: avgBaselineY,
    pdfY: medianPdfY,
    width: maxX - minX,
    height: maxY - minY,
    fontSize: avgFontSize,
    fontFamily: dominantFamily,
    fontFamilyCategory: dominantCategory,
    bold: tokens.filter(t => t.bold).length > tokens.length / 2,
    italic: tokens.filter(t => t.italic).length > tokens.length / 2,
    wordFont: dominantWordFont,
  };
}

export function constructBlock(lines: TextLine[], pageNumber: number): TextBlock {
  let text = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let lineText = line.text.trim();
    
    if (i === 0) {
      text = lineText;
    } else {
      const prevLine = lines[i - 1];
      const prevText = prevLine.text.trim();
      
      // If previous line ends with a hyphen and it looks like a word-break (no space before hyphen)
      if (prevText.endsWith('-') && !prevText.endsWith(' -')) {
        text = text.slice(0, -1) + lineText;
      } else {
        text += ' ' + lineText;
      }
    }
  }

  return {
    type: 'paragraph',
    lines,
    text,
    pageNumber,
  };
}

/**
 * Exports the structured document to high-quality plain text.
 */
export function exportToPlainText(doc: StructuredDocument): string {
  let output = '';
  doc.pages.forEach(page => {
    output += `\n--- Page ${page.pageNumber} ---\n\n`;
    page.blocks.forEach(block => {
      output += block.text + '\n\n';
    });
  });
  return output;
}
