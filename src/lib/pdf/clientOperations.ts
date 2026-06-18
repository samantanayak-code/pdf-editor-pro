import { PDFDocument, rgb, StandardFonts, degrees, PageSizes } from 'pdf-lib';
import { supabase } from '../supabase';

export async function rotateClientSide(
  file: File,
  pages: number[],
  angle: number
): Promise<Uint8Array> {
  console.log(`Client-side rotate: ${pages.length} pages by ${angle} degrees`);
  const startTime = Date.now();

  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc = await PDFDocument.load(arrayBuffer, {
    ignoreEncryption: true,
    updateMetadata: false,
  });

  const pdfPages = pdfDoc.getPages();

  for (const pageNum of pages) {
    if (pageNum >= 1 && pageNum <= pdfPages.length) {
      const page = pdfPages[pageNum - 1];
      page.setRotation(degrees(angle));
    }
  }

  const pdfBytes = await pdfDoc.save();
  console.log(`Client-side rotate complete in ${Date.now() - startTime}ms`);

  return pdfBytes;
}

export async function addPageNumbersClientSide(
  file: File,
  options: {
    format?: string;
    startNumber?: number;
    position?: string;
    fontSize?: number;
    color?: { r: number; g: number; b: number };
    excludePages?: number[];
    marginX?: number;
    marginY?: number;
  }
): Promise<Uint8Array> {
  console.log('Client-side add page numbers');
  const startTime = Date.now();

  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc = await PDFDocument.load(arrayBuffer, {
    ignoreEncryption: true,
    updateMetadata: false,
  });

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();

  const format = options.format || 'Page {n}';
  const startNumber = options.startNumber || 1;
  const position = options.position || 'bottom-center';
  const fontSize = options.fontSize || 12;
  const color = options.color || { r: 0, g: 0, b: 0 };
  const excludePages = options.excludePages || [];
  const marginX = options.marginX || 50;
  const marginY = options.marginY || 30;

  for (let i = 0; i < pages.length; i++) {
    const pageNum = i + 1;

    if (excludePages.includes(pageNum)) {
      continue;
    }

    const page = pages[i];
    const { width, height } = page.getSize();
    const text = format.replace('{n}', String(startNumber + i));
    const textWidth = font.widthOfTextAtSize(text, fontSize);

    let x = width / 2 - textWidth / 2;
    let y = marginY;

    if (position.includes('top')) {
      y = height - marginY;
    }
    if (position.includes('left')) {
      x = marginX;
    }
    if (position.includes('right')) {
      x = width - marginX - textWidth;
    }

    page.drawText(text, {
      x,
      y,
      size: fontSize,
      font,
      color: rgb(color.r / 255, color.g / 255, color.b / 255),
    });
  }

  const pdfBytes = await pdfDoc.save();
  console.log(`Client-side page numbers complete in ${Date.now() - startTime}ms`);

  return pdfBytes;
}

export async function addHeaderFooterClientSide(
  file: File,
  options: {
    headerText?: string;
    footerText?: string;
    position?: string;
    fontSize?: number;
    color?: { r: number; g: number; b: number };
    excludePages?: number[];
    marginX?: number;
    marginY?: number;
  }
): Promise<Uint8Array> {
  console.log('Client-side add header/footer');
  const startTime = Date.now();

  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc = await PDFDocument.load(arrayBuffer, {
    ignoreEncryption: true,
    updateMetadata: false,
  });

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();

  const headerText = options.headerText || '';
  const footerText = options.footerText || '';
  const fontSize = options.fontSize || 12;
  const color = options.color || { r: 0, g: 0, b: 0 };
  const excludePages = options.excludePages || [];
  const marginX = options.marginX || 50;
  const marginY = options.marginY || 30;

  for (let i = 0; i < pages.length; i++) {
    const pageNum = i + 1;

    if (excludePages.includes(pageNum)) {
      continue;
    }

    const page = pages[i];
    const { width, height } = page.getSize();

    if (headerText) {
      const textWidth = font.widthOfTextAtSize(headerText, fontSize);
      page.drawText(headerText, {
        x: width / 2 - textWidth / 2,
        y: height - marginY,
        size: fontSize,
        font,
        color: rgb(color.r / 255, color.g / 255, color.b / 255),
      });
    }

    if (footerText) {
      const textWidth = font.widthOfTextAtSize(footerText, fontSize);
      page.drawText(footerText, {
        x: width / 2 - textWidth / 2,
        y: marginY,
        size: fontSize,
        font,
        color: rgb(color.r / 255, color.g / 255, color.b / 255),
      });
    }
  }

  const pdfBytes = await pdfDoc.save();
  console.log(`Client-side header/footer complete in ${Date.now() - startTime}ms`);

  return pdfBytes;
}

export async function uploadProcessedPDF(
  pdfBytes: Uint8Array,
  userId: string,
  operation: string
): Promise<{ downloadUrl: string; fileId: string }> {
  const fileName = `${operation}-${Date.now()}-${Math.random().toString(36).substring(7)}.pdf`;

  const { error: uploadError } = await supabase.storage
    .from('processed-pdfs')
    .upload(fileName, pdfBytes, {
      contentType: 'application/pdf',
      cacheControl: '3600',
    });

  if (uploadError) {
    throw new Error(`Failed to upload processed PDF: ${uploadError.message}`);
  }

  await supabase.from('usage_logs').insert({
    user_id: userId,
    operation,
    file_size_mb: parseFloat((pdfBytes.length / (1024 * 1024)).toFixed(2)),
    page_count: 0,
  });

  const { data } = supabase.storage
    .from('processed-pdfs')
    .getPublicUrl(fileName);

  return {
    downloadUrl: data.publicUrl,
    fileId: fileName,
  };
}
