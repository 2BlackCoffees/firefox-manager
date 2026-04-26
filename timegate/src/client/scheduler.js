


export class TimeScheduler {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        this.days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        this.scheduleState = {}; 
        this.onSave = options.onSave || null;
        this.sendPhoto = false; // New state property

        console.log("TimeScheduler initialized with container:", this.container);
    }

    // Set data from the API
    setSchedule(data) {
        console.log("Setting schedule with data:", data);
        this.scheduleState = data.days || {0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: []};
        this.sendPhoto = data.send_photo || false; // Handle new photo authorization field
        this.render();
    }
    getSchedule() {
        return this.scheduleState;
    }
    getPhotoStatus() {
        return this.sendPhoto;
    }
    render() {
        if (!this.container) return;

        let html = `
            <div class="photo-config-header" style="margin-bottom: 20px; padding: 10px; background: rgba(0,255,255,0.05); border: 1px solid var(--cyan);">
                <label style="display: flex; align-items: center; cursor: pointer; gap: 10px;">
                    <input type="checkbox" id="photoAuthToggle" ${this.sendPhoto ? 'checked' : ''} style="width: 20px; height: 20px;">
                    <span style="font-weight: bold; color: var(--cyan);">AUTHORIZE PHOTO ON UNAUTHORIZED ACCESS</span>
                </label>
            </div>
        `;
        html += this.days.map((day, index) => {
            const ranges = this.scheduleState[index] || [];
            //console.log(`Rendering ${day} (${index}: ${this.scheduleState[index]}):`, ranges);
            return `
                <div class="day-config-row" data-day="${index}">
                    <div class="day-header">
                        <span class="day-name">${day}</span>
                        <button class="btn-cyan btn-small btn-add-range" data-day="${index}">+ ADD RANGE</button>
                    </div>
                    <div class="ranges-container">
                        ${ranges.map((r, rIdx) => `
                            <div class="time-chip">
                                ${r}
                                <span class="remove-range" data-day="${index}" data-idx="${rIdx}">×</span>
                            </div>
                        `).join('')}
                        ${ranges.length === 0 
                                        ? '<span class="status-locked">🔒 LOCKED WHOLE DAY</span>' 
                                        : ''
}                   </div>
                </div>
            `;
        }).join('');

        this.container.innerHTML = html;
        this.attachEventListeners();
    }

    attachEventListeners() {

        const photoToggle = this.container.querySelector('#photoAuthToggle');
        if (photoToggle) {
            photoToggle.onchange = (e) => {
                if (e.target.checked) {
                    // 1. Prepare the dynamic content
                    const title = "⚠️ LEGAL AUTHORIZATION";
                    const warningText = `
                        <p>By enabling <strong>Photo Capture</strong>, you authorize the device to record imagery of individuals during unauthorized access events.</p>
                        <p>This feature is intended for <strong>theft recovery</strong> and <strong>police evidence</strong>. However, use of surveillance technology is strictly regulated.</p>
                        <hr style="border: 0; border-top: 1px solid #444; margin: 10px 0;">
                        <p style="font-size: 0.85em; color: #bbb;">
                            You acknowledge sole responsibility for compliance with local privacy laws (GDPR, CCPA, etc.). 
                            The developer/provider is <strong>not liable</strong> for any legal repercussions or data breaches.
                        </p>
                    `;

                    // 2. Reference the new generic modal elements
                    const modal = document.getElementById('acceptDeclineModal');
                    const header = modal.querySelector('.modal-header');
                    const body = document.getElementById('warningMessage');
                    const confirmBtn = document.getElementById('warningConfirm');
                    const cancelBtn = document.getElementById('warningCancel');

                    // 3. Inject the content
                    header.innerText = title;
                    body.innerHTML = warningText;

                    // 4. Show modal
                    modal.style.display = 'flex';

                    // 5. Handle responses
                    confirmBtn.onclick = () => {
                        this.sendPhoto = true;
                        modal.style.display = 'none';
                        console.log("Photo capture authorized by user.");
                    };

                    cancelBtn.onclick = () => {
                        e.target.checked = false; // Uncheck the toggle
                        this.sendPhoto = false;
                        modal.style.display = 'none';
                    };
                } else {
                    this.sendPhoto = false;
                }
            };
        }

        this.container.querySelectorAll('.btn-add-range').forEach(btn => {
            btn.onclick = (e) => {
                const dayIdx = btn.getAttribute('data-day');
                e.preventDefault();
                this.promptNewRange(dayIdx);
            };
        });

        this.container.querySelectorAll('.remove-range').forEach(span => {
            span.onclick = (e) => {
                const dayIdx = span.getAttribute('data-day');
                const rangeIdx = span.getAttribute('data-idx');
                this.removeRange(dayIdx, rangeIdx);
            };
        });

    }

    promptNewRange(dayIdx) {
        const modal = document.getElementById('timePickerModal');
        const confirmBtn = document.getElementById('timePickerConfirm');
        const cancelBtn = document.getElementById('timePickerCancel');
        const startInput = document.getElementById('rangeStart');
        const endInput = document.getElementById('rangeEnd');

        // Show the modal
        modal.style.display = 'flex';
        console.log(`Button ${dayIdx} was clicked, style model is now:`, modal.style.display);


        // Cleanup function to remove listeners
        const closeModal = () => {
            modal.style.display = 'none';
            confirmBtn.onclick = null;
            cancelBtn.onclick = null;
        };

        confirmBtn.onclick = () => {
            const start = startInput.value.split(':').slice(0, 2).join(':');
            const end = endInput.value.split(':').slice(0, 2).join(':');

            console.log(`Confirming new range for day ${dayIdx}:`, { start, end });
            
            if (start && end) {
                if (!this.scheduleState[dayIdx]) this.scheduleState[dayIdx] = [];
                document.getElementById('globalStart').value = start;
                document.getElementById('globalEnd').value = end;
                this.scheduleState[dayIdx].push(`${start}-${end}`);
                this.render();
            }
            closeModal();
        };

        cancelBtn.onclick = () => {
            closeModal();
        };
    }

    removeRange(dayIdx, rangeIdx) {
        this.scheduleState[dayIdx].splice(rangeIdx, 1);
        this.render();
    }

}