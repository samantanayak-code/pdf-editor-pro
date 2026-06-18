import { useState, useCallback, useEffect, useRef } from 'react';
import {
  FileText, Upload, Download, AlertCircle,
  CheckCircle, Loader2, Info, ChevronDown, ChevronUp,
  FileSpreadsheet, AlignLeft, Eye, EyeOff, ArrowRight,
  ZoomIn, ZoomOut, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { downloadFile, convertPDFToWord, convertPDFTablesToExcel } from '../lib/pdf/converter';

interface ConversionResult {
  type: 'success' | 'error' | 'warning';
  message: string;
  details?: string[];
  blob?: Blob;
  filename?: string;
}
interface ExcelTable {
  label: string;
  headers: string[];
  rows: string[][];
  all_rows: string[][];
  cell_fills: (string | null)[][] | null;
  col_widths_pts: number[] | null;
  header_row_idx: number;
}

// ── load pdf.js once ─────────────────────────────────────────────────────────
function usePdfJs() {
  useEffect(() => {
    if ((window as any).pdfjsLib) return;
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = () => {
      (window as any).pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    };
    document.head.appendChild(s);
  }, []);
}

// ── Render PDF pages to canvas images ────────────────────────────────────────
function usePdfPreview(file: File | null) {
  const [pages, setPages]   = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!file) { setPages([]); return; }
    let cancelled = false;
    setLoading(true); setError(null); setPages([]);
    const run = async () => {
      let tries = 0;
      while (!(window as any).pdfjsLib && tries++ < 60)
        await new Promise(r => setTimeout(r, 100));
      if (!(window as any).pdfjsLib) {
        if (!cancelled) { setError('Preview unavailable'); setLoading(false); }
        return;
      }
      try {
        const pdfjs = (window as any).pdfjsLib;
        const buf   = await file.arrayBuffer();
        const pdf   = await pdfjs.getDocument({ data: buf }).promise;
        const count = Math.min(pdf.numPages, 10);
        const out: string[] = [];
        for (let i = 1; i <= count; i++) {
          if (cancelled) return;
          const page = await pdf.getPage(i);
          const vp   = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement('canvas');
          canvas.width = vp.width; canvas.height = vp.height;
          await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
          out.push(canvas.toDataURL('image/jpeg', 0.85));
        }
        if (!cancelled) { setPages(out); setLoading(false); }
      } catch { if (!cancelled) { setError('Preview failed'); setLoading(false); } }
    };
    run();
    return () => { cancelled = true; };
  }, [file]);

  return { pages, loading, error };
}

// ── PDF Preview Panel ────────────────────────────────────────────────────────
function PdfPreviewPanel({ pages, loading, error }: {
  pages: string[]; loading: boolean; error?: string | null;
}) {
  const [cur, setCur] = useState(0);
  const [zoom, setZoom] = useState(1);
  useEffect(() => { setCur(0); }, [pages]);

  return (
    <div className="flex flex-col h-full bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-gray-700 to-gray-800">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-white"/>
          <div>
            <p className="text-xs font-bold text-white">Original PDF</p>
            <p className="text-xs text-white/60">Before conversion</p>
          </div>
        </div>
        {pages.length > 0 && (
          <div className="flex items-center gap-1 bg-white/20 rounded-lg px-2 py-1">
            <button onClick={() => setZoom(z => Math.max(0.4, z-0.2))} className="text-white p-0.5 hover:text-white/70"><ZoomOut className="w-3 h-3"/></button>
            <span className="text-white text-xs font-mono w-8 text-center">{Math.round(zoom*100)}%</span>
            <button onClick={() => setZoom(z => Math.min(2.5, z+0.2))} className="text-white p-0.5 hover:text-white/70"><ZoomIn className="w-3 h-3"/></button>
          </div>
        )}
      </div>
      <div className="flex-1 overflow-auto bg-gray-100 flex flex-col items-center justify-center min-h-[460px]">
        {loading && <div className="flex flex-col items-center gap-2"><div className="w-8 h-8 border-4 border-gray-300 border-t-blue-500 rounded-full animate-spin"/><p className="text-xs text-gray-400">Rendering PDF…</p></div>}
        {!loading && error && <div className="text-center p-6"><AlertCircle className="w-7 h-7 text-red-400 mx-auto mb-2"/><p className="text-xs text-gray-400">{error}</p></div>}
        {!loading && !error && pages.length === 0 && (
          <div className="text-center p-8">
            <div className="p-4 bg-gray-200 rounded-2xl inline-block mb-3"><FileText className="w-7 h-7 text-gray-400"/></div>
            <p className="text-xs text-gray-400">Upload a PDF to preview</p>
          </div>
        )}
        {!loading && pages.length > 0 && (
          <div className="w-full overflow-auto flex flex-col items-center p-3" style={{ minHeight: '460px' }}>
            <div className="shadow-xl rounded bg-white overflow-hidden"
              style={{ transform: `scale(${zoom})`, transformOrigin: 'top center', transition: 'transform 0.15s' }}>
              <img src={pages[cur]} alt={`Page ${cur+1}`} className="block max-w-full h-auto" draggable={false}/>
            </div>
          </div>
        )}
      </div>
      {pages.length > 1 && (
        <div className="flex items-center justify-center gap-3 px-4 py-2 border-t border-gray-100 bg-white">
          <button onClick={() => setCur(c => Math.max(0,c-1))} disabled={cur===0}
            className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30"><ChevronLeft className="w-4 h-4 text-gray-600"/></button>
          <div className="flex gap-1">
            {pages.map((_,i) => (
              <button key={i} onClick={() => setCur(i)}
                className={`h-2 rounded-full transition-all ${i===cur?'w-5 bg-blue-600':'w-2 bg-gray-300'}`}/>
            ))}
          </div>
          <button onClick={() => setCur(c => Math.min(pages.length-1,c+1))} disabled={cur===pages.length-1}
            className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30"><ChevronRight className="w-4 h-4 text-gray-600"/></button>
          <span className="text-xs text-gray-400">{cur+1} / {pages.length}</span>
        </div>
      )}
    </div>
  );
}

// ── Word Preview Panel ────────────────────────────────────────────────────────
function WordPreviewPanel({ html, loading, error, blob, filename }: {
  html: string | null; loading: boolean; error?: string | null;
  blob?: Blob | null; filename?: string | null;
}) {
  const doDownload = () => { if (blob && filename) downloadFile(blob, filename); };
  return (
    <div className="flex flex-col h-full bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-blue-600 to-blue-700">
        <div className="flex items-center gap-2">
          <AlignLeft className="w-4 h-4 text-white"/>
          <div>
            <p className="text-xs font-bold text-white">Word Preview</p>
            <p className="text-xs text-white/60">Editable text output</p>
          </div>
        </div>
        {blob && (
          <button onClick={doDownload}
            className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-all">
            <Download className="w-3 h-3"/> Download .docx
          </button>
        )}
      </div>
      <div className="flex-1 overflow-auto bg-gray-50 min-h-[460px]">
        {loading && (
          <div className="flex flex-col items-center justify-center gap-3 min-h-[460px]">
            <div className="w-8 h-8 border-4 border-gray-300 border-t-blue-500 rounded-full animate-spin"/>
            <p className="text-xs text-gray-400">Generating preview…</p>
          </div>
        )}
        {!loading && error && (
          <div className="flex flex-col items-center justify-center gap-2 min-h-[460px] p-8">
            <AlertCircle className="w-7 h-7 text-red-400"/>
            <p className="text-xs text-gray-400">{error}</p>
          </div>
        )}
        {!loading && !error && !html && (
          <div className="flex flex-col items-center justify-center gap-3 min-h-[460px] p-8 text-center">
            <div className="p-4 bg-gray-200 rounded-2xl inline-block"><AlignLeft className="w-7 h-7 text-gray-400"/></div>
            <p className="text-xs text-gray-400 max-w-[200px]">Upload a PDF to see the Word preview</p>
          </div>
        )}
        {!loading && !error && html && (
          <div className="p-4">
            <div className="bg-white shadow-lg mx-auto"
              style={{ maxWidth:'680px', minHeight:'900px', padding:'48px 52px',
                fontFamily:'Calibri,sans-serif', fontSize:'10pt', lineHeight:'1.5', color:'#111' }}
              dangerouslySetInnerHTML={{ __html: `<style>
                *{box-sizing:border-box}
                p{margin:0 0 5px 0}
                table{border-collapse:collapse;width:100%;margin:8px 0;font-size:9px}
                td,th{border:1px solid #aaa;padding:4px 7px;vertical-align:top}
                th{background:#1F3864;color:#fff;text-align:left}
                tr:nth-child(even) td{background:#EEF2F7}
                b,strong{font-weight:bold}
                i,em{font-style:italic}
              </style>${html}` }}/>
          </div>
        )}
      </div>
      {blob && (
        <div className="px-4 py-2 border-t border-gray-100 bg-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-3.5 h-3.5 text-green-500"/>
            <p className="text-xs text-gray-500">{filename} · Ready to download</p>
          </div>
          <button onClick={doDownload}
            className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800">
            <Download className="w-3 h-3"/> Download
          </button>
        </div>
      )}
    </div>
  );
}

// ── Excel Preview Panel ───────────────────────────────────────────────────────

/** Convert PDF-point column widths to preview pixel widths */
function ptsToPreviewPx(pts: number | undefined): number {
  if (!pts) return 140;
  return Math.max(60, Math.min(320, Math.round(pts * 1.4)));
}

/** Hex fill → CSS color, skip near-white */
function fillToCss(hex: string | null | undefined): string | undefined {
  if (!hex) return undefined;
  const r = parseInt(hex.slice(0,2),16);
  const g = parseInt(hex.slice(2,4),16);
  const b = parseInt(hex.slice(4,6),16);
  if (r > 230 && g > 230 && b > 230) return undefined;
  return `#${hex}`;
}

function ExcelPreviewPanel({ tables, loading, error, blob, filename }: {
  tables: ExcelTable[] | null; loading: boolean; error?: string | null;
  blob?: Blob | null; filename?: string | null;
}) {
  const doDownload = () => { if (blob && filename) downloadFile(blob, filename); };

  return (
    <div className="flex flex-col h-full bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-emerald-600 to-emerald-700">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="w-4 h-4 text-white"/>
          <div>
            <p className="text-xs font-bold text-white">Excel Preview</p>
            <p className="text-xs text-white/60">Exact PDF table layout</p>
          </div>
        </div>
        {blob && (
          <button onClick={doDownload}
            className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-all">
            <Download className="w-3 h-3"/> Download .xlsx
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto min-h-[460px]" style={{background:'#f0f0f0'}}>

        {loading && (
          <div className="flex flex-col items-center justify-center gap-3 min-h-[460px]">
            <div className="w-8 h-8 border-4 border-gray-300 border-t-emerald-500 rounded-full animate-spin"/>
            <p className="text-xs text-gray-400">OCR-reading tables from PDF…</p>
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-col items-center justify-center gap-2 min-h-[460px] p-8">
            <AlertCircle className="w-7 h-7 text-red-400"/>
            <p className="text-xs text-gray-400">{error}</p>
          </div>
        )}

        {!loading && !error && !tables && (
          <div className="flex flex-col items-center justify-center gap-3 min-h-[460px] p-8 text-center">
            <div className="p-4 bg-gray-200 rounded-2xl inline-block">
              <FileSpreadsheet className="w-7 h-7 text-gray-400"/>
            </div>
            <p className="text-xs text-gray-400 max-w-[200px]">Upload a PDF to see the Excel preview</p>
          </div>
        )}

        {!loading && !error && tables && tables.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 min-h-[460px] p-8 text-center">
            <p className="text-sm font-medium text-gray-500">No tables found in this PDF</p>
            <p className="text-xs text-gray-400">Try PDF → Word instead</p>
          </div>
        )}

        {!loading && !error && tables && tables.length > 0 && (
          <div className="p-4 space-y-6">
            {/* Sheet tab bar */}
            <div className="flex items-end gap-0 border-b-2 border-emerald-600 overflow-x-auto pb-0">
              {tables.map((tbl, ti) => (
                <div key={ti}
                  className="px-3 py-1 text-xs font-semibold bg-white border border-gray-300 border-b-0 rounded-t text-emerald-700 whitespace-nowrap cursor-default select-none"
                  style={{marginBottom:'-2px', borderBottom:'2px solid white'}}>
                  {tbl.label}
                </div>
              ))}
            </div>

            {tables.map((tbl, ti) => {
              const allRows    = tbl.all_rows ?? [tbl.headers, ...tbl.rows];
              const fills      = tbl.cell_fills ?? null;
              const colPts     = tbl.col_widths_pts ?? null;
              const headerIdx  = tbl.header_row_idx ?? 0;
              const nCols      = allRows[0]?.length ?? 0;

              return (
                <div key={ti}>
                  <div className="overflow-x-auto rounded-lg shadow border border-gray-300 bg-white">
                    <table className="border-collapse" style={{fontFamily:'Calibri,Arial,sans-serif', fontSize:'11px', tableLayout:'fixed'}}>
                      <colgroup>
                        <col style={{width:'28px'}}/>
                        {Array.from({length: nCols}, (_,ci) => (
                          <col key={ci} style={{width:`${ptsToPreviewPx(colPts?.[ci])}px`}}/>
                        ))}
                      </colgroup>

                      {/* Column letters */}
                      <thead>
                        <tr>
                          <th style={{background:'#e9e9e9',border:'1px solid #bbb',padding:'2px 4px',color:'#666',fontSize:'10px',fontWeight:600,textAlign:'center',userSelect:'none'}}/>
                          {Array.from({length: nCols}, (_,ci) => (
                            <th key={ci} style={{background:'#e9e9e9',border:'1px solid #bbb',padding:'2px 6px',color:'#666',fontSize:'10px',fontWeight:600,textAlign:'center',userSelect:'none'}}>
                              {String.fromCharCode(65+ci)}
                            </th>
                          ))}
                        </tr>
                      </thead>

                      <tbody>
                        {allRows.map((row, ri) => {
                          const isHeader = ri === headerIdx;
                          return (
                            <tr key={ri}>
                              {/* Row number */}
                              <td style={{background:'#e9e9e9',border:'1px solid #bbb',padding:'2px 4px',textAlign:'center',color:'#666',fontSize:'10px',fontWeight:600,userSelect:'none',whiteSpace:'nowrap'}}>
                                {ri + 1}
                              </td>
                              {row.map((cell, ci) => {
                                const rawFill = fills?.[ri]?.[ci];
                                const bg = isHeader
                                  ? '#1F3864'
                                  : (fillToCss(rawFill) ?? (ri % 2 === 1 ? '#EEF2F7' : '#FFFFFF'));
                                const fg = isHeader ? '#FFFFFF' : '#1A1A1A';
                                const fw = isHeader ? '700' : '400';
                                const bd = isHeader ? '1.5px solid #4F4F4F' : '1px solid #C0C0C0';
                                return (
                                  <td key={ci} style={{
                                    background:bg, color:fg, fontWeight:fw,
                                    border:bd, padding: isHeader ? '6px 8px' : '4px 8px',
                                    verticalAlign:'top', whiteSpace:'pre-wrap',
                                    wordBreak:'break-word', lineHeight:'1.4', minHeight:'20px',
                                  }}>
                                    {cell || ''}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-1 text-right text-[10px] text-gray-400">
                    {allRows.length} rows × {nCols} cols
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {blob && (
        <div className="px-4 py-2 border-t border-gray-100 bg-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-3.5 h-3.5 text-green-500"/>
            <p className="text-xs text-gray-500">{filename} · Ready to download</p>
          </div>
          <button onClick={doDownload}
            className="flex items-center gap-1 text-xs font-semibold text-emerald-600 hover:text-emerald-800">
            <Download className="w-3 h-3"/> Download
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function PDFConverter() {
  const [selectedFile, setSelectedFile]   = useState<File | null>(null);
  const [converting, setConverting]       = useState(false);
  const [progress, setProgress]           = useState('');
  const [progressPct, setProgressPct]     = useState(0);
  const [result, setResult]               = useState<ConversionResult | null>(null);
  const [conversionType, setConversionType] = useState<'word'|'excel'>('word');
  const [wordPreset, setWordPreset]       = useState<'auto'|'letter'|'mom'>('auto');
  const [showTips, setShowTips]           = useState(false);
  const [dragOver, setDragOver]           = useState(false);
  const [showPreview, setShowPreview]     = useState(true);

  // ── Word preview state ──────────────────────────────────────────────────────
  const [wordPreviewHtml, setWordPreviewHtml]       = useState<string|null>(null);
  const [wordPreviewLoading, setWordPreviewLoading] = useState(false);
  const [wordPreviewError, setWordPreviewError]     = useState<string|null>(null);
  const [wordBlob, setWordBlob]                     = useState<Blob|null>(null);
  const [wordFilename, setWordFilename]             = useState<string|null>(null);

  // ── Excel preview state ─────────────────────────────────────────────────────
  const [excelTables, setExcelTables]               = useState<ExcelTable[]|null>(null);
  const [excelPreviewLoading, setExcelPreviewLoading] = useState(false);
  const [excelPreviewError, setExcelPreviewError]   = useState<string|null>(null);
  const [excelBlob, setExcelBlob]                   = useState<Blob|null>(null);
  const [excelFilename, setExcelFilename]           = useState<string|null>(null);

  usePdfJs();

  const { pages: pdfPages, loading: pdfLoading, error: pdfError } = usePdfPreview(selectedFile);
  const hasFile = !!selectedFile;

  // ── Client-side preview extraction ────────────────────────────────────────
  const [wordPreviewText, setWordPreviewText] = useState<string | null>(null);
  const [excelTablesPreview, setExcelTablesPreview] = useState<ExcelTable[] | null>(null);

  useEffect(() => {
    if (!selectedFile) { setWordPreviewText(null); setExcelTablesPreview(null); return; }

    // Extract text preview for Word tab
    if (conversionType === 'word') {
      setWordPreviewLoading(true); setWordPreviewError(null);
      const run = async () => {
        try {
          const pdfjs = (window as any).pdfjsLib;
          if (!pdfjs) { throw new Error('pdf.js not loaded'); }
          const buf = await selectedFile.arrayBuffer();
          const pdf = await pdfjs.getDocument({ data: buf }).promise;
          const maxPages = Math.min(pdf.numPages, 5);
          let text = '';
          for (let i = 1; i <= maxPages; i++) {
            const page = await pdf.getPage(i);
            const tc = await page.getTextContent();
            const pageText = tc.items.map((t: any) => t.str).join(' ').trim();
            if (pageText) text += `<p style="margin:0 0 6px 0;line-height:1.5">${pageText}</p>`;
          }
          setWordPreviewHtml(text || '<p style="color:#999">No text content found</p>');
        } catch (e: any) {
          setWordPreviewError('Preview unavailable');
        } finally {
          setWordPreviewLoading(false);
        }
      };
      run();
    }

    // Extract table preview for Excel tab
    if (conversionType === 'excel') {
      setExcelPreviewLoading(true); setExcelPreviewError(null);
      const run = async () => {
        try {
          const pdfjs = (window as any).pdfjsLib;
          if (!pdfjs) { throw new Error('pdf.js not loaded'); }
          const buf = await selectedFile.arrayBuffer();
          const pdf = await pdfjs.getDocument({ data: buf }).promise;
          const tables: ExcelTable[] = [];
          // Scan first few pages for tabular content
          for (let pi = 1; pi <= Math.min(pdf.numPages, 3); pi++) {
            const page = await pdf.getPage(pi);
            const tc = await page.getTextContent();
            const items = tc.items as any[];
            // Group items by y-position to detect rows
            const rows = new Map<number, { text: string; x: number }[]>();
            for (const item of items) {
              const y = Math.round(item.transform[5] * 10);
              if (!rows.has(y)) rows.set(y, []);
              rows.get(y)!.push({ text: item.str, x: item.transform[4] });
            }
            const sortedRows = [...rows.entries()]
              .sort((a, b) => b[0] - a[0])
              .map(([, cols]) => cols.sort((a, b) => a.x - b.x).map(c => c.text));
            if (sortedRows.length >= 3) {
              const cols = Math.max(...sortedRows.map(r => r.length));
              if (cols >= 3) {
                tables.push({
                  label: `Page ${pi}`,
                  headers: sortedRows[0],
                  rows: sortedRows.slice(1),
                  all_rows: sortedRows,
                  cell_fills: null,
                  col_widths_pts: null,
                  header_row_idx: 0,
                });
              }
            }
          }
          setExcelTables(tables.length > 0 ? tables : null);
          if (tables.length === 0) setExcelPreviewError('No tables detected — try converting anyway');
        } catch (e: any) {
          setExcelPreviewError('Table preview unavailable');
        } finally {
          setExcelPreviewLoading(false);
        }
      };
      run();
    }
  }, [selectedFile, conversionType]);

  // ── Convert (fully client-side) ────────────────────────────────────────────
  const handleConvert = async () => {
    if (!selectedFile) return;
    setConverting(true); setResult(null); setProgressPct(0);

    try {
      if (conversionType === 'word') {
        setProgress('Extracting text from PDF…'); setProgressPct(15);
        const result = await convertPDFToWord(
          selectedFile,
          { preset: wordPreset },
          (msg) => { setProgress(msg); }
        );
        setProgressPct(85);
        setProgress('Building Word document…');
        const filename = selectedFile.name.replace(/\.pdf$/i, '.docx');
        setWordBlob(result.blob); setWordFilename(filename);
        setProgressPct(100);
        setResult({ type:'success', message:`Ready: ${filename}`,
          details:['Fully editable text', 'Click Download in the preview panel'], blob: result.blob, filename });
      } else {
        setProgress('Extracting tables from PDF…'); setProgressPct(15);
        const blob = await convertPDFTablesToExcel(
          selectedFile,
          (msg) => { setProgress(msg); }
        );
        setProgressPct(85);
        setProgress('Building Excel workbook…');
        const filename = selectedFile.name.replace(/\.pdf$/i, '.xlsx');
        setExcelBlob(blob); setExcelFilename(filename);
        setProgressPct(100);
        setResult({ type:'success', message:`Ready: ${filename}`,
          details:['All tables on one sheet', 'Click Download in the preview panel'], blob, filename });
      }
    } catch (err: any) {
      const msg = err.message === 'SCANNED_PDF'
        ? 'Scanned PDF detected — no extractable text'
        : err.message === 'ENCRYPTED'
          ? 'PDF is password-protected'
          : err.message === 'UNSUPPORTED_FORMAT'
            ? 'Could not parse this PDF format'
            : err.message || 'Unknown error';
      setResult({ type:'error', message:`Conversion failed: ${msg}`,
        details: err.message === 'SCANNED_PDF' ? ['Try a regular PDF with text content'] : [] });
    } finally {
      setConverting(false); setProgress('');
    }
  };

  const handleFile = (file: File) => {
    if (file.type === 'application/pdf') {
      setSelectedFile(file);
      setResult(null); setProgress(''); setProgressPct(0);
    } else {
      setResult({ type:'error', message:'Please select a valid PDF file.' });
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (f) handleFile(f);
  };
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files?.[0]; if (f) handleFile(f);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100">
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl shadow-lg shadow-blue-200">
              <FileText className="w-6 h-6 text-white"/>
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-900 tracking-tight">PDF Converter</h2>
              <p className="text-sm text-gray-500">Preview instantly · Download when ready</p>
            </div>
          </div>
          {hasFile && (
            <button onClick={() => setShowPreview(v => !v)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition-all ${
                showPreview ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-600'}`}>
              {showPreview ? <EyeOff className="w-4 h-4"/> : <Eye className="w-4 h-4"/>}
              {showPreview ? 'Hide Preview' : 'Show Preview'}
            </button>
          )}
        </div>

        {/* Layout */}
        <div className={`grid gap-6 transition-all duration-300 ${hasFile && showPreview ? 'grid-cols-[360px,1fr]' : 'grid-cols-1 max-w-md'}`}>

          {/* Controls */}
          <div className="space-y-4">

            {/* Type selector */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { id:'word'  as const, label:'PDF → Word',  sub:'Editable text & tables', Icon:AlignLeft,       ac:'border-blue-600 bg-blue-50',    col:'bg-blue-600'    },
                { id:'excel' as const, label:'PDF → Excel', sub:'Tabular data & sheets',  Icon:FileSpreadsheet, ac:'border-emerald-600 bg-emerald-50', col:'bg-emerald-600' },
              ].map(({ id, label, sub, Icon, ac, col }) => (
                <button key={id} onClick={() => { setConversionType(id); setResult(null); }}
                  className={`flex items-center gap-2.5 p-3.5 rounded-xl border-2 text-left transition-all ${conversionType===id ? ac : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                  <div className={`p-1.5 rounded-lg ${conversionType===id ? col : 'bg-gray-100'}`}>
                    <Icon className={`w-4 h-4 ${conversionType===id ? 'text-white' : 'text-gray-500'}`}/>
                  </div>
                  <div>
                    <p className={`text-sm font-bold ${conversionType===id?'text-gray-900':'text-gray-700'}`}>{label}</p>
                    <p className="text-xs text-gray-400">{sub}</p>
                  </div>
                </button>
              ))}
            </div>

            {/* Word presets */}
            {conversionType === 'word' && (
              <div className="flex items-center gap-3 p-3.5 bg-white rounded-xl border border-gray-200">
                <p className="text-xs font-semibold text-gray-600 whitespace-nowrap">Preset:</p>
                <div className="flex gap-1.5 flex-wrap">
                  {[{id:'auto',label:'Auto'},{id:'letter',label:'Letter'},{id:'mom',label:'Minutes'}].map(p => (
                    <button key={p.id} onClick={() => setWordPreset(p.id as any)}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${wordPreset===p.id?'bg-blue-600 text-white shadow-sm':'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Drop zone */}
            <div onDragOver={e=>{e.preventDefault();setDragOver(true);}} onDragLeave={()=>setDragOver(false)} onDrop={handleDrop}
              className={`relative rounded-xl border-2 border-dashed transition-all ${dragOver?'border-blue-500 bg-blue-50 scale-[1.01]':hasFile?'border-green-400 bg-green-50/50':'border-gray-300 bg-white hover:border-blue-400 hover:bg-blue-50/20'}`}>
              <input type="file" accept="application/pdf" onChange={handleFileSelect} className="absolute inset-0 opacity-0 cursor-pointer"/>
              <div className="flex flex-col items-center justify-center gap-2 p-6 text-center">
                {hasFile ? (
                  <>
                    <div className="p-2.5 bg-green-100 rounded-xl"><CheckCircle className="w-6 h-6 text-green-600"/></div>
                    <p className="text-sm font-semibold text-gray-800 truncate max-w-[220px]">{selectedFile!.name}</p>
                    <p className="text-xs text-gray-500">{(selectedFile!.size/1024).toFixed(1)} KB
                      {pdfPages.length>0 && ` · ${pdfPages.length} page${pdfPages.length!==1?'s':''}`}
                    </p>
                    <p className="text-xs text-blue-500 cursor-pointer font-medium">Click to change file</p>
                  </>
                ) : (
                  <>
                    <div className="p-3 bg-gray-100 rounded-xl"><Upload className="w-6 h-6 text-gray-400"/></div>
                    <p className="text-sm font-semibold text-gray-700">Drop your PDF here</p>
                    <p className="text-xs text-gray-400">or click to browse — preview loads instantly</p>
                  </>
                )}
              </div>
            </div>

            {/* Convert button */}
            <button onClick={handleConvert} disabled={!hasFile||converting}
              className={`w-full flex items-center justify-center gap-2.5 py-3.5 rounded-xl font-semibold text-sm transition-all ${
                !hasFile||converting ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : conversionType==='word' ? 'bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white shadow-lg shadow-blue-200 hover:-translate-y-0.5'
                : 'bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white shadow-lg shadow-emerald-200 hover:-translate-y-0.5'}`}>
              {converting
                ? (<><Loader2 className="w-4 h-4 animate-spin"/><span>Converting…</span></>)
                : (<>{conversionType==='word'?<FileText className="w-4 h-4"/>:<FileSpreadsheet className="w-4 h-4"/>}
                   <span>Convert to {conversionType==='word'?'Word':'Excel'}</span></>)}
            </button>

            {/* Progress bar */}
            {converting && (
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <p className="text-xs text-gray-500 truncate flex-1 pr-2">{progress}</p>
                  <p className="text-xs font-mono text-blue-600 font-bold">{progressPct}%</p>
                </div>
                <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full transition-all duration-700" style={{width:`${progressPct}%`}}/>
                </div>
              </div>
            )}

            {/* Result banner */}
            {result?.type === 'error' && (
              <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl space-y-1">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0"/>
                  <p className="text-sm font-semibold text-red-700">{result.message}</p>
                </div>
                {result.details?.map((d,i) => <p key={i} className="text-xs text-red-500 ml-6">{d}</p>)}
              </div>
            )}
            {result && result.type !== 'error' && !showPreview && (
              <div className="p-3.5 bg-green-50 border border-green-200 rounded-xl space-y-2">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0"/>
                  <p className="text-sm font-semibold text-green-800">{result.message}</p>
                </div>
                {result.details?.map((d,i) => <p key={i} className="text-xs text-green-600 ml-6">{d}</p>)}
                {result.blob && result.filename && (
                  <button onClick={() => downloadFile(result.blob!, result.filename!)}
                    className="ml-6 flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 font-medium">
                    <Download className="w-3 h-3"/> Download {result.filename}
                  </button>
                )}
              </div>
            )}

            {/* Tips */}
            <button onClick={() => setShowTips(v=>!v)}
              className="w-full flex items-center justify-between p-3 text-sm text-gray-600 bg-white rounded-xl border border-gray-200 hover:border-gray-300 transition-all">
              <div className="flex items-center gap-2"><Info className="w-4 h-4 text-blue-500"/><span className="font-medium">What gets preserved?</span></div>
              {showTips ? <ChevronUp className="w-4 h-4"/> : <ChevronDown className="w-4 h-4"/>}
            </button>
            {showTips && (
              <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-700 space-y-1.5 -mt-2">
                {['✓ 100% editable text (OCR for scanned PDFs)',
                  '✓ Tables with styled header rows',
                  '✓ Paragraphs with correct spacing',
                  '✓ Excel: all tables on one sheet, blank row between',
                  '✓ Word: text layer extracted or OCR applied',
                  '✓ Preview loads as soon as file is selected',
                  '✓ Download only happens when you click Download',
                ].map((t,i) => <p key={i}>{t}</p>)}
              </div>
            )}
          </div>

          {/* Preview panels */}
          {hasFile && showPreview && (
            <div className="grid grid-cols-2 gap-4 min-h-[540px] relative">
              <PdfPreviewPanel pages={pdfPages} loading={pdfLoading} error={pdfError}/>

              <div className="absolute left-1/2 top-[230px] -translate-x-1/2 z-10 pointer-events-none">
                <div className={`p-2 rounded-full shadow-lg ${conversionType==='excel'?'bg-emerald-600':'bg-blue-600'}`}>
                  <ArrowRight className="w-4 h-4 text-white"/>
                </div>
              </div>

              {conversionType === 'word' ? (
                <WordPreviewPanel
                  html={wordPreviewHtml}
                  loading={wordPreviewLoading}
                  error={wordPreviewError}
                  blob={wordBlob}
                  filename={wordFilename}
                />
              ) : (
                <ExcelPreviewPanel
                  tables={excelTables}
                  loading={excelPreviewLoading}
                  error={excelPreviewError}
                  blob={excelBlob}
                  filename={excelFilename}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
