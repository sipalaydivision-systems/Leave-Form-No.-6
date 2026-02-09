const fs = require('fs');
const path = require('path');

const appsPath = path.join(__dirname, '..', 'data', 'applications.json');
const employeesPath = path.join(__dirname, '..', 'data', 'employees.json');

const apps = JSON.parse(fs.readFileSync(appsPath, 'utf8'));
const emps = JSON.parse(fs.readFileSync(employeesPath, 'utf8'));

let changed = 0;
for (const app of apps) {
  if (!app.email) {
    // debug print
    console.log('Checking app', app.id, 'last:', app.last_name, 'first:', app.first_name, 'office:', app.office);
    const match = emps.find(e => {
      console.log('  compare with emp', e.id, e.lastName, e.firstName, e.office);
      return e.lastName === app.last_name && e.firstName === app.first_name && e.office === app.office;
    });
    if (match && match.email) {
      app.email = match.email;
      changed++;
      console.log('Assigned', match.email, 'to application', app.id);
    }
  }
}

if (changed) {
  fs.writeFileSync(appsPath, JSON.stringify(apps, null, 2));
}
console.log('Total updated:', changed);
