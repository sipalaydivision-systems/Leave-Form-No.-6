const fs = require('fs');
const path = require('path');

const appsPath = path.join(__dirname, '..', 'data', 'applications.json');
const empsPath = path.join(__dirname, '..', 'data', 'employees.json');

if (!fs.existsSync(appsPath)) {
  console.error('applications.json not found'); process.exit(1);
}
if (!fs.existsSync(empsPath)) {
  console.error('employees.json not found'); process.exit(1);
}

const apps = JSON.parse(fs.readFileSync(appsPath, 'utf8'));
const emps = JSON.parse(fs.readFileSync(empsPath, 'utf8'));
console.log('apps count', apps.length, 'emps count', emps.length);
let updated = 0;

const byNameOffice = (a) => {
  return emps.find(e => {
    // normalize to simple lower-case trim to avoid minor mismatches
    const an = (a.last_name || '').toString().trim().toLowerCase();
    const af = (a.first_name || '').toString().trim().toLowerCase();
    const ao = (a.office || '').toString().trim().toLowerCase();
    const en = (e.lastName || '').toString().trim().toLowerCase();
    const ef = (e.firstName || '').toString().trim().toLowerCase();
    const eo = (e.office || '').toString().trim().toLowerCase();
    // debug
    console.log('compare', a.id, an, af, ao, 'with', en, ef, eo);
    return an && af && ao && en === an && ef === af && eo === ao;
  });
};

apps.forEach(app => {
  if (!app.email) {
    const match = byNameOffice(app);
    if (match && match.email) {
      console.log('Match found for app', app.id, '->', match.email);
      app.email = match.email;
      updated++;
    } else {
      console.log('No match for app', app.id, 'name:', app.last_name, app.first_name, 'office:', app.office);
    }
  }
});

if (updated > 0) {
  fs.writeFileSync(appsPath, JSON.stringify(apps, null, 2));
}

console.log(`Backfilled emails for ${updated} applications`);
