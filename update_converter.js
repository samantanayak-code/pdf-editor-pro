const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, 'src/lib/pdf/converter.ts');
const content = fs.readFileSync(targetPath, 'utf8');
const lines = content.split('\n');

const startIdx = lines.findIndex(l => l.startsWith('function extractVectorBoundaries'));
const endIdx = lines.findIndex(l => l.startsWith('export function downloadFile'));

if (startIdx === -1 || endIdx === -1) {
  console.error('Could not find bounds', startIdx, endIdx);
  process.exit(1);
}

// Add interfaces above startIdx if they don't exist
const prefix = `
export interface ExcelCell {
  text: string;
  r: number;
  c: number;
  rowSpan: number;
  colSpan: number;
  isHeader?: boolean;
  align?: 'left' | 'center' | 'right';
  vAlign?: 'top' | 'middle' | 'bottom';
  bold?: boolean;
}

export interface ExcelTable {
  cells: ExcelCell[];
  numRows: number;
  numCols: number;
  colWidthsPts: number[];
  rowHeightsPts: number[];
  startY: number;
  endY: number;
  confidenceScore: number;
}
`;

const newCode = prefix + `
function extractVectorBoundaries(
  pageRects: Array<{ x: number; y: number; width: number; height: number }>,
  pageWidth: number
) {
  const vertLines: number[] = [];
  const horizLines: number[] = [];

  for (const r of pageRects) {
    if (r.height >= 2) {
      vertLines.push(r.x);
      vertLines.push(r.x + Math.max(1, r.width));
    }
    if (r.width >= 5) {
      horizLines.push(r.y);
      horizLines.push(r.y + Math.max(1, r.height));
    }
  }

  const deduplicate = (arr: number[], tolerance: number) => {
    arr.sort((a, b) => a - b);
    const deduped: number[] = [];
    for (const v of arr) {
      if (deduped.length === 0 || v - deduped[deduped.length - 1] > tolerance) {
        deduped.push(v);
      }
    }
    return deduped;
  };

  return { 
    vertBoundaries: deduplicate(vertLines, 4), 
    horizBoundaries: deduplicate(horizLines, 4) 
  };
}

function extractTablesForExcel(
  allLines: TextLine[],
  pageWidth: number,
  pageRects?: Array<{ x: number; y: number; width: number; height: number }>
): ExcelTable[] {
  if (!allLines.length) return [];

  const allTokens = allLines
    .flatMap(l => l.tokens.filter(t => t.text.trim().length > 0))
    .sort((a, b) => a.y !== b.y ? a.y - b.y : a.x - b.x);
  
  if (!allTokens.length) return [];

  let vertBoundaries: number[] = [];
  let horizBoundaries: number[] = [];
  if (pageRects && pageRects.length > 0) {
    const b = extractVectorBoundaries(pageRects, pageWidth);
    vertBoundaries = b.vertBoundaries;
    horizBoundaries = b.horizBoundaries;
  }

  const hasVectorCols = vertBoundaries.length >= 2;
  const hasVectorRows = horizBoundaries.length >= 3; 

  // --- PHASE 1: FULL GEOMETRIC RECONSTRUCTION ---
  if (hasVectorCols && hasVectorRows) {
    const numCols = vertBoundaries.length - 1;
    const numRows = horizBoundaries.length - 1;
    
    const skipMap = new Set<string>();
    const cells: ExcelCell[] = [];

    const hasVerticalLine = (cIdx: number, rIdx: number) => {
       if (!pageRects) return false;
       const vX = vertBoundaries[cIdx];
       const rTop = horizBoundaries[rIdx];
       const rBot = horizBoundaries[rIdx + 1];
       return pageRects.some(r => 
         (Math.abs(r.x - vX) <= 4 || Math.abs(r.x + r.width - vX) <= 4) &&
         r.y <= rTop + 4 && (r.y + r.height) >= rBot - 4
       );
    };

    const hasHorizontalLine = (rIdx: number, cIdx: number) => {
       if (!pageRects) return false;
       const hY = horizBoundaries[rIdx];
       const cLeft = vertBoundaries[cIdx];
       const cRight = vertBoundaries[cIdx + 1];
       return pageRects.some(r => 
         (Math.abs(r.y - hY) <= 4 || Math.abs(r.y + r.height - hY) <= 4) &&
         r.x <= cLeft + 4 && (r.x + r.width) >= cRight - 4
       );
    };

    for (let r = 0; r < numRows; r++) {
      for (let c = 0; c < numCols; c++) {
        if (skipMap.has(\`\${r},\${c}\`)) continue;

        let colSpan = 1;
        while (c + colSpan < numCols && !hasVerticalLine(c + colSpan, r)) {
          colSpan++;
        }

        let rowSpan = 1;
        let canExpandDown = true;
        while (r + rowSpan < numRows && canExpandDown) {
          for (let i = 0; i < colSpan; i++) {
             if (hasHorizontalLine(r + rowSpan, c + i)) {
               canExpandDown = false;
               break;
             }
          }
          if (canExpandDown) {
             for (let i = 1; i < colSpan; i++) {
                if (hasVerticalLine(c + i, r + rowSpan)) {
                   canExpandDown = false;
                   break;
                }
             }
          }
          if (canExpandDown) {
             rowSpan++;
          }
        }

        for (let rr = 0; rr < rowSpan; rr++) {
          for (let cc = 0; cc < colSpan; cc++) {
            skipMap.add(\`\${r + rr},\${c + cc}\`);
          }
        }

        cells.push({
          text: '',
          r,
          c,
          rowSpan,
          colSpan,
          isHeader: r < Math.min(3, Math.ceil(numRows * 0.15))
        });
      }
    }

    const cellTokenMap = new Map<ExcelCell, TextToken[]>();
    for (const cell of cells) {
       cellTokenMap.set(cell, []);
    }

    for (const tok of allTokens) {
      const tCx = tok.x + tok.width / 2;
      const tCy = tok.y + tok.height / 2;
      
      let bestCell: ExcelCell | null = null;
      for (const cell of cells) {
         const left = vertBoundaries[cell.c];
         const right = vertBoundaries[cell.c + cell.colSpan];
         const top = horizBoundaries[cell.r];
         const bottom = horizBoundaries[cell.r + cell.rowSpan];
         
         if (tCx >= left - 2 && tCx <= right + 2 && tCy >= top - 2 && tCy <= bottom + 2) {
            bestCell = cell;
            break;
         }
      }
      
      if (!bestCell) {
         let minD = Infinity;
         for (const cell of cells) {
            const left = vertBoundaries[cell.c];
            const right = vertBoundaries[cell.c + cell.colSpan];
            const top = horizBoundaries[cell.r];
            const bottom = horizBoundaries[cell.r + cell.rowSpan];
            const cx = (left + right) / 2;
            const cy = (top + bottom) / 2;
            const d = Math.pow(tCx - cx, 2) + Math.pow(tCy - cy, 2);
            if (d < minD) {
               minD = d;
               bestCell = cell;
            }
         }
      }
      if (bestCell) {
         cellTokenMap.get(bestCell).push(tok);
      }
    }

    const rowHeightsPts: number[] = Array(numRows).fill(14); 

    for (const cell of cells) {
       const toks = cellTokenMap.get(cell);
       if (!toks || !toks.length) continue;
       
       toks.sort((a, b) => Math.abs(a.y - b.y) > 3 ? a.y - b.y : a.x - b.x);
       
       const cellLeft = vertBoundaries[cell.c];
       const cellRight = vertBoundaries[cell.c + cell.colSpan];
       const cellWidth = cellRight - cellLeft;
       
       const avgX = toks.reduce((sum, t) => sum + t.x, 0) / toks.length;
       if (avgX - cellLeft > cellWidth * 0.3 && cellRight - avgX > cellWidth * 0.3) {
          cell.align = 'center';
       } else {
          cell.align = 'left';
       }
       cell.vAlign = 'top';
       if (cell.isHeader) {
           cell.bold = true;
           cell.align = 'center';
           cell.vAlign = 'middle';
       }
       
       let cellStr = '';
       let currentYLine = toks[0].y;
       let lineCount = 1;

       for (const t of toks) {
          if (Math.abs(t.y - currentYLine) > 4) { 
            cellStr += '\\n' + t.text;
            currentYLine = t.y;
            lineCount++;
          } else { 
            if (cellStr.length > 0 && !cellStr.endsWith('\\n') && !cellStr.endsWith(' ')) {
              cellStr += ' ';
            }
            cellStr += t.text;
          }
       }
       cell.text = cellStr.trim();

       const requiredHeight = lineCount * 14;
       const heightPerR = requiredHeight / cell.rowSpan;
       for (let i = 0; i < cell.rowSpan; i++) {
         if (rowHeightsPts[cell.r + i] < heightPerR) {
            rowHeightsPts[cell.r + i] = heightPerR;
         }
       }
    }

    const colWidthsPts: number[] = [];
    for (let c = 0; c < numCols; c++) {
      colWidthsPts.push(Math.max(40, vertBoundaries[c + 1] - vertBoundaries[c]));
    }

    return [{
      cells,
      numRows,
      numCols,
      colWidthsPts,
      rowHeightsPts,
      startY: horizBoundaries[0],
      endY: horizBoundaries[numRows],
      confidenceScore: 0.95
    }];
  }

  // --- PHASE 2: HYBRID / HEURISTIC FALLBACK ---
  interface PhysBand {
    y: number;
    height: number;
    tokens: typeof allTokens;
  }
  const bands: PhysBand[] = [];
  let bTokens = [allTokens[0]];
  for (let i = 1; i <= allTokens.length; i++) {
    const tok = allTokens[i];
    if (tok && Math.abs(tok.y - bTokens[0].y) <= 3) {
      bTokens.push(tok);
    } else {
      bands.push({ y: bTokens[0].y, height: bTokens[0].height || 11, tokens: [...bTokens] });
      bTokens = tok ? [tok] : [];
    }
  }
  if (!bands.length) return [];

  let anchors: number[] = [];
  let isVectorColsFallback = false;

  if (hasVectorCols) {
    anchors = vertBoundaries;
    isVectorColsFallback = true;
  } else {
    const minSep = pageWidth * 0.10;
    const skip = Math.min(3, Math.floor(bands.length * 0.15));
    const bodyTokens = bands.slice(skip).flatMap(b => b.tokens);
    const bodyXs = bodyTokens.map(t => t.x).sort((a, b) => a - b);

    if (bodyXs.length) {
      const bxClusters: number[][] = [];
      let bc = [bodyXs[0]];
      for (let i = 1; i < bodyXs.length; i++) {
        if (bodyXs[i] - bc[bc.length - 1] <= 15) bc.push(bodyXs[i]);
        else { bxClusters.push(bc); bc = [bodyXs[i]]; }
      }
      bxClusters.push(bc);

      for (const cl of bxClusters) {
        const clX = Math.min(...cl);
        const clYs = new Set(bodyTokens.filter(t => cl.some(cx => Math.abs(t.x - cx) <= 15)).map(t => t.y));
        if (clYs.size >= 2 && (!anchors.length || clX - anchors[anchors.length - 1] >= minSep)) {
          anchors.push(clX);
        }
      }
    }

    if (anchors.length < 2) {
      anchors = [];
      const allXs = allTokens.map(t => t.x).sort((a, b) => a - b);
      const axClusters: number[][] = [];
      let ac = [allXs[0]];
      for (let i = 1; i < allXs.length; i++) {
        if (allXs[i] - ac[ac.length - 1] <= 15) ac.push(allXs[i]);
        else { axClusters.push(ac); ac = [allXs[i]]; }
      }
      axClusters.push(ac);
      for (const cl of axClusters) {
        const clX = Math.min(...cl);
        const clYs = new Set(allTokens.filter(t => cl.some(cx => Math.abs(t.x - cx) <= 15)).map(t => t.y));
        if (clYs.size >= 2 && (!anchors.length || clX - anchors[anchors.length - 1] >= minSep)) {
          anchors.push(clX);
        }
      }
    }
  }

  if (anchors.length < 2) {
    const singleCell: ExcelCell = {
        text: allLines.map(l => l.text.trim()).join('\\n'),
        r: 0, c: 0, rowSpan: 1, colSpan: 1
    };
    return [{
        cells: [singleCell],
        numRows: 1, numCols: 1,
        colWidthsPts: [pageWidth * 0.9],
        rowHeightsPts: [allLines.length * 14],
        startY: allLines[0].y, endY: allLines[allLines.length - 1].y,
        confidenceScore: 0.1
    }];
  }

  const numCols = isVectorColsFallback ? anchors.length - 1 : anchors.length;

  const assignCol = (x: number): number => {
    if (isVectorColsFallback) {
      for (let ci = 0; ci < numCols; ci++) {
        if (x >= anchors[ci] - 2 && x <= anchors[ci + 1] + 2) return ci;
      }
      if (x < anchors[0]) return 0;
      return numCols - 1;
    } else {
      for (let ci = 0; ci < numCols - 1; ci++) {
        if (x < (anchors[ci] + anchors[ci + 1]) / 2) return ci;
      }
      return numCols - 1;
    }
  };

  interface ColBand {
    y: number;
    height: number;
    cols: string[];
    filledCount: number;
  }

  let tableStartIdx = 0;
  for (let i = 0; i < bands.length; i++) {
    const colSet = new Set(bands[i].tokens.map(t => assignCol(t.x)));
    if (colSet.size >= Math.min(3, numCols)) { tableStartIdx = i; break; }
  }

  const colBands: ColBand[] = bands.slice(tableStartIdx).map(band => {
    const cols = Array.from({ length: numCols }, () => '');
    band.tokens.forEach(t => {
      const ci = assignCol(t.x);
      cols[ci] += (cols[ci] ? ' ' : '') + t.text;
    });
    return { y: band.y, height: band.height, cols, filledCount: cols.filter(c => c.trim()).length };
  });

  const sortedH = [...bands].map(b => b.height).sort((a, b) => a - b);
  const medianH = sortedH[Math.floor(sortedH.length / 2)] || 11;
  const ROW_GAP_FACTOR = 1.8;
  const logicalRows: ColBand[][] = [];
  let curRow: ColBand[] = [];
  let col0LineCount = 0;

  for (let bi = 0; bi < colBands.length; bi++) {
    const band = colBands[bi];
    const prev = colBands[bi - 1];

    const yGap = prev ? band.y - (prev.y + prev.height) : 0;
    const largeGap = prev && yGap > medianH * ROW_GAP_FACTOR;
    const col0Reset = band.cols[0].trim().length > 0 && col0LineCount > 0 && curRow.length >= 4;

    if (largeGap || col0Reset) {
      if (curRow.length) logicalRows.push(curRow);
      curRow = [];
      col0LineCount = 0;
    }

    curRow.push(band);
    if (band.cols[0].trim().length > 0) col0LineCount++;
  }
  if (curRow.length) logicalRows.push(curRow);

  const cells: ExcelCell[] = [];
  const rowHeightsPts: number[] = [];

  logicalRows.forEach((rowBands, rIdx) => {
    let maxLines = 1;
    rowBands.forEach(band => {
      band.cols.forEach((content, ci) => {
        if (!content.trim()) return;
        let existing = cells.find(c => c.r === rIdx && c.c === ci);
        if (!existing) {
            existing = { text: '', r: rIdx, c: ci, rowSpan: 1, colSpan: 1, isHeader: rIdx === 0 };
            cells.push(existing);
        }
        existing.text += (existing.text ? '\\n' : '') + content.trim();
        maxLines = Math.max(maxLines, existing.text.split('\\n').length);
      });
    });
    rowHeightsPts.push(maxLines * 14);
  });

  if (!cells.length) return [];

  const colWidthsPts: number[] = [];
  for (let ci = 0; ci < numCols; ci++) {
    const nextX = isVectorColsFallback ? anchors[ci + 1] : (anchors[ci + 1] ?? pageWidth);
    colWidthsPts.push(Math.max(40, nextX - anchors[ci]));
  }

  return [{
    cells,
    numRows: logicalRows.length,
    numCols,
    colWidthsPts,
    rowHeightsPts,
    startY: bands[0]?.y ?? 0,
    endY: bands[bands.length - 1]?.y ?? 0,
    confidenceScore: 0.65
  }];
}

function styleExcelSheet(
  ws: XLSX.WorkSheet,
  table: ExcelTable,
  pageWidth: number
): void {
  const totalPts = table.colWidthsPts.reduce((a, b) => a + b, 0);
  const colWidths = table.colWidthsPts.map(pts => {
    const proportion = pts / totalPts;
    const excelChars = Math.round(proportion * 120); 
    return Math.max(8, Math.min(80, excelChars));
  });
  ws['!cols'] = colWidths.map(w => ({ wch: w }));
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  
  if (!ws['!rows']) ws['!rows'] = [];
  table.rowHeightsPts.forEach((hpt, r) => {
     (ws['!rows'])[r] = { hpt: hpt + 4 };
  });

  const merges: XLSX.Range[] = [];

  let maxR = table.numRows - 1;
  let maxC = table.numCols - 1;

  for (let R = 0; R <= maxR; R++) {
    for (let C = 0; C <= maxC; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      if (!ws[addr]) ws[addr] = { t: 's', v: '' };

      const isEven = R % 2 === 0;
      ws[addr].s = {
        font: {
          name: 'Calibri',
          sz: 10,
          color: { rgb: '1A1A1A' },
        },
        fill: {
          patternType: 'solid',
          fgColor: { rgb: 'FFFFFF' },
        },
        alignment: { vertical: 'top', wrapText: true, horizontal: 'left' },
        border: {
          top:    { style: 'thin', color: { rgb: 'CCCCCC' } },
          bottom: { style: 'thin', color: { rgb: 'CCCCCC' } },
          left:   { style: 'thin', color: { rgb: 'CCCCCC' } },
          right:  { style: 'thin', color: { rgb: 'CCCCCC' } },
        },
      };
    }
  }

  for (const cell of table.cells) {
    if (cell.rowSpan > 1 || cell.colSpan > 1) {
       merges.push({
           s: { r: cell.r, c: cell.c },
           e: { r: cell.r + cell.rowSpan - 1, c: cell.c + cell.colSpan - 1 }
       });
    }

    const addr = XLSX.utils.encode_cell({ r: cell.r, c: cell.c });
    if (!ws[addr]) ws[addr] = { t: 's', v: '' };
    
    let cellV = cell.text;
    let t = 's';
    if (/^[0-9,]+(\\.[0-9]+)?$/.test(cellV.trim())) {
        t = 'n';
        cellV = cellV.replace(/,/g, '');
    }
    ws[addr].v = cellV;
    ws[addr].t = t;

    for (let rr = 0; rr < cell.rowSpan; rr++) {
       for (let cc = 0; cc < cell.colSpan; cc++) {
          const subAddr = XLSX.utils.encode_cell({ r: cell.r + rr, c: cell.c + cc });
          if (!ws[subAddr]) continue;
          
          ws[subAddr].s = {
              ...ws[subAddr].s,
              font: {
                 name: 'Calibri',
                 sz: cell.isHeader ? 10 : 9,
                 bold: cell.bold || cell.isHeader,
                 color: { rgb: cell.isHeader ? 'FFFFFF' : '000000' }
              },
              fill: {
                 patternType: 'solid',
                 fgColor: { rgb: cell.isHeader ? '1F3864' : 'FFFFFF' }
              },
              alignment: {
                 vertical: cell.vAlign || 'top',
                 horizontal: cell.align || 'left',
                 wrapText: true
              }
          };

          const isTopEdge = rr === 0;
          const isBottomEdge = rr === cell.rowSpan - 1;
          const isLeftEdge = cc === 0;
          const isRightEdge = cc === cell.colSpan - 1;

          ws[subAddr].s.border = {
              top:    { style: isTopEdge ? 'medium' : 'none', color: { rgb: '555555' } },
              bottom: { style: isBottomEdge ? 'medium' : 'none', color: { rgb: '555555' } },
              left:   { style: isLeftEdge ? 'medium' : 'none', color: { rgb: '555555' } },
              right:  { style: isRightEdge ? 'medium' : 'none', color: { rgb: '555555' } },
          };
       }
    }
  }

  if (merges.length > 0) {
      ws['!merges'] = merges;
  }
}

export async function convertPDFTablesToExcel(
  file: File,
  onProgress?: (msg: string) => void
): Promise<Blob> {
  if (onProgress) onProgress('Phase 1/3: Analyzing PDF structure...');
  const doc: StructuredDocument = await extractStructuredDocument(file, file.name);
  const workbook = XLSX.utils.book_new();

  const totalTokens = doc.pages.reduce(
    (acc, p) => acc + p.blocks.reduce((b, bl) => b + bl.lines.reduce((l, ln) => l + ln.tokens.length, 0), 0), 0
  );
  if (totalTokens < 20 && doc.pages.length > 0) throw new Error('SCANNED_PDF');

  const summaryRows: string[][] = [
    ['PDF to Excel Conversion Summary'],
    ['Source file:', file.name],
    ['Converted on:', new Date().toLocaleString()],
    ['Pages processed:', String(doc.pages.length)],
    [''],
    ['Sheet', 'Content', 'Rows', 'Columns', 'Confidence'],
  ];

  let sheetIndex = 0;

  for (let pi = 0; pi < doc.pages.length; pi++) {
    const page = doc.pages[pi];
    if (onProgress) onProgress(\`Phase 2/3: Extracting tables (Page \${pi + 1}/\${doc.pages.length})...\`);

    const regions = detectPageRegions(page);
    const bodyBlocks = page.blocks.filter(b =>
      b.lines.length > 0 && b.lines[0].y >= regions.body.y - 5
    );
    const allLines = bodyBlocks.flatMap(b => b.lines);
    if (!allLines.length) continue;

    const isLandscape = page.width > page.height;
    const extractedTables = extractTablesForExcel(allLines, page.width, page.vectorRects);

    for (const table of extractedTables) {
      if (table.numRows === 0 || table.numCols === 0) continue;
      sheetIndex++;

      const rawName = extractedTables.length === 1
        ? \`Page_\${pi + 1}\`
        : \`Page_\${pi + 1}_T\${sheetIndex}\`;
      const sheetName = rawName.slice(0, 31);

      const ws = {} as XLSX.WorkSheet;
      ws['!ref'] = XLSX.utils.encode_range({
         s: { r: 0, c: 0 },
         e: { r: Math.max(0, table.numRows - 1), c: Math.max(0, table.numCols - 1) }
      });
      
      styleExcelSheet(ws, table, page.width);
      
      ws['!pageSetup'] = {
        orientation: isLandscape ? 'landscape' : 'portrait',
        fitToPage: true, fitToWidth: 1, fitToHeight: 0,
        horizontalCentered: true
      };

      ws['!margins'] = { left: 0.25, right: 0.25, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 };

      XLSX.utils.book_append_sheet(workbook, ws, sheetName);
      summaryRows.push([
        sheetName, 
        \`Page \${pi + 1}\`, 
        String(table.numRows), 
        String(table.numCols),
        \`\${Math.round(table.confidenceScore * 100)}%\`
      ]);
    }
  }

  if (onProgress) onProgress('Phase 3/3: Finalizing workbook...');

  if (sheetIndex === 0) {
    const ws = XLSX.utils.aoa_to_sheet([['No tables found in this PDF.'], ['Try the PDF → Word converter instead.']]);
    XLSX.utils.book_append_sheet(workbook, ws, 'No Tables Found');
  }

  const summaryWs = XLSX.utils.aoa_to_sheet(summaryRows);
  summaryWs['!cols'] = [{ wch: 24 }, { wch: 40 }, { wch: 12 }, { wch: 10 }, { wch: 12 }];
  const sumRange = XLSX.utils.decode_range(summaryWs['!ref'] || 'A1');
  for (let R = sumRange.s.r; R <= sumRange.e.r; R++) {
    for (let C = sumRange.s.c; C <= sumRange.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      if (!summaryWs[addr]) summaryWs[addr] = { t: 's', v: '' };
      summaryWs[addr].s = {
        font: { name: 'Calibri', sz: R === 0 ? 13 : 9, bold: R === 0 || R === 5 },
        fill: R === 5 ? { patternType: 'solid', fgColor: { rgb: 'E8ECF2' } } : undefined,
      };
    }
  }
  workbook.SheetNames.unshift('Summary');
  workbook.Sheets['Summary'] = summaryWs;

  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array', cellStyles: true });
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
`;

const outputLines = [
  ...lines.slice(0, startIdx),
  newCode,
  ...lines.slice(endIdx)
];

fs.writeFileSync(targetPath, outputLines.join('\n'), 'utf8');
console.log('Successfully updated converter.ts');
