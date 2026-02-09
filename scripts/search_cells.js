const xlsx = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, '..', 'CS-FORM-6-UPDATED-08-04-2025-1.xlsx');
const workbook = xlsx.readFile(filePath);
const sheet = workbook.Sheets[workbook.SheetNames[0]];

const keywords = ['INCLUSIVE', 'INCLUSIVE DATES', 'DATE', 'FROM', 'TO', 'NO. OF DAYS', 'DAYS', 'NUM_DAYS', 'NUM DAYS'];

console.log('Searching for keywords in sheet:', workbook.SheetNames[0]);
Object.keys(sheet).forEach(k => {
  if (k[0] === '!') return;
  const val = String(sheet[k].v || '');
  keywords.forEach(kw => {
    if (val.toUpperCase().includes(kw)) {
      console.log(`${k}: ${val}`);
    }
  });
});
