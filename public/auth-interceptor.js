/**
 * auth-interceptor.js — Handles 401 responses by redirecting to the appropriate login page.
 *
 * With HttpOnly cookie auth, tokens are managed entirely by the browser.
 * No manual Authorization headers needed — cookies are sent automatically.
 * This interceptor only handles expired-session redirects.
 */
(function() {
    'use strict';
    const _originalFetch = window.fetch;

    // Map a role code to its login page (single source of truth)
    function loginUrlForRole(role) {
        switch (role) {
            case 'aov':   return '/admin-officer-login.html'; // Admin Officer V Portal
            case 'hr':   return '/hr-login.html';            // HR Portal
            case 'asds': return '/asds-login.html';
            case 'sds':  return '/sds-login.html';
            case 'it':   return '/it-login.html';
            case 'user': return '/login.html';
            default:     return null;
        }
    }

    // Detect which portal the user actually logged into; fall back to URL path.
    function getLoginRedirect() {
        try {
            var role = localStorage.getItem('userRole');
            var url = loginUrlForRole(role);
            if (url) return url;
        } catch (_) {}
        var path = window.location.pathname;
        if (path.includes('admin-officer-')) return '/admin-officer-login.html';
        if (path.includes('edit-employee-cards') || path.includes('employee-leavecard') || path.includes('hr-')) return '/hr-login.html';
        if (path.includes('asds-')) return '/asds-login.html';
        if (path.includes('sds-')) return '/sds-login.html';
        if (path.includes('it-') || path.includes('data-management') || path.includes('activity-logs')) return '/it-login.html';
        return '/login.html'; // Employee default
    }

    // Clear cached user display data on session expiry (only for current portal)
    function clearUserData() {
        var path = window.location.pathname;

        // Always clear employee/user session data
        sessionStorage.removeItem('user');
        sessionStorage.removeItem('employee');
        sessionStorage.removeItem('myApplications');
        localStorage.removeItem('user_backup');
        localStorage.removeItem('employee_backup');

        // Clear portal-specific storage based on current page
        if (path.includes('hr-')) {
            localStorage.removeItem('hrUser');
        } else if (path.includes('asds-')) {
            localStorage.removeItem('asdsUser');
        } else if (path.includes('sds-')) {
            localStorage.removeItem('sdsUser');
        } else if (path.includes('it-') || path.includes('data-management') || path.includes('activity-logs')) {
            localStorage.removeItem('itUser');
        }
        localStorage.removeItem('userRole');
    }

    // Exempt endpoints that should not trigger redirects
    var AUTH_EXEMPT = ['/api/login', '/api/register', '/api/validate-session', '/api/me', '/api/health'];

    // Track if we're already redirecting (prevent multiple redirects)
    let _isRedirecting = false;

    window.fetch = function(url, options) {
        // Only intercept API calls to our server
        if (typeof url === 'string' && url.startsWith('/api/')) {
            // Treat any API call as user activity so long-running requests
            // (e.g. Excel migration preview) don't get aborted by the idle timer
            if (url !== '/api/logout' && typeof window.__resetIdleTimer === 'function') {
                window.__resetIdleTimer();
            }
            return _originalFetch.call(this, url, options).then(function(response) {
                if (response.status === 401 && !_isRedirecting) {
                    // Skip redirect for login/register/health endpoints
                    var exempt = AUTH_EXEMPT.some(function(p) { return url.includes(p); });
                    if (!exempt) {
                        _isRedirecting = true;
                        // Resolve the redirect URL BEFORE wiping the userRole key
                        // so the user returns to the portal they were actually on.
                        var redirectUrl = getLoginRedirect();
                        clearUserData();
                        console.warn('[AUTH] Session expired or invalid. Redirecting to login...');
                        window.location.href = redirectUrl;
                    }
                }
                return response;
            });
        }
        return _originalFetch.apply(this, arguments);
    };
})();

// =============================================================================
// Inactivity Auto-Logout
// Monitors user activity (mouse movement, clicks, keypresses, scroll, touch,
// and API calls) and logs out automatically after 5 minutes of idle time.
// A 10-second countdown warning modal appears at the 4 min 50 s mark so the
// user can click "Stay Logged In" to extend the session.
// =============================================================================
(function () {
    'use strict';

    var IDLE_MS    = 290000;  // show warning after 4 min 50 s of inactivity
    var WARN_MS    = 10000;   // countdown duration (10 s)
    var TIMEOUT_MS = 300000;  // total before forced logout = 5 minutes

    // ── portal helpers (duplicated to keep this IIFE self-contained) ──────────
    // Prefer the role the user actually logged in with; fall back to URL path.
    function getLoginUrl() {
        try {
            var role = localStorage.getItem('userRole');
            switch (role) {
                case 'aov':   return '/admin-officer-login.html';
                case 'hr':   return '/hr-login.html';
                case 'asds': return '/asds-login.html';
                case 'sds':  return '/sds-login.html';
                case 'it':   return '/it-login.html';
                case 'user': return '/login.html';
            }
        } catch (_) {}
        var p = window.location.pathname;
        if (p.includes('admin-officer-')) return '/admin-officer-login.html';
        if (p.includes('edit-employee-cards') || p.includes('employee-leavecard') || p.includes('hr-')) return '/hr-login.html';
        if (p.includes('asds-')) return '/asds-login.html';
        if (p.includes('sds-')) return '/sds-login.html';
        if (p.includes('it-') || p.includes('data-management') || p.includes('activity-logs')) return '/it-login.html';
        return '/login.html';
    }

    function wipeStorage() {
        ['user','employee','myApplications'].forEach(function(k){ sessionStorage.removeItem(k); });
        ['user_backup','employee_backup','hrUser','asdsUser','sdsUser','itUser','userRole']
            .forEach(function(k){ localStorage.removeItem(k); });
    }

    // ── state ─────────────────────────────────────────────────────────────────
    var _warnTimer      = null;
    var _logoutTimer    = null;
    var _countdownTimer = null;

    // ── modal injection ───────────────────────────────────────────────────────
    function injectIdleUI() {
        if (document.getElementById('_idleModal')) return;

        var style = document.createElement('style');
        style.textContent = [
            '#_idleModal{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;',
            'display:none;align-items:center;justify-content:center;}',
            '#_idleModal.open{display:flex;}',
            '#_idleBox{background:#fff;border-radius:14px;padding:32px 28px;max-width:360px;',
            'width:90%;box-shadow:0 16px 48px rgba(0,0,0,.28);text-align:center;',
            'animation:_idleIn .25s ease;}',
            '@keyframes _idleIn{from{transform:translateY(-18px);opacity:0}to{transform:translateY(0);opacity:1}}',
            '#_idleBox .idle-icon{font-size:44px;margin-bottom:14px;}',
            '#_idleBox h3{margin:0 0 8px;font-size:17px;color:#111827;font-family:inherit;}',
            '#_idleBox p{margin:0 0 16px;font-size:13.5px;color:#6b7280;line-height:1.55;font-family:inherit;}',
            '#_idleNum{display:inline-block;background:#fef3c7;color:#92400e;border-radius:10px;',
            'padding:8px 22px;font-size:28px;font-weight:700;margin-bottom:18px;min-width:60px;}',
            '._idleActions{display:flex;gap:10px;justify-content:center;}',
            '._idleStay{background:#2563eb;color:#fff;border:none;border-radius:8px;',
            'padding:10px 24px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;}',
            '._idleStay:hover{background:#1d4ed8;}',
            '._idleLeave{background:#f1f5f9;color:#374151;border:none;border-radius:8px;',
            'padding:10px 24px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;}',
            '._idleLeave:hover{background:#e2e8f0;}'
        ].join('');
        document.head.appendChild(style);

        var el = document.createElement('div');
        el.id = '_idleModal';
        el.innerHTML =
            '<div id="_idleBox">' +
            '  <div class="idle-icon">\u23F0</div>' +
            '  <h3>Session Expiring Soon</h3>' +
            '  <p>You\'ve been inactive.<br>Logging out automatically in:</p>' +
            '  <div id="_idleNum">10</div>' +
            '  <p style="font-size:12px;color:#9ca3af;margin:0 0 18px">Move your mouse or press any key to stay logged in.</p>' +
            '  <div class="_idleActions">' +
            '    <button class="_idleStay" id="_idleStayBtn">Stay Logged In</button>' +
            '    <button class="_idleLeave" id="_idleLeaveBtn">Logout Now</button>' +
            '  </div>' +
            '</div>';
        document.body.appendChild(el);

        document.getElementById('_idleStayBtn').addEventListener('click', resetIdle);
        document.getElementById('_idleLeaveBtn').addEventListener('click', forceLogout);
    }

    function showWarning() {
        var modal = document.getElementById('_idleModal');
        if (!modal) return;
        var secs = Math.round(WARN_MS / 1000);
        document.getElementById('_idleNum').textContent = secs;
        modal.classList.add('open');

        _countdownTimer = setInterval(function () {
            secs -= 1;
            var numEl = document.getElementById('_idleNum');
            if (numEl) numEl.textContent = secs < 0 ? 0 : secs;
            if (secs <= 0) {
                clearInterval(_countdownTimer);
                forceLogout();
            }
        }, 1000);
    }

    function hideWarning() {
        clearInterval(_countdownTimer);
        var modal = document.getElementById('_idleModal');
        if (modal) modal.classList.remove('open');
    }

    function forceLogout() {
        hideWarning();
        clearTimeout(_warnTimer);
        clearTimeout(_logoutTimer);
        // Resolve the login URL BEFORE wiping storage so we can redirect
        // back to the portal the user was actually on (not the employee default)
        var redirectUrl = getLoginUrl();
        fetch('/api/logout', { method: 'POST' }).catch(function () {});
        wipeStorage();
        window.location.href = redirectUrl;
    }

    // ── timer management ──────────────────────────────────────────────────────
    function resetIdle() {
        hideWarning();
        clearTimeout(_warnTimer);
        clearTimeout(_logoutTimer);

        // Show warning at IDLE_MS, force logout at TIMEOUT_MS
        _warnTimer   = setTimeout(showWarning,  IDLE_MS);
        _logoutTimer = setTimeout(forceLogout,  TIMEOUT_MS);
    }

    // Expose so the fetch interceptor (IIFE 1) can reset the timer on API calls
    window.__resetIdleTimer = resetIdle;

    // ── activity event listeners ──────────────────────────────────────────────
    var EVENTS = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'click', 'scroll'];
    EVENTS.forEach(function (evt) {
        document.addEventListener(evt, function () {
            // Only reset if we're not already showing the final-second countdown
            resetIdle();
        }, { passive: true, capture: true });
    });

    // ── bootstrap ─────────────────────────────────────────────────────────────
    function boot() {
        injectIdleUI();
        resetIdle();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
