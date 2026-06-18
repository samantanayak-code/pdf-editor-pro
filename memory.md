# PDF Editor Pro: Converter Tab Quality Restoration

## Project Context
**Scope:** PDF Editor Pro -> `Converter` tab ONLY.
**Goal:** Achieve Adobe Acrobat Pro / Foxit level PDF-to-Word conversion quality for highly structured formal railway/infrastructure correspondence (e.g., JICC / PMC-TRS / MAHSR letters, NOO, Minutes of Meeting).
**Key Constraint:** The application must reconstruct the body to match the PDF’s layout as **editable Word content** while treating complex headers/footers as image assets.

## Recent Defects & Diagnostics
The conversion engine previously suffered from severe layout regressions:
1. **Word Fusion:** Words were merging without spaces (e.g., `1stFloor`, `Annexure-1.The`).
2. **Paragraph Shredding:** Standard letter paragraphs were being incorrectly detected as tables, tearing the text into jagged grids.
3. **Cell Flattening:** Multi-line text inside table cells (like NOO comments) was shredded into separate rows instead of wrapping cleanly within a single cell.
4. **Table Breaks:** Tables that spanned multiple pages were broken into entirely separate DOCX tables.

## Applied Architectural Fixes
The codebase (`textExtraction.ts` and `converter.ts`) has been overhauled to resolve these issues safely:

1. **Precision Whitespace Handling (`textExtraction.ts`)**
   - Tuned the visual gap threshold in `constructLine` from `0.15` to `0.08` to honor fine-grain spaces and eliminate word fusion without artificially splitting valid words.

2. **Hardened Table Detection (`converter.ts` -> `detectTables`)**
   - **Paragraph Exclusion:** Refined `candidateXs` to only pull anchors from tokens that start a new line or follow a >15pt gap. This ensures normal paragraphs are mathematically ignored by the table detector.
   - **Jump-Left Row Grouping:** Physical rows are now grouped into logical table rows using a "jump-left" heuristic. A new row only triggers if the text shifts back to a left-oriented column. This safely preserves multi-line wrapped cell content (like long comments) as a single unified Word cell.

3. **Multi-Page Table Continuity (`converter.ts` -> `convertPDFToWord`)**
   - **Dynamic Grid Merging:** The engine now processes all pages into an agnostic `PageContent[]` array. If a table ends on Page 1 and a structurally identical table starts on Page 2, the app merges the grids in-memory before building the DOCX, yielding a single native Word `<w:tbl>` that flows across pages.

4. **Native Image Headers/Footers (`converter.ts`)**
   - Eliminated the hacky multi-section architecture. Implemented Word's native `titlePage: true`. The first page uses the `first` header/footer stamp, and page 2+ uses the `default` header/footer stamp.

## Next Steps for Claude
1. **Fidelity Verification:** Run conversions on the samples in `D:\AI-APP\PDF_EDITOR\project\sample` (specifically the NOO and Reference documents).
2. **Column Width Refinement:** Table cell widths currently rely on coordinate mapping. If tables appear stretched or squished, refine the `width: { size, type: WidthType.DXA }` generation in `buildDocxTable`.
3. **Advanced Cell Merging (GridSpans):** The current logic maps tokens to the nearest column anchor. Evaluate if native Word `gridSpan` logic is required for headers that span multiple columns.
4. **Iterative Polish:** Continue tuning the heuristics in `detectTables` and `renderMixedContent` strictly based on observable discrepancies between the source PDFs in the `sample` folder and the generated DOCX outputs.
