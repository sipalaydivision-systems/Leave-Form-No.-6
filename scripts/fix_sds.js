const fs = require('fs');

// Fix SDS Dashboard
let sdsContent = fs.readFileSync('./public/sds-dashboard.html', 'utf8');

const oldText = `    console.error('Error loading applications:', error);\r\n            }\r\n\r\n                // Count users by department`;

const newText = `    console.error('Error loading applications:', error);\r\n            }\r\n\r\n            // Process data and render charts\r\n            try {\r\n                // Count users by department`;

if (sdsContent.includes(oldText)) {
    sdsContent = sdsContent.replace(oldText, newText);
    fs.writeFileSync('./public/sds-dashboard.html', sdsContent);
    console.log('Fixed SDS dashboard');
} else {
    console.log('SDS pattern not found - checking if already fixed');
    if (sdsContent.includes('// Process data and render charts')) {
        console.log('SDS dashboard is already fixed');
    } else {
        console.log('SDS dashboard needs manual review');
    }
}
