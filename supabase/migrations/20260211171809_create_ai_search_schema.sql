/*
  # AI Search and Citation System

  ## Overview
  Implements AI-powered search within PDFs with accurate citation tracking.
  Uses vector embeddings for semantic search and maintains page-level citations.

  ## Tables Created

  1. **pdf_documents** - Stores uploaded PDF metadata
     - `id` (uuid, primary key)
     - `user_id` (uuid, references profiles)
     - `filename` (text, not null)
     - `file_url` (text, not null)
     - `total_pages` (integer)
     - `file_size_mb` (decimal)
     - `created_at` (timestamptz)

  2. **pdf_chunks** - Stores text chunks with embeddings for search
     - `id` (uuid, primary key)
     - `document_id` (uuid, references pdf_documents)
     - `page_number` (integer, not null)
     - `chunk_index` (integer, not null)
     - `content` (text, not null)
     - `embedding` (vector(1536)) - OpenAI ada-002 embeddings
     - `created_at` (timestamptz)

  3. **search_history** - Tracks user searches for analytics
     - `id` (uuid, primary key)
     - `user_id` (uuid, references profiles)
     - `query` (text, not null)
     - `document_id` (uuid, references pdf_documents)
     - `results_count` (integer)
     - `created_at` (timestamptz)

  ## Security
  - RLS enabled on all tables
  - Users can only access their own documents and searches
  - Vector similarity search for semantic matching

  ## Notes
  - Enable pgvector extension for vector similarity search
  - Embeddings generated using OpenAI API or similar
  - Chunks are typically 500-1000 characters for optimal search
*/

-- Enable pgvector extension for vector similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- Create pdf_documents table
CREATE TABLE IF NOT EXISTS pdf_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  filename TEXT NOT NULL,
  file_url TEXT NOT NULL,
  total_pages INTEGER NOT NULL DEFAULT 0,
  file_size_mb DECIMAL(10, 2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create pdf_chunks table with vector embeddings
CREATE TABLE IF NOT EXISTS pdf_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES pdf_documents(id) ON DELETE CASCADE NOT NULL,
  page_number INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL,
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create search_history table
CREATE TABLE IF NOT EXISTS search_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  query TEXT NOT NULL,
  document_id UUID REFERENCES pdf_documents(id) ON DELETE SET NULL,
  results_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_pdf_documents_user ON pdf_documents(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pdf_chunks_document ON pdf_chunks(document_id, page_number);
CREATE INDEX IF NOT EXISTS idx_search_history_user ON search_history(user_id, created_at DESC);

-- Create vector similarity search index (HNSW for fast similarity search)
CREATE INDEX IF NOT EXISTS idx_pdf_chunks_embedding ON pdf_chunks USING hnsw (embedding vector_cosine_ops);

-- Enable Row Level Security
ALTER TABLE pdf_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE pdf_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies for pdf_documents
CREATE POLICY "Users can view own PDF documents"
  ON pdf_documents FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own PDF documents"
  ON pdf_documents FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own PDF documents"
  ON pdf_documents FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- RLS Policies for pdf_chunks
CREATE POLICY "Users can view own PDF chunks"
  ON pdf_chunks FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM pdf_documents
      WHERE pdf_documents.id = pdf_chunks.document_id
      AND pdf_documents.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own PDF chunks"
  ON pdf_chunks FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM pdf_documents
      WHERE pdf_documents.id = pdf_chunks.document_id
      AND pdf_documents.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own PDF chunks"
  ON pdf_chunks FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM pdf_documents
      WHERE pdf_documents.id = pdf_chunks.document_id
      AND pdf_documents.user_id = auth.uid()
    )
  );

-- RLS Policies for search_history
CREATE POLICY "Users can view own search history"
  ON search_history FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own search history"
  ON search_history FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Function for vector similarity search with citations
CREATE OR REPLACE FUNCTION search_pdf_content(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 5,
  target_user_id uuid DEFAULT auth.uid()
)
RETURNS TABLE (
  chunk_id uuid,
  document_id uuid,
  filename text,
  page_number int,
  content text,
  similarity float
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id as chunk_id,
    c.document_id,
    d.filename,
    c.page_number,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity
  FROM pdf_chunks c
  INNER JOIN pdf_documents d ON d.id = c.document_id
  WHERE d.user_id = target_user_id
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
