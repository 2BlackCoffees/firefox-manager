const API_URL = window.location.origin.includes('localhost') 
  ? `http://localhost:${process.env.SERVER_PORT}/api` 
  : '/api';
// UI Elements
const authModal = document.getElementById('authModal');
const modalInput = document.getElementById('modalInput');
const modalConfirm = document.getElementById('modalConfirm');
const modalCancel = document.getElementById('modalCancel');
const modalHeader = document.getElementById('modalHeader');
const updateTimeBtn = document.getElementById('updateTimeBtn');
const settingsModal = document.getElementById('settingsModal');
const openSettingsBtn = document.getElementById('openSettingsBtn');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');

let pendingAction = null;

async function loadGlobalSettings() {
    try {
        const res = await fetch(`${API_URL}/settings/time`);
        if (!res.ok) throw new Error("Settings fetch failed");
        
        const data = await res.json();
        
        // Map DB fields to the HTML Input elements
        if (data.min_start_time) {
            document.getElementById('globalStart').value = data.min_start_time;
        }
        if (data.max_start_time) {
            document.getElementById('globalEnd').value = data.max_start_time;
        }
    } catch (e) {
        console.error("Error loading global settings:", e);
    }
}

function showModal(message) {
    authModal.style.display = 'flex';
    modalInput.value = '';
    modalHeader.textContent = message;
    modalInput.classList.remove('shake');
    
    // Timeout ensures the element is visible before focusing
    setTimeout(() => {
        modalInput.focus();
    }, 10);
}
function closeModal() {
    authModal.style.display = 'none';
    modalInput.classList.remove('shake');
}


// --- Modal Logic ---
function requestPassword(message = "ACCESS KEY REQUIRED") {
    return new Promise((resolve) => {
        showModal("☯ " + message.toUpperCase());

        modalConfirm.onclick = () => {
            const val = modalInput.value;
            closeModal();
            resolve(val);
        };
        modalCancel.onclick = () => {
            closeModal();
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
        closeModal();
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
updateTimeBtn.onclick = async () => {
    const start = document.getElementById('globalStart').value;
    const end = document.getElementById('globalEnd').value;

    const key = await requestPassword("AUTHORIZE TIME UPDATE");
    if (!key) return;

    const res = await fetch(`${API_URL}/settings/time`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': key },
        body: JSON.stringify({ min_start_time: start, max_start_time: end })
    });

    if (res.ok) {
        await showAlert('info', 'Settings Updated', "Global time settings have been updated.");
    } else {
        await showAlert('error', 'Update Failed', "Unauthorized access.");
    }
}
openSettingsBtn.onclick = async () => {
    const key = await requestPassword("ACCESS SYSTEM SETTINGS");
    if (!key) return;
    
    // Verify key or just show (using existing secure logic)
    settingsModal.style.display = 'flex';
    loadTargets(true); // Load targets with "X" for modal
};

closeSettingsBtn.onclick = () => {
    settingsModal.style.display = 'none';
    loadTargets(false); // Reload main list without "X"
};


// --- Initialization ---
async function init() {

    loadTargets(false);
    loadHistory();
    loadGlobalSettings();

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
    modalCancel.addEventListener('click', closeModal);

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && authModal.style.display !== 'none') {
            closeModal();
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

// Update this function in app.js
async function loadTargets(isManagementMode = false) {
    const res = await fetch(`${API_URL}/targets`);
    const targets = await res.json();
    const container = document.getElementById('siteSelector');
    
    if (isManagementMode) {
        // Render inside the Settings Modal with delete buttons
        const container = document.getElementById('modalSiteList');
        container.innerHTML = targets.map(site => `
            <div class="modal-site-item">
                <span>${site.name} (${site.address})</span>
                <button class="btn-danger" style="padding: 5px 10px; font-size: 10px;" 
                    onclick="deleteTarget(${site.id}, '${site.name}')">REMOVE</button>
            </div>
        `).join('');
    } else {
        // Render on Main Page (Selection Only)
        const container = document.getElementById('siteSelector');
        container.innerHTML = targets.map(site => `
            <label class="site-btn">
                <input type="checkbox" value="${site.address}">
                <span>${site.name}</span>
            </label>
        `).join('');
    }
}

// Add this new function
window.deleteTarget = async (id, name) => {
    const confirmDelete = await requestPassword(`DELETE ${name.toUpperCase()}?`);
    if (!confirmDelete) return;

    const res = await fetch(`${API_URL}/targets/${id}`, {
        method: 'DELETE',
        headers: { 
            'Content-Type': 'application/json', 
            'Authorization': confirmDelete 
        }
    });

    if (res.ok) {
        await showAlert('info', 'Target Neutralized', `${name} has been removed.`);
        loadTargets(true);
    } else {
        await showAlert('error', 'Action Failed', "Unauthorized access.");
    }
};

document.getElementById('addNewTargetBtn').onclick = async () => {
    const name = document.getElementById('newSiteName').value.trim();
    const address = document.getElementById('newSiteAddress').value.trim();

    if (!name || !address) {
        return showAlert('error', 'Missing Data', "Please provide both a name and an address.");
    }

    // Reuse your existing secureApi logic or call fetch directly with auth
    const key = await requestPassword("AUTHORIZE NEW TARGET");
    if (!key) return;

    const res = await fetch(`${API_URL}/targets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': key },
        body: JSON.stringify({ name, address })
    });

    if (res.ok) {
        document.getElementById('newSiteName').value = '';
        document.getElementById('newSiteAddress').value = '';
        await showAlert('info', 'Target Added', `${name} is now in your mission list.`);
        loadTargets(true);
    } else {
        await showAlert('error', 'Unauthorized', "Invalid password.");
    }
};

init();