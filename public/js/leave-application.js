/**
 * Leave Application Form — Modern UI for CS Form No. 6
 * Preserves identical submit payload to POST /api/submit-leave
 */

(function () {
    'use strict';

    // ===== Leave Type Definitions (CS Form No. 6 — 14 official + Wellness) =====
    const LEAVE_TYPES = [
        { id: 'leave_vl',       name: 'Vacation Leave',                       legal: 'Sec. 51, Rule XVI, Omnibus Rules Implementing E.O. No. 292',                panel: 'location',  balanceKey: 'vl' },
        { id: 'leave_mfl',      name: 'Mandatory / Forced Leave',             legal: 'Sec. 25, Rule XVI, Omnibus Rules Implementing E.O. No. 292',                panel: null,        balanceKey: 'fl' },
        { id: 'leave_sl',       name: 'Sick Leave',                           legal: 'Sec. 43, Rule XVI, Omnibus Rules Implementing E.O. No. 292',                panel: 'sick',      balanceKey: 'sl' },
        { id: 'leave_ml',       name: 'Maternity Leave',                      legal: 'R.A. No. 11210 / IRR issued by CSC, DOLE and SSS',                          panel: null,        balanceKey: null },
        { id: 'leave_pl',       name: 'Paternity Leave',                      legal: 'R.A. No. 8187 / CSC MC No. 71, s. 1998, as amended',                        panel: null,        balanceKey: null },
        { id: 'leave_spl',      name: 'Special Privilege Leave',              legal: 'Sec. 21, Rule XVI, Omnibus Rules Implementing E.O. No. 292',                panel: 'location',  balanceKey: 'spl' },
        { id: 'leave_solo',     name: 'Solo Parent Leave',                    legal: 'RA No. 8972 / CSC MC No. 8, s. 2004',                                       panel: null,        balanceKey: null },
        { id: 'leave_study',    name: 'Study Leave',                          legal: 'Sec. 68, Rule XVI, Omnibus Rules Implementing E.O. No. 292',                panel: 'study',     balanceKey: null },
        { id: 'leave_vawc',     name: '10-Day VAWC Leave',                    legal: 'RA No. 9262 / CSC MC No. 15, s. 2005',                                      panel: null,        balanceKey: null },
        { id: 'leave_rehab',    name: 'Rehabilitation Privilege',             legal: 'Sec. 55, Rule XVI, Omnibus Rules Implementing E.O. No. 292',                panel: null,        balanceKey: null },
        { id: 'leave_women',    name: 'Special Leave Benefits for Women',     legal: 'RA No. 9710 / CSC MC No. 25, s. 2010',                                      panel: 'women',     balanceKey: null },
        { id: 'leave_calamity', name: 'Special Emergency (Calamity) Leave',   legal: 'CSC MC No. 2, s. 2012, as amended',                                         panel: null,        balanceKey: null },
        { id: 'leave_adoption', name: 'Adoption Leave',                       legal: 'R.A. No. 8552',                                                             panel: null,        balanceKey: null },
        { id: 'leave_wl',       name: 'Wellness Leave',                       legal: 'DepEd Order — 3-day yearly allocation',                                     panel: null,        balanceKey: 'wl' },
        { id: 'leave_others',   name: 'Others',                               legal: 'Specify leave type and attach Special Order',                               panel: 'others',    balanceKey: 'cto' },
    ];

    // ===== State =====
    let selectedLeaveType = null;
    let leaveBalances = {};
    let leaveCardData = {};
    let user = null;
    let employee = null;
    let sigDrawing = false;
    let statusPollInterval = null;

    // ===== DOM Ready =====
    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        // Auth check
        try { user = JSON.parse(sessionStorage.getItem('user')); } catch (e) { user = null; }
        try { employee = JSON.parse(sessionStorage.getItem('employee')); } catch (e) { employee = null; }

        if (!user || !user.email) {
            alert('Please login first');
            window.location.href = '/';
            return;
        }

        // Validate session
        try {
            const meResp = await fetch('/api/me');
            if (!meResp.ok) {
                sessionStorage.clear();
                alert('Session expired. Please login again.');
                window.location.href = '/';
                return;
            }
        } catch (e) { /* network error caught by API calls */ }

        populateEmployeeInfo();
        loadLeaveBalances();
        renderLeaveTypeOptions();
        setupLeaveTypeDropdown();
        setupConditionalPanels();
        setupDateRange();
        setupCommutation();
        setupSignaturePad();
        setupSOUpload();
        setupSubmit();
        setupResetForm();
        setupTrackerButtons();
    }

    // ===== 1. Populate Employee Info =====
    function populateEmployeeInfo() {
        const el = (id) => document.getElementById(id);
        el('topbar-user-name').textContent = user.name || user.email.split('@')[0];

        // Name fields
        let lastName = '', firstName = '', middleName = '';
        if (user.firstName || user.lastName || user.middleName) {
            lastName = user.lastName || '';
            firstName = user.firstName || '';
            middleName = user.middleName || '';
        } else if (user.name) {
            if (user.name.includes(',')) {
                const parts = user.name.split(',');
                lastName = parts[0].trim();
                const remaining = (parts[1] || '').trim();
                const nameParts = remaining.split(/\s+/);
                if (nameParts.length >= 2) {
                    firstName = nameParts.slice(0, -1).join(' ');
                    middleName = nameParts[nameParts.length - 1];
                } else {
                    firstName = remaining;
                }
            } else {
                const nameParts = user.name.trim().split(/\s+/);
                if (nameParts.length >= 3) {
                    lastName = nameParts[nameParts.length - 1];
                    middleName = nameParts[nameParts.length - 2];
                    firstName = nameParts.slice(0, -2).join(' ');
                } else if (nameParts.length === 2) {
                    firstName = nameParts[0];
                    lastName = nameParts[1];
                } else {
                    lastName = nameParts[0];
                }
            }
        }

        el('field-name-last').value = lastName;
        el('field-name-first').value = firstName;
        el('field-name-middle').value = middleName;
        el('field-fullname').value = [lastName, firstName, middleName].filter(Boolean).join(', ');

        // Office / Position / Salary
        el('field-office').value = user.office || user.school || (employee && employee.office) || '';
        el('field-position').value = user.position || (employee && employee.position) || '';

        const salaryRaw = user.salary || (employee && employee.salary) || '';
        if (salaryRaw) {
            const salaryNum = parseFloat(salaryRaw);
            el('field-salary').value = isNaN(salaryNum) ? salaryRaw : 'PHP ' + salaryNum.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }

        // Date of filing
        const today = new Date();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        const yyyy = today.getFullYear();
        el('field-date-filing').value = mm + '/' + dd + '/' + yyyy;
        el('field-date-filing-iso').value = yyyy + '-' + mm + '-' + dd;
    }

    // ===== 2. Load Leave Balances =====
    function loadLeaveBalances() {
        const creditsStr = sessionStorage.getItem('leaveCredits');
        const cardStr = sessionStorage.getItem('leaveCardData');

        if (creditsStr) {
            try { leaveBalances = JSON.parse(creditsStr); } catch (e) { leaveBalances = {}; }
        }
        if (cardStr) {
            try { leaveCardData = JSON.parse(cardStr); } catch (e) { leaveCardData = {}; }
        }

        // Render balance chips
        const vl = parseFloat(leaveBalances.vacationLeave) || 0;
        const sl = parseFloat(leaveBalances.sickLeave) || 0;
        const flSpent = leaveCardData.forceLeaveSpent || 0;
        const splSpent = leaveCardData.splSpent || 0;
        const wlSpent = leaveCardData.wellnessSpent || 0;
        const ctoBalance = parseFloat(leaveBalances.othersBalance) || 0;

        setText('bal-vl', vl.toFixed(1));
        setText('bal-sl', sl.toFixed(1));
        setText('bal-fl', Math.max(0, 5 - flSpent).toFixed(0));
        setText('bal-spl', Math.max(0, 3 - splSpent).toFixed(0));
        setText('bal-wl', Math.max(0, 3 - wlSpent).toFixed(0));
        setText('bal-cto', ctoBalance.toFixed(1));
    }

    // ===== 3. Leave Type Dropdown =====
    function renderLeaveTypeOptions() {
        const container = document.getElementById('leave-type-options');
        const flSpent = leaveCardData.forceLeaveSpent || 0;
        const splSpent = leaveCardData.splSpent || 0;
        const wlSpent = leaveCardData.wellnessSpent || 0;

        container.innerHTML = LEAVE_TYPES.map(lt => {
            let badgeHtml = '';
            let isDisabled = false;

            if (lt.id === 'leave_mfl' && flSpent >= 5) {
                badgeHtml = '<span class="lt-badge exhausted">Exhausted</span>';
                isDisabled = true;
            } else if (lt.id === 'leave_spl' && splSpent >= 3) {
                badgeHtml = '<span class="lt-badge exhausted">Exhausted</span>';
                isDisabled = true;
            } else if (lt.id === 'leave_wl' && wlSpent >= 3) {
                badgeHtml = '<span class="lt-badge exhausted">Exhausted</span>';
                isDisabled = true;
            } else {
                badgeHtml = '<span class="lt-badge avail">Available</span>';
            }

            return `<div class="leave-type-option${isDisabled ? ' disabled' : ''}" data-id="${lt.id}">
                <div>
                    <div class="lt-name">${lt.name}</div>
                    <div class="lt-legal">${lt.legal}</div>
                </div>
                ${badgeHtml}
            </div>`;
        }).join('');
    }

    function setupLeaveTypeDropdown() {
        const trigger = document.getElementById('leave-type-trigger');
        const panel = document.getElementById('leave-type-panel');
        const searchInput = document.getElementById('leave-type-search-input');

        trigger.addEventListener('click', () => {
            const isOpen = panel.classList.contains('open');
            if (isOpen) {
                closeDropdown();
            } else {
                panel.classList.add('open');
                trigger.classList.add('open');
                searchInput.value = '';
                filterOptions('');
                searchInput.focus();
            }
        });

        // Close on outside click
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#leave-type-dropdown')) {
                closeDropdown();
            }
        });

        // Search filter
        searchInput.addEventListener('input', () => {
            filterOptions(searchInput.value.toLowerCase());
        });

        // Option click
        document.getElementById('leave-type-options').addEventListener('click', (e) => {
            const option = e.target.closest('.leave-type-option');
            if (!option || option.classList.contains('disabled')) return;
            selectLeaveType(option.dataset.id);
            closeDropdown();
        });

        function closeDropdown() {
            panel.classList.remove('open');
            trigger.classList.remove('open');
        }

        function filterOptions(query) {
            const options = document.querySelectorAll('.leave-type-option');
            options.forEach(opt => {
                const text = opt.textContent.toLowerCase();
                opt.style.display = text.includes(query) ? '' : 'none';
            });
        }
    }

    function selectLeaveType(typeId) {
        selectedLeaveType = typeId;
        document.getElementById('field-leave-type').value = typeId;

        // Update trigger display
        const lt = LEAVE_TYPES.find(t => t.id === typeId);
        const trigger = document.getElementById('leave-type-trigger');
        trigger.innerHTML = `<span class="value">${lt.name}</span>
            <svg class="chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;

        // Highlight selected option
        document.querySelectorAll('.leave-type-option').forEach(opt => {
            opt.classList.toggle('selected', opt.dataset.id === typeId);
        });

        // Show/hide conditional panels
        showDetailPanel(lt.panel);

        // Highlight active balance chip
        document.querySelectorAll('.balance-chip').forEach(chip => {
            chip.classList.remove('active');
        });
        if (lt.balanceKey) {
            const chip = document.querySelector(`.balance-chip.${lt.balanceKey}`);
            if (chip) chip.classList.add('active');
        }

        // Validate force leave days if already have dates
        if (typeId === 'leave_mfl') {
            validateForceLeaveDays();
        }

        // Clear error
        document.getElementById('leave-type-error').style.display = 'none';
    }

    function showDetailPanel(panelName) {
        // Hide all panels
        const panels = ['panel-location', 'panel-sick', 'panel-women', 'panel-study', 'panel-others'];
        panels.forEach(id => {
            document.getElementById(id).classList.remove('visible');
        });

        // Clear all conditional field values
        clearConditionalFields();

        // Show relevant panel
        if (panelName) {
            document.getElementById('panel-' + panelName).classList.add('visible');
        }
    }

    function clearConditionalFields() {
        // Location
        document.querySelectorAll('input[name="location"]').forEach(r => r.checked = false);
        document.getElementById('field-abroad-specify').value = '';
        document.getElementById('abroad-specify-group').style.display = 'none';

        // Sick
        document.querySelectorAll('input[name="sick_type"]').forEach(r => r.checked = false);
        document.getElementById('field-hospital-illness').value = '';
        document.getElementById('field-outpatient-illness').value = '';
        document.getElementById('hospital-illness-group').style.display = 'none';
        document.getElementById('outpatient-illness-group').style.display = 'none';

        // Women
        document.getElementById('field-women-illness').value = '';

        // Study
        document.querySelectorAll('input[name="study_type"]').forEach(r => r.checked = false);

        // Others
        document.getElementById('field-other-specify').value = '';
        const soInput = document.getElementById('field-so-upload');
        if (soInput) soInput.value = '';
        document.getElementById('so-file-name').textContent = 'No file selected';
        document.getElementById('so-remove-btn').style.display = 'none';
    }

    // ===== 4. Conditional Panels =====
    function setupConditionalPanels() {
        // Location: show abroad specify
        document.querySelectorAll('input[name="location"]').forEach(radio => {
            radio.addEventListener('change', () => {
                document.getElementById('abroad-specify-group').style.display =
                    document.getElementById('loc-abroad').checked ? 'block' : 'none';
            });
        });

        // Sick: show illness text
        document.querySelectorAll('input[name="sick_type"]').forEach(radio => {
            radio.addEventListener('change', () => {
                document.getElementById('hospital-illness-group').style.display =
                    document.getElementById('sick-hospital').checked ? 'block' : 'none';
                document.getElementById('outpatient-illness-group').style.display =
                    document.getElementById('sick-outpatient').checked ? 'block' : 'none';
            });
        });
    }

    // ===== 5. Date Range =====
    function setupDateRange() {
        const dateFrom = document.getElementById('field-date-from');
        const dateTo = document.getElementById('field-date-to');

        function updateDays() {
            if (dateFrom.value && dateTo.value) {
                const days = calculateWorkingDays(dateFrom.value, dateTo.value);
                document.getElementById('days-count').textContent = days;
                document.getElementById('days-computed').style.visibility = 'visible';

                // Validate force leave
                if (selectedLeaveType === 'leave_mfl') {
                    validateForceLeaveDays();
                }
            } else {
                document.getElementById('days-computed').style.visibility = 'hidden';
            }
            document.getElementById('date-error').style.display = 'none';
        }

        dateFrom.addEventListener('change', updateDays);
        dateTo.addEventListener('change', updateDays);
    }

    function calculateWorkingDays(fromStr, toStr) {
        const start = new Date(fromStr);
        const end = new Date(toStr);
        if (isNaN(start) || isNaN(end) || start > end) return 0;

        let count = 0;
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dow = d.getDay();
            if (dow >= 1 && dow <= 5) count++;
        }
        return count;
    }

    function validateForceLeaveDays() {
        const days = parseInt(document.getElementById('days-count').textContent) || 0;
        if (selectedLeaveType === 'leave_mfl' && days >= 5) {
            alert('Force Leave cannot be taken for 5 or more consecutive working days.\nMaximum: 4 days per application.');
            return false;
        }
        return true;
    }

    // ===== 6. Commutation =====
    function setupCommutation() {
        document.querySelectorAll('input[name="commutation"]').forEach(radio => {
            radio.addEventListener('change', () => {
                document.querySelectorAll('.commutation-option').forEach(opt => {
                    opt.classList.toggle('selected', opt.querySelector('input').checked);
                });
            });
        });
    }

    // ===== 7. Signature Pad =====
    function setupSignaturePad() {
        const canvas = document.getElementById('signaturePad');
        const ctx = canvas.getContext('2d');
        const wrap = document.getElementById('sig-canvas-wrap');
        let isDrawing = false;
        let lastX = 0, lastY = 0;

        function getPos(e) {
            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            if (e.touches) {
                return {
                    x: (e.touches[0].clientX - rect.left) * scaleX,
                    y: (e.touches[0].clientY - rect.top) * scaleY
                };
            }
            return {
                x: (e.clientX - rect.left) * scaleX,
                y: (e.clientY - rect.top) * scaleY
            };
        }

        function startDraw(e) {
            e.preventDefault();
            isDrawing = true;
            const pos = getPos(e);
            lastX = pos.x;
            lastY = pos.y;
        }

        function draw(e) {
            if (!isDrawing) return;
            e.preventDefault();
            const pos = getPos(e);
            ctx.beginPath();
            ctx.moveTo(lastX, lastY);
            ctx.lineTo(pos.x, pos.y);
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            ctx.stroke();
            lastX = pos.x;
            lastY = pos.y;
            wrap.classList.add('has-signature');
        }

        function stopDraw() {
            isDrawing = false;
        }

        canvas.addEventListener('mousedown', startDraw);
        canvas.addEventListener('mousemove', draw);
        canvas.addEventListener('mouseup', stopDraw);
        canvas.addEventListener('mouseleave', stopDraw);
        canvas.addEventListener('touchstart', startDraw, { passive: false });
        canvas.addEventListener('touchmove', draw, { passive: false });
        canvas.addEventListener('touchend', stopDraw);

        // Clear
        document.getElementById('btn-clear-sig').addEventListener('click', () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            wrap.classList.remove('has-signature');
            document.getElementById('sig-error').classList.remove('show');
        });

        // Upload
        document.getElementById('btn-upload-sig').addEventListener('click', () => {
            document.getElementById('sig-upload-input').click();
        });

        document.getElementById('sig-upload-input').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const img = new Image();
            img.onload = () => {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                // Scale to fit
                const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
                const w = img.width * scale;
                const h = img.height * scale;
                const x = (canvas.width - w) / 2;
                const y = (canvas.height - h) / 2;
                ctx.drawImage(img, x, y, w, h);
                wrap.classList.add('has-signature');
            };
            img.src = URL.createObjectURL(file);
        });
    }

    function hasSignatureData() {
        const canvas = document.getElementById('signaturePad');
        const ctx = canvas.getContext('2d');
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        return data.data.some((val, i) => i % 4 === 3 && val > 0);
    }

    // ===== 8. SO File Upload =====
    function setupSOUpload() {
        const input = document.getElementById('field-so-upload');
        const nameSpan = document.getElementById('so-file-name');
        const removeBtn = document.getElementById('so-remove-btn');

        input.addEventListener('change', () => {
            if (input.files && input.files[0]) {
                const file = input.files[0];
                if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
                    alert('Only PDF files are accepted for Special Order uploads.');
                    input.value = '';
                    return;
                }
                if (file.size > 10 * 1024 * 1024) {
                    alert('PDF file must be under 10MB.');
                    input.value = '';
                    return;
                }
                nameSpan.textContent = file.name;
                nameSpan.classList.add('file-upload-name');
                removeBtn.style.display = 'inline-flex';
            }
        });

        removeBtn.addEventListener('click', () => {
            input.value = '';
            nameSpan.textContent = 'No file selected';
            removeBtn.style.display = 'none';
        });
    }

    // ===== 9. Submit =====
    function setupSubmit() {
        document.getElementById('btn-submit').addEventListener('click', handleSubmit);
    }

    async function handleSubmit() {
        const submitBtn = document.getElementById('btn-submit');

        // --- Validation ---

        // Leave type
        if (!selectedLeaveType) {
            document.getElementById('leave-type-error').style.display = 'block';
            document.getElementById('leave-type-dropdown').scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }

        // Dates
        const dateFrom = document.getElementById('field-date-from').value;
        const dateTo = document.getElementById('field-date-to').value;
        if (!dateFrom || !dateTo) {
            document.getElementById('date-error').style.display = 'block';
            document.getElementById('field-date-from').scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }

        const numDays = calculateWorkingDays(dateFrom, dateTo);
        if (numDays <= 0) {
            alert('Invalid date range. "To" date must be on or after "From" date, and must include at least 1 working day.');
            return;
        }

        // Force Leave validations
        if (selectedLeaveType === 'leave_mfl') {
            if (numDays >= 5) {
                alert('Force Leave cannot be taken for 5 or more consecutive working days.\nMaximum: 4 days per application.');
                return;
            }
            const flSpent = leaveCardData.forceLeaveSpent || 0;
            if (flSpent >= 5) {
                alert('You have exhausted your yearly Force Leave allocation (5 days).');
                return;
            }
        }

        // SPL validation
        if (selectedLeaveType === 'leave_spl') {
            const splSpent = leaveCardData.splSpent || 0;
            if (splSpent >= 3) {
                alert('You have exhausted your yearly Special Privilege Leave allocation (3 days).');
                return;
            }
        }

        // Wellness validation
        if (selectedLeaveType === 'leave_wl') {
            const wlSpent = leaveCardData.wellnessSpent || 0;
            if (wlSpent >= 3) {
                alert('You have exhausted your yearly Wellness Leave allocation (3 days).');
                return;
            }
        }

        // Others: must specify + upload SO
        if (selectedLeaveType === 'leave_others') {
            const spec = document.getElementById('field-other-specify').value.trim();
            const soInput = document.getElementById('field-so-upload');
            const hasFile = soInput && soInput.files && soInput.files.length > 0;

            if (!spec && !hasFile) {
                alert('You selected "Others" as your leave type. Please:\n1. Enter the type of leave (e.g., CTO - SO #12345)\n2. Upload the PDF copy of your Special Order');
                document.getElementById('field-other-specify').focus();
                return;
            }
            if (!spec) {
                alert('Please specify the leave type in the text field.');
                document.getElementById('field-other-specify').focus();
                return;
            }
            if (!hasFile) {
                alert('Please upload the PDF copy of your Special Order.');
                return;
            }
            const soFile = soInput.files[0];
            if (soFile.type !== 'application/pdf' && !soFile.name.toLowerCase().endsWith('.pdf')) {
                alert('Only PDF files are accepted for Special Order uploads.');
                return;
            }
        }

        // Signature
        if (!hasSignatureData()) {
            document.getElementById('sig-error').classList.add('show');
            alert('You must provide your signature to submit the leave application.\nPlease either draw or upload your signature.');
            document.getElementById('sig-canvas-wrap').scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }
        document.getElementById('sig-error').classList.remove('show');

        // --- Build Payload (identical to legacy form) ---

        const canvas = document.getElementById('signaturePad');
        const signatureData = canvas.toDataURL('image/png');

        const vlEarned = parseFloat(leaveBalances.vacationLeave) || 0;
        const slEarned = parseFloat(leaveBalances.sickLeave) || 0;

        const applicationData = {
            employeeEmail: user.email,
            employeeName: user.name,
            office: document.getElementById('field-office').value,
            position: document.getElementById('field-position').value,
            salary: document.getElementById('field-salary').value,
            dateOfFiling: document.getElementById('field-date-filing-iso').value,
            leaveType: selectedLeaveType,
            dateFrom: dateFrom,
            dateTo: dateTo,
            numDays: String(numDays),
            vlEarned: (selectedLeaveType === 'leave_vl' || selectedLeaveType === 'leave_sl') ? vlEarned.toFixed(3) : '',
            slEarned: (selectedLeaveType === 'leave_vl' || selectedLeaveType === 'leave_sl') ? slEarned.toFixed(3) : '',
            vlLess: '',
            slLess: '',
            vlBalance: '',
            slBalance: '',
            commutation: getRadioValue('commutation') || '',
            employeeSignature: signatureData,
            // Location details (VL / SPL)
            locationPH: document.getElementById('loc-ph').checked,
            locationAbroad: document.getElementById('loc-abroad').checked,
            abroadSpecify: document.getElementById('field-abroad-specify').value || '',
            // Sick leave details
            sickHospital: document.getElementById('sick-hospital').checked,
            sickOutpatient: document.getElementById('sick-outpatient').checked,
            hospitalIllness: document.getElementById('field-hospital-illness').value || '',
            outpatientIllness: document.getElementById('field-outpatient-illness').value || '',
            // Study leave details
            studyMasters: document.getElementById('study-masters').checked,
            studyBar: document.getElementById('study-bar').checked,
            // Women's special leave
            womenIllness: document.getElementById('field-women-illness').value || '',
            // Others
            otherLeaveSpecify: document.getElementById('field-other-specify').value || '',
            soFileData: null,
            soFileName: ''
        };

        // Read SO PDF as base64 if uploaded
        const soInput = document.getElementById('field-so-upload');
        if (soInput && soInput.files && soInput.files.length > 0) {
            const soFile = soInput.files[0];
            const soBase64 = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => resolve(null);
                reader.readAsDataURL(soFile);
            });
            if (soBase64) {
                applicationData.soFileData = soBase64;
                applicationData.soFileName = soFile.name;
            }
        }

        // --- Submit ---
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';

        try {
            const response = await fetch('/api/submit-leave', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(applicationData)
            });

            const result = await response.json();

            if (result.success) {
                sessionStorage.setItem('lastApplicationId', result.applicationId);
                showTracker(result.applicationId, result.currentApprover);
            } else {
                const errorMsg = result.message || result.error || 'Unknown error';
                alert(errorMsg);
            }
        } catch (error) {
            console.error('Submit error:', error);
            alert('Error submitting application. Please try again.');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg> Submit Application';
        }
    }

    // ===== 10. Reset Form =====
    function setupResetForm() {
        document.getElementById('btn-reset-form').addEventListener('click', () => {
            // Reset leave type
            selectedLeaveType = null;
            document.getElementById('field-leave-type').value = '';
            const trigger = document.getElementById('leave-type-trigger');
            trigger.innerHTML = '<span class="placeholder">Select leave type...</span><svg class="chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>';
            document.querySelectorAll('.leave-type-option').forEach(opt => opt.classList.remove('selected'));

            // Clear panels
            showDetailPanel(null);

            // Clear dates
            document.getElementById('field-date-from').value = '';
            document.getElementById('field-date-to').value = '';
            document.getElementById('days-computed').style.visibility = 'hidden';

            // Clear commutation
            document.querySelectorAll('input[name="commutation"]').forEach(r => r.checked = false);
            document.querySelectorAll('.commutation-option').forEach(o => o.classList.remove('selected'));

            // Clear signature
            const canvas = document.getElementById('signaturePad');
            canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
            document.getElementById('sig-canvas-wrap').classList.remove('has-signature');

            // Clear balance highlight
            document.querySelectorAll('.balance-chip').forEach(c => c.classList.remove('active'));

            // Clear errors
            document.getElementById('leave-type-error').style.display = 'none';
            document.getElementById('date-error').style.display = 'none';
            document.getElementById('sig-error').classList.remove('show');
        });
    }

    // ===== 11. Status Tracker =====
    function showTracker(appId, currentApprover) {
        document.getElementById('tracker-app-id').textContent = appId;
        document.getElementById('tracker-overlay').classList.add('open');

        // Animate: submitted → AO pending
        const steps = ['ts-submitted', 'ts-ao', 'ts-hr', 'ts-asds', 'ts-sds', 'ts-done'];
        steps.forEach(id => {
            const el = document.getElementById(id);
            el.classList.remove('active', 'completed');
        });

        setTimeout(() => {
            document.getElementById('ts-submitted').classList.add('completed');
            setTimeout(() => {
                document.getElementById('ts-ao').classList.add('active');
                document.getElementById('tracker-status-text').textContent = 'Pending AO Approval';
            }, 400);
        }, 400);

        // Start polling
        startPolling(appId);
    }

    function setupTrackerButtons() {
        document.getElementById('btn-tracker-refresh').addEventListener('click', () => {
            const appId = document.getElementById('tracker-app-id').textContent;
            if (appId) checkStatus(appId);
        });

        document.getElementById('btn-tracker-dashboard').addEventListener('click', () => {
            stopPolling();
            window.location.href = '/dashboard';
        });
    }

    function startPolling(appId) {
        stopPolling();
        statusPollInterval = setInterval(() => checkStatus(appId), 5000);
    }

    function stopPolling() {
        if (statusPollInterval) {
            clearInterval(statusPollInterval);
            statusPollInterval = null;
        }
    }

    async function checkStatus(appId) {
        try {
            const resp = await fetch('/api/application-status/' + appId);
            const result = await resp.json();
            if (result.success) updateTracker(result.application);
        } catch (e) {
            console.error('Status check error:', e);
        }
    }

    function updateTracker(app) {
        const stepMap = {
            submitted: 'ts-submitted',
            ao: 'ts-ao',
            hr: 'ts-hr',
            asds: 'ts-asds',
            sds: 'ts-sds',
            done: 'ts-done'
        };

        // Reset
        Object.values(stepMap).forEach(id => {
            document.getElementById(id).classList.remove('active', 'completed');
        });

        // Submitted always completed
        document.getElementById('ts-submitted').classList.add('completed');

        if (app.aoApprovedAt) document.getElementById('ts-ao').classList.add('completed');
        else if (app.currentApprover === 'AO') document.getElementById('ts-ao').classList.add('active');

        if (app.hrApprovedAt) document.getElementById('ts-hr').classList.add('completed');
        else if (app.currentApprover === 'HR') document.getElementById('ts-hr').classList.add('active');

        if (app.asdsApprovedAt) document.getElementById('ts-asds').classList.add('completed');
        else if (app.currentApprover === 'ASDS') document.getElementById('ts-asds').classList.add('active');

        if (app.sdsApprovedAt) document.getElementById('ts-sds').classList.add('completed');
        else if (app.currentApprover === 'SDS') document.getElementById('ts-sds').classList.add('active');

        if (app.status === 'approved') {
            document.getElementById('ts-done').classList.add('completed');
            document.getElementById('tracker-status-text').textContent = 'Application Approved!';
            stopPolling();
        } else if (app.status === 'disapproved' || app.status === 'rejected') {
            document.getElementById('tracker-status-text').textContent = 'Application Disapproved';
            document.getElementById('tracker-status-text').style.color = 'var(--color-danger)';
            stopPolling();
        } else if (app.status === 'returned') {
            document.getElementById('tracker-status-text').textContent = 'Application Returned — Please check dashboard';
            document.getElementById('tracker-status-text').style.color = 'var(--color-warning)';
            stopPolling();
        } else {
            const names = { AO: 'AO', HR: 'HR', ASDS: 'ASDS', SDS: 'SDS' };
            document.getElementById('tracker-status-text').textContent =
                'Pending ' + (names[app.currentApprover] || '') + ' Approval';
        }
    }

    // ===== Helpers =====
    function setText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    function getRadioValue(name) {
        const checked = document.querySelector('input[name="' + name + '"]:checked');
        return checked ? checked.value : null;
    }

})();
