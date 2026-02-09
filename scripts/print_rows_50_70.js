const xlsx = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, '..', 'CS-FORM-6-UPDATED-08-04-2025-1.xlsx');
const workbook = xlsx.readFile(filePath);
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];

console.log('Inspecting rows 50-70 for sheet:', sheetName);
const keys = Object.keys(sheet).filter(k => k[0] !== '!');
const entries = keys.map(k => ({ address: k, value: sheet[k].v }));
const rowsRange = entries.filter(e => {
  const r = parseInt(e.address.replace(/^[A-Z]+/, ''), 10);
  return r >= 50 && r <= 70;
}).sort((a,b) => {
  const rc = (s) => { const col = s.address.match(/^[A-Z]+/)[0]; const row = parseInt(s.address.replace(/^[A-Z]+/,''),10); return row*1000 + col.charCodeAt(0); };
  return rc(a) - rc(b);
});
rowsRange.forEach(e => console.log(`${e.address}: ${e.value}`));
