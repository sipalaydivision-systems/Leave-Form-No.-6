// Check authentication on page load
document.addEventListener('DOMContentLoaded', function() {
    // Check if user is logged in
    const user = sessionStorage.getItem('user');
    if (!user && !window.location.pathname.includes('login')) {
        window.location.href = '/';
        return;
    }
    

    // Auto-fill form fields based on logged-in user
    let role = '';
    if (user) {
        try {
            const userObj = JSON.parse(user);
            role = (userObj.role || '').toLowerCase();
            document.getElementById('office').value = userObj.office || '';
            if (document.getElementById('district')) document.getElementById('district').value = userObj.district || '';
            document.getElementById('last_name').value = userObj.lastName || '';
            document.getElementById('first_name').value = userObj.firstName || '';
            document.getElementById('middle_name').value = userObj.middleName || '';
            document.getElementById('position').value = userObj.position || '';
            document.getElementById('salary').value = userObj.salary || '';
        } catch (e) {
            console.error('Failed to parse user data:', e);
        }
    }

    // Also fetch the employee record from the employees API (so registration data populates form)
    try {
        const userObj = JSON.parse(user || '{}');
        const userEmail = userObj.email || '';
        if (userEmail) {
            fetch('/api/employees', { headers: { 'x-user-email': userEmail } })
                .then(r => r.json())
                .then(payload => {
                    const emp = (payload.data || [])[0];
                    if (emp) {
                        // fill fields from employee record
                        document.getElementById('office').value = emp.office || document.getElementById('office').value || '';
                        document.getElementById('last_name').value = emp.lastName || document.getElementById('last_name').value || '';
                        document.getElementById('first_name').value = emp.firstName || document.getElementById('first_name').value || '';
                        document.getElementById('middle_name').value = emp.middleName || document.getElementById('middle_name').value || '';
                        document.getElementById('position').value = emp.position || document.getElementById('position').value || '';
                        document.getElementById('salary').value = emp.salary ? parseFloat(emp.salary).toLocaleString('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 }) : document.getElementById('salary').value || '';
                        // load leave credits
                        if (emp.id) loadLeaveCreditsForEmployee(emp.id);
                    }
                })
                .catch(err => console.error('Error fetching employee record:', err));
        }
    } catch (e) {}
    
    // Bind logout links
    const logoutLinks = document.querySelectorAll('.logout-link');
    logoutLinks.forEach(link => link.addEventListener('click', logoutUser));
    
    // Set today's date as filing date
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('date_filing').value = today;
    
    // Add event listeners for date calculation
    document.getElementById('date_from').addEventListener('change', calculateWorkingDays);
    document.getElementById('date_to').addEventListener('change', calculateWorkingDays);
    
    // Add event listeners for leave credits calculation
    document.getElementById('vl_earned').addEventListener('input', calculateVLBalance);
    document.getElementById('vl_less').addEventListener('input', calculateVLBalance);
    document.getElementById('sl_earned').addEventListener('input', calculateSLBalance);
    document.getElementById('sl_less').addEventListener('input', calculateSLBalance);

    // Update less-this-application when number of days changes
    document.getElementById('num_days').addEventListener('input', applyLessThisApplication);
    // Update when leave type changes
    const leaveRadios = document.querySelectorAll('input[name="leave_type"]');
    leaveRadios.forEach(r => r.addEventListener('change', applyLessThisApplication));
    
    // Apply role-based permissions: applicants see full form except Section7; HR/approver sees only Section7 editable
    function applyRolePermissions(role) {
        const form = document.getElementById('leaveForm');
        const section7 = document.getElementById('section7');
        if (!form) return;

        const allControls = Array.from(form.querySelectorAll('input, textarea, select, button'));
        const section7Controls = section7 ? Array.from(section7.querySelectorAll('input, textarea, select, button')) : [];

        const approverRoles = ['hr','assistant','sds','approver', 'admin'];
        const isApprover = approverRoles.includes((role || '').toLowerCase());

        if (isApprover) {
            // Disable all controls in the form except those inside Section 7
            allControls.forEach(el => {
                if (section7 && section7.contains(el)) {
                    el.disabled = false;
                    el.readOnly = false;
                    el.tabIndex = 0;
                } else {
                    // hide submit/reset buttons for approver (they shouldn't submit a new application)
                    if ((el.tagName === 'BUTTON' && (el.type === 'submit' || el.type === 'reset')) || el.classList.contains('btn-print')) {
                        el.style.display = 'none';
                    }
                    el.disabled = true;
                    el.readOnly = true;
                    el.tabIndex = -1;
                }
            });
        } else {
            // Applicant / regular user: enable whole form, but make Section7 controls readonly/disabled
            allControls.forEach(el => {
                el.disabled = false;
                el.readOnly = false;
                el.tabIndex = 0;
                el.style.display = '';
            });
            if (section7) {
                section7Controls.forEach(el => {
                    el.disabled = true;
                    el.readOnly = true;
                    el.tabIndex = -1;
                });
            }
        }
    }

    applyRolePermissions(role);
});

// Load employees from database for dropdown
async function loadEmployees() {
    try {
        const response = await fetch('/api/employees');
        const payload = await response.json();
        const employees = payload.data || payload || [];
        
        const select = document.getElementById('employeeSelect');
        select.innerHTML = '<option value="">-- Select from database --</option>';
        
        employees.forEach(emp => {
            const option = document.createElement('option');
            option.value = emp.id;
            option.textContent = `${emp.lastName}, ${emp.firstName} ${emp.middleName || ''} - ${emp.position}${emp.office ? ' | ' + emp.office : ''}${emp.district ? ' (' + emp.district + ')' : ''}`;
            option.dataset.employee = JSON.stringify(emp);
            select.appendChild(option);
        });
        
        select.addEventListener('change', populateFromEmployee);
    } catch (error) {
        console.error('Error loading employees:', error);
    }
}

// Populate form fields from selected employee
function populateFromEmployee(e) {
    const selectedOption = e.target.selectedOptions[0];
    if (!selectedOption.value) return;
    
    const emp = JSON.parse(selectedOption.dataset.employee);
    
    document.getElementById('office').value = emp.office || '';
    // populate district if present
    if (document.getElementById('district')) document.getElementById('district').value = emp.district || '';
    document.getElementById('last_name').value = emp.lastName || '';
    document.getElementById('first_name').value = emp.firstName || '';
    document.getElementById('middle_name').value = emp.middleName || '';
    document.getElementById('position').value = emp.position || '';
    // load leave credits for this employee
    if (emp && emp.id) loadLeaveCreditsForEmployee(emp.id);
    if (document.getElementById('employeeId')) document.getElementById('employeeId').value = emp.id;

    // Format salary in Philippine Peso
    const salary = emp.salary ? parseFloat(emp.salary).toLocaleString('en-PH', {
        style: 'currency',
        currency: 'PHP',
        minimumFractionDigits: 2
    }) : '';
    document.getElementById('salary').value = salary;
}

// Determine the as-of date for leavecards
function computeAsOfDateFallback() {
    // Default fixed as-of date per requirement
    const defaultAsOf = '2025-12-31';
    const now = new Date();
    // If the month of January is finished (i.e., current month is February or later),
    // update the as-of to the current year December 31 (per user instruction behavior)
    if (now.getMonth() + 1 > 1) {
        return `${now.getFullYear()}-12-31`;
    }
    return defaultAsOf;
}

// Load leave credits and display leavecard history under the credits table
async function loadLeaveCreditsForEmployee(employeeId) {
    try {
        const resp = await fetch('/api/leavecards/' + employeeId);
        const asOfEl = document.getElementById('credits_date');
        const historyWrap = document.getElementById('leavecard-history');
        const asOfSpan = document.getElementById('leavecardAsOf');
        const lcVl = document.getElementById('lc_vl');
        const lcSl = document.getElementById('lc_sl');

        if (!resp.ok) {
            // no leave card found
            document.getElementById('vl_earned').value = '';
            document.getElementById('sl_earned').value = '';
            calculateVLBalance();
            calculateSLBalance();
            if (historyWrap) historyWrap.style.display = 'none';
            if (asOfEl) asOfEl.value = computeAsOfDateFallback();
            return;
        }

        const payload = await resp.json();
        const rec = payload.data || {};

        // Determine as-of date and apply monthly accrual (1.25/month) for fully completed months
        try {
            const baseAsOf = rec.asOf ? new Date(rec.asOf) : new Date('2025-12-31');
            const baseVacation = Number(rec.vacationLeave != null ? rec.vacationLeave : 0);
            const baseSick = Number(rec.sickLeave != null ? rec.sickLeave : 0);

            const now = new Date();
            // last fully completed month is the previous month (its last day)
            const lastCompleted = new Date(now.getFullYear(), now.getMonth(), 0); // e.g., Jan 25 -> Dec 31

            // months between baseAsOf.month and lastCompleted.month
            const months = Math.max(0, (lastCompleted.getFullYear() - baseAsOf.getFullYear()) * 12 + (lastCompleted.getMonth() - baseAsOf.getMonth()));

            const accrualPerMonth = 1.25;
            const added = accrualPerMonth * months;

            const newVacation = +(baseVacation + added).toFixed(3);
            const newSick = +(baseSick + added).toFixed(3);

            // new asOf should be last day of lastCompleted month if months>0, otherwise use baseAsOf
            let newAsOfDate;
            if (months > 0) {
                newAsOfDate = new Date(lastCompleted.getFullYear(), lastCompleted.getMonth() + 1, 0);
            } else {
                // ensure baseAsOf is end-of-month (use last day of that month)
                newAsOfDate = new Date(baseAsOf.getFullYear(), baseAsOf.getMonth() + 1, 0);
            }

            const asOfStr = newAsOfDate.toISOString().split('T')[0];
            if (asOfEl) asOfEl.value = asOfStr;
            if (asOfSpan) asOfSpan.textContent = asOfStr;

            // populate earned values from computed leavecard (totals as of newAsOfDate)
            document.getElementById('vl_earned').value = newVacation.toFixed(3);
            document.getElementById('sl_earned').value = newSick.toFixed(3);

            // Populate small history table below credits
            if (lcVl) lcVl.textContent = newVacation.toFixed(3);
            if (lcSl) lcSl.textContent = newSick.toFixed(3);

            if (historyWrap) historyWrap.style.display = 'block';

            calculateVLBalance();
            calculateSLBalance();
        } catch (err) {
            console.error('Error computing accruals:', err);
            // fallback to raw values
            const asOf = rec.asOf || computeAsOfDateFallback();
            if (asOfEl) asOfEl.value = asOf;
            if (asOfSpan) asOfSpan.textContent = asOf;
            document.getElementById('vl_earned').value = rec.vacationLeave != null ? Number(rec.vacationLeave).toFixed(3) : '';
            document.getElementById('sl_earned').value = rec.sickLeave != null ? Number(rec.sickLeave).toFixed(3) : '';
            if (lcVl) lcVl.textContent = rec.vacationLeave != null ? Number(rec.vacationLeave).toFixed(3) : '';
            if (lcSl) lcSl.textContent = rec.sickLeave != null ? Number(rec.sickLeave).toFixed(3) : '';
            if (historyWrap) historyWrap.style.display = 'block';
            calculateVLBalance();
            calculateSLBalance();
        }
    } catch (err) {
        console.error('Error loading leave credits:', err);
    }
}

// Calculate working days (Monday to Friday only)
function calculateWorkingDays() {
    const fromDate = document.getElementById('date_from').value;
    const toDate = document.getElementById('date_to').value;
    
    if (!fromDate || !toDate) return;
    
    const start = new Date(fromDate);
    const end = new Date(toDate);
    
    if (end < start) {
        alert('End date must be after start date');
        document.getElementById('date_to').value = '';
        return;
    }
    
    // Count working days (Mon-Fri)
    let workingDays = 0;
    let currentDate = new Date(start);
    
    while (currentDate <= end) {
        const dayOfWeek = currentDate.getDay();
        // 0 = Sunday, 6 = Saturday - skip weekends
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            workingDays++;
        }
        currentDate.setDate(currentDate.getDate() + 1);
    }
    
    // Update the number of days field
    document.getElementById('num_days').value = workingDays;
    
    // Update inclusive dates display
    const options = { year: 'numeric', month: 'long', day: 'numeric' };
    const fromFormatted = start.toLocaleDateString('en-US', options);
    const toFormatted = end.toLocaleDateString('en-US', options);
    document.getElementById('inclusive_dates').value = `${fromFormatted} - ${toFormatted}`;
}

// Calculate vacation leave balance
function calculateVLBalance() {
    const earned = parseFloat(document.getElementById('vl_earned').value) || 0;
    const less = parseFloat(document.getElementById('vl_less').value) || 0;
    document.getElementById('vl_balance').value = (earned - less).toFixed(3);
}

// Apply 'less this application' value based on selected leave type and num_days
function applyLessThisApplication() {
    const numDays = parseInt(document.getElementById('num_days').value) || 0;
    const selected = document.querySelector('input[name="leave_type"]:checked');
    const vlLessEl = document.getElementById('vl_less');
    const slLessEl = document.getElementById('sl_less');

    if (!selected) {
        // clear both
        vlLessEl.value = '';
        slLessEl.value = '';
    } else if (selected.value === 'vacation') {
        vlLessEl.value = numDays ? numDays.toFixed(3) : '';
        // when vacation is used, set sick values to zero per requirement
        slLessEl.value = '0.000';
        // also set displayed earned sick to zero
        document.getElementById('sl_earned').value = '0.000';
    } else if (selected.value === 'sick') {
        slLessEl.value = numDays ? numDays.toFixed(3) : '';
        vlLessEl.value = '0.000';
        document.getElementById('vl_earned').value = '0.000';
    } else {
        // other leave types: don't assume which credit to deduct; clear less fields
        vlLessEl.value = '';
        slLessEl.value = '';
    }

    // recalculate balances
    calculateVLBalance();
    calculateSLBalance();
}

// Calculate sick leave balance
function calculateSLBalance() {
    const earned = parseFloat(document.getElementById('sl_earned').value) || 0;
    const less = parseFloat(document.getElementById('sl_less').value) || 0;
    document.getElementById('sl_balance').value = (earned - less).toFixed(3);
}

// Form submission
document.getElementById('leaveForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const formData = new FormData(this);
    const data = {};
    
    formData.forEach((value, key) => {
        data[key] = value;
    });
    
    // Get selected checkboxes
    const checkboxes = this.querySelectorAll('input[type="checkbox"]:checked');
    checkboxes.forEach(cb => {
        data[cb.name] = true;
    });
    
    // Get selected radio
    const selectedRadio = this.querySelector('input[name="leave_type"]:checked');
    if (selectedRadio) {
        data.leave_type = selectedRadio.value;
    }
    
    try {
        // attach logged-in user's email so applications can be filtered and displayed per user
        const currentUser = JSON.parse(sessionStorage.getItem('user') || '{}');
        if (currentUser && currentUser.email) data.email = currentUser.email;
        // include employeeId if available on form
        const employeeIdEl = document.getElementById('employeeId');
        if (employeeIdEl && employeeIdEl.value) data.employeeId = employeeIdEl.value;

        const response = await fetch('/api/submit', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        
        if (response.ok) {
            // server returns `applicationId` (or `id`), prefer applicationId
            const appId = result.applicationId || result.id || '';
            document.getElementById('appId').textContent = appId;
            document.getElementById('successModal').style.display = 'flex';

            // Refresh leave credits for the current user's employee record (if available)
            (async function refreshLeaveData() {
                try {
                    // If server returned employeeId, use it
                    let employeeId = result.employeeId || null;

                    // If not returned, try to find employee by the logged-in user
                    if (!employeeId) {
                        const user = JSON.parse(sessionStorage.getItem('user') || '{}');
                        if (user && user.email) {
                            const resp = await fetch('/api/employees', { headers: { 'x-user-email': user.email } });
                            if (resp.ok) {
                                const payload = await resp.json();
                                const emps = payload.data || [];
                                if (emps.length > 0) employeeId = emps[0].id;
                            }
                        }
                    }

                    if (employeeId && typeof loadLeaveCreditsForEmployee === 'function') {
                        loadLeaveCreditsForEmployee(employeeId);
                    }

                    // If the applications list exists on the page, refresh it as well
                    if (typeof loadApplications === 'function') {
                        loadApplications();
                    }
                } catch (err) {
                    console.warn('Failed to refresh leave data after submit:', err);
                }
            })();
        } else {
            alert('Error: ' + (result.message || result.error || 'Unknown'));
        }
    } catch (error) {
        console.error('Error submitting form:', error);
        alert('Error submitting form. Please try again.');
    }
});

// Close success modal and reload the form for another entry
function closeModal() {
    const modal = document.getElementById('successModal');
    if (modal) modal.style.display = 'none';
    // Option: reset the form so user can submit another application
    const form = document.getElementById('leaveForm');
    if (form) form.reset();
    // reload to ensure UI state (leave credits etc.) refresh
    window.location.reload();
}

// Logout handler
function logoutUser(event) {
    if (event) event.preventDefault();
    try {
        // remove only user key for safety
        sessionStorage.removeItem('user');
    } catch (e) {
        try { sessionStorage.clear(); } catch (e) {}
    }
    // force navigation to login
    window.location.href = '/';
}

// Print form function
function printForm() {
    try {
        // If there is an application ID in the success modal, request server-generated Excel and download it
        const appIdEl = document.getElementById('appId');
        const appId = appIdEl ? appIdEl.textContent.trim() : '';
        if (appId) {
            fetch(`/api/applications/${appId}/export`)
                .then(r => {
                    if (!r.ok) throw new Error('Export failed: ' + r.statusText);
                    return r.blob();
                })
                .then(blob => {
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `CS-Form-6_${document.getElementById('last_name').value || 'form'}_${appId}.xlsx`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    URL.revokeObjectURL(url);
                    showNotification('Excel downloaded (server): ' + a.download, 'success');
                })
                .catch(err => {
                    console.error('Server export failed:', err);
                    alert('Server export failed. See console for details. Falling back to client-side generation.');

                    // Build fallback data from current form values and generate client-side Excel
                    try {
                        const firstName = document.getElementById('first_name').value.trim();
                        const lastName = document.getElementById('last_name').value.trim();
                        const employeeInfo = {
                            office: document.getElementById('office').value || 'N/A',
                            district: document.getElementById('district') ? document.getElementById('district').value || 'N/A' : 'N/A',
                            lastName: lastName,
                            firstName: firstName,
                            middleName: document.getElementById('middle_name').value || '',
                            dateOfFiling: document.getElementById('date_filing').value || new Date().toISOString().split('T')[0],
                            position: document.getElementById('position').value || 'N/A',
                            salary: document.getElementById('salary').value || 'N/A'
                        };
                        const leaveType = document.querySelector('input[name="leave_type"]:checked');
                        const commuteDaily = document.querySelector('input[name="commute_daily"]:checked');
                        const leaveDetails = {
                            leaveType: leaveType?.value || 'Not selected',
                            dateFrom: document.getElementById('date_from').value || 'N/A',
                            dateTo: document.getElementById('date_to').value || 'N/A',
                            workingDays: document.getElementById('num_days').value || '0',
                            reasons: document.getElementById('inclusive_dates').value || 'N/A',
                            commuteDaily: commuteDaily?.value || 'No'
                        };
                        const leaveCredits = {
                            vlEarned: document.getElementById('vl_earned').value || '0',
                            vlLess: document.getElementById('vl_less').value || '0',
                            vlBalance: document.getElementById('vl_balance').value || '0',
                            slEarned: document.getElementById('sl_earned').value || '0',
                            slLess: document.getElementById('sl_less').value || '0',
                            slBalance: document.getElementById('sl_balance').value || '0'
                        };
                        generateExcelFile(employeeInfo, leaveDetails, leaveCredits);
                    } catch (e) {
                        console.error('Fallback generation failed:', e);
                    }
                });
            return; // server download in progress
        }

        // Validate form has data
        const firstName = document.getElementById('first_name').value.trim();
        const lastName = document.getElementById('last_name').value.trim();
        
        if (!firstName || !lastName) {
            alert('Please fill in at least the employee name before generating Excel');
            return;
        }
        
        // Get employee info
        const employeeInfo = {
            office: document.getElementById('office').value || 'N/A',
            district: document.getElementById('district') ? document.getElementById('district').value || 'N/A' : 'N/A',
            lastName: lastName,
            firstName: firstName,
            middleName: document.getElementById('middle_name').value || '',
            dateOfFiling: document.getElementById('date_filing').value || new Date().toISOString().split('T')[0],
            position: document.getElementById('position').value || 'N/A',
            salary: document.getElementById('salary').value || 'N/A'
        };
        
        // Get leave application details
        const leaveType = document.querySelector('input[name="leave_type"]:checked');
        const commuteDaily = document.querySelector('input[name="commute_daily"]:checked');
        
        const leaveDetails = {
            leaveType: leaveType?.value || 'Not selected',
            dateFrom: document.getElementById('date_from').value || 'N/A',
            dateTo: document.getElementById('date_to').value || 'N/A',
            workingDays: document.getElementById('num_days').value || '0',
            reasons: document.getElementById('inclusive_dates').value || 'N/A',
            commuteDaily: commuteDaily?.value || 'No'
        };
        
        // Get leave credits
        const leaveCredits = {
            vlEarned: document.getElementById('vl_earned').value || '0',
            vlLess: document.getElementById('vl_less').value || '0',
            vlBalance: document.getElementById('vl_balance').value || '0',
            slEarned: document.getElementById('sl_earned').value || '0',
            slLess: document.getElementById('sl_less').value || '0',
            slBalance: document.getElementById('sl_balance').value || '0'
        };
        
        // Generate Excel
        generateExcelFile(employeeInfo, leaveDetails, leaveCredits);
    } catch (error) {
        console.error('Error generating Excel:', error);
        alert('Error generating Excel. Check console for details.');
    }
}

function generateExcelFile(employeeInfo, leaveDetails, leaveCredits) {
    if (!window.ExcelJS) {
        alert('Excel library not loaded. Refresh the page.');
        return;
    }

    const ExcelJS = window.ExcelJS;
    const templatePath = 'CS-FORM-6-UPDATED-08-04-2025-1.xlsx';
    
    console.log('Loading template...');
    
    fetch(templatePath)
        .then(r => {
            if (!r.ok) throw new Error('Template not found');
            return r.arrayBuffer();
        })
        .then(ab => {
            console.log('Template loaded, parsing...');
            const wb = new ExcelJS.Workbook();
            return wb.xlsx.load(ab).then(() => wb);
        })
        .then(wb => {
            console.log('Workbook loaded');
            console.log('Worksheets found:', wb.worksheets.map(w => w.name).join(', '));
            
            let ws = wb.worksheets.find(w => !w.hidden) || wb.worksheets[0];
            if (!ws) throw new Error('No worksheet available');
            
            console.log('Using worksheet:', ws.name);
            console.log('Applying form data...');
            
            // COMPREHENSIVE CELL MAPPING FOR CS FORM NO. 6
            // Adjust these cell references based on your actual template layout
            const cellMapping = {
                // Section 1: Office and Name (typically rows 4-6)
                'D5': employeeInfo.office,           // 1. OFFICE/DEPARTMENT
                'C5': employeeInfo.district,        // District
                'D6': employeeInfo.lastName,         // 2. NAME (Last)
                'F6': employeeInfo.firstName,        // 2. NAME (First)
                'H6': employeeInfo.middleName,       // 2. NAME (Middle)
                
                // Section 3-5: Date, Position, Salary (typically row 7-8)
                'D7': employeeInfo.dateOfFiling,     // 3. DATE OF FILING
                'F7': employeeInfo.position,         // 4. POSITION
                'H7': employeeInfo.salary,           // 5. SALARY
                
                // Section 6.A: Type of Leave checkboxes (typically rows 10-18)
                'B10': leaveDetails.leaveType === 'vacation' ? 'X' : '',
                'B11': leaveDetails.leaveType === 'mandatory' ? 'X' : '',
                'B12': leaveDetails.leaveType === 'sick' ? 'X' : '',
                'B13': leaveDetails.leaveType === 'maternity' ? 'X' : '',
                'B14': leaveDetails.leaveType === 'paternity' ? 'X' : '',
                'B15': leaveDetails.leaveType === 'special_privilege' ? 'X' : '',
                'B16': leaveDetails.leaveType === 'study' ? 'X' : '',
                'B17': leaveDetails.leaveType === 'vawc' ? 'X' : '',
                'B18': leaveDetails.leaveType === 'adoption' ? 'X' : '',

                // Details for leave locations/illnesses (checkbox + specify)
                'H14': document.getElementById('within_ph')?.checked ? 'X' : '',
                'J14': (document.querySelector('input[name="within_ph_specify"]') || { value: '' }).value,
                'H16': document.getElementById('abroad')?.checked ? 'X' : '',
                'J16': (document.querySelector('input[name="abroad_specify"]') || { value: '' }).value,
                'K20': document.getElementById('in_hospital')?.checked ? 'X' : '',
                'J20': (document.querySelector('input[name="hospital_illness"]') || { value: '' }).value,
                'K22': document.getElementById('out_patient')?.checked ? 'X' : '',
                'J22': (document.querySelector('input[name="outpatient_illness"]') || { value: '' }).value,
                'J28': (document.querySelector('input[name="women_illness"]') || { value: '' }).value,

                // Section 6.C: Inclusive Dates
                'D20': leaveDetails.dateFrom,        // From
                'F20': leaveDetails.dateTo,          // To
                'H20': leaveDetails.workingDays,     // Number of Working Days
                'D21': leaveDetails.reasons,         // Where Leave Will Be Spent

                // Terminal / Monetization and commutation
                'G40': document.getElementById('monetization')?.checked ? 'X' : '',
                'G42': document.getElementById('terminal')?.checked ? 'X' : '',
                'H46': document.getElementById('not_requested')?.checked ? 'X' : '',
                'H48': document.getElementById('requested')?.checked ? 'X' : '',

                // Section 7.A: Certification of Leave Credits
                'D54': (document.getElementById('credits_date') || { value: '' }).value,
                'D57': leaveCredits.vlEarned,        // Vacation Leave - Total Earned
                'D58': leaveCredits.vlLess,          // Vacation Leave - Less this application
                'D59': leaveCredits.vlBalance,       // Vacation Leave - Balance
                'E57': leaveCredits.slEarned,        // Sick Leave - Total Earned
                'E58': leaveCredits.slLess,          // Sick Leave - Less this application
                'E59': leaveCredits.slBalance,       // Sick Leave - Balance

                // Section 7.C / 7.D: Approval / Disapproval
                'I54': document.getElementById('for_approval')?.checked ? `For approval of ${ (document.querySelector('input[name="approval_days"]') || { value: '' }).value } day/s leave with pay` : (document.getElementById('for_disapproval')?.checked ? `For disapproval due to ${ (document.querySelector('input[name="disapproval_reason"]') || { value: '' }).value }` : ''),
                'C63': (document.querySelector('input[name="days_with_pay"]') || { value: '' }).value,
                'C64': (document.querySelector('input[name="days_without_pay"]') || { value: '' }).value,
                'C65': (document.querySelector('input[name="others_specify"]') || { value: '' }).value,
                'I56': (document.getElementById('disapproved_reason_final') || { value: '' }).value

            };
            
            // Apply all cell values
            Object.entries(cellMapping).forEach(([cellRef, value]) => {
                try {
                    const cell = ws.getCell(cellRef);
                    cell.value = value || '';
                    console.log(`Set ${cellRef} = "${value}"`);
                } catch (err) {
                    console.warn(`Failed to set ${cellRef}:`, err.message);
                }
            });
            
            console.log('All data applied, generating file...');
            
            const fileName = `CS-Form-6_${employeeInfo.lastName}_${Date.now()}.xlsx`;
            
            return wb.xlsx.writeBuffer().then(buf => {
                console.log('File generated, size:', buf.byteLength);
                const blob = new Blob([buf], {
                    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = fileName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                
                console.log('Download complete:', fileName);
                showNotification('Excel downloaded: ' + fileName, 'success');
            });
        })
        .catch(error => {
            console.error('Excel generation failed:', error);
            alert('Error: ' + error.message + '\n\nOpen browser console (F12) for details');
        });
}
function showNotification(message, type) {
    const notification = document.createElement('div');
    notification.className = 'notification ' + type;
    notification.textContent = message;
    notification.style.cssText = 'position: fixed; top: 20px; right: 20px; padding: 15px 20px; border-radius: 5px; background: ' + (type === 'success' ? '#28a745' : '#dc3545') + '; color: white; font-weight: bold; z-index: 9999; box-shadow: 0 2px 10px rgba(0,0,0,0.2);';
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 3000);
}


