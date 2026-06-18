import { PDFDocument } from 'pdf-lib';
import { MergeOptions, PDFProcessingResult } from './types';

export async function mergePDFs(options: MergeOptions): Promise<PDFProcessingResult> {
  const { files, pageRanges } = options;

  try {
    if (!files || files.length === 0) {
      return {
        success: false,
        error: 'No files provided for merging',
      };
    }

    const mergedPdf = await PDFDocument.create();

    for (let i = 0; i < files.length; i++) {
      const pdfDoc = await PDFDocument.load(files[i]);
      const totalPages = pdfDoc.getPageCount();

      const pagesToCopy = pageRanges?.[i]?.pages ||
        Array.from({ length: totalPages }, (_, idx) => idx);

      const copiedPages = await mergedPdf.copyPages(
        pdfDoc,
        pagesToCopy
      );

      copiedPages.forEach((page) => {
        mergedPdf.addPage(page);
      });
    }

    const pdfBytes = await mergedPdf.save();
    const pageCount = mergedPdf.getPageCount();

    return {
      success: true,
      data: pdfBytes,
      pageCount,
      fileSize: pdfBytes.length,
    };
  } catch (error) {
    return {
      success: false,
      error: `PDF merge failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}
