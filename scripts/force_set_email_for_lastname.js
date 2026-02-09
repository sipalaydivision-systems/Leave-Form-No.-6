const fs = require('fs');
const path = require('path');
const appsPath = path.join(__dirname, '..', 'data', 'applications.json');
let apps = JSON.parse(fs.readFileSync(appsPath, 'utf8'));
let changed = 0;
apps = apps.map(a => {
  if ((a.last_name || '').toLowerCase() === 'tiad') {
    if (a.email !== 'jenel.tiad@deped.gov.ph') {
      a.email = 'jenel.tiad@deped.gov.ph';
      changed++;
    }
  }
  return a;
});
if (changed) fs.writeFileSync(appsPath, JSON.stringify(apps, null, 2));
console.log('Updated', changed, 'applications');
