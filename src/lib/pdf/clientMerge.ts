import { PDFDocument } from 'pdf-lib';
import { supabase } from '../supabase';
import { getPdfBytes } from './buffers';

export async function mergeClientSide(files: File[]): Promise<{
  pdfBytes: Uint8Array;
  pageCount: number;
}> {
  console.log(`Client-side merge: Processing ${files.length} files`);
  const startTime = Date.now();

  const mergedPdf = await PDFDocument.create();

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    console.log(`Loading file ${i + 1}/${files.length}: ${file.name}`);

    const bytes = await getPdfBytes(file);
    const pdf = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });

    const pageCount = pdf.getPageCount();
    console.log(`File ${i + 1} has ${pageCount} pages`);

    const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
    copiedPages.forEach((page) => mergedPdf.addPage(page));
  }

  const pdfBytes = await mergedPdf.save();
  const totalTime = Date.now() - startTime;
  console.log(`Client-side merge complete in ${totalTime}ms: ${mergedPdf.getPageCount()} pages`);

  return {
    pdfBytes,
    pageCount: mergedPdf.getPageCount(),
  };
}

export async function uploadMergedPDF(
  pdfBytes: Uint8Array,
  userId: string
): Promise<{ downloadUrl: string; fileId: string }> {
  const fileName = `merged-${Date.now()}-${Math.random().toString(36).substring(7)}.pdf`;

  const { error: uploadError } = await supabase.storage
    .from('processed-pdfs')
    .upload(fileName, pdfBytes, {
      contentType: 'application/pdf',
      cacheControl: '3600',
    });

  if (uploadError) {
    throw new Error(`Failed to upload merged PDF: ${uploadError.message}`);
  }

  await supabase.from('usage_logs').insert({
    user_id: userId,
    operation: 'merge',
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
