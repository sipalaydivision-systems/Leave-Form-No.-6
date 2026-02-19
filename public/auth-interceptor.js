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
            || localStorage.getItem('itToken');
    }

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
        }
        return _originalFetch.apply(this, arguments);
    };
})();
