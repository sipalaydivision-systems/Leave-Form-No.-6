// Quick system verification test
async function runTests() {
    const base = 'http://localhost:3000';
    const results = [];

    // API Tests
    const apiTests = [
        { name: 'all-users', url: '/api/all-users', check: d => Array.isArray(d.users) ? `OK(${d.users.length})` : 'FAIL' },
        { name: 'all-apps', url: '/api/all-applications', check: d => Array.isArray(d.applications) ? `OK(${d.applications.length})` : `FAIL(type=${typeof d.applications})` },
        { name: 'leave-credits', url: '/api/leave-credits?employeeId=test@test.com', check: d => d.success ? `OK` : 'FAIL' },
        { name: 'cto-records', url: '/api/cto-records', check: d => d.success && Array.isArray(d.records) ? `OK(${d.records.length})` : (Array.isArray(d) ? `OK(${d.length})` : 'FAIL') },
        { name: 'employee-leavecard', url: '/api/employee-leavecard?employeeId=test@test.com', check: d => d.success !== undefined ? `OK` : 'FAIL' },
        { name: 'portal-AO', url: '/api/portal-applications/AO', check: d => Array.isArray(d.applications) ? `OK(${d.applications.length})` : 'FAIL' },
        { name: 'portal-HR', url: '/api/portal-applications/HR', check: d => Array.isArray(d.applications) ? `OK(${d.applications.length})` : 'FAIL' },
        { name: 'portal-ASDS', url: '/api/portal-applications/ASDS', check: d => Array.isArray(d.applications) ? `OK(${d.applications.length})` : 'FAIL' },
        { name: 'portal-SDS', url: '/api/portal-applications/SDS', check: d => Array.isArray(d.applications) ? `OK(${d.applications.length})` : 'FAIL' },
    ];

    for (const t of apiTests) {
        try {
            const res = await fetch(base + t.url);
            const data = await res.json();
            results.push(`${t.name}: ${t.check(data)}`);
        } catch (e) {
            results.push(`${t.name}: ERR(${e.message})`);
        }
    }

    // Page load tests
    const pages = ['/', '/dashboard.html', '/ao-dashboard.html', '/hr-approval.html', '/asds-dashboard.html', '/sds-dashboard.html', '/leave_form.html'];
    for (const p of pages) {
        try {
            const res = await fetch(base + p);
            results.push(`page ${p}: ${res.ok ? 'OK' : 'FAIL(' + res.status + ')'}`);
        } catch (e) {
            results.push(`page ${p}: ERR`);
        }
    }

    // Print
    console.log('\n=== SYSTEM TEST RESULTS ===');
    let pass = 0, fail = 0;
    results.forEach(r => {
        const ok = r.includes('OK');
        console.log((ok ? '✓' : '✗') + ' ' + r);
        if (ok) pass++; else fail++;
    });
    console.log(`\nTotal: ${pass} passed, ${fail} failed`);
}

runTests();
