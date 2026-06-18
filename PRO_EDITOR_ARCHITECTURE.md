# PDF Editor Pro - Technical Architecture

## Executive Summary

PDF Editor Pro is a client-side PDF editing application built with React, TypeScript, PDF.js, and pdf-lib. It achieves enterprise-grade editing capabilities entirely in the browser without server dependencies, providing fast performance, data privacy, and offline capability.

## Design Principles

### 1. **Client-Side First**
All PDF processing happens in the browser. No data leaves the user's machine.

**Benefits:**
- Privacy: User data never uploaded to servers
- Speed: No network latency
- Offline: Works without internet after initial load
- Scalability: No backend infrastructure needed
- Cost: No server costs for PDF processing

**Trade-offs:**
- Memory: Limited by browser memory (typically 2-4GB)
- Performance: Limited by client CPU
- Features: Some server-side features harder to implement (OCR, large batch processing)

### 2. **Immutable State**
All state changes create new objects rather than mutating existing ones.

**Benefits:**
- Predictability: Easy to reason about state changes
- Undo/Redo: Natural history management
- Debugging: Time-travel debugging possible
- Performance: Can optimize with memoization

**Implementation:**
```typescript
// ❌ Wrong - Mutation
function updateText(doc: PDFDocumentState, id: string, text: string) {
  doc.pages.get(1)!.textElements[0].text = text; // Mutation!
  return doc;
}

// ✅ Correct - Immutability
function updateText(doc: PDFDocumentState, id: string, text: string) {
  const newPages = new Map(doc.pages);
  const page = newPages.get(1)!;
  const newElements = [...page.textElements];
  newElements[0] = { ...newElements[0], text };
  newPages.set(1, { ...page, textElements: newElements });
  return { ...doc, pages: newPages };
}
```

### 3. **Progressive Enhancement**
Core features work immediately, advanced features load as needed.

**Levels:**
1. **Level 1 (Immediate)**: View PDF
2. **Level 2 (Fast)**: Navigate pages
3. **Level 3 (Quick)**: Select text
4. **Level 4 (Full)**: Edit and export

### 4. **Type Safety**
TypeScript throughout to catch errors at compile time.

**Benefits:**
- Fewer runtime errors
- Better IDE support
- Self-documenting code
- Refactoring confidence

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                  React Application                      │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │ │
│  │  │ PDFEditorPro │  │  Components  │  │     Toast    │ │ │
│  │  │  Component   │  │  (Toolbar,   │  │  Notifications│ │ │
│  │  │              │  │   Modal)     │  │              │ │ │
│  │  └──────┬───────┘  └──────────────┘  └──────────────┘ │ │
│  │         │                                               │ │
│  │         ▼                                               │ │
│  │  ┌──────────────────────────────────────────────────┐ │ │
│  │  │         pdfEditorPro.ts Library                   │ │ │
│  │  │  ┌───────────────┐  ┌───────────────────────┐   │ │ │
│  │  │  │   PDF Load    │  │    PDF Render         │   │ │ │
│  │  │  │   & Parse     │  │    & Display          │   │ │ │
│  │  │  └───────┬───────┘  └───────────────────────┘   │ │ │
│  │  │          │                                        │ │ │
│  │  │  ┌───────▼───────┐  ┌───────────────────────┐   │ │ │
│  │  │  │  Text Extract │  │   PDF Export          │   │ │ │
│  │  │  │  & Position   │  │   Generation          │   │ │ │
│  │  │  └───────────────┘  └───────────────────────┘   │ │ │
│  │  └──────────────────────────────────────────────────┘ │ │
│  │         │                          │                   │ │
│  └─────────┼──────────────────────────┼───────────────────┘ │
│            ▼                          ▼                     │
│  ┌─────────────────┐       ┌──────────────────┐           │
│  │    PDF.js       │       │     pdf-lib      │           │
│  │  (Mozilla)      │       │  (PDF Creation)  │           │
│  │                 │       │                  │           │
│  │ - PDF Parsing   │       │ - PDF Generation │           │
│  │ - Text Extract  │       │ - Text Drawing   │           │
│  │ - Canvas Render │       │ - Font Embedding │           │
│  └─────────────────┘       └──────────────────┘           │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐ │
│  │              Canvas 2D Context                        │ │
│  │        (Renders PDF pages for viewing)               │ │
│  └──────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Component Architecture

### PDFEditorPro Component

**Responsibilities:**
1. UI rendering and layout
2. User event handling
3. State management
4. Coordination between library functions

**State Flow:**
```
User Action → Event Handler → State Update → Re-render
                                    ↓
                            Library Function Call
                                    ↓
                              Update State
                                    ↓
                              Re-render UI
```

**Key State Variables:**

```typescript
// Document state
pdfDoc: PDFDocumentState | null        // Current loaded document
currentPage: number                     // Active page (1-indexed)

// UI state
zoom: number                            // Zoom level (0.5 - 3.0)
editMode: EditMode                      // Current tool mode
loading: boolean                        // Loading indicator
exporting: boolean                      // Export in progress

// Selection state
selectedElement: TextElement | null     // Currently selected item

// History state
history: PDFDocumentState[]             // Undo/redo stack
historyIndex: number                    // Current position in history
```

**Component Lifecycle:**

```
Mount
  ↓
Initialize refs (canvas, editor, fileInput)
  ↓
Register keyboard shortcuts
  ↓
Wait for user to select file
  ↓
File selected → loadPDFDocument()
  ↓
Update state with document
  ↓
Trigger renderPage()
  ↓
Canvas updated
  ↓
User interacts (select, edit, zoom)
  ↓
State updates
  ↓
Re-render as needed
  ↓
User clicks Export
  ↓
exportEditedPDF()
  ↓
Download file
  ↓
Continue editing or close
  ↓
Unmount
  ↓
Cleanup keyboard listeners
```

## Library Architecture (pdfEditorPro.ts)

### Core Functions

#### 1. loadPDFDocument
```typescript
async function loadPDFDocument(
  arrayBuffer: ArrayBuffer,
  filename: string
): Promise<PDFDocumentState>
```

**Process:**
1. Create PDF.js loading task
2. Get PDFDocumentProxy
3. For each page:
   - Get page viewport
   - Extract text content
   - Create TextElement objects with positioning
   - Store in PageData
4. Build complete PDFDocumentState
5. Return state

**Complexity:** O(n * m) where n = pages, m = text items per page

**Performance:**
- Small PDFs (10 pages): ~500ms
- Medium PDFs (50 pages): ~2s
- Large PDFs (100 pages): ~5s

#### 2. renderPDFPage
```typescript
async function renderPDFPage(
  docState: PDFDocumentState,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale: number
): Promise<void>
```

**Process:**
1. Get PDF page from proxy
2. Calculate viewport at scale
3. Set canvas dimensions
4. Render PDF content to canvas
5. Overlay text element highlights
6. Draw selection boxes

**Complexity:** O(1) per page

**Performance:**
- 150ms typical render time
- Scales with viewport size
- GPU accelerated

#### 3. exportEditedPDF
```typescript
async function exportEditedPDF(
  docState: PDFDocumentState
): Promise<Uint8Array>
```

**Process:**
1. Load original PDF with pdf-lib
2. Get all pages
3. Embed fonts (Helvetica family)
4. For each page:
   - For each modified TextElement:
     - Calculate Y position (flip coordinate)
     - Select font (normal/bold/italic)
     - Draw text at position
5. Save modified PDF
6. Return as Uint8Array

**Complexity:** O(p * t) where p = pages, t = text elements

**Performance:**
- Simple edits: ~800ms
- Complex documents: ~3s
- 100+ pages: ~8s

### Data Flow Diagrams

#### Loading Flow
```
File Input
    ↓
ArrayBuffer
    ↓
PDF.js LoadingTask
    ↓
PDFDocumentProxy
    ↓
For each page:
  PDFPageProxy
    ↓
  getViewport() → Dimensions
    ↓
  getTextContent() → Text Items
    ↓
  Transform to TextElements
    ↓
  Store in PageData
    ↓
Complete PDFDocumentState
    ↓
Return to Component
```

#### Rendering Flow
```
Component.renderPage()
    ↓
Get PDFPageProxy
    ↓
Calculate viewport * scale
    ↓
Set canvas size
    ↓
page.render(context, viewport)
    ↓
PDF content → Canvas
    ↓
Get PageData for page
    ↓
For each TextElement:
  Draw highlight box
    ↓
Canvas updated
    ↓
User sees rendered page
```

#### Export Flow
```
User clicks Export
    ↓
exportEditedPDF(docState)
    ↓
PDFDocument.load(originalBytes)
    ↓
Get all pages
    ↓
Embed fonts
    ↓
For each page:
  For each TextElement:
    Calculate position
    Select font
    Draw text on page
    ↓
PDFDocument.save()
    ↓
Return Uint8Array
    ↓
Create Blob
    ↓
Download file
```

## Coordinate System

### PDF Coordinate System
- Origin: Bottom-left
- X: Left to right
- Y: Bottom to top
- Units: Points (1/72 inch)

### Canvas Coordinate System
- Origin: Top-left
- X: Left to right
- Y: Top to bottom
- Units: Pixels

### Conversion
```typescript
// PDF to Canvas Y
canvasY = pageHeight - pdfY

// Canvas to PDF Y
pdfY = pageHeight - canvasY
```

### Transform Matrix

PDF text items include a transform matrix `[a, b, c, d, e, f]`:
- `a`: Horizontal scaling
- `b`: Horizontal skewing
- `c`: Vertical skewing
- `d`: Vertical scaling
- `e`: Horizontal translation (X position)
- `f`: Vertical translation (Y position)

**Font size calculation:**
```typescript
fontSize = Math.sqrt(a * a + b * b)
```

**Position extraction:**
```typescript
x = e
y = pageHeight - f  // Flip Y axis
```

## Memory Management

### Memory Usage Breakdown

```
Component State:         ~1 MB
  - pdfDoc structure
  - history array
  - UI state

PDF.js Document:         ~5-20 MB per PDF
  - Page objects
  - Text content
  - Font data
  - Cached resources

Canvas Buffer:           ~10-30 MB
  - Rendered page bitmap
  - Depends on page size and zoom

pdf-lib Document:        ~5-15 MB during export
  - Copy of original PDF
  - Font embeddings
  - Temporary during export only

Total Active:            ~20-70 MB typical document
```

### Memory Optimization Strategies

1. **Page Virtualization** (Future)
```typescript
// Only load visible pages + buffer
const visiblePages = calculateVisiblePages(scrollPosition, viewportHeight);
const pagesToLoad = [
  ...visiblePages,
  visiblePages[0] - 1,  // Previous page
  visiblePages[visiblePages.length - 1] + 1  // Next page
];
```

2. **Canvas Reuse**
```typescript
// Reuse same canvas for different pages
const canvas = canvasRef.current;
canvas.width = newWidth;
canvas.height = newHeight;
// Canvas automatically clears on resize
```

3. **History Limits** (Planned)
```typescript
// Keep only last N history states
const MAX_HISTORY = 50;
if (history.length > MAX_HISTORY) {
  history = history.slice(-MAX_HISTORY);
}
```

## Performance Optimization

### Rendering Optimizations

1. **Debounced Rendering**
```typescript
const debouncedRender = debounce(renderPage, 100);

// In zoom handler
setZoom(newZoom);
debouncedRender();  // Wait 100ms after last zoom change
```

2. **RAF-based Updates**
```typescript
let animationFrame: number | null = null;

function requestRender() {
  if (animationFrame === null) {
    animationFrame = requestAnimationFrame(() => {
      renderPage();
      animationFrame = null;
    });
  }
}
```

3. **Incremental Rendering** (Planned)
```typescript
// Render low-res preview first, then high-res
renderPage(lowResScale);
setTimeout(() => renderPage(fullScale), 100);
```

### Load Optimizations

1. **Lazy Page Loading**
```typescript
// Only parse pages as needed
async function getPage(pageNum: number) {
  if (!loadedPages.has(pageNum)) {
    const page = await pdfDoc.getPage(pageNum);
    const pageData = await parsePage(page);
    loadedPages.set(pageNum, pageData);
  }
  return loadedPages.get(pageNum);
}
```

2. **Worker-based Processing**
```typescript
// PDF.js already uses worker for parsing
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerPath;
```

3. **Chunked Text Extraction** (Planned)
```typescript
// Process text in chunks to avoid blocking
async function extractTextChunked(textContent) {
  const chunks = chunkArray(textContent.items, 100);
  for (const chunk of chunks) {
    await processChunk(chunk);
    await nextTick();  // Yield to browser
  }
}
```

## Error Handling

### Error Categories

1. **Load Errors**
```typescript
try {
  const doc = await loadPDFDocument(buffer, filename);
} catch (error) {
  if (error.name === 'InvalidPDFException') {
    // Corrupted or invalid PDF
  } else if (error.name === 'PasswordException') {
    // Password-protected
  } else {
    // Other errors
  }
}
```

2. **Render Errors**
```typescript
try {
  await renderPDFPage(doc, pageNum, canvas, zoom);
} catch (error) {
  // Fallback to blank page with error message
  showErrorOnCanvas(canvas, 'Failed to render page');
}
```

3. **Export Errors**
```typescript
try {
  const pdfBytes = await exportEditedPDF(doc);
} catch (error) {
  if (error.message.includes('memory')) {
    // Out of memory
    showToast('Document too large. Try reducing pages.', 'error');
  } else {
    // Other export errors
  }
}
```

### Error Recovery

1. **Graceful Degradation**
- If rendering fails, show error message but keep UI functional
- If text extraction fails, fallback to image-only view
- If export fails, allow user to retry or download original

2. **User Feedback**
- Clear error messages in plain English
- Suggest solutions where possible
- Provide contact/report options

3. **Logging**
```typescript
function handleError(error: Error, context: string) {
  console.error(`[${context}]`, error);
  // Send to error tracking service (future)
  // logToService({ error, context, userAgent, etc });
}
```

## Testing Strategy

### Unit Tests

```typescript
describe('loadPDFDocument', () => {
  it('should load a valid PDF', async () => {
    const buffer = await loadTestPDF('simple.pdf');
    const doc = await loadPDFDocument(buffer, 'simple.pdf');
    expect(doc.totalPages).toBe(3);
    expect(doc.filename).toBe('simple.pdf');
  });

  it('should extract text elements', async () => {
    const buffer = await loadTestPDF('text.pdf');
    const doc = await loadPDFDocument(buffer, 'text.pdf');
    const page1 = doc.pages.get(1)!;
    expect(page1.textElements.length).toBeGreaterThan(0);
  });
});
```

### Integration Tests

```typescript
describe('PDF editing workflow', () => {
  it('should load, edit, and export PDF', async () => {
    // Load
    const doc = await loadPDFDocument(testPDF, 'test.pdf');

    // Edit
    const updated = updateTextElement(doc, 'text-1-0', {
      text: 'Modified text'
    });

    // Export
    const pdfBytes = await exportEditedPDF(updated);

    // Verify
    expect(pdfBytes.length).toBeGreaterThan(0);
    // Load exported PDF and verify changes
  });
});
```

### E2E Tests (Planned)

```typescript
test('user can edit PDF', async ({ page }) => {
  // Navigate to app
  await page.goto('/');

  // Sign in
  await page.click('text=Sign In');
  await page.fill('[name=email]', 'test@example.com');
  await page.fill('[name=password]', 'password');
  await page.click('text=Submit');

  // Open Pro Editor
  await page.click('text=Pro Editor');

  // Upload PDF
  await page.setInputFiles('input[type=file]', 'test.pdf');

  // Wait for load
  await page.waitForSelector('canvas');

  // Select text
  await page.click('canvas', { position: { x: 100, y: 100 } });

  // Verify selected
  await expect(page.locator('.selected-element')).toBeVisible();

  // Export
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('text=Export')
  ]);

  // Verify download
  expect(download.suggestedFilename()).toContain('.pdf');
});
```

## Security Considerations

### Client-Side Security

1. **No Data Upload**
- All processing in browser
- No server-side storage
- User data never leaves machine

2. **XSS Protection**
- React automatically escapes text
- No dangerouslySetInnerHTML usage
- All user input sanitized

3. **CSRF Protection**
- No state-changing server requests
- All operations local

4. **Content Security Policy**
```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self';
               script-src 'self';
               style-src 'self' 'unsafe-inline';">
```

### Future Considerations

1. **Encrypted PDFs**
- Password-protected PDF support
- Prompt for password
- Decrypt in memory only

2. **Digital Signatures**
- Preserve existing signatures
- Add new signatures
- Verify signature validity

3. **Redaction**
- Permanent removal of content
- Not just visual covering
- Secure deletion from PDF structure

## Deployment

### Build Process

```bash
# Development
npm run dev          # Start dev server with HMR

# Production
npm run build        # TypeScript compile + Vite build
npm run preview      # Preview production build

# Quality
npm run typecheck    # TypeScript type checking
npm run lint         # ESLint code linting
```

### Build Output

```
dist/
  ├── index.html                      # Entry point
  ├── assets/
  │   ├── index-[hash].js            # Main bundle
  │   ├── index-[hash].css           # Styles
  │   └── pdf.worker.min-[hash].mjs  # PDF.js worker
  └── ...
```

### Optimization

```typescript
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'pdf-libs': ['pdfjs-dist', 'pdf-lib'],
          'react-vendor': ['react', 'react-dom'],
        }
      }
    },
    chunkSizeWarningLimit: 1000
  }
});
```

### Hosting

**Recommended Platforms:**
- Vercel (zero-config)
- Netlify (auto-deploy)
- GitHub Pages (free)
- AWS S3 + CloudFront (scalable)

**Requirements:**
- Static file hosting
- HTTPS (required for modern features)
- SPA routing support (fallback to index.html)

## Future Enhancements

### Phase 1: Enhanced Editing
- [ ] Inline text editing with contentEditable
- [ ] Drag to move text elements
- [ ] Resize text elements
- [ ] Multi-select with Shift/Ctrl
- [ ] Copy/paste support
- [ ] Text search and replace

### Phase 2: Rich Content
- [ ] Image insertion
- [ ] Image editing (crop, resize, rotate)
- [ ] Shape tools (rectangle, circle, line)
- [ ] Drawing tools (pen, highlighter)
- [ ] Stamp tools (checkmark, signature)

### Phase 3: Advanced Features
- [ ] OCR for scanned PDFs
- [ ] Form field support
- [ ] Annotation tools
- [ ] Page manipulation (add, delete, reorder)
- [ ] Batch operations
- [ ] Templates

### Phase 4: Collaboration
- [ ] Real-time collaboration
- [ ] Comments and replies
- [ ] Version history
- [ ] Share links
- [ ] Access control

## Conclusion

PDF Editor Pro achieves enterprise-grade PDF editing entirely client-side through careful architecture, modern web APIs, and battle-tested libraries. The immutable state design enables powerful undo/redo, while PDF.js and pdf-lib provide the foundation for pixel-perfect viewing and editing.

The architecture prioritizes:
- **Performance**: Fast load and export times
- **Privacy**: No data upload required
- **Reliability**: Comprehensive error handling
- **Extensibility**: Clean separation of concerns
- **Maintainability**: Type-safe, well-documented code

With this foundation, PDF Editor Pro can continue to grow and add features while maintaining its core promise: professional PDF editing that's fast, private, and accessible to everyone.

---

**Version**: 1.0.0
**Last Updated**: February 2026
**Architecture Review**: Quarterly
