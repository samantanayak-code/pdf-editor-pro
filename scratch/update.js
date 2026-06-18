const fs = require('fs');
const path = require('path');

const targetPath = path.resolve(__dirname, '../src/lib/pdf/converter.ts');
const newCodePath = path.resolve(__dirname, 'new_excel_code.txt');

console.log('Target path:', targetPath);
console.log('New code path:', newCodePath);

if (!fs.existsSync(targetPath)) {
  console.error('Target file does not exist!');
  process.exit(1);
}
if (!fs.existsSync(newCodePath)) {
  console.error('New code file does not exist!');
  process.exit(1);
}

const content = fs.readFileSync(targetPath, 'utf8');
const searchStr = 'function inferCellType(text: string)';
const index = content.indexOf(searchStr);

if (index === -1) {
  console.error('Could not find starting signature:', searchStr);
  process.exit(1);
}

const beforeContent = content.slice(0, index);
const newExcelCode = fs.readFileSync(newCodePath, 'utf8');

const updatedContent = beforeContent + newExcelCode;
fs.writeFileSync(targetPath, updatedContent, 'utf8');
console.log('Successfully updated converter.ts with cell merging logic from new_excel_code.txt!');
