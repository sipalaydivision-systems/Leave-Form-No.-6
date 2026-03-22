const crypto = require('crypto');

function generateSessionToken() {
    return crypto.randomBytes(48).toString('hex');
}

// Generate sequential Application ID (SDO Sipalay-01, SDO Sipalay-02, etc.)
// Includes timestamp suffix to prevent race condition conflicts
function generateApplicationId(applications) {
    const prefix = 'SDO Sipalay-';

    // Find the highest existing number
    let maxNumber = 0;
    applications.forEach(app => {
        if (typeof app.id === 'string' && app.id.startsWith(prefix)) {
            // Extract the numeric part (before any hyphen suffix)
            const afterPrefix = app.id.replace(prefix, '');
            const numPart = parseInt(afterPrefix.split('-')[0]);
            if (!isNaN(numPart) && numPart > maxNumber) {
                maxNumber = numPart;
            }
        }
    });

    // Generate next number with leading zeros (minimum 2 digits)
    const nextNumber = maxNumber + 1;
    const paddedNumber = nextNumber.toString().padStart(2, '0');

    // Add short timestamp suffix to guarantee uniqueness in case of simultaneous requests
    const uniqueSuffix = Date.now().toString(36).slice(-4).toUpperCase();

    return prefix + paddedNumber + '-' + uniqueSuffix;
}

module.exports = { generateSessionToken, generateApplicationId };
