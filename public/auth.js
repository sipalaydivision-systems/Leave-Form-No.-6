/**
 * auth.js — Client-side authentication helper for SDO Sipalay Leave Management System
 * Provides session token management, authenticated API calls, and auth guards.
 */
const Auth = (() => {
    const TOKEN_KEY = 'authToken';
    const USER_KEY = 'authUser';

    /** Store session after login */
    function saveSession(token, user) {
        sessionStorage.setItem(TOKEN_KEY, token);
        sessionStorage.setItem(USER_KEY, JSON.stringify(user));
    }

    /** Get stored token */
    function getToken() {
        return sessionStorage.getItem(TOKEN_KEY);
    }

    /** Get stored user object */
    function getUser() {
        try {
            const raw = sessionStorage.getItem(USER_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch { return null; }
    }

    /** Clear session (logout) */
    function clearSession() {
        sessionStorage.removeItem(TOKEN_KEY);
        sessionStorage.removeItem(USER_KEY);
        // Also clear any legacy keys
        sessionStorage.removeItem('user');
        sessionStorage.removeItem('userEmail');
        sessionStorage.removeItem('userName');
        localStorage.removeItem('hrUser');
        localStorage.removeItem('userRole');
        localStorage.removeItem('itUser');
        localStorage.removeItem('aoUser');
    }

    /** Check if user is authenticated */
    function isAuthenticated() {
        return !!getToken() && !!getUser();
    }

    /**
     * Make authenticated API request
     * Automatically injects Authorization header with session token.
     * If 401 is returned, clears session and redirects to login.
     */
    async function apiFetch(url, options = {}) {
        const token = getToken();
        const headers = {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const res = await fetch(url, { ...options, headers });

        if (res.status === 401) {
            clearSession();
            const user = getUser();
            const portal = user?.role || '';
            let loginPage = '/';
            if (portal === 'hr') loginPage = '/hr-login';
            else if (portal === 'asds') loginPage = '/asds-login';
            else if (portal === 'sds') loginPage = '/sds-login';
            else if (portal === 'ao') loginPage = '/ao-login';
            else if (portal === 'it') loginPage = '/it-login';
            else loginPage = '/login';
            
            if (typeof showAlert === 'function') {
                showAlert('Session expired. Please log in again.', 'warning');
            }
            setTimeout(() => { window.location.href = loginPage; }, 1500);
            throw new Error('Session expired');
        }

        return res;
    }

    /**
     * Auth guard — call at the top of protected pages.
     * Redirects to login if no valid session. 
     * @param {string} requiredRole - 'user', 'hr', 'asds', 'sds', 'ao', 'it'
     * @param {string} loginRedirect - URL to redirect to if unauthenticated
     */
    function requireLogin(requiredRole, loginRedirect) {
        if (!isAuthenticated()) {
            window.location.href = loginRedirect || '/';
            return false;
        }
        const user = getUser();
        if (requiredRole && user.role !== requiredRole) {
            window.location.href = loginRedirect || '/';
            return false;
        }
        return true;
    }

    /** Logout — calls server to invalidate session, then clears local data */
    async function logout(redirectUrl) {
        try {
            const token = getToken();
            if (token) {
                await fetch('/api/logout', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    }
                });
            }
        } catch (e) {
            // Ignore network errors during logout
        }
        clearSession();
        window.location.href = redirectUrl || '/';
    }

    /** Validate session with server */
    async function validateSession() {
        const token = getToken();
        if (!token) return false;
        try {
            const res = await fetch('/api/validate-session', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) {
                clearSession();
                return false;
            }
            return true;
        } catch {
            return false;
        }
    }

    return {
        saveSession,
        getToken,
        getUser,
        clearSession,
        isAuthenticated,
        apiFetch,
        requireLogin,
        logout,
        validateSession
    };
})();
