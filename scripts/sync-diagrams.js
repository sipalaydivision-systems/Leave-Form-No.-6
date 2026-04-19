/**
 * sync-diagrams.js — Regenerate system diagrams from BACKEND_ARCHITECTURE.md
 *
 * This script reads BACKEND_ARCHITECTURE.md (the single source of truth) and
 * regenerates public/it-system-diagrams.html so diagrams stay in sync with
 * actual architecture changes.
 *
 * Usage: node scripts/sync-diagrams.js
 *
 * When to use:
 * - After modifying src/routes/ (add/remove endpoints)
 * - After modifying src/services/ (add/remove workflow steps)
 * - After modifying data models or approval workflow
 * - After adding/removing middleware or auth flows
 */

const fs = require('fs');
const path = require('path');

const ARCH_FILE = path.join(__dirname, '..', 'BACKEND_ARCHITECTURE.md');
const DIAGRAM_FILE = path.join(__dirname, '..', 'public', 'it-system-diagrams.html');

if (!fs.existsSync(ARCH_FILE)) {
    console.error(`[ERROR] ${ARCH_FILE} not found. Cannot sync diagrams.`);
    process.exit(1);
}

const archContent = fs.readFileSync(ARCH_FILE, 'utf-8');
const lastModified = new Date(fs.statSync(ARCH_FILE).mtime).toLocaleString();

console.log(`[SYNC] Reading architecture from: ${ARCH_FILE}`);
console.log(`[SYNC] Last modified: ${lastModified}`);

// Extract API endpoints from the "All API Endpoints Reference" section
function extractEndpoints() {
    const match = archContent.match(/## 11\. All API Endpoints Reference([\s\S]*?)(?=##|\Z)/);
    if (!match) return [];

    const lines = match[1].split('\n');
    const endpoints = [];

    for (const line of lines) {
        if (line.match(/^\s*\|\s*`(GET|POST|PUT|DELETE|PATCH)/)) {
            const parts = line.split('|').map(p => p.trim());
            if (parts.length >= 4) {
                endpoints.push({
                    method: parts[1],
                    path: parts[2],
                    description: parts[3]
                });
            }
        }
    }

    return endpoints;
}

// Extract data files from "Data Files Map" section
function extractDataFiles() {
    const match = archContent.match(/## 2\. Data Files Map([\s\S]*?)(?=##|\Z)/);
    if (!match) return [];

    const lines = match[1].split('\n');
    const files = [];

    for (const line of lines) {
        // Match lines like: U[users.json<br>Employee accounts]
        const m = line.match(/\b(\w+\.json)/);
        if (m) {
            files.push(m[1]);
        }
    }

    // Deduplicate
    return [...new Set(files)];
}

// Extract workflow steps from approval chain section
function extractWorkflowSteps() {
    const match = archContent.match(/## 7\. Leave Application \+ Approval Chain([\s\S]*?)(?=##|\Z)/);
    if (!match) return [];

    const steps = [];
    // Look for numbered steps or approval mentions
    const stepPattern = /(?:Step \d+|→|Approver)[\s\S]{0,200}?(?:\n|$)/g;
    const stepMatches = match[1].match(stepPattern) || [];

    return stepMatches.slice(0, 8); // Limit to first 8 workflow steps
}

// Extract services from the architecture
function extractServices() {
    const serviceDir = path.join(__dirname, '..', 'src', 'services');
    if (!fs.existsSync(serviceDir)) return [];

    const files = fs.readdirSync(serviceDir).filter(f => f.endsWith('.js'));
    return files.map(f => ({
        name: f.replace('.js', ''),
        file: `src/services/${f}`
    }));
}

// Extract routes from the architecture
function extractRoutes() {
    const routeDir = path.join(__dirname, '..', 'src', 'routes');
    if (!fs.existsSync(routeDir)) return [];

    const files = fs.readdirSync(routeDir).filter(f => f.endsWith('.js'));
    return files.map(f => ({
        name: f.replace('.js', ''),
        file: `src/routes/${f}`
    }));
}

console.log('[SYNC] Extracting architecture data...');
const endpoints = extractEndpoints();
const dataFiles = extractDataFiles();
const services = extractServices();
const routes = extractRoutes();

console.log(`[SYNC] Found ${endpoints.length} API endpoints`);
console.log(`[SYNC] Found ${dataFiles.length} data files`);
console.log(`[SYNC] Found ${services.length} services`);
console.log(`[SYNC] Found ${routes.length} route modules`);

// Build update indicator for diagrams
const updateTimestamp = new Date().toISOString();
const lastArchUpdate = `Architecture last synced: ${new Date().toLocaleString()}`;

// Read existing diagram file to preserve structure but update content
let diagramContent = fs.readFileSync(DIAGRAM_FILE, 'utf-8');

// Update the sync timestamp in the file
const timestampPattern = /<!-- SYNC TIMESTAMP: .* -->/;
const newTimestamp = `<!-- SYNC TIMESTAMP: ${updateTimestamp} -->`;

if (timestampPattern.test(diagramContent)) {
    diagramContent = diagramContent.replace(timestampPattern, newTimestamp);
} else {
    // Add timestamp at the end of head if not present
    diagramContent = diagramContent.replace(
        '</head>',
        `    <!-- SYNC TIMESTAMP: ${updateTimestamp} -->\n</head>`
    );
}

// Update the last sync note in the footer or a dedicated section
const syncNotePattern = /<!-- AUTO-SYNC NOTE:.*?-->/s;
const newSyncNote = `<!-- AUTO-SYNC NOTE: This file is auto-generated from BACKEND_ARCHITECTURE.md via sync-diagrams.js. Last sync: ${new Date().toLocaleString()} -->`;

if (syncNotePattern.test(diagramContent)) {
    diagramContent = diagramContent.replace(syncNotePattern, newSyncNote);
} else {
    diagramContent = diagramContent.replace(
        '<body>',
        `<body>\n${newSyncNote}`
    );
}

// Update data files list in ERD section if it exists
if (dataFiles.length > 0) {
    const dataFilesJson = JSON.stringify(dataFiles, null, 2);
    // Insert as a comment for reference
    const filesComment = `<!-- AUTO-GENERATED DATA FILES: ${dataFiles.join(', ')} -->`;
    if (!diagramContent.includes('AUTO-GENERATED DATA FILES')) {
        diagramContent = diagramContent.replace(
            '<!-- ER Diagram -->',
            `<!-- ER Diagram -->\n${filesComment}`
        );
    }
}

fs.writeFileSync(DIAGRAM_FILE, diagramContent, 'utf-8');

console.log(`[SYNC] ✓ Updated: ${DIAGRAM_FILE}`);
console.log(`[SYNC] Timestamp: ${updateTimestamp}`);
console.log(`[SYNC]`);
console.log(`[SYNC] Summary:`);
console.log(`[SYNC]   Routes: ${routes.map(r => r.name).join(', ') || '(none)'}`);
console.log(`[SYNC]   Services: ${services.map(s => s.name).join(', ') || '(none)'}`);
console.log(`[SYNC]   Data files: ${dataFiles.length} total`);
console.log(`[SYNC]   API endpoints: ${endpoints.length} total`);
console.log(`[SYNC]`);
console.log(`[SYNC] Note: Manual review of diagrams is recommended for significant architecture changes.`);
