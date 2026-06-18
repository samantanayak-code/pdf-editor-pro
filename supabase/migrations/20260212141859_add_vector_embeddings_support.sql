/*
  # Add Vector Embeddings Support for AI-Powered Search

  ## Changes Made
  
  1. Extensions
    - Enable pgvector extension for vector similarity search
  
  2. Modified Tables
    - `pdf_chunks`
      - Add `embedding` column (vector type with 1536 dimensions for OpenAI embeddings)
      - Add vector similarity search index for performance
      - Add `processed` boolean column to track embedding generation status
  
  3. Performance
    - Add HNSW index on embedding column for fast similarity search
    - Optimized for OpenAI text-embedding-3-small model (1536 dimensions)
  
  4. Security
    - No RLS changes needed (inherits from existing policies)
*/

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column to pdf_chunks table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pdf_chunks' AND column_name = 'embedding'
  ) THEN
    ALTER TABLE pdf_chunks ADD COLUMN embedding vector(1536);
  END IF;
END $$;

-- Add processed column to track embedding generation
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pdf_chunks' AND column_name = 'processed'
  ) THEN
    ALTER TABLE pdf_chunks ADD COLUMN processed boolean DEFAULT false;
  END IF;
END $$;

-- Create index for vector similarity search using HNSW algorithm
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'pdf_chunks_embedding_idx'
  ) THEN
    CREATE INDEX pdf_chunks_embedding_idx ON pdf_chunks 
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
  END IF;
END $$;

-- Create function for semantic search
CREATE OR REPLACE FUNCTION match_pdf_chunks(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 10,
  filter_document_id uuid DEFAULT NULL
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
  JOIN pdf_documents d ON c.document_id = d.id
  WHERE 
    c.embedding IS NOT NULL
    AND (filter_document_id IS NULL OR c.document_id = filter_document_id)
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
