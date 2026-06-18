import { readFileSync, writeFileSync } from 'fs';
import { convertPDFTablesToExcel } from '../src/lib/pdf/converter';
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
  const pdfName = 'T3-JHC-LT-26-0527_Request for Engineers direction regarding discrepancy in Sabarmati Depot Layout at 602A-602B Crossover location.pdf';
  const pdfPath = path.join(sampleDir, pdfName);
  const pdfBuffer = readFileSync(pdfPath);
  
  const mockFile = new MockFile(pdfBuffer, pdfName);
  
  console.log('Converting PDF to Excel...');
  const blob = await convertPDFTablesToExcel(mockFile as any, (msg) => console.log(msg));
  
  const arrayBuffer = await blob.arrayBuffer();
  writeFileSync(path.join(__dirname, 'output.xlsx'), Buffer.from(arrayBuffer));
  console.log('Saved to scratch/output.xlsx');
}

runTest().catch(console.error);
