/**
 * Extract Initial Leave Credits from Excel Files
 * 
 * This script reads all leave card Excel files from the teaching and non-teaching
 * personnel folders and extracts the vacation and sick leave balances.
 * The data is saved to data/initial-credits.json for use during employee registration.
 */

const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

const baseDir = path.join(__dirname, '..');
const outputFile = path.join(baseDir, 'data', 'initial-credits.json');

// Directories containing leave card Excel files
const directories = [
    path.join(baseDir, 'OneDrive_2026-02-05', 'LEAVE CARD-NON-TEACHING PERSONNEL'),
    path.join(baseDir, 'OneDrive_2026-02-05_1', 'LEAVE CARD-TEACHING PERSONNEL')
];

function extractCreditsFromFile(filePath) {
    try {
        const wb = xlsx.readFile(filePath);
        const ws = wb.Sheets[wb.SheetNames[0]]; // First sheet (Leave Card)
        const data = xlsx.utils.sheet_to_json(ws, { header: 1 });
        
        // Get employee name from filename (format: "LASTNAME, FIRSTNAME.xlsx")
        const fileName = path.basename(filePath, '.xlsx');
        
        // Find the last row with balance data (has numeric values in columns 7 and 8)
        let vacationBalance = null;
        let sickBalance = null;
        let lastDataRow = null;
        
        // Scan from bottom up to find the last row with balance data
        for (let i = data.length - 1; i >= 0; i--) {
            const row = data[i];
            if (row && row.length >= 9) {
                // Check if columns 7 and 8 have numeric values (VACATION and SICK balance)
                // This is the format for non-teaching personnel
                const vacCol = row[7];
                const sickCol = row[8];
                
                if (typeof vacCol === 'number' && typeof sickCol === 'number') {
                    vacationBalance = vacCol;
                    sickBalance = sickCol;
                    lastDataRow = i;
                    break;
                }
            }
        }
        
        // If no VL/SL data found, check if this is a teaching personnel file with VSC format
        // Teaching personnel might have VSC (Vacation Service Credits) instead
        if (lastDataRow === null) {
            // Check for VSC format - look for row with "VSC" header
            let isVSCFormat = false;
            for (let i = 0; i < Math.min(20, data.length); i++) {
                const row = data[i];
                if (row && row[0] && String(row[0]).toUpperCase().includes('VSC')) {
                    isVSCFormat = true;
                    break;
                }
            }
            
            // If VSC format, try to find balance in column 7 (index 7)
            if (isVSCFormat) {
                for (let i = data.length - 1; i >= 0; i--) {
                    const row = data[i];
                    if (row && row.length >= 8) {
                        const balance = row[7];
                        if (typeof balance === 'number') {
                            // For VSC format, set both VL and SL to same value (total credits)
                            vacationBalance = balance;
                            sickBalance = balance;
                            lastDataRow = i;
                            break;
                        }
                    }
                }
            }
        }
        
        // If still no data found, return null
        if (lastDataRow === null) {
            console.log(`  Warning: No balance data found in ${fileName}`);
            return null;
        }
        
        // Try to get employee number from row 6 (index 6), column 8
        let empNo = '';
        if (data[6] && data[6][8]) {
            empNo = String(data[6][8]);
        }
        
        return {
            name: fileName,
            employeeNo: empNo,
            vacationLeave: Math.round(vacationBalance * 1000) / 1000, // Round to 3 decimal places
            sickLeave: Math.round(sickBalance * 1000) / 1000,
            extractedFrom: path.basename(filePath),
            extractedAt: new Date().toISOString()
        };
    } catch (error) {
        console.error(`  Error reading ${filePath}: ${error.message}`);
        return null;
    }
}

function processDirectory(dirPath, personnelType) {
    const results = [];
    
    if (!fs.existsSync(dirPath)) {
        console.log(`Directory not found: ${dirPath}`);
        return results;
    }
    
    const files = fs.readdirSync(dirPath);
    const xlsxFiles = files.filter(f => f.endsWith('.xlsx') && !f.startsWith('~$'));
    
    console.log(`\nProcessing ${personnelType}: ${xlsxFiles.length} files`);
    
    for (const file of xlsxFiles) {
        const filePath = path.join(dirPath, file);
        const credits = extractCreditsFromFile(filePath);
        
        if (credits) {
            credits.personnelType = personnelType;
            results.push(credits);
            console.log(`  ✓ ${credits.name}: VL=${credits.vacationLeave}, SL=${credits.sickLeave}`);
        }
    }
    
    return results;
}

function normalizeNameForMatching(name) {
    // Convert to uppercase and remove special characters for matching
    return name
        .toUpperCase()
        .replace(/[.,\-_]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function main() {
    console.log('='.repeat(60));
    console.log('Extracting Initial Leave Credits from Excel Files');
    console.log('='.repeat(60));
    
    const allCredits = [];
    
    // Process non-teaching personnel
    const nonTeachingCredits = processDirectory(
        directories[0], 
        'non-teaching'
    );
    allCredits.push(...nonTeachingCredits);
    
    // Process teaching personnel
    const teachingCredits = processDirectory(
        directories[1], 
        'teaching'
    );
    allCredits.push(...teachingCredits);
    
    // Create a lookup map for easier matching
    const creditsMap = {};
    for (const credit of allCredits) {
        // Create multiple keys for matching
        const normalizedName = normalizeNameForMatching(credit.name);
        creditsMap[normalizedName] = credit;
        
        // Also add by employee number if available
        if (credit.employeeNo) {
            creditsMap[`EMP:${credit.employeeNo}`] = credit;
        }
    }
    
    const output = {
        generatedAt: new Date().toISOString(),
        totalRecords: allCredits.length,
        nonTeachingCount: nonTeachingCredits.length,
        teachingCount: teachingCredits.length,
        credits: allCredits,
        lookupMap: creditsMap
    };
    
    // Ensure data directory exists
    const dataDir = path.join(baseDir, 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    
    // Write to JSON file
    fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
    
    console.log('\n' + '='.repeat(60));
    console.log(`Total records extracted: ${allCredits.length}`);
    console.log(`  Non-teaching: ${nonTeachingCredits.length}`);
    console.log(`  Teaching: ${teachingCredits.length}`);
    console.log(`\nOutput saved to: ${outputFile}`);
    console.log('='.repeat(60));
}

main();
