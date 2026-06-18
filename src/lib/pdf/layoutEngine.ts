// src/lib/pdf/layoutEngine.ts

/**
 * Layout engine for a TextBox.
 *
 * Input: a TextBox (rect, paragraphs with spans) and a pdf-lib PDFFont.
 * Output: an array of line objects that describe the exact text, x offset,
 *         and baseline Y (relative to the page origin used by pdf-lib).
 *
 * The algorithm is intentionally simple for Phase 1:
 *   1️⃣ Flatten all spans of the paragraph(s) into a single string of words.
 *   2️⃣ Iterate words, measuring each with `font.widthOfTextAtSize`.
 *   3️⃣ Accumulate words until adding the next would exceed the box width.
 *   4️⃣ When the line is full, push a line record and start a new line.
 *   5️⃣ Compute the Y position for each line using the box top, the line
 *      height (`font.heightAtSize`) and the requested line‑spacing multiplier.
 *   6️⃣ Return an array of `{ text, x, baselineY, style }` objects that can be
 *      fed directly to `pdfPage.drawText` (or to a Canvas overlay).
 */

import { PDFFont } from 'pdf-lib';
import { TextBox, TextSpanStyle, Paragraph } from '../model';

export type LayoutLine = {
  /** Full line text */
  text: string;
  /** X offset from the left side of the TextBox */
  x: number;
  /** Baseline Y coordinate (PDF user‑space) */
  baselineY: number;
  /** Style applied to this line – for Phase 1 we keep a single style per line */
  style: TextSpanStyle;
};

/**
 * Layout a TextBox into lines that fit inside its width.
 *
 * @param box      The TextBox containing paragraphs.
 * @param measurer Either a Record of PDFFonts or a Canvas context for preview.
 * @returns        Array of LayoutLine objects.
 */
export function layoutTextBox(
  box: TextBox,
  measurer: Record<string, PDFFont> | CanvasRenderingContext2D
): LayoutLine[] {
  const lines: LayoutLine[] = [];

  const firstParagraph: Paragraph | undefined = box.paragraphs[0];
  const defaultStyle: TextSpanStyle = firstParagraph?.spans[0]?.style ?? {
    fontFamily: 'Helvetica',
    fontSize: 12,
    color: '#000000',
  };

  const fontSize = defaultStyle.fontSize;
  
  // Helper for width measurement
  const getWidth = (text: string, style: TextSpanStyle): number => {
    if (measurer instanceof CanvasRenderingContext2D) {
      const fontStr = `${style.bold ? 'bold ' : ''}${style.italic ? 'italic ' : ''}${style.fontSize}px ${style.fontFamily}`;
      measurer.font = fontStr;
      return measurer.measureText(text).width;
    } else {
      const font = measurer[style.fontFamily] || measurer['Helvetica'];
      return font ? font.widthOfTextAtSize(text, style.fontSize) : text.length * style.fontSize * 0.5;
    }
  };

  // Helper for height measurement
  const getHeight = (style: TextSpanStyle): number => {
    if (measurer instanceof CanvasRenderingContext2D) {
      return style.fontSize * 1.2;
    } else {
      const font = measurer[style.fontFamily] || measurer['Helvetica'];
      return font ? font.heightAtSize(style.fontSize) : style.fontSize * 1.2;
    }
  };

  const lineHeight = getHeight(defaultStyle);
  const lineSpacingMul =
    box.lineSpacing === 'single' ? 1.0 : box.lineSpacing === 'oneHalf' ? 1.5 : 2.0;

  // 1️⃣ Build a flat array of words (preserving spaces)
  const words: string[] = [];
  for (const para of box.paragraphs) {
    for (const span of para.spans) {
      // Split on spaces but keep them as separate tokens so spacing is accurate.
      const parts = span.text.split(/(\s+)/);
      for (const p of parts) {
        if (p.length === 0) continue;
        words.push(p);
      }
    }
    // Paragraph break – we treat it as a forced line break.
    words.push('\n');
  }

  // 2️⃣ Assemble lines respecting the box width.
  let currentLine = '';
  let currentWidth = 0;
  const maxWidth = box.rect.width;

  const flushLine = (lineText: string) => {
    if (lineText.length === 0) return;
    lines.push({
      text: lineText,
      x: box.rect.x,
      baselineY: 0, // placeholder – will be set after we know line index
      style: defaultStyle,
    });
  };

  for (const word of words) {
    if (word === '\n') {
      // Paragraph break – finish current line and start a new one.
      flushLine(currentLine.trimEnd());
      currentLine = '';
      currentWidth = 0;
      continue;
    }
    const wordWidth = getWidth(word, defaultStyle);
    // If adding this word exceeds the box width, emit the current line first.
    if (currentWidth + wordWidth > maxWidth && currentLine.length > 0) {
      flushLine(currentLine.trimEnd());
      currentLine = '';
      currentWidth = 0;
    }
    currentLine += word;
    currentWidth += wordWidth;
  }
  // Flush any remaining text.
  flushLine(currentLine.trimEnd());

  // 3️⃣ Compute baseline Y for each line, starting from the top of the box.
  const startY = box.rect.y + box.rect.height; // top edge of the box (PDF origin is bottom‑left)
  lines.forEach((ln, idx) => {
    const lineBaseline =
      startY - (idx + 0.8) * lineHeight * lineSpacingMul; // 0.8 ≈ typical ascent factor
    ln.baselineY = lineBaseline;
  });

  return lines;
}
