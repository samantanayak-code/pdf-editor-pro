import { useState, useRef, useEffect } from 'react';
import {
  Upload,
  Download,
  Type,
  MousePointer,
  Hand,
  ZoomIn,
  ZoomOut,
  Undo,
  Redo,
  Bold,
  Italic,
  Underline,
  Loader2,
  Trash2,
  ChevronLeft,
  ChevronRight,
  PanelLeft,
  RotateCw,
  Plus,
  LayoutGrid,
  FileText,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import {
  loadPDFDocument,
  renderPDFPage,
  exportEditedPDF,
  PDFDocumentState,
  TextElement,
  EditMode,
  findTextElementAt,
  updateTextElement,
  deleteTextElement,
  generateThumbnail,
  deletePages,
  reorderPages,
  replacePage,
} from '../lib/pdfEditorPro';
import { mergeClientSide } from '../lib/pdf/clientMerge';
import { DocumentModel, TextBox, Paragraph, TextSpan, generateId } from '../lib/model';
import { pdfToDocumentModel } from '../lib/pdf/extractToModel';
import { layoutTextBox } from '../lib/pdf/layoutEngine';
import { addHeaderFooter } from '../lib/pdf/headerFooter';
import { addPageNumbers } from '../lib/pdf/paginate';
import { HeaderFooterModal, HeaderFooterOptions, PageNumberOptions } from './HeaderFooterModal';

interface PDFEditorProProps {
  onToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

export function PDFEditorPro({ onToast }: PDFEditorProProps) {
  const { user } = useAuth();
  const [view, setView] = useState<'editor' | 'merger'>('editor');
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentState | null>(null);
  const [docModel, setDocModel] = useState<DocumentModel | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1.0);
  const [editMode, setEditMode] = useState<EditMode>('select');
  const [selectedElement, setSelectedElement] = useState<TextElement | null>(null);
  const [editingElement, setEditingElement] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [history, setHistory] = useState<PDFDocumentState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  
  // Merger State
  const [mergeFiles, setMergeFiles] = useState<File[]>([]);
  
  // Page Management State
  const [draggedPage, setDraggedPage] = useState<number | null>(null);
  const [isReplaceModalOpen, setIsReplaceModalOpen] = useState(false);
  const [targetReplacePage, setTargetReplacePage] = useState<number | null>(null);
  const [replacementFile, setReplacementFile] = useState<File | null>(null);
  const [sourceReplacePageNum, setSourceReplacePageNum] = useState(1);

  // Header/Footer & Page Numbers
  const [isHFModalOpen, setIsHFModalOpen] = useState(false);

  // Drawing Text Box State
  const [isDrawingBox, setIsDrawingBox] = useState(false);
  const [boxStartPos, setBoxStartPos] = useState({ x: 0, y: 0 });
  const [boxCurrentPos, setBoxCurrentPos] = useState({ x: 0, y: 0 });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const originalBytesRef = useRef<Uint8Array | null>(null);

  // Helper to safely get original bytes (ONLY from ref, never from pdfDoc state)
  const getOriginalBytes = (): Uint8Array | null => {
    return originalBytesRef.current;
  };

  // Helper to create document with original bytes
  const getDocWithBytes = (): PDFDocumentState | null => {
    if (!pdfDoc) return null;
    const originalBytes = getOriginalBytes();
    if (!originalBytes || originalBytes.length === 0) return null;

    return {
      ...pdfDoc,
      originalBytes,
    };
  };

  const renderPage = async (docOverride?: PDFDocumentState) => {
    const doc = docOverride ?? pdfDoc;
    if (!doc || !canvasRef.current) return;
    try {
      await renderPDFPage(doc, currentPage, canvasRef.current, zoom);
    } catch (error) {
      console.error('Error rendering page:', error);
    }
  };

  useEffect(() => {
    if (pdfDoc && canvasRef.current) {
      requestAnimationFrame(() => renderPage());
    }
  }, [pdfDoc, currentPage, zoom, selectedElement]);

  const generateAllThumbnails = async (doc: PDFDocumentState) => {
    const thumbs: string[] = [];
    for (let i = 1; i <= doc.totalPages; i++) {
      try {
        const thumb = await generateThumbnail(doc, i);
        thumbs.push(thumb);
      } catch (e) {
        console.error(`Failed to generate thumbnail for page ${i}`, e);
        thumbs.push('');
      }
    }
    setThumbnails(thumbs);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf') {
      onToast('Please select a PDF file', 'error');
      return;
    }

    try {
      setLoading(true);
      const doc = await loadPDFDocument(file, file.name);

      originalBytesRef.current = doc.originalBytes;

      const docForHistory = {
        ...doc,
        originalBytes: new Uint8Array(0),
      };

      setPdfDoc(doc);
      setCurrentPage(1);
      setHistory([docForHistory]);
      setHistoryIndex(0);
      onToast(`Loaded ${doc.totalPages} pages successfully`, 'success');
      
      // Initialize structured model for Phase 1 reflow editing
      const model = await pdfToDocumentModel(file, file.name);
      setDocModel(model);
      
      await generateAllThumbnails(doc);

      // Pass doc directly to bypass the stale-closure problem:
      // at this point setPdfDoc(doc) has been called but React hasn't
      // re-rendered yet, so pdfDoc inside renderPage() is still null.
      requestAnimationFrame(() => renderPage(doc));
    } catch (error: any) {
      onToast(`Failed to load PDF: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDeletePage = async (pageNum: number) => {
    if (!pdfDoc || pdfDoc.totalPages <= 1) {
      onToast('Cannot delete the last page', 'error');
      return;
    }

    try {
      setLoading(true);
      const docWithBytes = getDocWithBytes();
      if (!docWithBytes) throw new Error('Original bytes not found');

      const newDoc = await deletePages(docWithBytes, [pageNum]);
      originalBytesRef.current = newDoc.originalBytes;
      
      saveToHistory(newDoc);
      if (currentPage >= pageNum && currentPage > 1) {
        setCurrentPage(currentPage - 1);
      }
      onToast(`Page ${pageNum} deleted`, 'success');
      generateAllThumbnails(newDoc);
    } catch (error: any) {
      onToast(`Failed to delete page: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleApplyHeaderFooter = async (options: HeaderFooterOptions) => {
    const originalBytes = getOriginalBytes();
    if (!originalBytes || !pdfDoc) {
      onToast('No PDF loaded', 'error');
      return;
    }
    try {
      setLoading(true);
      // Slice a fresh ArrayBuffer copy — the .buffer property of a Uint8Array
      // subarray is the FULL underlying buffer, which causes pdf-lib to read
      // garbage bytes if the Uint8Array has a non-zero byteOffset.
      const freshBuffer = originalBytes.buffer.slice(
        originalBytes.byteOffset,
        originalBytes.byteOffset + originalBytes.byteLength
      );
      const result = await addHeaderFooter(freshBuffer, {
        ...options,
        fileName: pdfDoc.filename,
      });
      if (!result.success || !result.data) throw new Error(result.error || 'Failed');
      const newDoc = await loadPDFDocument(result.data, pdfDoc.filename);
      originalBytesRef.current = newDoc.originalBytes;
      saveToHistory(newDoc);
      await generateAllThumbnails(newDoc);
      onToast('Header/footer applied to all pages', 'success');
    } catch (e: any) {
      onToast(`Header/footer failed: ${e.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleApplyPageNumbers = async (options: PageNumberOptions) => {
    const originalBytes = getOriginalBytes();
    if (!originalBytes || !pdfDoc) {
      onToast('No PDF loaded', 'error');
      return;
    }
    try {
      setLoading(true);
      const freshBuffer = originalBytes.buffer.slice(
        originalBytes.byteOffset,
        originalBytes.byteOffset + originalBytes.byteLength
      );
      const excludePages = options.excludeFirstPage ? [1] : [];
      const result = await addPageNumbers(freshBuffer, {
        format: options.format,
        startNumber: options.startNumber,
        position: options.position,
        fontSize: options.fontSize,
        color: options.color,
        excludePages,
        marginX: options.marginX,
        marginY: options.marginY,
      });
      if (!result.success || !result.data) throw new Error(result.error || 'Failed');
      const newDoc = await loadPDFDocument(result.data, pdfDoc.filename);
      originalBytesRef.current = newDoc.originalBytes;
      saveToHistory(newDoc);
      await generateAllThumbnails(newDoc);
      onToast('Page numbers added to all pages', 'success');
    } catch (e: any) {
      onToast(`Page numbers failed: ${e.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    if (!pdfDoc) return;

    const originalBytes = getOriginalBytes();

    console.log('Export attempt - Ref bytes:', originalBytes?.length);

    if (!originalBytes || originalBytes.length === 0) {
      console.error('Export failed - no originalBytes available');
      onToast('No original PDF data available. Please reload the document.', 'error');
      return;
    }

    try {
      // Always use exportEditedPDF — it is the only path that uses el.pdfY
      // (raw PDF-space coordinates from transform[5]) for both redaction and
      // text placement, so positioning is always correct regardless of page size.
      // exportStructuredPDF uses CSS-space baselineY which causes scrambling.
      const docWithBytes = {
        ...pdfDoc,
        originalBytes,
      };
      const pdfBytes = await exportEditedPDF(docWithBytes);

      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;

      let safeFilename = pdfDoc.filename || 'document.pdf';
      if (!safeFilename.toLowerCase().endsWith('.pdf')) {
        safeFilename += '.pdf';
      }

      a.download = `edited-${safeFilename}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setTimeout(() => URL.revokeObjectURL(url), 1000);
      onToast('PDF exported successfully', 'success');
    } catch (error: any) {
      onToast(`Export failed: ${error.message}`, 'error');
    } finally {
      setExporting(false);
    }
  };

  const handleZoomIn = () => {
    setZoom((prev) => Math.min(prev + 0.25, 3.0));
  };

  const handleZoomOut = () => {
    setZoom((prev) => Math.max(prev - 0.25, 0.5));
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      const originalBytes = getOriginalBytes();
      if (!originalBytes) {
        onToast('Cannot undo: original PDF data not available', 'error');
        return;
      }

      setHistoryIndex(historyIndex - 1);
      const docWithBytes = {
        ...history[historyIndex - 1],
        originalBytes,
      };
      setPdfDoc(docWithBytes);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const originalBytes = getOriginalBytes();
      if (!originalBytes) {
        onToast('Cannot redo: original PDF data not available', 'error');
        return;
      }

      setHistoryIndex(historyIndex + 1);
      const docWithBytes = {
        ...history[historyIndex + 1],
        originalBytes,
      };
      setPdfDoc(docWithBytes);
    }
  };

  const saveToHistory = (newDoc: PDFDocumentState) => {
    const newHistory = history.slice(0, historyIndex + 1);
    // Don't store originalBytes in history to save memory - we keep it in ref
    const docForHistory = {
      ...newDoc,
      originalBytes: new Uint8Array(0), // Empty array to maintain type structure
    };
    newHistory.push(docForHistory);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    setPdfDoc(newDoc);
  };

  const handleMergeFiles = async (mode: 'open' | 'download') => {
    if (mergeFiles.length === 0) return;
    
    try {
      setLoading(true);
      const result = await mergeClientSide(mergeFiles);
      
      if (mode === 'download') {
        const blob = new Blob([result.pdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `merged-${Date.now()}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
        onToast('PDFs merged and downloaded', 'success');
      } else {
        const doc = await loadPDFDocument(result.pdfBytes, `merged-${Date.now()}.pdf`);
        originalBytesRef.current = doc.originalBytes;
        saveToHistory(doc);
        setView('editor');
        onToast('PDFs merged and opened in editor', 'success');
      }
    } catch (error: any) {
      onToast(`Merge failed: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handlePageDrop = async (e: React.DragEvent, targetPage: number) => {
    e.preventDefault();
    if (draggedPage === null || draggedPage === targetPage) return;
    
    try {
      setLoading(true);
      const docWithBytes = getDocWithBytes();
      if (!docWithBytes) throw new Error('Original bytes not found');
      
      const pageOrder = Array.from({ length: docWithBytes.totalPages }, (_, i) => i + 1);
      const fromIdx = draggedPage - 1;
      const toIdx = targetPage - 1;
      
      const [removed] = pageOrder.splice(fromIdx, 1);
      pageOrder.splice(toIdx, 0, removed);
      
      const newDoc = await reorderPages(docWithBytes, pageOrder);
      originalBytesRef.current = newDoc.originalBytes;
      saveToHistory(newDoc);
      setCurrentPage(targetPage);
      onToast(`Page moved from ${draggedPage} to ${targetPage}`, 'success');
      generateAllThumbnails(newDoc);
    } catch (error: any) {
      onToast(`Failed to move page: ${error.message}`, 'error');
    } finally {
      setLoading(false);
      setDraggedPage(null);
    }
  };

  const handleReplacePage = async () => {
    if (!pdfDoc || !targetReplacePage || !replacementFile) return;
    
    try {
      setLoading(true);
      const docWithBytes = getDocWithBytes();
      if (!docWithBytes) throw new Error('Original bytes not found');
      
      const newDoc = await replacePage(
        docWithBytes,
        targetReplacePage,
        replacementFile,
        sourceReplacePageNum
      );
      
      originalBytesRef.current = newDoc.originalBytes;
      saveToHistory(newDoc);
      onToast(`Page ${targetReplacePage} replaced`, 'success');
      generateAllThumbnails(newDoc);
      setIsReplaceModalOpen(false);
      setReplacementFile(null);
    } catch (error: any) {
      onToast(`Failed to replace page: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!pdfDoc || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;

    const pageData = pdfDoc.pages.get(currentPage);
    if (!pageData) return;

    if (editMode === 'select' || editMode === 'text') {
      let element = findTextElementAt(pageData, x, y, 1.0);

      // Handle Triple Click -> Select/Merge entire line
      if (e.detail === 3 && element) {
        const lineElements = pageData.textElements
          .filter(el => Math.abs(el.baselineY - element!.baselineY) < 2 && !el.deleted)
          .sort((a, b) => a.x - b.x);
        
        if (lineElements.length > 1) {
          const mergedText = lineElements.map(el => el.text).join(' ');
          const minX = Math.min(...lineElements.map(el => el.x));
          const maxX = Math.max(...lineElements.map(el => el.x + el.width));
          const constituentIds = lineElements.filter(el => el.id !== element!.id).map(el => el.id);
          
          element = {
            ...element,
            text: mergedText,
            x: minX,
            width: maxX - minX,
          };
          (element as any).constituentIds = constituentIds;
        }
      }

      if (element) {
        setSelectedElement(element);
        if (editMode === 'text') {
          setEditingElement(element.id);
          setEditText(element.text);
          setTimeout(() => {
            const domEl = document.getElementById(element!.id);
            if (domEl) {
              domEl.focus();
            }
          }, 20);
        }
      } else {
        if (editMode === 'text') {
          if (editingElement) {
            // Clicked away while editing -> blur active element
            const domEl = document.getElementById(editingElement);
            if (domEl) {
              domEl.blur();
            }
            setSelectedElement(null);
            setEditingElement(null);
          }
        } else {
          setSelectedElement(null);
          setEditingElement(null);
        }
      }
    } else if (editMode === 'pan') {
      setSelectedElement(null);
      setEditingElement(null);
    }
  };

  const handleCanvasDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!pdfDoc || !canvasRef.current || editMode !== 'text') return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;

    const pageData = pdfDoc.pages.get(currentPage);
    if (!pageData) return;

    const element = findTextElementAt(pageData, x, y, 1.0);
    if (!element) {
      // Double clicked empty space -> create new text element of default size
      const docWithBytes = getDocWithBytes();
      if (docWithBytes) {
        const newId = `token-new-${Date.now()}`;
        const newEl: TextElement = {
          id: newId,
          text: 'Type text...',
          x: x - 60,
          y: y - 10,
          baselineY: y + 6,
          pdfY: 0,
          width: 120,
          height: 20,
          fontSize: 12,
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontFamilyCategory: 'sans',
          color: { r: 0, g: 0, b: 0 },
          page: currentPage,
          transform: [1, 0, 0, 1, x - 60, y + 6],
          bold: false,
          italic: false,
          modified: true,
          isNew: true,
        };

        const newPages = new Map(docWithBytes.pages);
        const pageData = newPages.get(currentPage);
        if (pageData) {
          newPages.set(currentPage, {
            ...pageData,
            textElements: [...pageData.textElements, newEl],
          });
        }

        const newDoc = {
          ...docWithBytes,
          pages: newPages,
        };

        saveToHistory(newDoc);
        setSelectedElement(newEl);
        setEditingElement(newId);
        setEditText('Type text...');

        setTimeout(() => {
          const domEl = document.getElementById(newId);
          if (domEl) {
            domEl.focus();
            const range = document.createRange();
            range.selectNodeContents(domEl);
            const sel = window.getSelection();
            if (sel) {
              sel.removeAllRanges();
              sel.addRange(range);
            }
          }
        }, 50);
      }
    }
  };

  const handleTextBlurWithVal = (elementId: string, val: string) => {
    if (!pdfDoc) {
      setEditingElement(null);
      return;
    }

    const docWithBytes = getDocWithBytes();
    if (!docWithBytes) {
      onToast('Cannot save changes: original PDF data not available', 'error');
      setEditingElement(null);
      return;
    }

    const trimmedVal = val.trim();
    if (trimmedVal === '' || trimmedVal === 'Type text...') {
      // Check if this element is brand new
      const pageData = pdfDoc.pages.get(currentPage);
      const currentElement = pageData?.textElements.find(el => el.id === elementId);

      if (currentElement?.isNew) {
        // Remove completely from the element list so it vanishes with no background mask
        const newPages = new Map(docWithBytes.pages);
        const pageData = newPages.get(currentPage);
        if (pageData) {
          newPages.set(currentPage, {
            ...pageData,
            textElements: pageData.textElements.filter(el => el.id !== elementId),
          });
        }
        const newDoc = { ...docWithBytes, pages: newPages };
        saveToHistory(newDoc);
        setSelectedElement(null);
      } else {
        // Original text deleted -> mark deleted for export redaction
        const newDoc = deleteTextElement(docWithBytes, elementId);
        saveToHistory(newDoc);
        setSelectedElement(null);
      }
    } else {
      const pageData = pdfDoc.pages.get(currentPage);
      const currentElement = pageData?.textElements.find(el => el.id === elementId);

      if (currentElement && trimmedVal !== currentElement.text) {
        let newWidth = currentElement.width;
        const measureCanvas = document.createElement('canvas');
        const ctx = measureCanvas.getContext('2d');
        if (ctx) {
          let cssFontFamily = 'sans-serif';
          if (currentElement.fontFamilyCategory === 'serif') cssFontFamily = '"Times New Roman", Times, serif';
          else if (currentElement.fontFamilyCategory === 'mono') cssFontFamily = '"Courier New", Courier, monospace';
          else cssFontFamily = 'Arial, Helvetica, sans-serif';

          const fontStyle = `${currentElement.bold ? 'bold ' : ''}${currentElement.italic ? 'italic ' : ''}`;
          ctx.font = `${fontStyle}${currentElement.fontSize}px ${cssFontFamily}`;
          newWidth = ctx.measureText(trimmedVal).width;
        }

        let newDoc = docWithBytes;
        const constituentIds = (currentElement as any).constituentIds;
        if (constituentIds && Array.isArray(constituentIds)) {
          constituentIds.forEach(cId => {
            newDoc = deleteTextElement(newDoc, cId);
          });
        }

        newDoc = updateTextElement(newDoc, elementId, { text: trimmedVal, width: newWidth });
        saveToHistory(newDoc);

        const updatedPageData = newDoc.pages.get(currentPage);
        if (updatedPageData) {
          const updatedElement = updatedPageData.textElements.find((el) => el.id === elementId);
          if (updatedElement) {
            setSelectedElement(updatedElement);
          }
        }
      }
    }

    setEditingElement(null);
  };

  const handleDeleteElement = () => {
    if (!pdfDoc || !selectedElement) return;

    const docWithBytes = getDocWithBytes();
    if (!docWithBytes) {
      onToast('Cannot delete: original PDF data not available', 'error');
      return;
    }

    const newDoc = deleteTextElement(docWithBytes, selectedElement.id);
    saveToHistory(newDoc);
    setSelectedElement(null);
    setEditingElement(null);
  };

  const handleTextFormatting = (format: 'bold' | 'italic' | 'underline') => {
    if (!pdfDoc || !selectedElement) return;

    const docWithBytes = getDocWithBytes();
    if (!docWithBytes) {
      onToast('Cannot format: original PDF data not available', 'error');
      return;
    }

    const updates: Partial<TextElement> = {
      [format]: !selectedElement[format],
    };

    const newDoc = updateTextElement(docWithBytes, selectedElement.id, updates);
    saveToHistory(newDoc);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (editMode === 'pan') {
      setIsPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY });
      e.currentTarget.style.cursor = 'grabbing';
    } else if (editMode === 'text') {
      if (!pdfDoc || !canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left) / zoom;
      const y = (e.clientY - rect.top) / zoom;
      
      const pageData = pdfDoc.pages.get(currentPage);
      if (!pageData) return;

      const element = findTextElementAt(pageData, x, y, 1.0);
      if (!element) {
        // Start drawing text box
        setIsDrawingBox(true);
        setBoxStartPos({ x, y });
        setBoxCurrentPos({ x, y });
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isPanning && editorRef.current?.parentElement) {
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;

      editorRef.current.parentElement.scrollLeft -= dx;
      editorRef.current.parentElement.scrollTop -= dy;

      setPanStart({ x: e.clientX, y: e.clientY });
    } else if (isDrawingBox && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left) / zoom;
      const y = (e.clientY - rect.top) / zoom;
      setBoxCurrentPos({ x, y });
    }
  };

  const handleMouseUp = () => {
    if (isPanning && editorRef.current) {
      setIsPanning(false);
      editorRef.current.style.cursor = editMode === 'pan' ? 'grab' : 'default';
    } else if (isDrawingBox) {
      setIsDrawingBox(false);

      const left = Math.min(boxStartPos.x, boxCurrentPos.x);
      const top = Math.min(boxStartPos.y, boxCurrentPos.y);
      const width = Math.abs(boxStartPos.x - boxCurrentPos.x);
      const height = Math.abs(boxStartPos.y - boxCurrentPos.y);

      // Only create if they dragged at least 10px
      if (width > 10 && height > 10) {
        const docWithBytes = getDocWithBytes();
        if (docWithBytes) {
          const newId = `token-new-${Date.now()}`;
          const newEl: TextElement = {
            id: newId,
            text: 'Type text...',
            x: left,
            y: top,
            baselineY: top + height - 4,
            pdfY: 0,
            width: width,
            height: height,
            fontSize: Math.max(10, Math.min(height - 4, 18)),
            fontFamily: 'Arial, Helvetica, sans-serif',
            fontFamilyCategory: 'sans',
            color: { r: 0, g: 0, b: 0 },
            page: currentPage,
            transform: [1, 0, 0, 1, left, top + height - 4],
            bold: false,
            italic: false,
            modified: true,
            isNew: true,
          };

          const newPages = new Map(docWithBytes.pages);
          const pageData = newPages.get(currentPage);
          if (pageData) {
            newPages.set(currentPage, {
              ...pageData,
              textElements: [...pageData.textElements, newEl],
            });
          }

          const newDoc = {
            ...docWithBytes,
            pages: newPages,
          };

          saveToHistory(newDoc);
          setSelectedElement(newEl);
          setEditingElement(newId);
          setEditText('Type text...');

          setTimeout(() => {
            const domEl = document.getElementById(newId);
            if (domEl) {
              domEl.focus();
              const range = document.createRange();
              range.selectNodeContents(domEl);
              const sel = window.getSelection();
              if (sel) {
                sel.removeAllRanges();
                sel.addRange(range);
              }
            }
          }, 50);
        }
      }
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (editingElement) return; // Don't handle shortcuts while editing

      if (e.key === 'Delete' && selectedElement) {
        e.preventDefault();
        handleDeleteElement();
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'z':
            e.preventDefault();
            if (e.shiftKey) {
              handleRedo();
            } else {
              handleUndo();
            }
            break;
          case 'y':
            e.preventDefault();
            handleRedo();
            break;
          case 's':
            e.preventDefault();
            handleExport();
            break;
          case '+':
          case '=':
            e.preventDefault();
            handleZoomIn();
            break;
          case '-':
            e.preventDefault();
            handleZoomOut();
            break;
          case 'b':
            if (selectedElement) {
              e.preventDefault();
              handleTextFormatting('bold');
            }
            break;
          case 'i':
            if (selectedElement) {
              e.preventDefault();
              handleTextFormatting('italic');
            }
            break;
          case 'u':
            if (selectedElement) {
              e.preventDefault();
              handleTextFormatting('underline');
            }
            break;
        }
      }

      // Mode shortcuts
      switch (e.key.toLowerCase()) {
        case 'v':
          if (!e.ctrlKey && !e.metaKey) {
            setEditMode('select');
          }
          break;
        case 'h':
          if (!e.ctrlKey && !e.metaKey) {
            setEditMode('pan');
          }
          break;
        case 't':
          if (!e.ctrlKey && !e.metaKey) {
            setEditMode('text');
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [historyIndex, history, selectedElement, editingElement, editMode]);

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] bg-gray-100 overflow-hidden">
      {/* Tool Bar */}
      <div className="bg-white border-b border-gray-200 shadow-sm flex-shrink-0">
        <div className="flex items-center justify-between px-4 py-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className={`p-2 rounded-lg transition-colors ${isSidebarOpen ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-100'}`}
              title="Toggle Sidebar"
            >
              <PanelLeft className="w-5 h-5" />
            </button>
            <div className="h-6 w-px bg-gray-200 mx-1" />
            
            <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg">
              <button
                onClick={() => setView('editor')}
                className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${view === 'editor' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
              >
                EDITOR
              </button>
              <button
                onClick={() => setView('merger')}
                className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${view === 'merger' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
              >
                MERGER
              </button>
            </div>

            <div className="h-6 w-px bg-gray-200 mx-1" />

            {view === 'editor' && (
              <>
                <div className="flex items-center gap-0.5 bg-gray-100 p-1 rounded-lg">
                  <button
                    onClick={() => setEditMode('select')}
                    className={`p-1.5 rounded-md transition-all ${editMode === 'select' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                    title="Select (V)"
                  >
                    <MousePointer className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => setEditMode('pan')}
                    className={`p-1.5 rounded-md transition-all ${editMode === 'pan' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                    title="Pan (H)"
                  >
                    <Hand className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => setEditMode('text')}
                    className={`p-1.5 rounded-md transition-all ${editMode === 'text' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                    title="Edit Text (T)"
                  >
                    <Type className="w-5 h-5" />
                  </button>
                </div>

                <div className="h-6 w-px bg-gray-200 mx-1" />

                <div className="flex items-center gap-1">
                  <button
                    onClick={handleUndo}
                    disabled={historyIndex <= 0}
                    className="p-1.5 rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-30"
                    title="Undo (Ctrl+Z)"
                  >
                    <Undo className="w-5 h-5" />
                  </button>
                  <button
                    onClick={handleRedo}
                    disabled={historyIndex >= history.length - 1}
                    className="p-1.5 rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-30"
                    title="Redo (Ctrl+Y)"
                  >
                    <Redo className="w-5 h-5" />
                  </button>
                </div>

                <div className="h-6 w-px bg-gray-200 mx-1" />

                <button
                  onClick={() => setIsHFModalOpen(true)}
                  disabled={!pdfDoc}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-100 rounded-lg transition-all disabled:opacity-30"
                  title="Add Header, Footer & Page Numbers"
                >
                  <FileText className="w-4 h-4" />
                  <span className="hidden lg:inline">Hdr/Ftr</span>
                </button>
              </>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg">
              <button onClick={handleZoomOut} className="p-1 text-gray-600 hover:text-gray-900"><ZoomOut className="w-4 h-4" /></button>
              <span className="text-xs font-bold text-gray-700 min-w-[3rem] text-center">{Math.round(zoom * 100)}%</span>
              <button onClick={handleZoomIn} className="p-1 text-gray-600 hover:text-gray-900"><ZoomIn className="w-4 h-4" /></button>
            </div>

            <div className="h-6 w-px bg-gray-200 mx-1" />

            <input ref={fileInputRef} type="file" accept="application/pdf" onChange={handleFileSelect} className="hidden" />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-100 rounded-lg transition-all"
            >
              <Plus className="w-4 h-4" />
              Open
            </button>
            
            <button
              onClick={handleExport}
              disabled={!pdfDoc || exporting}
              className="flex items-center gap-2 px-4 py-1.5 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 transition-all shadow-sm disabled:opacity-50"
            >
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Export
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        {isSidebarOpen && (
          <div className="w-64 bg-white border-r border-gray-200 flex flex-col flex-shrink-0 animate-in slide-in-from-left duration-200">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <LayoutGrid className="w-4 h-4 text-blue-600" />
                Pages
              </h3>
              <span className="text-xs font-medium text-gray-400">{pdfDoc?.totalPages || 0} pages</span>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50/50">
              {pdfDoc ? (
                Array.from({ length: pdfDoc.totalPages }, (_, i) => i + 1).map((pageNum) => (
                  <div key={pageNum} className="group relative">
                    <div className="absolute -left-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-gray-400 tabular-nums">
                      {pageNum}
                    </div>
                    <button
                      draggable
                      onDragStart={() => setDraggedPage(pageNum)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => handlePageDrop(e, pageNum)}
                      onClick={() => setCurrentPage(pageNum)}
                      className={`w-full aspect-[1/1.41] bg-white rounded-lg border-2 transition-all overflow-hidden relative shadow-sm hover:shadow-md cursor-grab active:cursor-grabbing ${
                        currentPage === pageNum ? 'border-blue-500 ring-2 ring-blue-100' : 'border-transparent hover:border-gray-300'
                      } ${draggedPage === pageNum ? 'opacity-50' : ''}`}
                    >
                      {thumbnails[pageNum - 1] ? (
                        <img src={thumbnails[pageNum - 1]} alt={`Page ${pageNum}`} className="w-full h-full object-contain" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-gray-50">
                          <Loader2 className="w-4 h-4 animate-spin text-gray-300" />
                        </div>
                      )}
                      
                      {/* Page Actions Overlay */}
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5">
                        <button
                          onClick={(e) => { e.stopPropagation(); setTargetReplacePage(pageNum); setIsReplaceModalOpen(true); }}
                          className="p-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                          title="Replace Page"
                        >
                          <RotateCw className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeletePage(pageNum); }}
                          className="p-1.5 bg-red-600 text-white rounded-md hover:bg-red-700"
                          title="Delete Page"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </button>
                  </div>
                ))
              ) : (
                <div className="text-center py-10">
                  <p className="text-sm text-gray-400">No document open</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Replace Page Modal */}
        {isReplaceModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in duration-200">
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-lg font-bold text-gray-900">Replace Page {targetReplacePage}</h3>
                <button onClick={() => setIsReplaceModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                  <Plus className="w-5 h-5 rotate-45" />
                </button>
              </div>
              
              <div className="p-6 space-y-6">
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Source PDF</label>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = 'application/pdf';
                        input.onchange = (e) => setReplacementFile((e.target as HTMLInputElement).files?.[0] || null);
                        input.click();
                      }}
                      className="flex-1 px-4 py-3 border-2 border-dashed border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:border-blue-400 hover:text-blue-600 transition-all text-left truncate"
                    >
                      {replacementFile ? replacementFile.name : 'Select replacement file...'}
                    </button>
                  </div>
                </div>

                {replacementFile && (
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Source Page Index</label>
                    <div className="flex items-center gap-4">
                      <input
                        type="number"
                        min="1"
                        value={sourceReplacePageNum}
                        onChange={(e) => setSourceReplacePageNum(parseInt(e.target.value) || 1)}
                        className="flex-1 px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
                      />
                      <span className="text-xs text-gray-400 font-medium">Page {sourceReplacePageNum} of ?</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="p-6 bg-gray-50 flex gap-3">
                <button
                  onClick={() => setIsReplaceModalOpen(false)}
                  className="flex-1 px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-200 rounded-lg transition-all"
                >
                  Cancel
                </button>
                <button
                  disabled={!replacementFile}
                  onClick={handleReplacePage}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 transition-all shadow-md disabled:opacity-50"
                >
                  Confirm Replace
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Main Viewer / Merger */}
        <div className="flex-1 overflow-auto bg-gray-200 relative">
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10">
              <div className="text-center">
                <div className="relative inline-block">
                  <Loader2 className="w-12 h-12 animate-spin text-blue-600" />
                  <div className="absolute inset-0 rounded-full bg-blue-100 animate-ping opacity-25" />
                </div>
                <p className="mt-4 text-sm font-bold text-gray-900 uppercase tracking-widest">Processing...</p>
              </div>
            </div>
          ) : view === 'merger' ? (
            <div className="flex flex-col items-center justify-center min-h-full p-8">
              <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl p-8 border border-gray-200">
                <div className="flex items-center justify-between mb-8">
                  <div>
                    <h2 className="text-2xl font-bold text-gray-900">Merge PDFs</h2>
                    <p className="text-gray-500 font-medium">Combine multiple documents into one.</p>
                  </div>
                  <button
                    onClick={() => {
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.accept = 'application/pdf';
                      input.multiple = true;
                      input.onchange = (e) => {
                        const files = Array.from((e.target as HTMLInputElement).files || []);
                        setMergeFiles(prev => [...prev, ...files]);
                      };
                      input.click();
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all font-bold shadow-md"
                  >
                    <Plus className="w-4 h-4" />
                    Add Files
                  </button>
                </div>

                {mergeFiles.length > 0 ? (
                  <div className="space-y-3 mb-8">
                    {mergeFiles.map((file, idx) => (
                      <div key={`${file.name}-${idx}`} className="flex items-center gap-4 p-3 bg-gray-50 rounded-xl border border-gray-100 group">
                        <div className="flex flex-col gap-1">
                          <button 
                            disabled={idx === 0}
                            onClick={() => {
                              const newFiles = [...mergeFiles];
                              [newFiles[idx-1], newFiles[idx]] = [newFiles[idx], newFiles[idx-1]];
                              setMergeFiles(newFiles);
                            }}
                            className="p-1 hover:bg-white rounded text-gray-400 hover:text-blue-600 disabled:opacity-0"
                          >
                            <ChevronLeft className="w-4 h-4 rotate-90" />
                          </button>
                          <button 
                            disabled={idx === mergeFiles.length - 1}
                            onClick={() => {
                              const newFiles = [...mergeFiles];
                              [newFiles[idx+1], newFiles[idx]] = [newFiles[idx], newFiles[idx+1]];
                              setMergeFiles(newFiles);
                            }}
                            className="p-1 hover:bg-white rounded text-gray-400 hover:text-blue-600 disabled:opacity-0"
                          >
                            <ChevronRight className="w-4 h-4 rotate-90" />
                          </button>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-gray-900 truncate">{file.name}</p>
                          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tight">
                            {(file.size / 1024 / 1024).toFixed(2)} MB
                          </p>
                        </div>
                        <button
                          onClick={() => setMergeFiles(prev => prev.filter((_, i) => i !== idx))}
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-16 text-center border-2 border-dashed border-gray-100 rounded-3xl mb-8">
                    <Upload className="w-12 h-12 text-gray-200 mx-auto mb-4" />
                    <p className="text-sm font-bold text-gray-400 uppercase tracking-widest">No files selected</p>
                  </div>
                )}

                <div className="flex gap-4">
                  <button
                    disabled={mergeFiles.length < 2}
                    onClick={() => handleMergeFiles('download')}
                    className="flex-1 px-6 py-4 border-2 border-gray-900 text-gray-900 rounded-xl font-bold hover:bg-gray-50 transition-all disabled:opacity-30 disabled:grayscale"
                  >
                    Merge & Download
                  </button>
                  <button
                    disabled={mergeFiles.length < 2}
                    onClick={() => handleMergeFiles('open')}
                    className="flex-1 px-6 py-4 bg-gray-900 text-white rounded-xl font-bold hover:bg-black transition-all shadow-xl disabled:opacity-30 disabled:grayscale"
                  >
                    Merge & Open Editor
                  </button>
                </div>
              </div>
            </div>
          ) : pdfDoc ? (
            <div className="min-h-full flex items-start justify-center p-12">
              <div
                ref={editorRef}
                className="relative bg-white shadow-2xl transition-transform duration-200"
                style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: 'top center',
                  cursor: editMode === 'pan' ? 'grab' : 'default',
                }}
                onClick={handleCanvasClick}
                onDoubleClick={handleCanvasDoubleClick}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              >
                <canvas ref={canvasRef} className="block shadow-inner" />

                {/* Interactive overlay for text elements */}
                <div
                  ref={overlayRef}
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    width: canvasRef.current?.width,
                    height: canvasRef.current?.height,
                  }}
                >
                  {/* Drawing Guide Box */}
                  {isDrawingBox && (
                    <div
                      className="absolute border-2 border-dashed border-blue-400 bg-blue-400/10 backdrop-blur-[1px]"
                      style={{
                        left: `${Math.min(boxStartPos.x, boxCurrentPos.x)}px`,
                        top: `${Math.min(boxStartPos.y, boxCurrentPos.y)}px`,
                        width: `${Math.abs(boxStartPos.x - boxCurrentPos.x)}px`,
                        height: `${Math.abs(boxStartPos.y - boxCurrentPos.y)}px`,
                        pointerEvents: 'none',
                        borderRadius: '2px',
                        boxShadow: '0 0 8px rgba(59, 130, 246, 0.3)',
                      }}
                    />
                  )}

                  {/* Standard View: Show words */}
                  {pdfDoc?.pages.get(currentPage)?.textElements
                    .filter(el => !el.deleted)
                    .map((element) => {
                      const isSelected = selectedElement?.id === element.id;
                      const isEditing = editingElement === element.id;
                      const isModified = element.modified;
                      const isNewElement = element.isNew;

                      const showRedaction = isModified || isEditing;

                      let cssFontFamily = 'sans-serif';
                      if (element.fontFamilyCategory === 'serif') cssFontFamily = '"Times New Roman", Times, serif';
                      else if (element.fontFamilyCategory === 'mono') cssFontFamily = '"Courier New", Courier, monospace';
                      else cssFontFamily = 'Arial, Helvetica, sans-serif';

                      const bg = element.bgColor || { r: 1, g: 1, b: 1 };
                      const bgStyle = `rgb(${bg.r * 255}, ${bg.g * 255}, ${bg.b * 255})`;

                      const elColor = element.color || { r: 0, g: 0, b: 0 };
                      const textColor = (isEditing || isModified)
                        ? `rgb(${elColor.r * 255}, ${elColor.g * 255}, ${elColor.b * 255})`
                        : 'transparent';

                      return (
                        <div
                          key={element.id}
                          id={element.id}
                          contentEditable={editMode === 'text'}
                          suppressContentEditableWarning={true}
                          className={`absolute pointer-events-auto transition-all ${
                            isEditing ? 'z-[100] outline-none min-w-[10px]' : ''
                          }`}
                          style={{
                            left: `${element.x}px`,
                            top: `${element.y}px`,
                            width: isEditing ? 'auto' : `${element.width}px`,
                            height: `${element.height}px`,
                            border: (isNewElement && isEditing) ? '2px dashed #60a5fa' : 'none',
                            outline: 'none',
                            backgroundColor: (isNewElement && isEditing)
                              ? 'rgba(96, 165, 250, 0.1)'
                              : (showRedaction ? bgStyle : 'transparent'),
                            backdropFilter: (isNewElement && isEditing) ? 'blur(1px)' : 'none',
                            cursor: editMode === 'text' || editMode === 'select' ? 'text' : 'default',
                            zIndex: isEditing ? 100 : (isModified ? 10 : 1),
                            
                            // Typography
                            fontSize: `${element.fontSize}px`,
                            fontFamily: cssFontFamily,
                            fontWeight: element.bold ? 'bold' : 'normal',
                            fontStyle: element.italic ? 'italic' : 'normal',
                            textDecoration: element.underline ? 'underline' : 'none',
                            color: textColor,
                            caretColor: 'black',
                            whiteSpace: 'nowrap',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'flex-start',
                            overflow: isEditing ? 'visible' : 'hidden',
                          }}
                          onFocus={(e) => {
                            if (editMode !== 'text') return;
                            setEditingElement(element.id);
                            setSelectedElement(element);
                            setEditText(element.text);
                          }}
                          onBlur={(e) => {
                            if (editMode !== 'text') return;
                            const newText = e.currentTarget.textContent || '';
                            setEditText(newText);
                            handleTextBlurWithVal(element.id, newText);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              e.currentTarget.blur();
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              e.currentTarget.textContent = element.text;
                              e.currentTarget.blur();
                            }
                          }}
                          onClick={(e) => {
                            if (editMode === 'select') {
                              setSelectedElement(element);
                            } else if (editMode === 'text') {
                              e.stopPropagation(); // prevent canvas click from blurring/creating new text
                            }
                          }}
                        >
                          {element.text}
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* Context Toolbar */}
              {selectedElement && !editingElement && (
                <div 
                  className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-gray-900 text-white rounded-full shadow-2xl px-6 py-3 flex items-center gap-4 z-50 animate-in fade-in zoom-in slide-in-from-bottom-4 duration-200"
                >
                  <div className="flex items-center gap-1 border-r border-gray-700 pr-4">
                    <button onClick={() => handleTextFormatting('bold')} className={`p-1.5 rounded-md hover:bg-gray-800 ${selectedElement.bold ? 'text-blue-400' : ''}`}><Bold className="w-4 h-4" /></button>
                    <button onClick={() => handleTextFormatting('italic')} className={`p-1.5 rounded-md hover:bg-gray-800 ${selectedElement.italic ? 'text-blue-400' : ''}`}><Italic className="w-4 h-4" /></button>
                    <button onClick={() => handleTextFormatting('underline')} className={`p-1.5 rounded-md hover:bg-gray-800 ${selectedElement.underline ? 'text-blue-400' : ''}`}><Underline className="w-4 h-4" /></button>
                  </div>
                  <button onClick={handleDeleteElement} className="p-1.5 text-red-400 hover:bg-red-400/10 rounded-md"><Trash2 className="w-4 h-4" /></button>
                  <div className="h-6 w-px bg-gray-700 mx-1" />
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-tighter">Text Editing</span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center max-w-sm">
                <div className="w-24 h-24 bg-blue-100 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-inner">
                  <Upload className="w-10 h-10 text-blue-600" />
                </div>
                <h2 className="text-2xl font-bold text-gray-900 mb-4">No Document Open</h2>
                <p className="text-gray-500 mb-8 font-medium">Load a PDF file to start using the professional editing tools.</p>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full px-8 py-4 bg-gray-900 text-white rounded-xl hover:bg-black transition-all font-bold shadow-xl flex items-center justify-center gap-3"
                >
                  <Plus className="w-5 h-5" />
                  Select PDF
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer / Status Bar */}
      <div className="h-8 bg-white border-t border-gray-200 px-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
            {pdfDoc ? `${pdfDoc.filename}` : 'Ready'}
          </span>
        </div>
        <div className="flex items-center gap-4 text-[10px] font-bold text-gray-500">
          <span>{pdfDoc ? `PAGE ${currentPage} / ${pdfDoc.totalPages}` : 'NO DOCUMENT'}</span>
          <div className="h-4 w-px bg-gray-200" />
          <span className="text-blue-600">PRO MODE ACTIVE</span>
        </div>
      </div>
      {/* Header/Footer & Page Numbers Modal */}
      <HeaderFooterModal
        isOpen={isHFModalOpen}
        onClose={() => setIsHFModalOpen(false)}
        onApply={handleApplyHeaderFooter}
        onApplyPageNumbers={handleApplyPageNumbers}
      />
    </div>
  );
}
