/**
 * Global Modal Alert System
 * Replaces browser alert() with professional modal dialogs
 * Include this file in all HTML pages: <script src="/modal-alert.js"></script>
 */

// Create modal alert HTML structure
function initializeModalAlert() {
    if (document.getElementById('globalModalAlert')) {
        return; // Already initialized
    }

    const modalHTML = `
    <div id="globalModalAlert" class="modal-alert-overlay">
        <div class="modal-alert">
            <div class="modal-alert-header">
                <span class="modal-alert-icon">⚠️</span>
                <span class="modal-alert-title">Alert</span>
            </div>
            <div class="modal-alert-body">
                <p id="modalAlertMessage"></p>
            </div>
            <div class="modal-alert-footer">
                <button class="modal-alert-btn" onclick="closeModalAlert()">OK</button>
            </div>
        </div>
    </div>

    <style>
        .modal-alert-overlay {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
            z-index: 99999;
            justify-content: center;
            align-items: center;
        }

        .modal-alert-overlay.show {
            display: flex;
        }

        .modal-alert {
            background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
            border-radius: 12px;
            min-width: 400px;
            max-width: 600px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8),
                        0 0 40px rgba(255, 107, 107, 0.3);
            border: 1px solid rgba(255, 107, 107, 0.3);
            animation: slideIn 0.3s ease-out;
        }

        @keyframes slideIn {
            from {
                transform: translateY(-30px);
                opacity: 0;
            }
            to {
                transform: translateY(0);
                opacity: 1;
            }
        }

        .modal-alert-header {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 20px;
            border-bottom: 1px solid rgba(255, 107, 107, 0.2);
        }

        .modal-alert-icon {
            font-size: 24px;
            min-width: 30px;
            text-align: center;
        }

        .modal-alert-title {
            font-size: 18px;
            font-weight: bold;
            color: #ff6b6b;
        }

        .modal-alert-body {
            padding: 20px;
            min-height: 60px;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .modal-alert-body p {
            margin: 0;
            color: #e0e0e0;
            font-size: 14px;
            line-height: 1.6;
            white-space: pre-wrap;
            word-wrap: break-word;
            text-align: center;
        }

        .modal-alert-footer {
            display: flex;
            justify-content: center;
            padding: 15px 20px;
            border-top: 1px solid rgba(255, 107, 107, 0.2);
        }

        .modal-alert-btn {
            background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
            color: white;
            border: none;
            padding: 10px 40px;
            border-radius: 6px;
            font-size: 14px;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.3s ease;
            min-width: 100px;
        }

        .modal-alert-btn:hover {
            background: linear-gradient(135deg, #45a049 0%, #3d8b40 100%);
            box-shadow: 0 5px 15px rgba(76, 175, 80, 0.4);
            transform: translateY(-2px);
        }

        .modal-alert-btn:active {
            transform: translateY(0);
        }

        /* Variants for different alert types */
        .modal-alert.error .modal-alert-icon {
            color: #ff6b6b;
        }

        .modal-alert.error .modal-alert-title {
            color: #ff6b6b;
        }

        .modal-alert.success .modal-alert-icon {
            color: #4CAF50;
        }

        .modal-alert.success .modal-alert-title {
            color: #4CAF50;
        }

        .modal-alert.warning .modal-alert-icon {
            color: #FFB800;
        }

        .modal-alert.warning .modal-alert-title {
            color: #FFB800;
        }

        .modal-alert.info .modal-alert-icon {
            color: #2196F3;
        }

        .modal-alert.info .modal-alert-title {
            color: #2196F3;
        }

        @media (max-width: 600px) {
            .modal-alert {
                min-width: 90%;
                max-width: 95%;
            }

            .modal-alert-body p {
                font-size: 13px;
            }
        }
    </style>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

/**
 * Show modal alert with custom title and message
 * @param {string} message - Alert message (supports newlines with \n)
 * @param {string} title - Alert title (default: "Alert")
 * @param {string} type - Alert type: 'info', 'success', 'warning', 'error' (default: 'info')
 * @param {function} callback - Callback function when OK is clicked
 */
function showModalAlert(message = '', title = 'Alert', type = 'info', callback = null) {
    initializeModalAlert();

    const overlay = document.getElementById('globalModalAlert');
    const modal = overlay.querySelector('.modal-alert');
    const titleElement = overlay.querySelector('.modal-alert-title');
    const messageElement = document.getElementById('modalAlertMessage');
    const icon = overlay.querySelector('.modal-alert-icon');

    // Update content
    titleElement.textContent = title;
    messageElement.textContent = message;

    // Set icon based on type
    const icons = {
        'error': '❌',
        'success': '✅',
        'warning': '⚠️',
        'info': 'ℹ️'
    };
    icon.textContent = icons[type] || '⚠️';

    // Update modal class
    modal.className = 'modal-alert ' + type;

    // Store callback
    window.modalAlertCallback = callback;

    // Show modal
    overlay.classList.add('show');

    // Focus on OK button for keyboard accessibility
    setTimeout(() => {
        const btnOK = overlay.querySelector('.modal-alert-btn');
        if (btnOK) btnOK.focus();
    }, 100);
}

/**
 * Close modal alert
 */
function closeModalAlert() {
    const overlay = document.getElementById('globalModalAlert');
    if (overlay) {
        overlay.classList.remove('show');
        
        // Execute callback if provided
        if (window.modalAlertCallback && typeof window.modalAlertCallback === 'function') {
            window.modalAlertCallback();
            window.modalAlertCallback = null;
        }
    }
}

/**
 * Convenience functions for different alert types
 */
window.alertError = function(message, title = '❌ Error', callback = null) {
    showModalAlert(message, title, 'error', callback);
};

window.alertSuccess = function(message, title = '✅ Success', callback = null) {
    showModalAlert(message, title, 'success', callback);
};

window.alertWarning = function(message, title = '⚠️ Warning', callback = null) {
    showModalAlert(message, title, 'warning', callback);
};

window.alertInfo = function(message, title = 'ℹ️ Information', callback = null) {
    showModalAlert(message, title, 'info', callback);
};

/**
 * Override browser alert() with modal alert
 * This makes all alert() calls use the modal instead
 */
window.alert = function(message) {
    // Auto-detect alert type based on message content
    let type = 'info';
    let title = 'Alert';

    if (typeof message === 'string') {
        if (message.includes('❌')) {
            type = 'error';
            title = 'Error';
        } else if (message.includes('✅')) {
            type = 'success';
            title = 'Success';
        } else if (message.includes('⚠️')) {
            type = 'warning';
            title = 'Warning';
        } else if (message.toLowerCase().includes('error')) {
            type = 'error';
            title = 'Error';
        } else if (message.toLowerCase().includes('success') || message.toLowerCase().includes('successfully')) {
            type = 'success';
            title = 'Success';
        }
    }

    showModalAlert(message, title, type);
};

/**
 * Add keyboard support (Escape to close, Enter to confirm)
 */
document.addEventListener('keydown', function(event) {
    const overlay = document.getElementById('globalModalAlert');
    if (!overlay) return;

    if (overlay.classList.contains('show')) {
        if (event.key === 'Escape') {
            closeModalAlert();
        } else if (event.key === 'Enter') {
            closeModalAlert();
        }
    }
});

// Initialize on page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeModalAlert);
} else {
    initializeModalAlert();
}

/**
 * Backward-compatible alias for dashboards that call showAlertModal(message, title).
 * DRY: Eliminates per-file wrapper definitions in sds/asds/hr dashboards.
 */
window.showAlertModal = function(message, title = 'Required Fields Missing') {
    showModalAlert(message, title, 'warning');
};
