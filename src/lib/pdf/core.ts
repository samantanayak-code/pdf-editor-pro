import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib';

export interface PDFProcessingResult {
  success: boolean;
  data?: Uint8Array;
  pageCount?: number;
  fileSize?: number;
  error?: string;
}

/**
 * Merges multiple PDF files into one.
 */
export async function mergePDFs(files: File[] | ArrayBuffer[]): Promise<PDFProcessingResult> {
  try {
    const mergedPdf = await PDFDocument.create();
    for (const file of files) {
      const buffer = file instanceof File ? await file.arrayBuffer() : file;
      const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
      const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
      copiedPages.forEach((page) => mergedPdf.addPage(page));
    }
    const pdfBytes = await mergedPdf.save();
    return {
      success: true,
      data: pdfBytes,
      pageCount: mergedPdf.getPageCount(),
      fileSize: pdfBytes.length,
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Splits a PDF into multiple files based on ranges.
 */
export async function splitPDF(
  buffer: ArrayBuffer,
  ranges: { start: number; end: number }[]
): Promise<PDFProcessingResult[]> {
  try {
    const sourcePdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const totalPages = sourcePdf.getPageCount();
    const results: PDFProcessingResult[] = [];

    for (const range of ranges) {
      const newPdf = await PDFDocument.create();
      const start = Math.max(0, range.start - 1);
      const end = Math.min(totalPages, range.end);
      const pagesToCopy = Array.from({ length: end - start }, (_, i) => start + i);
      
      const copiedPages = await newPdf.copyPages(sourcePdf, pagesToCopy);
      copiedPages.forEach((page) => newPdf.addPage(page));
      
      const pdfBytes = await newPdf.save();
      results.push({
        success: true,
        data: pdfBytes,
        pageCount: copiedPages.length,
        fileSize: pdfBytes.length,
      });
    }
    return results;
  } catch (error: any) {
    return [{ success: false, error: error.message }];
  }
}

/**
 * Rotates specific pages of a PDF.
 */
export async function rotatePDF(
  buffer: ArrayBuffer,
  pageIndices: number[],
  angle: number
): Promise<PDFProcessingResult> {
  try {
    const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const pages = pdfDoc.getPages();
    for (const index of pageIndices) {
      if (index >= 0 && index < pages.length) {
        const page = pages[index];
        const currentRotation = page.getRotation().angle;
        page.setRotation(degrees(currentRotation + angle));
      }
    }
    const pdfBytes = await pdfDoc.save();
    return {
      success: true,
      data: pdfBytes,
      pageCount: pages.length,
      fileSize: pdfBytes.length,
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Deletes specific pages from a PDF.
 */
export async function deletePages(
  buffer: ArrayBuffer,
  pageIndices: number[]
): Promise<PDFProcessingResult> {
  try {
    const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const newPdf = await PDFDocument.create();
    const totalPages = pdfDoc.getPageCount();
    const pagesToKeep = Array.from({ length: totalPages }, (_, i) => i)
      .filter((i) => !pageIndices.includes(i));

    const copiedPages = await newPdf.copyPages(pdfDoc, pagesToKeep);
    copiedPages.forEach((page) => newPdf.addPage(page));

    const pdfBytes = await newPdf.save();
    return {
      success: true,
      data: pdfBytes,
      pageCount: copiedPages.length,
      fileSize: pdfBytes.length,
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Adds page numbers to a PDF.
 */
export async function addPageNumbers(
  buffer: ArrayBuffer,
  options: {
    format?: string;
    startNumber?: number;
    position?: 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
    fontSize?: number;
    color?: { r: number; g: number; b: number };
    excludePages?: number[];
  }
): Promise<PDFProcessingResult> {
  try {
    const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();
    
    const {
      format = 'Page {n}',
      startNumber = 1,
      position = 'bottom-center',
      fontSize = 12,
      color = { r: 0, g: 0, b: 0 },
      excludePages = []
    } = options;

    for (let i = 0; i < pages.length; i++) {
      if (excludePages.includes(i + 1)) continue;

      const page = pages[i];
      const { width, height } = page.getSize();
      const text = format.replace('{n}', String(startNumber + i));
      const textWidth = font.widthOfTextAtSize(text, fontSize);

      let x = width / 2 - textWidth / 2;
      let y = 30;

      if (position.includes('top')) y = height - 30;
      if (position.includes('left')) x = 50;
      if (position.includes('right')) x = width - 50 - textWidth;

      page.drawText(text, {
        x, y, size: fontSize, font,
        color: rgb(color.r / 255, color.g / 255, color.b / 255),
      });
    }

    const pdfBytes = await pdfDoc.save();
    return {
      success: true,
      data: pdfBytes,
      pageCount: pages.length,
      fileSize: pdfBytes.length,
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
