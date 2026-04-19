/**
 * One-shot codemod: swap role codes 'ao' ↔ 'hr' (with 'hr' becoming 'aov')
 * and rename related identifiers throughout the codebase.
 *
 * Mapping:
 *   role 'ao'         → 'hr'         (HR Portal)
 *   role 'hr'         → 'aov'        (Admin Officer V Portal)
 *   var aoUsersFile   → hrUsersFile
 *   var hrUsersFile   → aovUsersFile
 *   path ao-users.json → hr-users.json
 *   path hr-users.json → aov-users.json
 *   workflow 'AO'     → 'HR'
 *   workflow 'HR'     → 'AOV'
 *
 * Preserved (NOT renamed):
 *   - portalLabel display strings: 'HR', 'AO', 'Admin Officer V', etc.
 *   - URL paths: /hr-login, /admin-officer-login, /hr-dashboard
 *   - File/page references in HTML: hr-dashboard.html, hr-login.html, etc.
 *   - dashboard-admin-officer.js, dashboard-hr.js filenames
 *   - css class names, comments mentioning humans-readable "HR"
 *
 * Usage: node scripts/rename-roles.js <file> [<file>...]
 *
 * The script uses a placeholder strategy to safely swap collisions:
 * AO → __PH_HR__ → HR, then HR → AOV, then __PH_HR__ → HR
 */

const fs = require('fs');

if (process.argv.length < 3) {
    console.error('Usage: node scripts/rename-roles.js <file> [<file>...]');
    process.exit(1);
}

const PH_AO = '__PHACEHOLDER_AO_TO_HR__';
const PH_HR = '__PHACEHOLDER_HR_TO_AOV__';

// Replacements applied sequentially. Each entry is [pattern, replacement].
// Patterns are crafted to avoid clobbering display labels.
const swaps = [
    // ── Identifier renames (unique enough to safely string-replace) ─────────
    // Variable: aoUsersFile → hrUsersFile, hrUsersFile → aovUsersFile
    // Use placeholders to prevent collision when both appear together.
    [/\baoUsersFile\b/g, PH_AO + '_VAR'],
    [/\bhrUsersFile\b/g, PH_HR + '_VAR'],
    [new RegExp(PH_AO + '_VAR', 'g'), 'hrUsersFile'],
    [new RegExp(PH_HR + '_VAR', 'g'), 'aovUsersFile'],

    // File path: 'ao-users.json' → 'hr-users.json', 'hr-users.json' → 'aov-users.json'
    [/(["'`])ao-users\.json\1/g, '$1' + PH_AO + '-users.json$1'],
    [/(["'`])hr-users\.json\1/g, '$1' + PH_HR + '-users.json$1'],
    [new RegExp('(["\'`])' + PH_AO + '-users\\.json\\1', 'g'), "$1hr-users.json$1"],
    [new RegExp('(["\'`])' + PH_HR + '-users\\.json\\1', 'g'), "$1aov-users.json$1"],

    // ── Quoted role-code strings ─────────────────────────────────────────────
    // 'ao' / "ao" → 'hr' / "hr" ;  'hr' / "hr" → 'aov' / "aov"
    [/(['"])ao\1/g, '$1' + PH_AO + '$1'],
    [/(['"])hr\1/g, '$1' + PH_HR + '$1'],
    [new RegExp("(['\"])" + PH_AO + "\\1", 'g'), '$1hr$1'],
    [new RegExp("(['\"])" + PH_HR + "\\1", 'g'), '$1aov$1'],

    // ── Workflow constants in approvalHistory + currentApprover ──────────────
    // Identifier-context only: word-boundary uppercase 'AO' / 'HR' inside quotes
    // BUT must NOT touch portalLabel 'HR' / 'AO' / 'Admin Officer V'.
    // Strategy: match in workflow-related contexts only.
    // Since these only appear in:
    //   currentApprover === 'AO' / 'HR'
    //   portal: 'AO' / 'HR'
    //   roleToPortal map values
    //   workflowOrder array
    //   notifyNextApprover('AO')
    //   returnTo === 'AO' / 'HR'
    //   stepSignature checks
    // The pattern: quoted standalone 'AO' or 'HR' that is NOT preceded by
    // `portalLabel: ` on the same logical statement.
    //
    // Practical approach: globally swap 'AO'/"AO" → 'HR'/"HR"
    // and 'HR'/"HR" → 'AOV'/"AOV", BUT first protect portalLabel lines.

    // Protect portalLabel lines: replace 'HR' and 'AO' there with sentinels
    [/portalLabel:\s*(['"])HR\1/g, "portalLabel: $1__KEEP_HR__$1"],
    [/portalLabel:\s*(['"])AO\1/g, "portalLabel: $1__KEEP_AO__$1"],

    // Now swap workflow uppercase tokens
    [/(['"])AO\1/g, '$1' + PH_AO + '_U$1'],
    [/(['"])HR\1/g, '$1' + PH_HR + '_U$1'],
    [new RegExp("(['\"])" + PH_AO + "_U\\1", 'g'), '$1HR$1'],
    [new RegExp("(['\"])" + PH_HR + "_U\\1", 'g'), '$1AOV$1'],

    // Restore portalLabel display strings
    [/(['"])__KEEP_HR__\1/g, "$1HR$1"],
    [/(['"])__KEEP_AO__\1/g, "$1AO$1"],

    // ── Helper function names (server-only identifiers) ─────────────────────
    [/\bisAoAccessAllowed\b/g, 'isHrAccessAllowed'],
    [/\bisAoDivisionLevel\b/g, 'isHrDivisionLevel'],
    [/\baoOffice\b/g, 'hrOffice'],

    // ── API path /api/update-ao-profile → /api/update-hr-profile ────────────
    // (and old /api/update-hr-profile is now /api/update-aov-profile)
    [/\/api\/update-ao-profile/g, '/api/' + PH_AO + '-profile-route'],
    [/\/api\/update-hr-profile/g, '/api/' + PH_HR + '-profile-route'],
    [new RegExp('/api/' + PH_AO + '-profile-route', 'g'), '/api/update-hr-profile'],
    [new RegExp('/api/' + PH_HR + '-profile-route', 'g'), '/api/update-aov-profile'],
];

for (let i = 2; i < process.argv.length; i++) {
    const file = process.argv[i];
    let src = fs.readFileSync(file, 'utf-8');
    const before = src;
    for (const [pattern, replacement] of swaps) {
        src = src.replace(pattern, replacement);
    }
    if (src !== before) {
        fs.writeFileSync(file, src);
        console.log('updated:', file);
    } else {
        console.log('no change:', file);
    }
}
