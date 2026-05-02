const { electronAPI } = window;

const recordingsList = document.getElementById('recordings-list');
const btnNewRecording = document.getElementById('btn-new-recording');
const btnRun = document.getElementById('btn-run');
const btnSave = document.getElementById('btn-save');
const btnDelete = document.getElementById('btn-delete');
const editor = document.getElementById('editor');
const consoleOutput = document.getElementById('console-output');
const currentRecordingName = document.getElementById('current-recording-name');

const modalNew = document.getElementById('modal-new');
const btnModalCancel = document.getElementById('btn-modal-cancel');
const btnModalStart = document.getElementById('btn-modal-start');
const inputUrl = document.getElementById('input-url');
const inputName = document.getElementById('input-name');

const checkHeadless = document.getElementById('check-headless');
const schedulePanel = document.getElementById('schedule-panel');
const checkScheduleEnabled = document.getElementById('check-schedule-enabled');
const inputCron = document.getElementById('input-cron');
const nextRunPreview = document.getElementById('next-run-preview');
const checkAutoLaunch = document.getElementById('check-auto-launch');

let activeRecording = null;

// Initialize
async function loadRecordings() {
  // Initialize auto-launch state
  const isAutoLaunch = await electronAPI.getAutoLaunch();
  checkAutoLaunch.checked = isAutoLaunch;

  const files = await electronAPI.getRecordings();
  recordingsList.innerHTML = '';
  files.forEach(file => {
    const item = document.createElement('div');
    item.className = `recording-item ${activeRecording === file.name ? 'active' : ''}`;
    
    // Create the schedule icon SVG if the script has an active schedule
    const scheduleIcon = file.hasSchedule ? 
      `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-calendar-clock" style="color: var(--accent-color); margin-right: 4px;"><path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h5"/><path d="M17.5 17.5 16 16.25V14"/><circle cx="16" cy="16" r="6"/></svg>` 
      : '';

    item.innerHTML = `
      <div style="display: flex; align-items: center; flex: 1; overflow: hidden;">
        ${scheduleIcon}
        <span class="recording-name">${file.name}</span>
      </div>
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-right" style="flex-shrink: 0;"><path d="m9 18 6-6-6-6"/></svg>
    `;
    item.onclick = () => selectRecording(file.name);
    recordingsList.appendChild(item);
  });
}

async function selectRecording(name) {
  activeRecording = name;
  currentRecordingName.textContent = name;
  const content = await electronAPI.readRecording(name);
  editor.value = content;
  
  // Load schedule
  const schedule = await electronAPI.getSchedule(name);
  if (schedule) {
    checkScheduleEnabled.checked = schedule.enabled;
    inputCron.value = schedule.cron || '';
    checkHeadless.checked = schedule.headless !== false; // Default to true if not set
    updateNextRunPreview(schedule.cron);
  } else {
    checkScheduleEnabled.checked = false;
    inputCron.value = '';
    checkHeadless.checked = true; // Default for new
    nextRunPreview.textContent = 'Not set';
  }
  schedulePanel.style.display = 'flex';

  loadRecordings(); // Refresh UI for active state
  log(`Loaded ${name}`);
}

async function updateNextRunPreview(cron) {
  if (!cron) {
    nextRunPreview.textContent = 'Not set';
    return;
  }
  const result = await electronAPI.getNextRun(cron);
  if (result.success) {
    nextRunPreview.textContent = result.next || 'Never';
    nextRunPreview.style.color = 'var(--accent-color)';
  } else {
    nextRunPreview.textContent = 'Invalid Expression';
    nextRunPreview.style.color = '#ff4d4d'; // Red
  }
}

function log(msg) {
  const timestamp = new Date().toLocaleTimeString();
  consoleOutput.innerHTML += `<div><span style="color: #475569;">[${timestamp}]</span> ${msg}</div>`;
  consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

// Actions
btnNewRecording.onclick = () => {
  modalNew.style.display = 'flex';
};

btnModalCancel.onclick = () => {
  modalNew.style.display = 'none';
};

btnModalStart.onclick = async () => {
  const url = inputUrl.value || 'https://google.com';
  const name = inputName.value || `recording-${Date.now()}`;
  modalNew.style.display = 'none';
  
  log(`Starting codegen for ${url}...`);
  const result = await electronAPI.startCodegen(url);
  
  if (result.success) {
    log(`Recording completed. Saving as ${name}.js`);
    // Patch content to support headless toggle via environment variable
    const patchedContent = result.content.replace(/headless: false/g, 'headless: process.env.PW_HEADLESS === "1"');
    await electronAPI.saveRecording(name, patchedContent);
    await loadRecordings();
    selectRecording(name.endsWith('.cjs') ? name : `${name}.cjs`);
  } else {
    log(`Error: ${result.error}`);
  }
};

btnRun.onclick = async () => {
  if (!activeRecording) return;
  const headless = checkHeadless.checked;
  log(`Running ${activeRecording} (headless: ${headless})...`);
  consoleOutput.innerHTML = ''; // Clear console for run
  const result = await electronAPI.runRecording(activeRecording, headless);
  if (result.success) {
    log(`Run finished successfully.`);
  } else {
    log(`Run failed.`);
  }
};

async function saveScheduleAuto() {
  if (!activeRecording) return;
  const cron = inputCron.value;
  const enabled = checkScheduleEnabled.checked;
  const headless = checkHeadless.checked;

  const result = await electronAPI.updateSchedule({
    name: activeRecording,
    cron,
    enabled,
    headless
  });
  
  if (result.success) {
    log(`Schedule auto-updated: ${enabled ? 'Enabled' : 'Disabled'} (${cron})`);
    loadRecordings(); // Refresh list to update the schedule icon
  } else {
    log(`Error updating schedule: ${result.error}`);
  }
}

inputCron.oninput = () => {
  updateNextRunPreview(inputCron.value);
};

// Auto-save when input loses focus or Enter is pressed
inputCron.onchange = saveScheduleAuto;

// Auto-save when toggles are clicked
checkScheduleEnabled.addEventListener('change', saveScheduleAuto);
checkHeadless.addEventListener('change', () => {
  // Headless toggle affects both manual run and schedule, so we auto-save the schedule if one exists
  if (activeRecording) {
    saveScheduleAuto();
  }
});

btnSave.onclick = async () => {
  if (!activeRecording) return;
  await electronAPI.saveRecording(activeRecording, editor.value);
  log(`Saved ${activeRecording}`);
};

btnDelete.onclick = async () => {
  if (!activeRecording) return;
  if (confirm(`Delete ${activeRecording}?`)) {
    await electronAPI.deleteRecording(activeRecording);
    // Also remove schedule
    await electronAPI.updateSchedule({ name: activeRecording, enabled: false });
    
    activeRecording = null;
    editor.value = '';
    currentRecordingName.textContent = 'No Recording Selected';
    schedulePanel.style.display = 'none';
    loadRecordings();
    log(`Deleted recording.`);
  }
};

checkAutoLaunch.onchange = async () => {
  const enabled = checkAutoLaunch.checked;
  await electronAPI.setAutoLaunch(enabled);
  log(`Auto-launch ${enabled ? 'enabled' : 'disabled'}`);
};

// IPC Listeners
electronAPI.onRunOutput((data) => {
  consoleOutput.innerHTML += `<div>${data}</div>`;
  consoleOutput.scrollTop = consoleOutput.scrollHeight;
});

// Start
loadRecordings();
log('Application started.');
