import { useState } from 'react';
import { X, AlignLeft, AlignCenter, AlignRight, Hash } from 'lucide-react';

interface HeaderFooterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (options: HeaderFooterOptions) => void;
  onApplyPageNumbers: (options: PageNumberOptions) => void;
}

export interface HeaderFooterOptions {
  header?: {
    text: string;
    showFileName: boolean;
    showDate: boolean;
    position: 'left' | 'center' | 'right';
  };
  footer?: {
    text: string;
    showFileName: boolean;
    showDate: boolean;
    position: 'left' | 'center' | 'right';
  };
  fontSize: number;
  color: { r: number; g: number; b: number };
  marginX: number;
  marginY: number;
}

export interface PageNumberOptions {
  format: string;
  startNumber: number;
  position: 'header-left' | 'header-center' | 'header-right' | 'footer-left' | 'footer-center' | 'footer-right';
  fontSize: number;
  color: { r: number; g: number; b: number };
  excludeFirstPage: boolean;
  marginX: number;
  marginY: number;
}

export function HeaderFooterModal({ isOpen, onClose, onApply, onApplyPageNumbers }: HeaderFooterModalProps) {
  const [activeTab, setActiveTab] = useState<'headerfooter' | 'pagenumbers'>('headerfooter');
  const [enableHeader, setEnableHeader] = useState(false);
  const [enableFooter, setEnableFooter] = useState(true);
  const [headerText, setHeaderText] = useState('');
  const [footerText, setFooterText] = useState('');
  const [headerShowFileName, setHeaderShowFileName] = useState(false);
  const [headerShowDate, setHeaderShowDate] = useState(false);
  const [footerShowFileName, setFooterShowFileName] = useState(true);
  const [footerShowDate, setFooterShowDate] = useState(false);
  const [headerPosition, setHeaderPosition] = useState<'left' | 'center' | 'right'>('center');
  const [footerPosition, setFooterPosition] = useState<'left' | 'center' | 'right'>('center');
  const [fontSize, setFontSize] = useState(10);
  const [marginX, setMarginX] = useState(40);
  const [marginY, setMarginY] = useState(40);

  // Page number state
  const [pnFormat, setPnFormat] = useState('Page {page} of {total}');
  const [pnStartNumber, setPnStartNumber] = useState(1);
  const [pnPosition, setPnPosition] = useState<PageNumberOptions['position']>('footer-center');
  const [pnFontSize, setPnFontSize] = useState(10);
  const [pnExcludeFirst, setPnExcludeFirst] = useState(false);
  const [pnMarginX, setPnMarginX] = useState(40);
  const [pnMarginY, setPnMarginY] = useState(30);

  if (!isOpen) return null;

  const PositionBtn = ({ value, current, onClick }: { value: string; current: string; onClick: () => void }) => (
    <button
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
        current === value ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
      }`}
    >
      {value === 'left' || value.endsWith('-left') ? <AlignLeft className="w-3.5 h-3.5" /> :
       value === 'right' || value.endsWith('-right') ? <AlignRight className="w-3.5 h-3.5" /> :
       <AlignCenter className="w-3.5 h-3.5" />}
      {value.includes('-') ? value.split('-')[1].charAt(0).toUpperCase() + value.split('-')[1].slice(1)
                           : value.charAt(0).toUpperCase() + value.slice(1)}
    </button>
  );

  const handleApply = () => {
    if (activeTab === 'headerfooter') {
      const options: HeaderFooterOptions = {
        fontSize,
        color: { r: 0, g: 0, b: 0 },
        marginX,
        marginY,
      };
      if (enableHeader) {
        options.header = { text: headerText, showFileName: headerShowFileName, showDate: headerShowDate, position: headerPosition };
      }
      if (enableFooter) {
        options.footer = { text: footerText, showFileName: footerShowFileName, showDate: footerShowDate, position: footerPosition };
      }
      onApply(options);
    } else {
      onApplyPageNumbers({
        format: pnFormat,
        startNumber: pnStartNumber,
        position: pnPosition,
        fontSize: pnFontSize,
        color: { r: 0, g: 0, b: 0 },
        excludeFirstPage: pnExcludeFirst,
        marginX: pnMarginX,
        marginY: pnMarginY,
      });
    }
    onClose();
  };

  const canApply = activeTab === 'headerfooter' ? (enableHeader || enableFooter) : true;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 my-8 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">Header, Footer &amp; Page Numbers</h2>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 px-6">
          <button
            onClick={() => setActiveTab('headerfooter')}
            className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === 'headerfooter' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Header &amp; Footer
          </button>
          <button
            onClick={() => setActiveTab('pagenumbers')}
            className={`flex items-center gap-1.5 px-4 py-3 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === 'pagenumbers' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Hash className="w-3.5 h-3.5" /> Page Numbers
          </button>
        </div>

        <div className="p-6 space-y-5 max-h-[60vh] overflow-y-auto">

          {activeTab === 'headerfooter' && (
            <>
              {/* Header section */}
              <div className="space-y-3">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" checked={enableHeader} onChange={e => setEnableHeader(e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded" />
                  <span className="text-sm font-bold text-gray-900">Header</span>
                </label>
                {enableHeader && (
                  <div className="ml-6 space-y-3 p-4 bg-blue-50 rounded-xl border border-blue-100">
                    <input type="text" value={headerText} onChange={e => setHeaderText(e.target.value)}
                      placeholder="Header text (optional)"
                      className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-400" />
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                        <input type="checkbox" checked={headerShowFileName} onChange={e => setHeaderShowFileName(e.target.checked)} className="w-4 h-4 rounded" />
                        Show filename
                      </label>
                      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                        <input type="checkbox" checked={headerShowDate} onChange={e => setHeaderShowDate(e.target.checked)} className="w-4 h-4 rounded" />
                        Show date
                      </label>
                    </div>
                    <div className="flex gap-2">
                      {(['left','center','right'] as const).map(p => (
                        <PositionBtn key={p} value={p} current={headerPosition} onClick={() => setHeaderPosition(p)} />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Footer section */}
              <div className="space-y-3">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" checked={enableFooter} onChange={e => setEnableFooter(e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded" />
                  <span className="text-sm font-bold text-gray-900">Footer</span>
                </label>
                {enableFooter && (
                  <div className="ml-6 space-y-3 p-4 bg-green-50 rounded-xl border border-green-100">
                    <input type="text" value={footerText} onChange={e => setFooterText(e.target.value)}
                      placeholder="Footer text (optional)"
                      className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-green-400" />
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                        <input type="checkbox" checked={footerShowFileName} onChange={e => setFooterShowFileName(e.target.checked)} className="w-4 h-4 rounded" />
                        Show filename
                      </label>
                      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                        <input type="checkbox" checked={footerShowDate} onChange={e => setFooterShowDate(e.target.checked)} className="w-4 h-4 rounded" />
                        Show date
                      </label>
                    </div>
                    <div className="flex gap-2">
                      {(['left','center','right'] as const).map(p => (
                        <PositionBtn key={p} value={p} current={footerPosition} onClick={() => setFooterPosition(p)} />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Shared styling */}
              <div className="grid grid-cols-3 gap-4 pt-4 border-t border-gray-100">
                {[['Font Size', fontSize, setFontSize, 6, 24], ['Margin X', marginX, setMarginX, 10, 120], ['Margin Y', marginY, setMarginY, 10, 120]].map(([label, val, set, min, max]: any) => (
                  <div key={label}>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">{label}</label>
                    <input type="number" value={val} onChange={e => set(Number(e.target.value))} min={min} max={max}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-400" />
                  </div>
                ))}
              </div>
            </>
          )}

          {activeTab === 'pagenumbers' && (
            <div className="space-y-5">
              {/* Format */}
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Format</label>
                <div className="grid grid-cols-3 gap-2 mb-2">
                  {['Page {page}', 'Page {page} of {total}', '{page}/{total}'].map(f => (
                    <button key={f} onClick={() => setPnFormat(f)}
                      className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
                        pnFormat === f ? 'bg-blue-600 text-white border-blue-600' : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                      }`}>
                      {f}
                    </button>
                  ))}
                </div>
                <input type="text" value={pnFormat} onChange={e => setPnFormat(e.target.value)}
                  placeholder="Custom format: use {page} and {total}"
                  className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-400" />
                <p className="text-xs text-gray-400 mt-1">Use <code className="bg-gray-100 px-1 rounded">{'{page}'}</code> for page number and <code className="bg-gray-100 px-1 rounded">{'{total}'}</code> for total pages.</p>
              </div>

              {/* Position */}
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Position</label>
                <div className="space-y-2">
                  <p className="text-xs text-gray-500 font-medium">Header</p>
                  <div className="flex gap-2">
                    {(['header-left','header-center','header-right'] as const).map(p => (
                      <PositionBtn key={p} value={p} current={pnPosition} onClick={() => setPnPosition(p)} />
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 font-medium">Footer</p>
                  <div className="flex gap-2">
                    {(['footer-left','footer-center','footer-right'] as const).map(p => (
                      <PositionBtn key={p} value={p} current={pnPosition} onClick={() => setPnPosition(p)} />
                    ))}
                  </div>
                </div>
              </div>

              {/* Options */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Start Number</label>
                  <input type="number" value={pnStartNumber} onChange={e => setPnStartNumber(Number(e.target.value))} min={1}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Font Size</label>
                  <input type="number" value={pnFontSize} onChange={e => setPnFontSize(Number(e.target.value))} min={6} max={24}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Margin X</label>
                  <input type="number" value={pnMarginX} onChange={e => setPnMarginX(Number(e.target.value))} min={10} max={120}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Margin Y</label>
                  <input type="number" value={pnMarginY} onChange={e => setPnMarginY(Number(e.target.value))} min={10} max={120}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
              </div>

              <label className="flex items-center gap-2.5 cursor-pointer">
                <input type="checkbox" checked={pnExcludeFirst} onChange={e => setPnExcludeFirst(e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded" />
                <span className="text-sm text-gray-700">Skip first page (cover page)</span>
              </label>

              {/* Live preview */}
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-200">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Preview</p>
                <p className="text-sm font-mono text-gray-800">
                  {pnFormat.replace('{page}', String(pnStartNumber)).replace('{total}', 'N')}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">{pnPosition.replace('-', ' ')} · size {pnFontSize}pt</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-200 rounded-lg transition-colors">
            Cancel
          </button>
          <button onClick={handleApply} disabled={!canApply}
            className="px-6 py-2 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed">
            Apply to All Pages
          </button>
        </div>
      </div>
    </div>
  );
}
