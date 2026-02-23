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

    // Detect which portal we're on and return the appropriate login URL
    function getLoginRedirect() {
        var path = window.location.pathname;
        if (path.includes('ao-')) return '/ao-login.html';
        if (path.includes('hr-')) return '/hr-login.html';
        if (path.includes('asds-')) return '/asds-login.html';
        if (path.includes('sds-')) return '/sds-login.html';
        if (path.includes('it-') || path.includes('data-management') || path.includes('activity-logs')) return '/it-login.html';
        return '/login.html'; // Employee default
    }

    // Clear cached user display data on session expiry
    function clearUserData() {
        sessionStorage.removeItem('user');
        sessionStorage.removeItem('employee');
        localStorage.removeItem('user_backup');
        localStorage.removeItem('employee_backup');
        localStorage.removeItem('hrUser');
        localStorage.removeItem('asdsUser');
        localStorage.removeItem('sdsUser');
        localStorage.removeItem('itUser');
        localStorage.removeItem('userRole');
    }

    // Exempt endpoints that should not trigger redirects
    var AUTH_EXEMPT = ['/api/login', '/api/register', '/api/validate-session', '/api/me', '/api/health'];

    // Track if we're already redirecting (prevent multiple redirects)
    let _isRedirecting = false;

    window.fetch = function(url, options) {
        // Only intercept API calls to our server
        if (typeof url === 'string' && url.startsWith('/api/')) {
            return _originalFetch.call(this, url, options).then(function(response) {
                if (response.status === 401 && !_isRedirecting) {
                    // Skip redirect for login/register/health endpoints
                    var exempt = AUTH_EXEMPT.some(function(p) { return url.includes(p); });
                    if (!exempt) {
                        _isRedirecting = true;
                        clearUserData();
                        console.warn('[AUTH] Session expired or invalid. Redirecting to login...');
                        window.location.href = getLoginRedirect();
                    }
                }
                return response;
            });
        }
        return _originalFetch.apply(this, arguments);
    };
})();
