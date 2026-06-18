/*
 * src/lib/pdf/extractToModel.ts
 * --------------------------------------------------------------
 * Converts the output of `extractStructuredDocument` (pdf.js based) into
 * the structured `DocumentModel` defined in `model.ts`.
 *
 * This is the bridge that creates the initial editable representation
 * (Mode A – layout‑faithful edit).  It will be used when a PDF is first
 * uploaded, populating `pages[i].textBoxes`.
 * --------------------------------------------------------------
 */

import { extractStructuredDocument, StructuredDocument, StructuredPage, TextBlock, TextLine } from './textExtraction';
import { DocumentModel, PageModel, TextBox, Paragraph, TextSpan, TextSpanStyle, TextBoxAlignment, LineSpacing, generateId } from '../model';

/**
 * Helper – creates a default TextSpanStyle for a line's tokens.
 * pdf‑js gives us font family, size, and bold/italic flags.
 */
const styleFromLine = (line: TextLine): TextSpanStyle => {
  let baseFamily = 'serif';
  const name = (line.fontFamily || '').toLowerCase();
  
  if (name.includes('times') || name.includes('serif') || name.includes('cambria') || name.includes('georgia')) {
    baseFamily = '"Times New Roman", Times, serif';
  } else if (name.includes('arial') || name.includes('helvetica') || name.includes('sans') || name.includes('calibri')) {
    baseFamily = 'Arial, Helvetica, sans-serif';
  } else if (name.includes('courier') || name.includes('mono')) {
    baseFamily = '"Courier New", Courier, monospace';
  }

  return {
    fontFamily: baseFamily,
    fontSize: line.fontSize,
    color: '#000000',
    bold: line.bold,
    italic: line.italic,
    underline: false,
  };
};

/**
 * Convert a `TextBlock` (paragraph / heading / list) into a `TextBox`.
 * The block's bounding box is approximated from the first and last line.
 */
const blockToTextBox = (block: TextBlock, pageIndex: number): TextBox => {
  // Determine the outer rectangle from the lines.
  const xs = block.lines.map(l => l.x);
  const ys = block.lines.map(l => l.y);
  const widths = block.lines.map(l => l.width);
  const heights = block.lines.map(l => l.height);

  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs.map((x, i) => x + widths[i]));
  const maxY = Math.max(...ys.map((y, i) => y + heights[i]));

  const rect = {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };

  // Build paragraphs – each line becomes a paragraph with a single span.
  const paragraphs = block.lines.map((line, idx) => {
    const paragraph: Paragraph = {
      id: generateId(),
      spans: [],
    };
    const spanStyle = styleFromLine(line);
    // The line.text already contains the concatenated tokens.
    const span: TextSpan = {
      id: generateId(),
      text: line.text,
      style: spanStyle,
    };
    paragraph.spans.push(span);
    return paragraph;
  });

  const textBox: TextBox = {
    id: generateId(),
    pageIndex,
    rect,
    paragraphs,
    alignment: 'left', // default – UI can change later
    lineSpacing: 'single', // default
  };

  return textBox;
};

/**
 * Main entry – builds a `DocumentModel` from a PDF Blob / File.
 */
export const pdfToDocumentModel = async (source: File | Blob | ArrayBuffer | Uint8Array, filename: string): Promise<DocumentModel> => {
  // 1️⃣ Extract a structured representation using the existing helper.
  const structured: StructuredDocument = await extractStructuredDocument(source, filename);

  // 2️⃣ Initialise pages array – we need dimensions from the structured pages.
  const pages: PageModel[] = structured.pages.map((sp: StructuredPage) => {
    const pageIndex = sp.pageNumber - 1; // StructuredDocument uses 1‑based numbers.
    const pageModel: PageModel = {
      pageIndex,
      width: sp.width,
      height: sp.height,
      textBoxes: [],
      images: [],
      shapes: [],
      watermarks: [],
      redactions: [],
    };
    return pageModel;
  });

  // 3️⃣ Convert each block on each page into a TextBox and push it.
  for (const sp of structured.pages) {
    const pageIdx = sp.pageNumber - 1;
    const pageModel = pages[pageIdx];
    for (const block of sp.blocks) {
      // We only convert paragraphs / headings for now – ignore tables for simplicity.
      if (block.type === 'paragraph' || block.type === 'heading' || block.type === 'list') {
        const tb = blockToTextBox(block, pageIdx);
        pageModel.textBoxes.push(tb);
      }
    }
  }

  const docModel: DocumentModel = {
    filename,
    pages,
  };

  return docModel;
};
