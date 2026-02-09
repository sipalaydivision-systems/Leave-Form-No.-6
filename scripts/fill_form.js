const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');

const workbookPath = path.join(__dirname, '..', 'CS-FORM-6-UPDATED-08-04-2025-1.xlsx');
const appsPath = path.join(__dirname, '..', 'data', 'applications.json');

if (!fs.existsSync(workbookPath)) {
  console.error('Workbook not found:', workbookPath);
  process.exit(1);
}
if (!fs.existsSync(appsPath)) {
  console.error('Applications file not found:', appsPath);
  process.exit(1);
}

const apps = JSON.parse(fs.readFileSync(appsPath, 'utf8'));
if (!apps || apps.length === 0) {
  console.error('No applications found in', appsPath);
  process.exit(1);
}

// pick the latest application (last in array)
const app = apps[apps.length - 1];

const wb = xlsx.readFile(workbookPath);
const sheetName = wb.SheetNames[0];
const sheet = wb.Sheets[sheetName];

function setCell(addr, value) {
  if (value == null) value = '';
  sheet[addr] = { t: 's', v: String(value) };
  // expand sheet range
  const ref = sheet['!ref'] || 'A1';
  const range = xlsx.utils.decode_range(ref);
  const cell = xlsx.utils.decode_cell(addr);
  if (cell.r < range.s.r) range.s.r = cell.r;
  if (cell.c < range.s.c) range.s.c = cell.c;
  if (cell.r > range.e.r) range.e.r = cell.r;
  if (cell.c > range.e.c) range.e.c = cell.c;
  sheet['!ref'] = xlsx.utils.encode_range(range);
}

// Mapping (adjusted based on template inspection)
const mapping = {
  'B5': app.office || '',
  'F5': app.last_name || '',
  'G5': app.first_name || '',
  'H5': app.middle_name || '',
  'B7': app.date_filing || '',
  'F7': app.position || '',
  'H7': app.salary || '',
  // Leave type
  'B10': String(app.leave_type || '').toLowerCase(),
  // Location/illness details (checkbox + specify)
  'H14': app.within_ph ? 'X' : '',
  'J14': app.within_ph_specify || '',
  'H16': app.abroad ? 'X' : '',
  'J16': app.abroad_specify || '',
  'K20': app.in_hospital ? 'X' : '',
  'J20': app.hospital_illness || '',
  'K22': app.out_patient ? 'X' : '',
  'J22': app.outpatient_illness || '',
  'J28': app.women_illness || '',
  // Working days / dates
  'D20': app.date_from || app.dateFrom || '',
  'F20': app.date_to || app.dateTo || '',
  'H20': app.num_days || app.workingDays || '',
  'D21': app.inclusive_dates || `${app.date_from || ''} - ${app.date_to || ''}`,
  // Monetization / Terminal
  'G40': app.monetization ? 'X' : '',
  'G42': app.terminal ? 'X' : '',
  // Commutation
  'H46': app.not_requested ? 'X' : '',
  'H48': app.requested ? 'X' : '',
  // Credits
  'D54': app.credits_date || app.as_of || '',
  'D57': app.vl_earned || app.vlEarned || '',
  'D58': app.vl_less || app.vlLess || '',
  'D59': app.vl_balance || app.vlBalance || '',
  'E57': app.sl_earned || app.slEarned || '',
  'E58': app.sl_less || app.slLess || '',
  'E59': app.sl_balance || app.slBalance || '',
  // Approval/Disapproval
  'I54': app.for_approval ? `For approval of ${app.approval_days || ''} day/s leave with pay` : (app.for_disapproval ? `For disapproval due to ${app.disapproval_reason || ''}` : ''),
  'C63': app.days_with_pay || '',
  'C64': app.days_without_pay || '',
  'C65': app.others_specify || '',
  'I56': app.disapproved_reason_final || app.disapproval_reason || '',
  'D48': app.inclusive_dates || `${app.date_from || ''} - ${app.date_to || ''}`
};

console.log('Applying mapping to', sheetName);
Object.keys(mapping).forEach(addr => {
  setCell(addr, mapping[addr]);
  console.log(`  ${addr} <= ${mapping[addr]}`);
});

const outName = `CS-FORM-6-filled-${app.id || Date.now()}.xlsx`;
const outPath = path.join(__dirname, '..', outName);
xlsx.writeFile(wb, outPath);

console.log('\nSaved filled workbook to', outPath);

// Verify by reading back the written cells
const verifyWb = xlsx.readFile(outPath);
const verifySheet = verifyWb.Sheets[verifyWb.SheetNames[0]];
console.log('\nVerification:');
Object.keys(mapping).forEach(addr => {
  const cell = verifySheet[addr];
  console.log(`  ${addr}:`, cell ? cell.v : '(empty)');
});
