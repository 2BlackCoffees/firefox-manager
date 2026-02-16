// scheduler.js

export class TimeScheduler {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        this.days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        this.scheduleState = {}; 
        this.onSave = options.onSave || null;
        console.log("TimeScheduler initialized with container:", this.container);
    }

    // Set data from the API
    setData(data) {
        this.scheduleState = data || {i: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: []};
        this.render();
    }

    render() {
        if (!this.container) return;

        this.container.innerHTML = this.days.map((day, index) => {
            const ranges = this.scheduleState[index] || [];
            //console.log(`Rendering ${day}:`, ranges);
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

        this.attachEventListeners();
    }

    attachEventListeners() {

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
        const startInput = document.getElementById('pickerStart');
        const endInput = document.getElementById('pickerEnd');

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
            const start = startInput.value;
            const end = endInput.value;
            
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

    getSchedule() {
        return this.scheduleState;
    }
}