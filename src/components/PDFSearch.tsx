import { useState, useEffect } from 'react';
import { Search, Upload, FileText, Trash2, BookOpen, Quote, AlertCircle, RefreshCw } from 'lucide-react';
import { useAuth } from '../lib/auth';
import {
  searchPDFContent,
  getUserPDFDocuments,
  uploadPDFForSearch,
  deletePDFDocument,
  SearchResult,
} from '../lib/pdfSearch';
import { supabase } from '../lib/supabase';

interface PDFSearchProps {
  onToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

export function PDFSearch({ onToast }: PDFSearchProps) {
  const { user } = useAuth();
  const [documents, setDocuments] = useState<any[]>([]);
  const [documentEmbeddings, setDocumentEmbeddings] = useState<Record<string, number>>({});
  const [selectedDocument, setSelectedDocument] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (user) {
      loadDocuments();
    }
  }, [user]);

  const loadDocuments = async () => {
    if (!user) return;

    try {
      setLoading(true);
      const docs = await getUserPDFDocuments(user.id);
      setDocuments(docs);

      const embeddingStatus: Record<string, number> = {};
      for (const doc of docs) {
        const { count } = await supabase
          .from('pdf_chunks')
          .select('*', { count: 'exact', head: true })
          .eq('document_id', doc.id)
          .not('embedding', 'is', null);
        embeddingStatus[doc.id] = count || 0;
      }
      setDocumentEmbeddings(embeddingStatus);
    } catch (error: any) {
      onToast(`Failed to load documents: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (file.type !== 'application/pdf') {
      onToast('Please upload a PDF file', 'error');
      return;
    }

    try {
      setUploading(true);

      const fileName = `${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('processed-pdfs')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from('processed-pdfs')
        .getPublicUrl(fileName);

      await uploadPDFForSearch(user.id, file, data.publicUrl);

      onToast('PDF uploaded! AI indexing in progress...', 'success');
      await loadDocuments();
    } catch (error: any) {
      onToast(`Upload failed: ${error.message}`, 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim() || !user) return;

    try {
      setSearching(true);

      const { data: embeddingCheck } = await supabase
        .from('pdf_chunks')
        .select('id', { count: 'exact', head: false })
        .not('embedding', 'is', null)
        .limit(1);

      if (!embeddingCheck || embeddingCheck.length === 0) {
        onToast(
          'Please generate AI index first by clicking the refresh icon (🔄) next to your document',
          'error'
        );
        setSearching(false);
        return;
      }

      const results = await searchPDFContent(
        searchQuery,
        selectedDocument || undefined
      );
      setSearchResults(results);

      if (results.length === 0) {
        onToast('No results found. Try different keywords or generate embeddings for more documents.', 'info');
      }
    } catch (error: any) {
      const errorMsg = error.message || 'Search failed';
      if (errorMsg.includes('OpenAI') || errorMsg.includes('API key')) {
        onToast('OpenAI API key not configured. Please check setup instructions.', 'error');
      } else if (errorMsg.includes('embedding')) {
        onToast('Please generate AI index first by clicking the refresh icon next to your document', 'error');
      } else {
        onToast(`Search failed: ${errorMsg}`, 'error');
      }
    } finally {
      setSearching(false);
    }
  };

  const handleDelete = async (documentId: string) => {
    if (!user) return;

    if (!confirm('Are you sure you want to delete this document?')) return;

    try {
      await deletePDFDocument(documentId, user.id);
      onToast('Document deleted successfully', 'success');
      await loadDocuments();
      if (selectedDocument === documentId) {
        setSelectedDocument('');
        setSearchResults([]);
      }
    } catch (error: any) {
      onToast(`Delete failed: ${error.message}`, 'error');
    }
  };

  const handleRegenerateIndex = async (documentId: string) => {
    if (!user) return;

    let toastShown = false;

    try {
      setLoading(true);
      onToast('Generating AI index... This may take a minute.', 'info');
      toastShown = true;

      const { data: sessionData, error: sessionError } = await supabase.auth.refreshSession();
      if (sessionError || !sessionData.session) {
        const { data: fallbackSession } = await supabase.auth.getSession();
        if (!fallbackSession.session) {
          throw new Error('Your session has expired. Please log out and log back in.');
        }
      }

      const finalSession = sessionData?.session || (await supabase.auth.getSession()).data.session;
      if (!finalSession) {
        throw new Error('Unable to get valid session. Please refresh the page.');
      }

      const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-embeddings`;

      const response = await fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${finalSession.access_token}`,
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ documentId }),
      });

      let result;
      try {
        result = await response.json();
      } catch (parseError) {
        throw new Error(`Server error (status ${response.status}). Please try again.`);
      }

      if (!response.ok) {
        const errorMsg = result.error || result.details || result.message || 'Unknown error occurred';

        if (errorMsg.includes('Unauthorized') || errorMsg.includes('JWT') || errorMsg.includes('authorization') || errorMsg.includes('expired')) {
          throw new Error('Session expired. Please refresh the page and try again.');
        }

        if (errorMsg.includes('OpenAI') || errorMsg.includes('API key') || errorMsg.includes('api key') || errorMsg.includes('not configured')) {
          throw new Error('OpenAI API key not configured. Please add your API key in Supabase Dashboard → Project Settings → Edge Functions. See OPENAI_SETUP.md for instructions.');
        }
        throw new Error(errorMsg);
      }

      onToast(`Successfully indexed ${result.processed} chunks! You can now search this document.`, 'success');
      await loadDocuments();
    } catch (error: any) {
      if (!toastShown || error.message) {
        onToast(`Index generation failed: ${error.message || 'Unknown error'}`, 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  const highlightText = (text: string, query: string) => {
    if (!query) return text;

    const queryWords = query.toLowerCase().split(/\s+/);
    let highlightedText = text;

    queryWords.forEach((word) => {
      const regex = new RegExp(`(${word})`, 'gi');
      highlightedText = highlightedText.replace(
        regex,
        '<mark class="bg-yellow-200 px-1 rounded">$1</mark>'
      );
    });

    return highlightedText;
  };

  if (!user) {
    return (
      <div className="max-w-6xl mx-auto text-center py-20">
        <BookOpen className="w-16 h-16 text-gray-400 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 mb-2">AI-Powered PDF Search</h2>
        <p className="text-gray-600">Please sign in to search your PDF documents</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="bg-gradient-to-br from-white via-blue-50 to-white rounded-2xl shadow-2xl p-8 border border-blue-100">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h2 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent mb-2">
              AI-Powered Search
            </h2>
            <p className="text-gray-600 text-lg">
              Find anything across your documents with accurate citations
            </p>
          </div>
          <label className="px-6 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 text-white rounded-xl font-bold hover:from-blue-700 hover:to-cyan-700 transition-all duration-300 cursor-pointer flex items-center gap-2 shadow-lg hover:shadow-xl transform hover:scale-105">
            <Upload className="w-5 h-5" />
            {uploading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                <span>Indexing...</span>
              </>
            ) : (
              'Upload PDF'
            )}
            <input
              type="file"
              accept="application/pdf"
              onChange={handleFileUpload}
              disabled={uploading}
              className="hidden"
            />
          </label>
        </div>

        {documents.length > 0 && (
          <div className="mb-6">
            <label className="block text-sm font-bold text-gray-700 mb-2">
              Filter by Document
            </label>
            <select
              value={selectedDocument}
              onChange={(e) => setSelectedDocument(e.target.value)}
              className="w-full px-4 py-3 border-2 border-blue-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white transition-all"
            >
              <option value="">🔍 Search all documents</option>
              {documents.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  📄 {doc.filename} ({doc.total_pages} pages)
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex gap-3">
          <div className="flex-1 relative group">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-6 h-6 text-blue-400 group-focus-within:text-blue-600 transition-colors" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="What are you looking for?"
              className="w-full pl-14 pr-4 py-4 border-2 border-blue-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-lg transition-all shadow-sm focus:shadow-lg"
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={!searchQuery.trim() || searching}
            className="px-8 py-4 bg-gradient-to-r from-blue-600 to-blue-600 text-white rounded-xl font-bold hover:from-blue-700 hover:to-blue-700 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl transform hover:scale-105 disabled:hover:scale-100"
          >
            {searching ? (
              <div className="flex items-center gap-2">
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent" />
                <span>AI Searching...</span>
              </div>
            ) : (
              'Search'
            )}
          </button>
        </div>

        {documents.length === 0 && !loading && (
          <div className="mt-8 p-8 bg-gradient-to-br from-blue-50 to-cyan-50 rounded-2xl border-2 border-dashed border-blue-300 text-center">
            <div className="inline-block p-4 bg-white rounded-full shadow-lg mb-4">
              <AlertCircle className="w-12 h-12 text-blue-500" />
            </div>
            <p className="text-lg font-bold text-gray-900 mb-2">No Documents Yet</p>
            <p className="text-gray-600 mb-4">
              Upload your first PDF to start searching with AI-powered semantic understanding
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6 text-left">
              <div className="p-4 bg-white rounded-lg shadow-sm">
                <div className="font-semibold text-blue-600 mb-1">Semantic Understanding</div>
                <p className="text-sm text-gray-600">Finds meaning, not just keywords</p>
              </div>
              <div className="p-4 bg-white rounded-lg shadow-sm">
                <div className="font-semibold text-blue-600 mb-1">Accurate Citations</div>
                <p className="text-sm text-gray-600">Every result linked to exact page</p>
              </div>
              <div className="p-4 bg-white rounded-lg shadow-sm">
                <div className="font-semibold text-blue-600 mb-1">Fast Search</div>
                <p className="text-sm text-gray-600">Instant results across all documents</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {searchResults.length > 0 && (
        <div className="bg-white rounded-xl shadow-lg p-8">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-bold text-gray-900">
              Search Results ({searchResults.length})
            </h3>
            <div className="text-sm text-gray-500 bg-blue-50 px-3 py-1 rounded-full">
              AI-ranked by relevance
            </div>
          </div>
          <div className="space-y-4">
            {searchResults.map((result, index) => (
              <div
                key={result.chunk_id}
                className="p-5 border-2 border-gray-200 rounded-xl hover:border-blue-400 hover:shadow-md transition-all duration-200"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-8 h-8 bg-blue-100 text-blue-700 font-bold rounded-full text-sm">
                      {index + 1}
                    </div>
                    <FileText className="w-5 h-5 text-blue-600" />
                    <span className="font-medium text-gray-900">{result.filename}</span>
                    <span className="px-3 py-1 bg-blue-100 text-blue-700 text-xs font-semibold rounded-full">
                      Page {result.page_number}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 px-3 py-1 bg-green-50 text-green-700 rounded-full text-sm font-medium">
                    <Quote className="w-4 h-4" />
                    <span>{(result.similarity * 100).toFixed(0)}%</span>
                  </div>
                </div>
                <p
                  className="text-gray-700 leading-relaxed mb-3 pl-11"
                  dangerouslySetInnerHTML={{
                    __html: highlightText(result.content, searchQuery),
                  }}
                />
                <div className="mt-3 pt-3 border-t border-gray-100 pl-11">
                  <p className="text-xs text-gray-500">
                    <strong>Citation:</strong> {result.filename}, Page {result.page_number}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {documents.length > 0 && (
        <div className="bg-white rounded-xl shadow-lg p-8">
          <h3 className="text-xl font-bold text-gray-900 mb-4">Your Documents</h3>
          <div className="space-y-2">
            {documents.map((doc) => {
              const embeddingCount = documentEmbeddings[doc.id] || 0;
              const needsEmbeddings = embeddingCount === 0;

              return (
                <div
                  key={doc.id}
                  className={`flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 transition-colors ${
                    needsEmbeddings ? 'border-orange-300 bg-orange-50' : 'border-gray-200'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <FileText className="w-5 h-5 text-red-500" />
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-900">{doc.filename}</p>
                        {needsEmbeddings && (
                          <span className="px-2 py-0.5 bg-orange-100 text-orange-700 text-xs font-semibold rounded-full">
                            AI Index Needed
                          </span>
                        )}
                        {!needsEmbeddings && (
                          <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-semibold rounded-full">
                            ✓ Ready
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500">
                        {doc.total_pages} pages • {doc.file_size_mb?.toFixed(2)} MB •{' '}
                        {new Date(doc.created_at).toLocaleDateString()}
                        {!needsEmbeddings && ` • ${embeddingCount} chunks indexed`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleRegenerateIndex(doc.id)}
                      disabled={loading}
                      className={`p-2 transition-colors disabled:opacity-50 ${
                        needsEmbeddings
                          ? 'text-orange-500 hover:text-orange-600 animate-pulse'
                          : 'text-gray-400 hover:text-blue-500'
                      }`}
                      title={needsEmbeddings ? 'Click to generate AI index (required for search)' : 'Regenerate AI index'}
                    >
                      <RefreshCw className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => handleDelete(doc.id)}
                      className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                      title="Delete document"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
