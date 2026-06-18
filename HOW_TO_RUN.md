# How to Run – PDF Editor

## Prerequisites

### 1. Node.js (v18+)
Download from https://nodejs.org

### 2. Python (3.9+)
Download from https://python.org

### 3. Tesseract OCR (for scanned PDF → Word)
- **Windows**: Download installer from https://github.com/UB-Mannheim/tesseract/wiki
  - Install to the default path: `C:\Program Files\Tesseract-OCR\`
  - No PATH setup needed — server.py auto-detects it
- **Mac**: `brew install tesseract`
- **Linux**: `sudo apt install tesseract-ocr`

---

## Install Python Dependencies

```bash
pip install flask flask-cors pdfplumber openpyxl python-docx pymupdf pytesseract pillow
```

> **Note**: `pymupdf` replaces `pdf2image` + `poppler`. No poppler install needed.

---

## Install Node.js Dependencies

```bash
npm install
```

---

## Run the App

### Option A – Run both together (recommended)
```bash
npm start
```

### Option B – Run separately in two terminals

**Terminal 1 – Python backend:**
```bash
python server.py
```
You should see: `✅  PDF backend running on http://localhost:5050`

**Terminal 2 – Frontend:**
```bash
npm run dev
```
You should see: `Local: http://localhost:5173`

---

## Open the App

Go to: **http://localhost:5173**

---

## What was fixed

### ✅ PDF → Word (scanned PDFs)
- Now uses **PyMuPDF** (fitz) to render pages — no Poppler/pdf2image needed
- Tesseract path auto-detected on Windows
- Output is **fully editable text** (not pasted as image)

### ✅ Text Editor (no more flickering/jumping)
- Fixed scroll-jump when double-clicking to edit text
- Edited text now matches surrounding text font/size
- `preventScroll: true` on focus prevents page jumping
- Canvas no longer re-renders on every click

### ✅ Previews (Word & Excel)
- Upload a PDF → Word preview loads automatically (left = original PDF, right = converted text)
- Upload a PDF → Excel preview shows all extracted tables instantly
- Download button appears in the preview panel after conversion
