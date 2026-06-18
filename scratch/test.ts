import { readFileSync, writeFileSync } from 'fs';
import { convertPDFToWord } from '../src/lib/pdf/converter';
import * as path from 'path';

// Mock File API for Node
class MockFile {
  name: string;
  buffer: Buffer;
  constructor(buffer: Buffer, name: string) {
    this.name = name;
    this.buffer = buffer;
  }
  async arrayBuffer() {
    return this.buffer.buffer.slice(this.buffer.byteOffset, this.buffer.byteOffset + this.buffer.byteLength);
  }
}
(global as any).File = MockFile;

// Mock DOMMatrix
(global as any).DOMMatrix = class DOMMatrix {};

(global as any).document = {
  createElement: (tag: string) => {
    if (tag === 'canvas') {
      return {
        getContext: () => ({
          scale: () => {},
          drawImage: () => {},
          fillRect: () => {},
          fillText: () => {},
        }),
        width: 100,
        height: 100,
        toDataURL: () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', // 1x1 transparent png
      };
    }
    return {};
  }
};

async function runTest() {
  const sampleDir = path.resolve(__dirname, '../sample');
  const nooPdfPath = path.join(sampleDir, '230120_T3-JHC-LT-23-0005_Completion Management Plan_NOO.pdf');
  const pdfBuffer = readFileSync(nooPdfPath);
  
  const mockFile = new MockFile(pdfBuffer, 'NOO.pdf');
  
  console.log('Converting...');
  const { blob, diagnostics } = await convertPDFToWord(mockFile as any, { preset: 'auto' });
  console.log('Diagnostics:', diagnostics);
  
  const arrayBuffer = await blob.arrayBuffer();
  writeFileSync(path.join(__dirname, 'NOO.docx'), Buffer.from(arrayBuffer));
  console.log('Saved to scratch/NOO.docx');
}

runTest().catch(console.error);
