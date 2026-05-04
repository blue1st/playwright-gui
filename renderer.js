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
const checkSaveStorage = document.getElementById('check-save-storage');
const checkLoadStorage = document.getElementById('check-load-storage');
const inputStorageName = document.getElementById('input-storage-name');
const checkScrapingHelper = document.getElementById('check-scraping-helper');

// New Logs Elements
const navRecordings = document.getElementById('nav-recordings');
const navLogs = document.getElementById('nav-logs');
const recordingView = document.getElementById('recording-view');
const logsView = document.getElementById('logs-view');
const logsList = document.getElementById('logs-list');
const btnRefreshLogs = document.getElementById('btn-refresh-logs');
const btnOpenLogsFolder = document.getElementById('btn-open-logs-folder');

const modalLog = document.getElementById('modal-log');
const logViewerTitle = document.getElementById('log-viewer-title');
const logContent = document.getElementById('log-content');
const btnCloseLog = document.getElementById('btn-close-log');
const btnLogModalClose = document.getElementById('btn-log-modal-close');

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
    inputCron.value = schedule.cron || '';
    checkHeadless.checked = schedule.headless !== false; // Default to true if not set
    checkScheduleEnabled.checked = schedule.enabled;
    await updateNextRunPreview(schedule.cron);
  } else {
    inputCron.value = '';
    checkHeadless.checked = true; // Default for new
    checkScheduleEnabled.checked = false;
    await updateNextRunPreview('');
  }
  schedulePanel.style.display = 'flex';

  loadRecordings(); // Refresh UI for active state
  log(`Loaded ${name}`);
}

async function updateNextRunPreview(cron) {
  if (!cron) {
    nextRunPreview.textContent = 'Not set';
    checkScheduleEnabled.disabled = true;
    checkScheduleEnabled.checked = false;
    return;
  }
  const result = await electronAPI.getNextRun(cron);
  if (result.success) {
    nextRunPreview.textContent = result.next || 'Never';
    nextRunPreview.style.color = 'var(--accent-color)';
    checkScheduleEnabled.disabled = false;
  } else {
    nextRunPreview.textContent = 'Invalid Expression';
    nextRunPreview.style.color = '#ff4d4d'; // Red
    checkScheduleEnabled.disabled = true;
    if (checkScheduleEnabled.checked) {
      checkScheduleEnabled.checked = false;
      saveScheduleAuto();
    }
  }
}

function log(msg) {
  const timestamp = new Date().toLocaleTimeString();
  consoleOutput.innerHTML += `<div><span style="color: #475569;">[${timestamp}]</span> ${msg}</div>`;
  consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

async function handleBrowserError(result) {
  if (result.isMissingBrowser) {
    log('<span style="color: #ef4444; font-weight: bold;">Error: Playwright browsers are not installed.</span>');
    if (confirm('Playwright browsers are missing. Would you like to install them now? This may take a few minutes.')) {
      log('Starting browser installation...');
      const installResult = await electronAPI.installBrowsers();
      if (installResult.success) {
        log('<span style="color: #22c55e; font-weight: bold;">Browsers installed successfully!</span> You can now try your action again.');
      } else {
        log(`<span style="color: #ef4444;">Installation failed: ${installResult.error}</span>`);
      }
    }
    return true;
  }
  return false;
}

// Actions
btnNewRecording.onclick = () => {
  // Clear inputs and set a unique default name
  inputUrl.value = 'https://google.com';
  inputName.value = ''; // Let it default to timestamp or let user type
  inputStorageName.value = 'auth.json';
  checkSaveStorage.checked = false;
  checkLoadStorage.checked = false;
  checkScrapingHelper.checked = false;
  modalNew.style.display = 'flex';
};

btnModalCancel.onclick = () => {
  modalNew.style.display = 'none';
};

// Logs Logic
async function loadLogs() {
  const logs = await electronAPI.getLogs();
  logsList.innerHTML = '';
  
  if (logs.length === 0) {
    logsList.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-secondary); padding: 40px;">No execution logs found.</td></tr>';
    return;
  }

  logs.forEach(log => {
    const row = document.createElement('tr');
    
    // Extract recording name from log filename (e.g., "my-script_2024-05-04T01-42-03-000Z.log")
    const parts = log.name.split('_');
    const recName = parts[0] + '.cjs';
    const dateStr = new Date(log.mtime).toLocaleString();
    const sizeStr = (log.size / 1024).toFixed(1) + ' KB';

    row.innerHTML = `
      <td><span class="log-name">${recName}</span></td>
      <td><span class="log-time">${dateStr}</span></td>
      <td><span style="color: var(--text-secondary);">${sizeStr}</span></td>
      <td>
        <div class="actions" style="gap: 8px;">
          <button class="btn-icon btn-view-log" title="View">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-eye"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
          <button class="btn-icon btn-delete-log" title="Delete" style="color: var(--danger);">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
          </button>
        </div>
      </td>
    `;
    
    row.querySelector('.btn-view-log').onclick = () => viewLog(log.name);
    row.querySelector('.btn-delete-log').onclick = () => deleteLog(log.name);
    
    logsList.appendChild(row);
  });
}

async function viewLog(name) {
  const content = await electronAPI.readLog(name);
  logViewerTitle.textContent = `Log: ${name}`;
  logContent.textContent = content || 'Error: Could not read log file.';
  modalLog.style.display = 'flex';
}

async function deleteLog(name) {
  if (confirm(`Delete log ${name}?`)) {
    const result = await electronAPI.deleteLog(name);
    if (result.success) {
      loadLogs();
    } else {
      alert(`Error deleting log: ${result.error}`);
    }
  }
}

// Navigation
navRecordings.onclick = () => {
  navRecordings.classList.add('active');
  navLogs.classList.remove('active');
  recordingView.style.display = 'flex';
  logsView.style.display = 'none';
};

navLogs.onclick = () => {
  navLogs.classList.add('active');
  navRecordings.classList.remove('active');
  recordingView.style.display = 'none';
  logsView.style.display = 'flex';
  loadLogs();
};

btnRefreshLogs.onclick = loadLogs;
btnOpenLogsFolder.onclick = () => electronAPI.openLogFolder();

btnCloseLog.onclick = btnLogModalClose.onclick = () => {
  modalLog.style.display = 'none';
};

btnModalStart.onclick = async () => {
  const url = inputUrl.value || 'https://google.com';
  // Use a more readable timestamp for the default name
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  let name = inputName.value || `recording-${timestamp}`;
  const saveStorage = checkSaveStorage.checked;
  const loadStorage = checkLoadStorage.checked;
  const storageName = inputStorageName.value || 'auth.json';
  const useScrapingHelper = checkScrapingHelper.checked;
  
  // Auto-increment name if it already exists to ensure it's a "new" file
  let finalName = name;
  let counter = 1;
  while (await electronAPI.checkFileExists(finalName)) {
    const baseName = name.endsWith('.cjs') ? name.slice(0, -4) : name;
    finalName = `${baseName}-${counter}`;
    counter++;
  }
  name = finalName;
  const fileName = name.endsWith('.cjs') ? name : `${name}.cjs`;

  // Show the name immediately so the user knows where it will be saved
  activeRecording = fileName;
  currentRecordingName.textContent = fileName;
  schedulePanel.style.display = 'flex';
  
  modalNew.style.display = 'none';
  
  if (useScrapingHelper) {
    log(`Starting smart recording for ${url}...`);
    
    // Initialize editor with boilerplate
    editor.value = `const { chromium } = require('playwright');\n\n(async () => {\n  const browser = await chromium.launch({ headless: process.env.PW_HEADLESS === "1" });\n  const context = await browser.newContext();\n  const page = await context.newPage();\n\n  await page.goto('${url}');\n`;
    
    const result = await electronAPI.startSmartRecording(url, { saveStorage, loadStorage, storageName });
    
    if (result.success) {
      log(`Recording finished. Saving as ${fileName}`);
      editor.value += `\n  await context.close();\n  await browser.close();\n})();`;
      const saveResult = await electronAPI.saveRecording(name, editor.value);
      if (saveResult.success) {
        await loadRecordings();
        selectRecording(fileName);
      } else {
        log(`Error saving recording: ${saveResult.error}`);
      }
    } else {
      log(`Error: ${result.error}`);
    }
  } else {
    log(`Starting codegen for ${url}...`);
    const result = await electronAPI.startCodegen(url, { saveStorage, loadStorage, storageName });
    
    if (result.success) {
      log(`Recording completed. Saving as ${fileName}`);
      let patchedContent = result.content.replace(/headless: false/g, 'headless: process.env.PW_HEADLESS === "1"');
      const saveResult = await electronAPI.saveRecording(name, patchedContent);
      if (saveResult.success) {
        await loadRecordings();
        selectRecording(fileName);
      } else {
        log(`Error saving recording: ${saveResult.error}`);
      }
    } else {
      const handled = await handleBrowserError(result);
      if (!handled) {
        log(`Error: ${result.error}`);
      }
    }
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
    const handled = await handleBrowserError(result);
    if (!handled) {
      log(`Run failed.`);
    }
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

electronAPI.onRecordingAction((action) => {
  if (action.type === 'extract') {
    log(`<span style="color: var(--accent-primary);">Extracted:</span> ${action.selector}`);
    const code = `\n  // Extract text from ${action.selector}\n  const text_${Math.floor(Math.random()*1000)} = await page.innerText('${action.selector}');\n  console.log('Value of ${action.selector}:', text_${Math.floor(Math.random()*1000)});`;
    editor.value += code;
    editor.scrollTop = editor.scrollHeight;
  } else if (action.type === 'click') {
    editor.value += `\n  await page.click('${action.selector}');`;
    editor.scrollTop = editor.scrollHeight;
  }
});

// Start
loadRecordings();
log('Application started.');
