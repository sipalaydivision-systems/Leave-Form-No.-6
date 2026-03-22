/**
 * Shared utility functions for all client-side pages.
 * Include via: <script src="/utils.js"></script>
 */

/**
 * Escape HTML entities to prevent XSS when injecting into innerHTML.
 * Defense-in-depth: server-side sanitizeInput() already encodes stored data,
 * but this protects against localStorage, error messages, and client-only data.
 * @param {*} str - Value to escape (coerced to string)
 * @returns {string} HTML-safe string
 */
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    const s = String(str);
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
    return s.replace(/[&<>"'`]/g, ch => map[ch]);
}

/**
 * Safely build an onclick attribute value with escaped parameters.
 * Prevents breakout from onclick="fn('...')" via quotes in data.
 * @param {string} fnName - Function name to call
 * @param {...string} args - Arguments to pass (will be escaped)
 * @returns {string} Safe onclick attribute string
 */
function safeOnclick(fnName, ...args) {
    const escaped = args.map(a => escapeHtml(String(a).replace(/\\/g, '\\\\').replace(/'/g, "\\'"))).join("', '");
    return `${fnName}('${escaped}')`;
}

// ========== Leave Type Labels (DRY: used by 5+ portal dashboards) ==========

/**
 * Comprehensive leave type ID to display label mapping.
 * Supports both old-style ('vacation') and new-style ('leave_vl') IDs.
 */
const LEAVE_TYPE_LABELS = {
    'vacation': 'Vacation Leave',
    'mandatory': 'Mandatory/Force Leave',
    'sick': 'Sick Leave',
    'maternity': 'Maternity Leave',
    'paternity': 'Paternity Leave',
    'special_privilege': 'Special Privilege Leave',
    'solo_parent': 'Solo Parent Leave',
    'study': 'Study Leave',
    'vawc': '10-Day VAWC Leave',
    'rehabilitation': 'Rehabilitation Privilege',
    'leave_vl': 'Vacation Leave',
    'leave_mfl': 'Mandatory/Force Leave',
    'leave_mandatory': 'Mandatory/Force Leave',
    'leave_sl': 'Sick Leave',
    'leave_maternity': 'Maternity Leave',
    'leave_paternity': 'Paternity Leave',
    'leave_spl': 'Special Privilege Leave',
    'leave_solo': 'Solo Parent Leave',
    'leave_study': 'Study Leave',
    'leave_vawc': '10-Day VAWC Leave',
    'leave_ml': 'Maternity Leave',
    'leave_pl': 'Paternity Leave',
    'leave_rehabilitation': 'Rehabilitation Privilege',
    'leave_rehab': 'Rehabilitation Privilege',
    'special_leave_women': 'Special Leave Benefits for Women',
    'leave_women': 'Special Leave Benefits for Women',
    'special_emergency': 'Special Emergency (Calamity) Leave',
    'leave_calamity': 'Special Emergency (Calamity) Leave',
    'adoption': 'Adoption Leave',
    'leave_adoption': 'Adoption Leave',
    'wellness': 'Wellness Leave',
    'leave_wl': 'Wellness Leave',
    'leave_wellness': 'Wellness Leave',
    'others': 'Other Leave'
};

/**
 * Get human-readable label for a leave type ID.
 * @param {string} type - Leave type key (e.g., 'leave_vl', 'sick')
 * @returns {string} Display label
 */
function getLeaveTypeLabel(type) {
    return LEAVE_TYPE_LABELS[type] || (type ? type.charAt(0).toUpperCase() + type.slice(1) + ' Leave' : 'Leave');
}

/** Alias for backward compatibility (dashboard.html uses this name) */
const getLeaveTypeName = getLeaveTypeLabel;

// ========== Logout System (DRY: used by all 7 portal pages) ==========

/**
 * Initialize the logout modal system. Call once on DOMContentLoaded.
 * Uses HttpOnly cookie auth — server handles session destruction.
 * @param {object} opts
 * @param {'session'|'local'} [opts.storage='session'] - Which storage holds cached user display data
 * @param {string} opts.redirectUrl - URL to redirect after logout (e.g., '/ao-login')
 */
function initLogoutSystem(opts) {
    const store = opts.storage === 'local' ? localStorage : sessionStorage;

    // Inject modal HTML if not already present
    if (!document.getElementById('logoutModal')) {
        const modalDiv = document.createElement('div');
        modalDiv.innerHTML = `
            <div id="logoutModal" class="logout-modal" style="display:none">
                <div class="logout-modal-content">
                    <div class="logout-modal-header">
                        <h3>Confirm Logout</h3>
                    </div>
                    <div class="logout-modal-body">
                        <p>Are you sure you want to logout?</p>
                    </div>
                    <div class="logout-modal-footer">
                        <button class="btn-cancel" onclick="closeLogoutModal()">Cancel</button>
                        <button class="btn-logout" onclick="confirmLogout()">Logout</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(modalDiv.firstElementChild);
    }

    // Inject minimal CSS if not already present
    if (!document.getElementById('logoutModalCSS')) {
        const style = document.createElement('style');
        style.id = 'logoutModalCSS';
        style.textContent = `
            .logout-modal { position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:10000; display:flex; align-items:center; justify-content:center; }
            .logout-modal-content { background:#fff; border-radius:12px; padding:24px; max-width:400px; width:90%; box-shadow:0 10px 30px rgba(0,0,0,0.3); animation:slideDown 0.3s ease; }
            .logout-modal-header h3 { margin:0 0 16px; color:#333; }
            .logout-modal-body p { margin:0 0 20px; color:#666; }
            .logout-modal-footer { display:flex; gap:12px; justify-content:flex-end; }
            .logout-modal-footer button { padding:8px 20px; border:none; border-radius:6px; cursor:pointer; font-weight:600; }
            .btn-cancel { background:#e0e0e0; color:#333; }
            .btn-logout { background:#e74c3c; color:#fff; }
            @keyframes slideDown { from { transform:translateY(-20px); opacity:0; } to { transform:translateY(0); opacity:1; } }`;
        document.head.appendChild(style);
    }

    // Expose global functions
    window.logout = function() {
        document.getElementById('logoutModal').style.display = 'flex';
    };
    window.closeLogoutModal = function() {
        document.getElementById('logoutModal').style.display = 'none';
    };
    window.confirmLogout = function() {
        // Destroy server session (cookie sent automatically)
        fetch('/api/logout', { method: 'POST' }).catch(() => {});
        // Clear cached user display data
        store.removeItem('user');
        store.removeItem('userData');
        window.location.href = opts.redirectUrl;
    };

    // Close on outside click
    document.getElementById('logoutModal').addEventListener('click', function(e) {
        if (e.target === this) closeLogoutModal();
    });
}
