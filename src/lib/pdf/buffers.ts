
/**
 * Utility to safely get bytes from various PDF sources.
 * Ensures we always have a fresh Uint8Array to avoid "detached ArrayBuffer" errors
 * when multiple consumers (pdf.js, pdf-lib) process the same source.
 */
export async function getPdfBytes(
  source: File | Blob | ArrayBuffer | Uint8Array
): Promise<Uint8Array> {
  if (source instanceof Uint8Array) {
    // Create a copy to ensure we don't pass a view that might be detached elsewhere
    const copy = new Uint8Array(source.byteLength);
    copy.set(source);
    return copy;
  }
  
  if (source instanceof ArrayBuffer) {
    // .slice(0) creates a new ArrayBuffer, preventing detachment issues for the original
    const copyBuffer = source.slice(0);
    return new Uint8Array(copyBuffer);
  }
  
  if (source instanceof Blob || source instanceof File) {
    // file.arrayBuffer() returns a new ArrayBuffer each time it's called
    const buf = await source.arrayBuffer();
    return new Uint8Array(buf);
  }
  
  throw new Error("Unsupported PDF source type");
}

/**
 * Debug helper to verify buffer state before passing to consumers.
 */
export function debugBuffer(label: string, buffer: ArrayBuffer | Uint8Array) {
  const byteLength = buffer instanceof Uint8Array ? buffer.byteLength : buffer.byteLength;
  console.log(`[PDF] ${label} byteLength=`, byteLength);
  if (byteLength === 0) {
    console.error(`[PDF] WARNING: ${label} is DETACHED or EMPTY!`);
  }
}
