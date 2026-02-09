const xlsx = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, '..', 'CS-FORM-6-UPDATED-08-04-2025-1.xlsx');
try {
  const workbook = xlsx.readFile(filePath);
  console.log('Workbook:', filePath);
  console.log('Sheet Names:', workbook.SheetNames);

  workbook.SheetNames.forEach((name) => {
    console.log('\n--- Sheet:', name, '---');
    const sheet = workbook.Sheets[name];
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    const max = Math.min(10, rows.length);
    console.log('Total rows:', rows.length);
    for (let i = 0; i < max; i++) {
      console.log(i + 1, JSON.stringify(rows[i]));
    }
  });
} catch (err) {
  console.error('Error reading workbook:', err.message);
  process.exit(1);
}