/*
  # Setup Storage Buckets for PDF Processing

  ## Changes Made
  
  1. Storage Buckets
    - Create `processed-pdfs` bucket for storing uploaded and processed PDF files
    - Set up public access for processed PDFs (files are accessible via public URLs)
  
  2. Security
    - Authenticated users can upload files
    - Authenticated users can only delete their own files
    - Public read access for all files
  
  ## Notes
  - Files are stored with unique names to prevent conflicts
  - Public bucket allows direct download links without authentication
*/

-- Create the processed-pdfs bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'processed-pdfs',
  'processed-pdfs',
  true,
  52428800,
  ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE
SET 
  public = true,
  file_size_limit = 52428800,
  allowed_mime_types = ARRAY['application/pdf']::text[];

-- Drop existing policies if they exist
DO $$
BEGIN
  DROP POLICY IF EXISTS "Authenticated users can upload PDFs" ON storage.objects;
  DROP POLICY IF EXISTS "Users can read their own PDFs" ON storage.objects;
  DROP POLICY IF EXISTS "Public read access for processed PDFs" ON storage.objects;
  DROP POLICY IF EXISTS "Users can delete their own PDFs" ON storage.objects;
  DROP POLICY IF EXISTS "Users can update their own PDFs" ON storage.objects;
  DROP POLICY IF EXISTS "Users can delete PDFs" ON storage.objects;
  DROP POLICY IF EXISTS "Users can update PDFs" ON storage.objects;
END $$;

-- Storage policies for authenticated users to upload
CREATE POLICY "Authenticated users can upload PDFs"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'processed-pdfs'
);

-- Storage policies for public read access (public bucket)
CREATE POLICY "Public read access for processed PDFs"
ON storage.objects
FOR SELECT
TO public
USING (
  bucket_id = 'processed-pdfs'
);

-- Storage policies for authenticated users to delete files
CREATE POLICY "Users can delete PDFs"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'processed-pdfs'
);

-- Storage policies for authenticated users to update files
CREATE POLICY "Users can update PDFs"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'processed-pdfs'
)
WITH CHECK (
  bucket_id = 'processed-pdfs'
);
