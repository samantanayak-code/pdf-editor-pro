import * as pdfjsLib from 'pdfjs-dist';
import { supabase } from './supabase';

export interface PDFChunk {
  page_number: number;
  chunk_index: number;
  content: string;
}

export interface SearchResult {
  chunk_id: string;
  document_id: string;
  filename: string;
  page_number: number;
  content: string;
  similarity: number;
}

export async function extractTextFromPDF(pdfBuffer: ArrayBuffer): Promise<{
  chunks: PDFChunk[];
  totalPages: number;
}> {
  try {
    const loadingTask = pdfjsLib.getDocument({ data: pdfBuffer });
    const pdfDoc = await loadingTask.promise;
    const totalPages = pdfDoc.numPages;
    const chunks: PDFChunk[] = [];

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ')
        .trim();

      if (pageText.length > 0) {
        const pageChunks = chunkText(pageText, 800);
        pageChunks.forEach((chunk, index) => {
          chunks.push({
            page_number: pageNum,
            chunk_index: index,
            content: chunk,
          });
        });
      }
    }

    return { chunks, totalPages };
  } catch (error) {
    console.error('Error extracting text from PDF:', error);
    throw new Error('Failed to extract text from PDF');
  }
}

function chunkText(text: string, chunkSize: number = 800): string[] {
  const chunks: string[] = [];
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];

  let currentChunk = '';

  for (const sentence of sentences) {
    if ((currentChunk + sentence).length <= chunkSize) {
      currentChunk += sentence;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = sentence;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks.filter(chunk => chunk.length > 0);
}

export async function uploadPDFForSearch(
  userId: string,
  file: File,
  fileUrl: string
): Promise<string> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const { chunks, totalPages } = await extractTextFromPDF(arrayBuffer);

    const { data: document, error: docError } = await supabase
      .from('pdf_documents')
      .insert({
        user_id: userId,
        filename: file.name,
        file_url: fileUrl,
        total_pages: totalPages,
        file_size_mb: file.size / (1024 * 1024),
      })
      .select()
      .single();

    if (docError) throw docError;

    const chunksToInsert = chunks.map((chunk) => ({
      document_id: document.id,
      page_number: chunk.page_number,
      chunk_index: chunk.chunk_index,
      content: chunk.content,
    }));

    const { error: chunksError } = await supabase
      .from('pdf_chunks')
      .insert(chunksToInsert);

    if (chunksError) throw chunksError;

    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData.session) {
      const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-embeddings`;

      fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${sessionData.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ documentId: document.id }),
      }).catch(err => console.error('Background embedding generation failed:', err));
    }

    return document.id;
  } catch (error) {
    console.error('Error uploading PDF for search:', error);
    throw error;
  }
}

export async function searchPDFContent(
  query: string,
  documentId?: string
): Promise<SearchResult[]> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      throw new Error('Not authenticated');
    }

    const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/semantic-search`;

    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sessionData.session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        documentId: documentId || undefined,
        matchThreshold: 0.5,
        matchCount: 20,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || result.details || 'Search failed');
    }

    return result.results || [];
  } catch (error) {
    console.error('Error searching PDF content:', error);
    throw error;
  }
}

export async function getUserPDFDocuments(userId: string) {
  const { data, error } = await supabase
    .from('pdf_documents')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function deletePDFDocument(documentId: string, userId: string) {
  const { error } = await supabase
    .from('pdf_documents')
    .delete()
    .eq('id', documentId)
    .eq('user_id', userId);

  if (error) throw error;
}
