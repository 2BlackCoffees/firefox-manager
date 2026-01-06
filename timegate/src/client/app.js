const API_URL = window.location.origin.includes('localhost') 
  ? `http://localhost:${process.env.SERVER_PORT}/api` 
  : '/api';
// UI Elements
const authModal = document.getElementById('authModal');
const modalInput = document.getElementById('modalInput');
const modalConfirm = document.getElementById('modalConfirm');
const modalCancel = document.getElementById('modalCancel');
const modalHeader = document.getElementById('modalHeader');

let pendingAction = null;

// --- Modal Logic ---
function requestPassword(message = "ACCESS KEY REQUIRED") {
    return new Promise((resolve) => {
        authModal.style.display = 'flex';
        modalInput.value = '';
        modalHeader.textContent = "☯ " + message.toUpperCase();
        modalInput.focus();

        modalConfirm.onclick = () => {
            const val = modalInput.value;
            authModal.style.display = 'none';
            resolve(val);
        };
        modalCancel.onclick = () => {
            authModal.style.display = 'none';
            resolve(null);
        };
    });
}

function showAlert(type = 'info', title = 'SYSTEM MESSAGE', message = '') {
    return new Promise((resolve) => {
        const infoModal = document.getElementById('infoModal');
        const infoTitle = document.getElementById('infoTitle');
        const infoMessage = document.getElementById('infoMessage');
        const infoClose = document.getElementById('infoClose');

        // 1. Set the text
        infoTitle.textContent = `☯ ${title.toUpperCase()}`;
        infoMessage.textContent = message;

        // 2. Set the style based on type
        infoTitle.className = 'modal-header'; // Reset
        infoTitle.classList.add(`header-${type}`);

        // 3. Show and handle close
        infoModal.style.display = 'flex';

        infoClose.onclick = () => {
            infoModal.style.display = 'none';
            resolve();
        };
    });
}

// --- Protected API ---
async function secureApi(path, method, body) {
    const key = await requestPassword();
    if (!key) return;

    const res = await fetch(`${API_URL}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'Authorization': key },
        body: JSON.stringify(body)
    });

    if (res.status === 401) await showAlert('error', 'Security issue', "Invalid password used.");
    else if (res.ok) {
        await showAlert('info', 'Action Successful', "Action completed successfully.");
        loadHistory();
    }
}

// --- Actions ---
document.getElementById('allowBtn').onclick = async () => {
    const checked = Array.from(document.querySelectorAll('.site-selector input:checked')).map(i => i.value);
    const manual = document.getElementById('customSite').value.trim();
    let sites = [...new Set([...checked, ...(manual ? [manual] : [])])];
    
    if (sites.length === 0) {
         await showAlert('error', 'No webSite selected', "Please select at least one website.");
         return;
    }
    secureApi('/allow', 'POST', { sites, duration: document.getElementById('duration').value });
};

document.getElementById('stopBtn').onclick = () => secureApi('/stop', 'POST', {});

document.getElementById('changePassBtn').onclick = async () => {
    const oldP = await requestPassword("Enter your current passowrd");
    if (!oldP) return;
    
    // For change password, we need a special flow for the new password
    const n1 = await requestPassword("Enter your new passowrd");
    if (!n1) return;    
    const n2 = await requestPassword("Confirm your new password");
    if (!n2) return;
    if (n1 !== n2) 
        return await showAlert('error', 'Password not changed',"The 2 passwords do not match.");

    const res = await fetch(`${API_URL}/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': oldP },
        body: JSON.stringify({ oldPassword: oldP, newPassword: n1 })
    });
    if (res.ok) await showAlert('info', 'Password Changed Successfully', "Password has been successfully changed.");
    else await showAlert('error', 'Password not changed',"Password Verification Failed.");
};

// --- Initialization ---
async function init() {
    const res = await fetch(`${API_URL}/auth-status`);
    const { initialized } = await res.json();
    if (!initialized) {
        await showAlert('warning', 'First start', "Please setup a password (Do not reuse any of your passwords).");
        const p = await requestPassword();
        await fetch(`${API_URL}/setup-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: p })
        });
    }
    loadHistory();
    modalInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            // Prevent the default behavior (like form submission) 
            event.preventDefault(); 
            // Trigger the click event on the confirm button
            modalConfirm.click();
        }
    });
}

function formatFullCreationString(selectedSites, isoTimestamp, durationMins) {
    const date = new Date(isoTimestamp);
    
    // Formats to "Jan 1, 11:23 AM"
    const datePart = date.toLocaleDateString([], { 
        month: 'short', 
        day: 'numeric' 
    });
    
    const timePart = date.toLocaleTimeString([], { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
    let result = ''
    if (selectedSites !== null && selectedSites !== undefined) {
        result = `Sites: ${selectedSites?.join(', ')}  - \t`;
    }    
    result += `${datePart}, ${timePart}`;

    // Add duration only if it exists and is not null
    if (durationMins !== null && durationMins !== undefined) {
        result += ` for ${durationMins}m`;
    }
    return result;
}

async function loadHistory() {
    const res = await fetch(`${API_URL}/history`);
    const data = await res.json();
    document.getElementById('historyList').innerHTML = data.map(i => `
        <div class="log-item">
            <strong>${i.action}</strong>: ${formatFullCreationString(i.sites, i.timestamp, i.duration_minutes)}
        </div>
    `).join('');
}

init();