# Editing Alignment Notes: Near-Acrobat Precision

This document summarizes the technical implementation used to achieve seamless word-level editing in the PDF Editor Pro.

## Core Implementation: `calculateTextLayout`

To ensure visual consistency between the in-app preview and the exported PDF, all text positioning and sizing is handled by a unified helper in `src/lib/pdfEditorPro.ts`.

### 1. Unified Scaling Logic
- **Constraint**: Replacement text must start exactly at the original `x` position.
- **Scaling**: We only scale down the `fontSize` if the new text width exceeds **102%** of the original box width. This prevents minor kerning differences from causing a visible "shrink" in the text.
- **Consistency**: The same function is called by:
    - `exportEditedPDF` (using `pdf-lib` font metrics).
    - `renderPDFPage` (using Canvas `2dContext` metrics).
    - React Overlay (using Canvas `2dContext` metrics).

### 2. Precise Baseline Alignment
- **Detection**: `src/lib/pdf/textExtraction.ts` captures the exact `baselineY` from the PDF transform matrix.
- **Nudge**: A fine-tuned `BASELINE_NUDGE` of `-0.5` is applied to move text slightly up, compensating for the natural "float" observed in browser rendering vs. standard PDF viewers.
- **Formula**:
    - Preview Top: `layout.baselineY - element.y + BASELINE_NUDGE`
    - Export Y (PDF Coords): `height - (layout.baselineY + BASELINE_NUDGE)`

### 3. Style Preservation (Bold/Italic)
- **Extraction**: The extraction pipeline now parses font family strings (e.g., "Helvetica-Bold", "TimesNewRomanPS-ItalicMT") to detect bold and italic flags.
- **Mapping**: These flags are propagated through the `TextElement` model and mapped to `StandardFonts` (Times, Helvetica, Courier) during export and standard CSS families during preview.

## Tweaking & Maintenance

If future documents show slight misalignments, adjust these constants in `src/lib/pdfEditorPro.ts`:

| Constant | Default | Purpose |
| :--- | :--- | :--- |
| `BASELINE_NUDGE` | `-0.5` | Move text up/down globally. Positive = Down, Negative = Up. |
| `overflowThreshold` | `1.02` | How much wider text can be before it starts scaling down. |
| `0.99` (in scale) | `0.99` | The safety margin when scaling down to fit. |

## Known Limitations
- **Exotic Fonts**: While bold/italic are detected, the visual weight of standard fonts (Helvetica/Times) may still differ slightly from proprietary embedded fonts.
- **Sub-pixel Anti-aliasing**: At extremely high zoom (400%+), browser anti-aliasing may differ slightly from Acrobat's renderer.
