import { useRef, useState } from 'react';
import { Upload, FileText, X, GripVertical, ArrowUp, ArrowDown } from 'lucide-react';

interface FileUploadProps {
  onFilesSelected: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  maxFiles?: number;
}

export function FileUpload({
  onFilesSelected,
  accept = 'application/pdf',
  multiple = true,
  maxFiles = 10,
}: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files).filter(
      (file) => file.type === 'application/pdf'
    );

    if (files.length > maxFiles) {
      alert(`Maximum ${maxFiles} files allowed`);
      return;
    }

    setSelectedFiles(files);
    onFilesSelected(files);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);

    if (files.length > maxFiles) {
      alert(`Maximum ${maxFiles} files allowed`);
      return;
    }

    setSelectedFiles(files);
    onFilesSelected(files);
  };

  const removeFile = (index: number) => {
    const newFiles = selectedFiles.filter((_, i) => i !== index);
    setSelectedFiles(newFiles);
    onFilesSelected(newFiles);
  };

  const moveFile = (fromIndex: number, toIndex: number) => {
    const newFiles = [...selectedFiles];
    const [movedFile] = newFiles.splice(fromIndex, 1);
    newFiles.splice(toIndex, 0, movedFile);
    setSelectedFiles(newFiles);
    onFilesSelected(newFiles);
  };

  const handleFileDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleFileDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    moveFile(draggedIndex, index);
    setDraggedIndex(index);
  };

  const handleFileDragEnd = () => {
    setDraggedIndex(null);
  };

  return (
    <div className="w-full">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all duration-300 ${
          isDragging
            ? 'border-blue-500 bg-gradient-to-br from-blue-50 to-blue-100 scale-105 shadow-lg'
            : 'border-gray-300 hover:border-blue-400 hover:bg-gradient-to-br hover:from-gray-50 hover:to-blue-50 hover:shadow-md'
        }`}
      >
        <div className={`transition-transform duration-300 ${isDragging ? 'scale-110' : ''}`}>
          <Upload
            className={`w-16 h-16 mx-auto mb-4 transition-all duration-300 ${
              isDragging ? 'text-blue-600 animate-bounce' : 'text-gray-400'
            }`}
          />
          <h3 className="text-xl font-bold text-gray-900 mb-2">
            {isDragging ? 'Drop your PDFs here!' : 'Drop PDF files here or click to browse'}
          </h3>
          <p className="text-sm text-gray-600">
            {multiple ? `Upload up to ${maxFiles} PDF files • Drag to reorder` : 'Upload a PDF file'}
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={handleFileInput}
          className="hidden"
        />
      </div>

      {selectedFiles.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-lg font-bold text-gray-900">
              Selected Files ({selectedFiles.length})
            </h4>
            <p className="text-sm text-gray-500">
              Drag files to reorder for merge
            </p>
          </div>
          <div className="space-y-3">
            {selectedFiles.map((file, index) => (
              <div
                key={index}
                draggable
                onDragStart={(e) => handleFileDragStart(e, index)}
                onDragOver={(e) => handleFileDragOver(e, index)}
                onDragEnd={handleFileDragEnd}
                className={`group flex items-center gap-3 p-4 bg-white rounded-xl border-2 transition-all duration-200 cursor-move ${
                  draggedIndex === index
                    ? 'border-blue-500 shadow-lg scale-105 opacity-50'
                    : 'border-gray-200 hover:border-blue-300 hover:shadow-md'
                }`}
              >
                <div className="flex items-center gap-2 text-gray-400 group-hover:text-blue-600 transition-colors">
                  <GripVertical className="w-5 h-5" />
                  <span className="text-sm font-bold text-blue-600 bg-blue-100 px-2 py-1 rounded">
                    {index + 1}
                  </span>
                </div>

                <FileText className="w-8 h-8 text-red-500 flex-shrink-0" />

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{file.name}</p>
                  <p className="text-xs text-gray-500">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (index > 0) moveFile(index, index - 1);
                    }}
                    disabled={index === 0}
                    className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Move up"
                  >
                    <ArrowUp className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (index < selectedFiles.length - 1) moveFile(index, index + 1);
                    }}
                    disabled={index === selectedFiles.length - 1}
                    className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Move down"
                  >
                    <ArrowDown className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(index);
                    }}
                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    title="Remove"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
