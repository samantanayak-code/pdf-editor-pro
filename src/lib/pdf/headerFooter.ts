import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import { HeaderFooterOptions, PDFProcessingResult } from './types';

export async function addHeaderFooter(
  pdfBuffer: ArrayBuffer,
  options: HeaderFooterOptions
): Promise<PDFProcessingResult> {
  const { header, footer, fontSize = 10, color = { r: 0, g: 0, b: 0 },
    marginX = 40, marginY = 40, fileName = 'document.pdf', opacity = 1 } = options;
  try {
    const srcBytes = new Uint8Array(pdfBuffer.slice(0));
    const pdfJsDoc = await pdfjsLib.getDocument({ data: srcBytes.slice(0) }).promise;
    const newDoc = await PDFDocument.create();
    const font = await newDoc.embedFont(StandardFonts.Helvetica);
    const currentDate = new Date().toLocaleDateString();
    for (let i = 1; i <= pdfJsDoc.numPages; i++) {
      const pdfJsPage = await pdfJsDoc.getPage(i);
      const vp1 = pdfJsPage.getViewport({ scale: 1.0 });
      const vp2 = pdfJsPage.getViewport({ scale: 2.0 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vp2.width); canvas.height = Math.round(vp2.height);
      const ctx = canvas.getContext('2d')!;
      await pdfJsPage.render({ canvasContext: ctx, viewport: vp2 }).promise;
      const pngBytes = Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), c => c.charCodeAt(0));
      const pngImage = await newDoc.embedPng(pngBytes);
      const pdfPage = newDoc.addPage([vp1.width, vp1.height]);
      pdfPage.drawImage(pngImage, { x: 0, y: 0, width: vp1.width, height: vp1.height });
      const { width, height } = pdfPage.getSize();
      if (header) {
        let text = (header.text || '') + (header.showFileName ? ' ' + fileName : '') + (header.showDate ? ' ' + currentDate : '');
        if (text.trim()) {
          const tw = font.widthOfTextAtSize(text, fontSize);
          const x = header.position === 'left' ? marginX : header.position === 'right' ? width - tw - marginX : (width - tw) / 2;
          pdfPage.drawText(text, { x, y: height - marginY, size: fontSize, font, color: rgb(color.r, color.g, color.b), opacity });
        }
      }
      if (footer) {
        let text = (footer.text || '') + (footer.showFileName ? ' ' + fileName : '') + (footer.showDate ? ' ' + currentDate : '');
        if (text.trim()) {
          const tw = font.widthOfTextAtSize(text, fontSize);
          const x = footer.position === 'left' ? marginX : footer.position === 'right' ? width - tw - marginX : (width - tw) / 2;
          pdfPage.drawText(text, { x, y: marginY, size: fontSize, font, color: rgb(color.r, color.g, color.b), opacity });
        }
      }
    }
    const pdfBytes = await newDoc.save();
    return { success: true, data: pdfBytes, pageCount: pdfJsDoc.numPages, fileSize: pdfBytes.length };
  } catch (error) {
    return { success: false, error: `Add header/footer failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
}
