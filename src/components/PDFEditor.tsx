import { useState } from 'react';
import {
  Merge,
  RotateCw,
  Hash,
  Type,
  X,
  GripVertical,
} from 'lucide-react';
import { FileUpload } from './FileUpload';
import { mergePDFsServer, rotatePDFServer, addPageNumbersServer, addHeaderFooterServer, downloadUint8Array } from '../lib/pdfService';
import { useAuth } from '../lib/auth';
import { HeaderFooterModal, HeaderFooterOptions } from './HeaderFooterModal';

interface PDFEditorProps {
  onToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

export function PDFEditor({ onToast }: PDFEditorProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [processing, setProcessing] = useState(false);
  const [operation, setOperation] = useState<string>('');
  const [headerFooterModalOpen, setHeaderFooterModalOpen] = useState(false);
  const { user } = useAuth();

  const handleFilesSelected = (selectedFiles: File[]) => {
    setFiles(selectedFiles);
  };

  const handleRemoveFile = (index: number) => {
    setFiles(files.filter((_, i) => i !== index));
  };

  const handleMerge = async () => {
    if (files.length < 2) {
      onToast('Please select at least 2 PDF files to merge', 'error');
      return;
    }

    try {
      setProcessing(true);
      setOperation(`Merging ${files.length} files...`);

      const result = await mergePDFsServer(files);

      if (!result.success || !result.data) {
        throw new Error(result.error || 'Merge operation failed');
      }

      downloadUint8Array(result.data, 'merged.pdf');
      onToast(`Successfully merged ${files.length} PDF files!`, 'success');
      setFiles([]);
    } catch (error: any) {
      console.error('Merge error:', error);
      onToast(`Merge failed: ${error.message || 'Unknown error'}`, 'error');
    } finally {
      setProcessing(false);
      setOperation('');
    }
  };

  const handleAddPageNumbers = async () => {
    if (files.length !== 1) {
      onToast('Please select exactly one PDF file to add page numbers', 'error');
      return;
    }

    try {
      setProcessing(true);
      setOperation('Adding page numbers...');

      const result = await addPageNumbersServer(files[0], {
        position: 'bottom-center',
        format: 'Page {n}',
      });

      if (!result.success || !result.data) {
        throw new Error(result.error || 'Operation failed');
      }

      downloadUint8Array(result.data, `paginated-${files[0].name}`);
      onToast('Successfully added page numbers!', 'success');
      setFiles([]);
    } catch (error: any) {
      onToast(`Failed: ${error.message}`, 'error');
    } finally {
      setProcessing(false);
      setOperation('');
    }
  };

  const handleRotate = async () => {
    if (files.length !== 1) {
      onToast('Please select exactly 1 PDF file', 'error');
      return;
    }

    try {
      setProcessing(true);
      setOperation('Rotating pages...');

      const result = await rotatePDFServer(files[0], [1], 90);

      if (!result.success || !result.data) {
        throw new Error(result.error || 'Rotation failed');
      }

      downloadUint8Array(result.data, `rotated-${files[0].name}`);
      onToast('Pages rotated successfully!', 'success');
      setFiles([]);
    } catch (error: any) {
      onToast(`Failed to rotate: ${error.message}`, 'error');
    } finally {
      setProcessing(false);
      setOperation('');
    }
  };

  const handleHeaderFooter = async (options: HeaderFooterOptions) => {
    if (files.length !== 1) {
      onToast('Please select exactly 1 PDF file', 'error');
      return;
    }

    try {
      setProcessing(true);
      setOperation('Adding header/footer...');

      const result = await addHeaderFooterServer(files[0], options);

      if (!result.success || !result.data) {
        throw new Error(result.error || 'Adding header/footer failed');
      }

      downloadUint8Array(result.data, `edited-${files[0].name}`);
      onToast('Header/footer added successfully!', 'success');
      setFiles([]);
    } catch (error: any) {
      onToast(`Failed to add header/footer: ${error.message}`, 'error');
    } finally {
      setProcessing(false);
      setOperation('');
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="bg-gradient-to-br from-white via-blue-50 to-white rounded-2xl shadow-2xl p-8 border border-blue-100">
        <div className="mb-8 text-center">
          <h2 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-3">
            Transform Your PDFs
          </h2>
          <p className="text-gray-600 text-lg">
            Upload, reorder, and edit your documents with powerful tools
          </p>
        </div>

        <FileUpload onFilesSelected={handleFilesSelected} />

        {files.length > 0 && (
          <div className="mt-8 animate-fadeIn">
            <div className="mb-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-gray-900">
                  Selected Files ({files.length})
                </h3>
                <span className="text-sm text-gray-500">
                  {files.length > 1 ? 'Drag to reorder for merge' : ''}
                </span>
              </div>

              <div className="space-y-3 max-h-48 overflow-y-auto bg-gray-50 rounded-xl p-4">
                {files.map((file, index) => (
                  <div
                    key={index}
                    className="group flex items-center gap-4 p-4 bg-white rounded-lg shadow-sm border border-gray-200 hover:border-blue-300 hover:shadow-md transition-all"
                  >
                    {files.length > 1 && (
                      <GripVertical className="w-5 h-5 text-gray-400 cursor-move opacity-0 group-hover:opacity-100 transition-opacity" />
                    )}
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                        <span className="text-sm font-bold text-blue-600">{index + 1}</span>
                      </div>
                      <div className="text-red-500 flex-shrink-0">
                        <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/>
                        </svg>
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate" title={file.name}>
                        {file.name}
                      </p>
                      <p className="text-sm text-gray-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                    <button
                      onClick={() => handleRemoveFile(index)}
                      className="flex-shrink-0 p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                      title="Remove file"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-8 pt-8 border-t-2 border-gray-200">
              <div className="text-center mb-6">
                <h3 className="text-2xl font-bold text-gray-900 mb-2">
                  Choose Your Operation
                </h3>
                <p className="text-gray-600">
                  {files.length === 1
                    ? 'Select what you want to do with your PDF'
                    : `${files.length} files ready • Use merge to combine them`}
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              <button
                onClick={handleMerge}
                disabled={processing || files.length < 2}
                className="group relative flex flex-col items-center gap-4 p-8 bg-gradient-to-br from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-300 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
              >
                <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 rounded-2xl transition-opacity" />
                <Merge className="w-12 h-12 text-white" />
                <span className="text-base font-bold text-white">Merge PDFs</span>
                <span className="text-xs text-blue-100">Combine files</span>
              </button>

              <button
                onClick={handleAddPageNumbers}
                disabled={processing || files.length !== 1}
                className="group relative flex flex-col items-center gap-4 p-8 bg-gradient-to-br from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-300 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
              >
                <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 rounded-2xl transition-opacity" />
                <Hash className="w-12 h-12 text-white" />
                <span className="text-base font-bold text-white">Page Numbers</span>
                <span className="text-xs text-green-100">Add pagination</span>
              </button>

              <button
                onClick={handleRotate}
                disabled={processing || files.length !== 1}
                className="group relative flex flex-col items-center gap-4 p-8 bg-gradient-to-br from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-300 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
              >
                <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 rounded-2xl transition-opacity" />
                <RotateCw className="w-12 h-12 text-white" />
                <span className="text-base font-bold text-white">Rotate Pages</span>
                <span className="text-xs text-amber-100">Fix orientation</span>
              </button>

              <button
                onClick={() => setHeaderFooterModalOpen(true)}
                disabled={processing || files.length !== 1}
                className="group relative flex flex-col items-center gap-4 p-8 bg-gradient-to-br from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-300 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
              >
                <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 rounded-2xl transition-opacity" />
                <Type className="w-12 h-12 text-white" />
                <span className="text-base font-bold text-white">Header/Footer</span>
                <span className="text-xs text-purple-100">Customize</span>
              </button>
              </div>
            </div>
          </div>
        )}

        {processing && (
          <div className="mt-10 p-8 bg-gradient-to-r from-blue-500 to-purple-600 rounded-2xl shadow-lg">
            <div className="flex items-center gap-6">
              <div className="relative">
                <div className="animate-spin rounded-full h-16 w-16 border-4 border-white border-t-transparent"></div>
                <div className="absolute inset-0 rounded-full bg-white opacity-20 animate-ping"></div>
              </div>
              <div className="flex-1">
                <p className="text-xl font-bold text-white mb-2">{operation}</p>
                <div className="w-full bg-white bg-opacity-20 rounded-full h-2 overflow-hidden">
                  <div className="h-full bg-white rounded-full animate-pulse" style={{ width: '60%' }}></div>
                </div>
                <p className="text-sm text-blue-100 mt-2">Processing entirely in your browser for maximum privacy and speed.</p>
              </div>
            </div>
          </div>
        )}
      </div>

      <HeaderFooterModal
        isOpen={headerFooterModalOpen}
        onClose={() => setHeaderFooterModalOpen(false)}
        onApply={handleHeaderFooter}
        onApplyPageNumbers={() => {}}  // Will add page number support when implemented
      />
    </div>
  );

}
