import { supabase } from './supabase';
import {
  mergePDFs,
  rotatePDF,
  addPageNumbers,
  deletePages,
  PDFProcessingResult as CoreResult
} from './pdf/core';

export interface PDFServiceResult {
  success: boolean;
  downloadUrl?: string;
  fileId?: string;
  pageCount?: number;
  fileSize?: number;
  error?: string;
  data?: Uint8Array; // Added for direct client-side handling
}

/**
 * Triggers a browser download of a Uint8Array as a PDF file.
 */
export function downloadUint8Array(data: Uint8Array, filename: string) {
  const blob = new Blob([data], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Log usage to Supabase if the user is signed in.
 * This is non-blocking and doesn't prevent the operation from succeeding.
 */
async function logUsage(operation: string, fileSize: number = 0, pageCount: number = 0) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      await supabase.from('usage_logs').insert({
        user_id: session.user.id,
        operation,
        file_size_mb: parseFloat((fileSize / (1024 * 1024)).toFixed(2)),
        page_count: pageCount,
      });
    }
  } catch (e) {
    console.warn('Failed to log usage:', e);
  }
}

export async function mergePDFsServer(files: File[]): Promise<PDFServiceResult> {
  console.log(`Starting client-side merge of ${files.length} files...`);
  const result = await mergePDFs(files);
  
  if (result.success && result.data) {
    logUsage('merge', result.fileSize, result.pageCount);
    return {
      success: true,
      data: result.data,
      pageCount: result.pageCount,
      fileSize: result.fileSize,
    };
  }
  
  return { success: false, error: result.error };
}

export async function rotatePDFServer(file: File, pages: number[], angle: number): Promise<PDFServiceResult> {
  const buffer = await file.arrayBuffer();
  const result = await rotatePDF(buffer, pages.map(p => p - 1), angle);

  if (result.success && result.data) {
    logUsage('rotate', result.fileSize, result.pageCount);
    return {
      success: true,
      data: result.data,
      pageCount: result.pageCount,
      fileSize: result.fileSize,
    };
  }

  return { success: false, error: result.error };
}

export async function addPageNumbersServer(
  file: File,
  options: any
): Promise<PDFServiceResult> {
  const buffer = await file.arrayBuffer();
  const result = await addPageNumbers(buffer, options);

  if (result.success && result.data) {
    logUsage('paginate', result.fileSize, result.pageCount);
    return {
      success: true,
      data: result.data,
      pageCount: result.pageCount,
      fileSize: result.fileSize,
    };
  }

  return { success: false, error: result.error };
}

export async function deletePagesServer(file: File, pages: number[]): Promise<PDFServiceResult> {
  const buffer = await file.arrayBuffer();
  const result = await deletePages(buffer, pages.map(p => p - 1));

  if (result.success && result.data) {
    logUsage('delete', result.fileSize, result.pageCount);
    return {
      success: true,
      data: result.data,
      pageCount: result.pageCount,
      fileSize: result.fileSize,
    };
  }

  return { success: false, error: result.error };
}

export async function extractPagesServer(file: File, pages: number[]): Promise<PDFServiceResult> {
  // Extract is essentially delete everything else, or we can use our split logic
  const buffer = await file.arrayBuffer();
  const pdfDoc = await mergePDFs([file]); // Temporary reuse of merge for simple load/save if needed, but better to use direct logic
  // For now, let's just use deletePages with the inverse
  const result = await deletePages(buffer, []); // Placeholder - ideally we add extract to core
  
  if (result.success && result.data) {
     // TODO: Implement proper extract in core.ts
  }
  
  return { success: false, error: 'Extract not yet implemented in 100% client mode' };
}

export async function addHeaderFooterServer(
  file: File,
  options: any
): Promise<PDFServiceResult> {
  // We can reuse addPageNumbers logic or extend core.ts
  return { success: false, error: 'Header/Footer migration in progress' };
}

