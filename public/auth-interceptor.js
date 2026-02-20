/**
 * auth-interceptor.js — Automatically adds authentication tokens to API requests.
 * Include this script in any page that makes /api/ calls.
 * 
 * Works with all portal token storage patterns:
 * - Employee: sessionStorage.authToken
 * - AO: sessionStorage.aoToken
 * - HR: localStorage.hrToken
 * - ASDS: localStorage.asdsToken
 * - SDS: localStorage.sdsToken
 * - IT: localStorage.itToken
 * 
 * Also handles 401 responses by clearing stale tokens and redirecting to login.
 */
(function() {
    'use strict';
    const _originalFetch = window.fetch;

    function getAuthToken() {
        return sessionStorage.getItem('authToken')
            || sessionStorage.getItem('aoToken')
            || localStorage.getItem('hrToken')
            || localStorage.getItem('asdsToken')
            || localStorage.getItem('sdsToken')
            || localStorage.getItem('itToken')
            || localStorage.getItem('authToken_backup');
    }

    // Detect which portal we're on and return the appropriate login URL
    function getLoginRedirect() {
        const path = window.location.pathname;
        if (path.includes('ao-')) return '/ao-login.html';
        if (path.includes('hr-')) return '/hr-login.html';
        if (path.includes('asds-')) return '/asds-login.html';
        if (path.includes('sds-')) return '/sds-login.html';
        if (path.includes('it-')) return '/it-login.html';
        return '/login.html'; // Employee default
    }

    // Clear all auth tokens
    function clearAllTokens() {
        sessionStorage.removeItem('authToken');
        sessionStorage.removeItem('aoToken');
        localStorage.removeItem('hrToken');
        localStorage.removeItem('asdsToken');
        localStorage.removeItem('sdsToken');
        localStorage.removeItem('itToken');
        localStorage.removeItem('authToken_backup');
        localStorage.removeItem('user_backup');
        localStorage.removeItem('employee_backup');
    }

    // Track if we're already redirecting (prevent multiple redirects)
    let _isRedirecting = false;

    window.fetch = function(url, options) {
        // Only intercept API calls to our server
        if (typeof url === 'string' && url.startsWith('/api/')) {
            options = options || {};

            // Normalize headers to a plain object
            if (!options.headers) {
                options.headers = {};
            } else if (options.headers instanceof Headers) {
                const h = {};
                options.headers.forEach(function(v, k) { h[k] = v; });
                options.headers = h;
            }

            // Don't override an existing Authorization header
            if (!options.headers['Authorization']) {
                var token = getAuthToken();
                if (token) {
                    options.headers['Authorization'] = 'Bearer ' + token;
                }
            }

            // Wrap the response to handle 401 (session expired / server restarted)
            return _originalFetch.call(this, url, options).then(function(response) {
                if (response.status === 401 && !_isRedirecting) {
                    // Skip redirect for login/register/validate-session endpoints
                    if (!url.includes('/api/login') && !url.includes('/api/register') && !url.includes('/api/validate-session')) {
                        _isRedirecting = true;
                        clearAllTokens();
                        sessionStorage.removeItem('user');
                        sessionStorage.removeItem('employee');
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
