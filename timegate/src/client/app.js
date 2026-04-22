import { TimeScheduler } from './scheduler.js';

// Initialize the scheduler instance
const scheduler = new TimeScheduler('weeklyScheduler');

const API_URL = window.location.origin.includes('localhost') 
  ? `http://localhost:${process.env.SERVER_PORT}/api` 
  : '/api';

// --- MULTI-CLIENT STATE ---
let selectedClientId = null;

// UI Elements
const clientSelector = document.getElementById('clientSelector'); // Ensure this exists in HTML
const authModal = document.getElementById('authModal');
const modalInput = document.getElementById('modalInput');
const modalConfirm = document.getElementById('modalConfirm');
const modalCancel = document.getElementById('modalCancel');
const modalHeader = document.getElementById('modalHeader');
const settingsModal = document.getElementById('settingsModal');
const openSettingsBtn = document.getElementById('openSettingsBtn');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const saveScheduledButton = document.getElementById('saveScheduleBtn');
const openAccessTimeBtn = document.getElementById('openAccessTimeBtn');
const timeAccessesModal = document.getElementById('timeAccessesModal');
const updateFirefoxAccessTime = document.getElementById('updateFirefoxAccessTime');
const timeAccessesModalCancel = document.getElementById('timeAccessesModalCancel');


// --- HELPER: HEADERS ---
function getHeaders(authKey = null, client = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (authKey) headers['Authorization'] = authKey;
    if (client) headers['x-client-id'] = client;
    return headers;
}

async function loadAll() {
    await Promise.all([
        loadGlobalSettings(),
        loadHistory(),
        loadSchedule()
    ]);
}
// --- CLIENT CONTEXT MANAGEMENT ---
async function setClient(id) {
    selectedClientId = id;
    localStorage.setItem('last_selected_client', id);
    console.log(`Selected client set to: ${id}`);
    
    loadAll();
}

function getClient() {
    if (!selectedClientId) {
            showAlert('error', 'No client selected', "This actions requires a client to be selected."); 
    }
    return selectedClientId
}

async function apiGetRequest(url, headers = {}) {
    // 1. Generate and Log the CURL command
    const curlArgs = Object.entries(headers)
        .map(([key, value]) => `-H "${key}: ${value}"`)
        .join(' ');
    
    const curlCommand = `curl -X GET "${url}" ${curlArgs}`;
    
    console.log("%c DEBUG CURL ", "background: #222; color: #bada55; font-weight: bold;", curlCommand);

    try {
        // 2. Execute Fetch
        const response = await fetch(url, {
            method: 'GET',
            headers: headers
        });

        // 3. Error Handling
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`HTTP ${response.status}: ${errorData.error || response.statusText}`);
        }

        return await response;
    } catch (error) {
        console.error(`[API Error] ${url}:`, error.message);
        throw error;
    }
}

let globalClients = []; 
async function initClientList() {
    try {
        console.log(`Address server: ${API_URL}/clients`)
        //console.log(`'Authorization': ${adminPassword}`)
        const res = await fetch(`${API_URL}/clients`, { headers: getHeaders(null, null) });
        globalClients = await res.json();
        console.log(`Client list:`, globalClients);
        
        if (clientSelector) {
            // clientSelector.innerHTML = globalClients.map(c => 
            //     `<option value="${c.id}">${c.id}</option>`
            // ).join('');

            const last = localStorage.getItem('last_selected_client');
            //const initialId = (last && clients.find(c => c.id === last)) ? last : clients[0]?.id;
            const initialId = (last && globalClients.find(c => c.id === last)) ? last : globalClients[0]?.id;
            refreshFullFleetLabels(); // Load with status indicators

            clientSelector.value = initialId;
            setClient(initialId);

        } else {
            console.error("No client found yet, please refresh in 60sec.");
        }
    } catch (e) {
        console.error("Failed to load clients", e);
    }
    // Now that selectedClientId is guaranteed, load the rest
    loadTargets(false);
    loadAll();
}

// Trigger full fleet status ONLY on click/interaction
clientSelector.addEventListener('mousedown', refreshFullFleetLabels);

// Change handler remains the same
clientSelector.onchange = (e) => {
    setClient(e.target.value);
    if (clientSelector.value != e.target.value) {
        clientSelector.value = e.target.value; // Ensure dropdown reflects the actual selected client
    }
    refreshSingleStatus(); // Update LED immediately for new selection
};

// Triggered ONLY when the user clicks the dropdown
async function refreshFullFleetLabels() {
    try {
        const res = await fetch(`${API_URL}/clients/status-all`, { headers: getHeaders(null, null) });
        const fleetStatus = await res.json();
        renderClientDropdown(clientSelector.value, fleetStatus);
    } catch (e) { console.error("Fleet sync failed", e); }
}

function renderClientDropdown(selectedId, fleetStatus = {}) {
    if (!clientSelector) return;

    clientSelector.innerHTML = globalClients.map(c => {
        const statusData = fleetStatus[c.id];
        
        // Define the indicator based on status
        // 🟢 for connected, 🔴 for disconnected, ⚪ for unknown/offline
        let indicator = "⚪"; 
        if (statusData) {
            indicator = statusData.online ? "🟢" : "🔴";
        }

        const isSelected = c.id === selectedId ? 'selected' : '';
        return `<option value="${c.id}" ${isSelected}>
            ${indicator} ${c.id}
        </option>`;
    }).join('');
}

// Background Polling (Single Client)
async function refreshSingleStatus() {
    const activeId = getClient();
    if (!activeId) return;

    try {
        const res = await apiGetRequest(`${API_URL}/clients/get-status`, getHeaders(null, activeId));
        // const res = await fetch(`${API_URL}/clients/get-status`, { 
        //     headers: getHeaders(activeId, null) 
        // });
        const data = await res.json();
        
        // Update ONLY the LED color
        const statusColor = data.online ? '#44ff00ff' : '#ff003c';
        clientSelector.style.setProperty('--status-color', statusColor);
        console.log(`Polled status for ${activeId}: Online=${data.online}, Data structure=${data}`);
    } catch (e) { 
        console.error("Single poll failed", e); 
    }
}

function startSingleStatusPoll() {
    refreshSingleStatus();
    setInterval(refreshSingleStatus, 60000);
}

// --- DATA CALCULATION & UI ---
function calculateDailyTotal(ranges) {
    if (!ranges || ranges.length === 0) return 0;
    let totalMinutes = 0;
    ranges.forEach(range => {
        const [start, end] = range.split('-');
        const [sH, sM] = start.split(':').map(Number);
        const [eH, eM] = end.split(':').map(Number);
        totalMinutes += (eH * 60 + eM) - (sH * 60 + sM);
    });
    return (totalMinutes / 60).toFixed(1);
}

function updateSyntheticView(data) {
    const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const grid = document.getElementById('statusGrid');
    const summary = document.getElementById('todayWindows');
    const todayIndex = new Date().getDay();

    let gridHTML = '';
    for (let i = 0; i < 7; i++) {
        const hours = calculateDailyTotal(data[i]);
        const isToday = i === todayIndex;
        gridHTML += `
            <div class="day-stat" style="${isToday ? 'border-bottom: 2px solid #00f3ff;' : ''}">
                <span class="day-label">${dayNames[i]}</span>
                <span class="hour-value ${hours <= 0 ? 'zero' : ''}">${hours}<span class="hour-unit">H</span></span>
            </div>`;
    }
    grid.innerHTML = gridHTML;
    summary.innerText = (data[todayIndex]?.length > 0) ? data[todayIndex].join(' | ') : 'STANDBY MODE (NO ACCESS)';
}

// --- API FETCHERS ---
async function loadGlobalSettings() {
    const client = getClient();
    if (!client) return;
    try {
        const res = await fetch(`${API_URL}/settings/time`, { headers: getHeaders(null, client) });
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
async function secureApi(path, method, body, client = null) {
    const key = await requestPassword();
    if (!key) return;

    const res = await fetch(`${API_URL}${path}`, {
        method,
        headers: getHeaders(key, client),
        body: JSON.stringify(body)
    });

    if (res.status === 401) {
        await showAlert('error', 'Security issue', "Invalid password used.");
    } else if (res.ok) {
        closeModal();
        await showAlert('info', 'Action Successful', "Action completed successfully.");
        loadHistory();
    }
}

// --- Actions ---
document.getElementById('allowBtn').onclick = async () => {
    const client = getClient();
    if(!client) return;
    
    const checked = Array.from(document.querySelectorAll('.site-selector input:checked')).map(i => i.value);
    const manual = document.getElementById('customSite').value.trim();
    let sites = [...new Set([...checked, ...(manual ? [manual] : [])])];
    
    if (sites.length === 0) {
         await showAlert('error', 'No webSite selected', "Please select at least one website.");
         return;
    }
    secureApi('/allow', 'POST', { sites, duration: document.getElementById('duration').value }, client);
};

document.getElementById('stopBtn').onclick = () => {
    const client = getClient();
    if(!client) return;
    
    secureApi('/stop', 'POST', {}, client);
}

document.getElementById('changePassBtn').onclick = async () => {
    const oldPassword = await requestPassword("Enter your current passowrd");
    if (!oldPassword) return;
    
    // For change password, we need a special flow for the new password
    const newPassword = await requestPassword("Enter your new passowrd");
    if (!newPassword) return;    
    const newPasswordRetypeed = await requestPassword("Confirm your new password");
    if (!newPasswordRetypeed) return;
    if (newPassword !== newPasswordRetypeed) 
        return await showAlert('error', 'Password not changed',"The 2 passwords do not match.");

    const res = await fetch(`${API_URL}/change-password`, {
        method: 'POST',
        headers: getHeaders(oldPassword, null),
        body: JSON.stringify({ oldPassword: oldPassword, newPassword: newPassword })
    });
    if (res.ok) await showAlert('info', 'Password Changed Successfully', "Password has been successfully changed.");
    else await showAlert('error', 'Password not changed',"Password Verification Failed.");
};

openAccessTimeBtn.onclick = () => {
    // Pre-fill the modal with current values from the main screen
    document.getElementById('pickerStart').value = document.getElementById('globalStart').value;
    document.getElementById('pickerEnd').value = document.getElementById('globalEnd').value;
    
    timeAccessesModal.style.display = 'flex';
};

timeAccessesModalCancel.onclick = () => {
    timeAccessesModal.style.display = 'none';
};

updateFirefoxAccessTime.onclick = async () => {
    const start = document.getElementById('pickerStart').value;
    const end = document.getElementById('pickerEnd').value;

    const client = getClient();
    if(!client) return;

    const key = await requestPassword("AUTHORIZE TIME UPDATE");
    if (!key) return;

    try {
        const res = await fetch(`${API_URL}/settings/time`, {
            method: 'POST',
            headers: getHeaders(key, client),
            body: JSON.stringify({ min_start_time: start, max_start_time: end })
        });

        if (res.ok) {
            // Update the read-only display on the main page
            document.getElementById('globalStart').value = start;
            document.getElementById('globalEnd').value = end;
            
            timeAccessesModal.style.display = 'none';
            await showAlert('info', 'Settings Updated', "Global time settings updated. System refresh may take a few minutes.");
        } else {
            await showAlert('error', 'Update Failed', "Unauthorized access.");
        }
    } catch (error) {
        console.error("Update Firefox Access Time Failed:", error);
    }
};

openSettingsBtn.onclick = async () => {
    settingsModal.style.display = 'flex';
    loadTargets(true); 
};

closeSettingsBtn.onclick = () => {
    settingsModal.style.display = 'none';
    loadTargets(false); 
};


async function loadSchedule() {
    const client = getClient();
    if (!client) return;
    try {
        const res = await fetch(`${API_URL}/settings/poweronschedule`, { headers: getHeaders(null, client) });
        const data = await res.json();
        scheduler.setSchedule(data);
        updateSyntheticView(data.schedule);
    } catch (e) { 
        console.error("Failed to load schedule", e);
    }
}

saveScheduledButton.onclick = async () => {
    const currentData = scheduler.getSchedule();
    const key = await requestPassword("AUTHORIZE POWER ON TIME UPDATE");
    const client = getClient();
    if(!client) return;

    if (!key) return;

    try {

        const res = await fetch(`${API_URL}/settings/poweronschedule`, {
            method: 'POST',
            headers: getHeaders(key, client),
            body: JSON.stringify({ schedule: currentData })
        });

        if (res.ok) {
            await showAlert('info', 'Schedule Deployed', "Protocol updated successfully.");
            updateSyntheticView(currentData);
        } else {
            await showAlert('error', 'Schedule update Failed', "Unauthorized access."); 
        }
    } catch (e) {
        console.error("PowerOn Schedule failed: ", e)

    }
};

async function init() {
    // 1. Check if the system even has a password yet
    const authRes = await apiGetRequest(`${API_URL}/auth-status`);

    const { initialized } = await authRes.json();
    
    if (!initialized) {
        await showAlert('warning', 'First start', "Please setup a password.");
        const n1 = await requestPassword("Enter your passowrd");
        if (!n1) {
            await showAlert('error', 'Security issue', "Invalid password used.");
            setTimeout(init, 1000);
            return;
        };    
        const n2 = await requestPassword("Confirm your password");
        if (!n2) {
            await showAlert('error', 'Security issue', "Invalid password used.");
            setTimeout(init, 1000);
            return;
        };            
        if (n1 !== n2) {
            await showAlert('error', 'Password not set',"The 2 passwords do not match.");
            setTimeout(init, 1000);
            return;
        }

        await fetch(`${API_URL}/setup-password`, {
            method: 'POST',
            body: JSON.stringify({ password: n1 }),
            headers: getHeaders(null, null)
        });
    }

    // Load the client list and WAIT for it to set the selectedClientId
    await initClientList(); 
    startSingleStatusPoll();
    return;


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
    const client = getClient();
    if(!client) return;
    try {
        const res = await fetch(`${API_URL}/history`, {headers: getHeaders(null, client)});
        const data = await res.json();
        document.getElementById('historyList').innerHTML = data.map(i => `
            <div class="log-item">
                <small>[${i.client_id}]</small> <strong>${i.action}</strong>: 
                ${formatFullCreationString(i.sites, i.timestamp, i.duration_minutes)}
            </div>
        `).join('');
    } catch (e) { 
        console.error("Load history failed: ", e); 
    }
}

async function loadTargets(isManagementMode = false) {
    const res = await fetch(`${API_URL}/targets`, { headers: getHeaders() });
    const targets = await res.json();
    
    if (isManagementMode) {
        document.getElementById('modalSiteList').innerHTML = targets.map(site => `
            <div class="modal-site-item">
                <span>${site.name}</span>
                <button class="btn-danger" style="padding: 5px 10px; font-size: 10px;" 
                    onclick="deleteTarget(${site.id}, '${site.name}')">REMOVE</button>
            </div>`).join('');
    } else {
        document.getElementById('siteSelector').innerHTML = targets.map(site => `
            <label class="site-btn">
                <input type="checkbox" value="${site.address}">
                <span>${site.name}</span>
            </label>`).join('');
    }
}

window.deleteTarget = async (id, name) => {
    const confirmDelete = await requestPassword(`DELETE ${name.toUpperCase()}?`);
    if (!confirmDelete) return;

    const res = await fetch(`${API_URL}/targets/${id}`, {
        method: 'DELETE',
        headers: getHeaders(confirmDelete, null)
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
        headers: getHeaders(key, null), 
        body: JSON.stringify({ name, address }) 
    });
   if (res.ok) {
        document.getElementById('newSiteName').value = '';
        document.getElementById('newSiteAddress').value = '';
        await showAlert('info', 'Target Added', `${name} is now in your mission list.`);
        loadTargets(true); // loadTargets(false);
    } else {
        await showAlert('error', 'Unauthorized', "Invalid password.");
    }
};

// --- STARFIELD ANIMATION ---
init();

const canvas = document.getElementById('starCanvas');
const ctx = canvas.getContext('2d');

let stars = [];
const starCount = 300; // Lower count looks cleaner over a background image

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

window.addEventListener('resize', resize);
resize();

class Star {
    constructor() {
        this.init();
    }

    init() {
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * canvas.height;
        this.size = Math.random() * 1.5 + 0.5;
        this.speedY = Math.random() * 0.4 * (this.y > canvas.height / 2 ? -1 : +1);
        this.speedX = Math.random() * 0.4 * (this.y > canvas.width / 2 ? -1 : +1);
        this.opacity = Math.random() + 0.1; 
        this.fadeSpeed = this.opacity / Math.min(canvas.width/this.speedX, canvas.height/this.speedY) ;
        this.angle = Math.random() * Math.PI * 2;
        this.curve = (Math.random() - 0.5) * 0.02;
        // Match your theme colors: Cyan or Magenta
        this.color = Math.random() > 0.5 ? "255, 255, 255" : "255, 0, 128"; 
    }
    update() {
        this.angle += this.curve;

        this.x += Math.cos(this.angle) * this.speedX;
        this.y += Math.sin(this.angle) * this.speedY;
        this.y += this.speedY;
        this.x += this.speedX;
        this.opacity -= this.fadeSpeed;

        if (this.opacity <= 0 || this.x < 0 || this.x > canvas.width || this.y < 0 || this.y > canvas.height) {
            this.init();
        }

    }
    draw() {
        ctx.beginPath();
        let gradient = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.size * 2);
        gradient.addColorStop(0, `rgba(${this.color}, ${this.opacity})`);
        gradient.addColorStop(1, `rgba(${this.color}, 0)`);
        
        ctx.fillStyle = gradient;
        ctx.arc(this.x, this.y, this.size * 2, 0, Math.PI * 2);
        ctx.fill();
    }


}

for (let i = 0; i < starCount; i++) {
    stars.push(new Star());
}

function animate() {
    // Clear the canvas every frame to keep it transparent
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    stars.forEach(star => {
        star.update();
        star.draw();
    });

    requestAnimationFrame(animate);
}

animate();

// This is a function referenc that could be used if TTL had to be defined manually from the client side, but currently TTL is only managed server-side based on the schedule and allowances, so this is not needed. Kept here for potential future use.
// async function updateClientTTL(targetId, seconds) {
//     try {
//         const adminPassword = await requestPassword("Enter your password");

//         const response = await fetch(`${API_URL}/api/clients/update-ttl?ttl=${seconds}`, {
//             method: 'POST',
//             headers: {
//                 'Authorization': adminPassword, // From your auth state
//                 'x-client-id': targetId         // Standard header
//             }
//         });

//         const data = await response.json();
//         if (data.success) {
//             console.log(`System TTL updated to ${seconds}s for ${targetId}`);
//         }
//     } catch (err) {
//         console.error("Communication failure during TTL update", err);
//     }
// }