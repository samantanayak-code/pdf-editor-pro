import { PDFDocument, degrees } from 'pdf-lib';
import {
  SplitOptions,
  RotateOptions,
  DeleteOptions,
  ExtractOptions,
  ReorderOptions,
  PDFProcessingResult,
} from './types';

export async function splitPDF(
  pdfBuffer: ArrayBuffer,
  options: SplitOptions
): Promise<PDFProcessingResult[]> {
  const { ranges } = options;

  try {
    const sourcePdf = await PDFDocument.load(pdfBuffer);
    const totalPages = sourcePdf.getPageCount();
    const results: PDFProcessingResult[] = [];

    for (const range of ranges) {
      const newPdf = await PDFDocument.create();
      const start = Math.max(0, range.start - 1);
      const end = Math.min(totalPages, range.end);

      const pagesToCopy = Array.from(
        { length: end - start },
        (_, i) => start + i
      );

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
  } catch (error) {
    return [{
      success: false,
      error: `PDF split failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }];
  }
}

export async function rotatePDF(
  pdfBuffer: ArrayBuffer,
  options: RotateOptions
): Promise<PDFProcessingResult> {
  const { pages: pageNumbers, angle } = options;

  try {
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const pages = pdfDoc.getPages();

    for (const pageNum of pageNumbers) {
      const pageIndex = pageNum - 1;
      if (pageIndex >= 0 && pageIndex < pages.length) {
        const page = pages[pageIndex];
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
  } catch (error) {
    return {
      success: false,
      error: `PDF rotate failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export async function deletePages(
  pdfBuffer: ArrayBuffer,
  options: DeleteOptions
): Promise<PDFProcessingResult> {
  const { pages: pageNumbers } = options;

  try {
    const sourcePdf = await PDFDocument.load(pdfBuffer);
    const totalPages = sourcePdf.getPageCount();
    const newPdf = await PDFDocument.create();

    const pagesToKeep = Array.from(
      { length: totalPages },
      (_, i) => i
    ).filter((i) => !pageNumbers.includes(i + 1));

    const copiedPages = await newPdf.copyPages(sourcePdf, pagesToKeep);
    copiedPages.forEach((page) => newPdf.addPage(page));

    const pdfBytes = await newPdf.save();

    return {
      success: true,
      data: pdfBytes,
      pageCount: copiedPages.length,
      fileSize: pdfBytes.length,
    };
  } catch (error) {
    return {
      success: false,
      error: `Delete pages failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export async function extractPages(
  pdfBuffer: ArrayBuffer,
  options: ExtractOptions
): Promise<PDFProcessingResult> {
  const { pages: pageNumbers } = options;

  try {
    const sourcePdf = await PDFDocument.load(pdfBuffer);
    const newPdf = await PDFDocument.create();

    const pagesToExtract = pageNumbers.map((p) => p - 1);
    const copiedPages = await newPdf.copyPages(sourcePdf, pagesToExtract);
    copiedPages.forEach((page) => newPdf.addPage(page));

    const pdfBytes = await newPdf.save();

    return {
      success: true,
      data: pdfBytes,
      pageCount: copiedPages.length,
      fileSize: pdfBytes.length,
    };
  } catch (error) {
    return {
      success: false,
      error: `Extract pages failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export async function reorderPages(
  pdfBuffer: ArrayBuffer,
  options: ReorderOptions
): Promise<PDFProcessingResult> {
  const { newOrder } = options;

  try {
    const sourcePdf = await PDFDocument.load(pdfBuffer);
    const newPdf = await PDFDocument.create();

    const pagesToCopy = newOrder.map((p) => p - 1);
    const copiedPages = await newPdf.copyPages(sourcePdf, pagesToCopy);
    copiedPages.forEach((page) => newPdf.addPage(page));

    const pdfBytes = await newPdf.save();

    return {
      success: true,
      data: pdfBytes,
      pageCount: copiedPages.length,
      fileSize: pdfBytes.length,
    };
  } catch (error) {
    return {
      success: false,
      error: `Reorder pages failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}
