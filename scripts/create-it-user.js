const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');

const dataDir = path.join(__dirname, '..', 'data');
const itUsersFile = path.join(dataDir, 'it-users.json');

// Hash password with bcrypt
const password = 'TestPassword123!';
const hashedPassword = bcrypt.hashSync(password, 12);

const itUser = {
    id: crypto.randomUUID(),
    email: 'it-admin@deped.gov.ph',
    password: hashedPassword,
    name: 'IT Administrator',
    fullName: 'IT Administrator',
    createdAt: new Date().toISOString()
};

fs.writeFileSync(itUsersFile, JSON.stringify([itUser], null, 2));
console.log('✓ IT user created');
console.log(`  Email: ${itUser.email}`);
console.log(`  Password: ${password}`);
