import { app, BrowserWindow, ipcMain, Tray, Menu } from 'electron';
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import isDev from 'electron-is-dev';
import { exec, spawn } from 'child_process';
import fs from 'fs-extra';
import { Cron } from 'croner';
import fixPath from 'fix-path';

fixPath();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;
let tray;
const schedules = new Map(); // recordingName -> Cron instance
const runningTasks = new Set();

const RECORDINGS_DIR = isDev 
  ? path.join(__dirname, 'recordings') 
  : path.join(app.getPath('userData'), 'recordings');

const STORAGE_DIR = isDev 
  ? path.join(__dirname, 'storage') 
  : path.join(app.getPath('userData'), 'storage');

const LOGS_DIR = isDev 
  ? path.join(__dirname, 'logs') 
  : path.join(app.getPath('userData'), 'logs');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f172a',
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
  }

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });
}

app.whenReady().then(async () => {
  await fs.ensureDir(RECORDINGS_DIR);
  await fs.ensureDir(STORAGE_DIR);
  await fs.ensureDir(LOGS_DIR);
  createWindow();
  createTray();
  loadSchedules();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

function createTray() {
  const iconPath = path.join(__dirname, 'tray-iconTemplate.png'); 
  tray = new Tray(fs.existsSync(iconPath) ? iconPath : path.join(__dirname, 'icon.png'));
  
  updateTrayMenu();
  
  tray.setToolTip('Playwright Studio');
  tray.on('click', () => {
    mainWindow.show();
  });

  // Refresh tray menu every minute to keep "next run" times updated
  setInterval(updateTrayMenu, 60000);
}

function updateTrayMenu() {
  if (!tray) return;

  const template = [
    { label: 'Playwright Studio', enabled: false },
    { type: 'separator' },
  ];

  // Running tasks
  if (runningTasks.size > 0) {
    template.push({ label: '実行中のスクリプト:', enabled: false });
    runningTasks.forEach(name => {
      template.push({ label: `  ▶ ${name}`, click: () => { mainWindow.show(); } });
    });
    template.push({ type: 'separator' });
  }

  // Scheduled tasks
  const scheduledItems = [];
  schedules.forEach((entry, name) => {
    const next = entry.job.nextRun();
    if (next) {
      scheduledItems.push({
        name,
        time: next,
        timeStr: next.toLocaleString('ja-JP', { 
            month: 'numeric', 
            day: 'numeric', 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: false 
        })
      });
    }
  });

  if (scheduledItems.length > 0) {
    template.push({ label: '次回の実行予定:', enabled: false });
    // Sort by time
    scheduledItems.sort((a, b) => a.time - b.time);
    scheduledItems.slice(0, 5).forEach(item => { // Show up to 5 next runs
      template.push({ label: `  🗓 ${item.timeStr} - ${item.name}`, click: () => { mainWindow.show(); } });
    });
    template.push({ type: 'separator' });
  }

  template.push(
    { label: 'アプリを表示', click: () => { mainWindow.show(); } },
    { label: '終了', click: () => { app.isQuitting = true; app.quit(); } }
  );

  const contextMenu = Menu.buildFromTemplate(template);
  tray.setContextMenu(contextMenu);
}

async function loadSchedules() {
  const schedulePath = path.join(app.getPath('userData'), 'schedules.json');
  if (await fs.exists(schedulePath)) {
    const data = await fs.readJson(schedulePath);
    let modified = false;

    // Clear existing jobs
    for (const [name, entry] of schedules.entries()) {
      entry.job.stop();
    }
    schedules.clear();

    for (const [name, config] of Object.entries(data)) {
      const filePath = path.join(RECORDINGS_DIR, name);
      if (!(await fs.exists(filePath))) {
        console.log(`Removing orphaned schedule for non-existent file: ${name}`);
        delete data[name];
        modified = true;
        continue;
      }

      if (config.enabled && config.cron) {
        console.log(`Initializing schedule for ${name}: ${config.cron}`);
        setupCron(name, config.cron, config.headless);
      }
    }

    if (modified) {
      await fs.writeJson(schedulePath, data);
    }
    updateTrayMenu();
  }
}

function setupCron(name, cronExpression, headless) {
  if (schedules.has(name)) {
    console.log(`Stopping existing job for ${name}`);
    schedules.get(name).job.stop();
    schedules.delete(name);
  }

  try {
    const job = new Cron(cronExpression, () => {
      const entry = schedules.get(name);
      if (entry && entry.enabled) {
        const now = Date.now();
        // Guard: Prevent re-running within 10 seconds to avoid double-triggers from library drift
        if (entry.lastRun && (now - entry.lastRun < 10000)) {
          console.log(`[${new Date().toISOString()}] Ignoring potential double-trigger for ${name} (last run was ${Math.round((now - entry.lastRun)/1000)}s ago)`);
          return;
        }

        if (runningTasks.has(name)) {
          console.log(`[${new Date().toISOString()}] Skipping scheduled task ${name}: Already running.`);
          return;
        }

        entry.lastRun = now;
        console.log(`[${new Date().toISOString()}] Executing scheduled task: ${name}`);
        runRecordingInternal(name, headless);
      } else {
        console.log(`[${new Date().toISOString()}] Skipping execution for ${name}: Job disabled or removed from memory`);
        if (entry) entry.job.stop();
      }
    });
    
    schedules.set(name, { job, enabled: true, cron: cronExpression, lastRun: 0 });
    console.log(`Successfully scheduled ${name} with pattern: ${cronExpression}`);
    updateTrayMenu();
    return true;
  } catch (error) {
    console.error(`Failed to setup cron for ${name}:`, error);
    return false;
  }
}

async function runRecordingInternal(name, headless) {
    const filePath = path.join(RECORDINGS_DIR, name);
    if (!await fs.exists(filePath)) return;

    runningTasks.add(name);
    updateTrayMenu();

    // Create log file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFileName = `${name.replace('.cjs', '')}_${timestamp}.log`;
    const logPath = path.join(LOGS_DIR, logFileName);
    const logStream = fs.createWriteStream(logPath);

    logStream.write(`--- Execution Started: ${new Date().toLocaleString()} ---\n`);
    logStream.write(`Script: ${name}\n`);
    logStream.write(`Headless: ${headless}\n\n`);

    console.log(`Running scheduled task: ${name} (headless: ${headless})`);
    
    const env = { 
      ...process.env, 
      PW_HEADLESS: headless ? '1' : '0',
      ELECTRON_RUN_AS_NODE: '1',
      NODE_PATH: path.join(__dirname, 'node_modules')
    };
    
    const runProcess = spawn(process.execPath, [filePath], {
      shell: false,
      env
    });

  runProcess.stdout.on('data', (data) => {
    logStream.write(`[STDOUT] ${data}`);
    if (mainWindow) mainWindow.webContents.send('run-output', `[Scheduled: ${name}] ${data}`);
  });

  runProcess.stderr.on('data', (data) => {
    logStream.write(`[STDERR] ${data}`);
    if (mainWindow) mainWindow.webContents.send('run-output', `[Scheduled Error: ${name}] ${data}`);
  });

  runProcess.on('close', (code) => {
    logStream.write(`\n--- Execution Finished with code ${code} at ${new Date().toLocaleString()} ---`);
    logStream.end();
    runningTasks.delete(name);
    updateTrayMenu();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (!app.isQuitting) {
      // Keep it in tray
    } else {
      app.quit();
    }
  }
});

// IPC Handlers

ipcMain.handle('get-recordings', async () => {
  await fs.ensureDir(RECORDINGS_DIR);
  const files = await fs.readdir(RECORDINGS_DIR);
  const validFiles = files.filter(f => f.endsWith('.cjs') && f !== 'recording-temp.cjs');
  
  return validFiles.map(file => {
    // Check if there's an active schedule for this file
    const hasActiveSchedule = schedules.has(file) && schedules.get(file).enabled;
    return {
      name: file,
      hasSchedule: hasActiveSchedule
    };
  });
});

ipcMain.handle('read-recording', async (event, name) => {
  const filePath = path.join(RECORDINGS_DIR, name);
  return await fs.readFile(filePath, 'utf-8');
});

ipcMain.handle('save-recording', async (event, { name, content }) => {
  try {
    await fs.ensureDir(RECORDINGS_DIR);
    const filePath = path.join(RECORDINGS_DIR, name.endsWith('.cjs') ? name : `${name}.cjs`);
    await fs.writeFile(filePath, content);
    return { success: true };
  } catch (error) {
    console.error('Save Recording Error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('check-file-exists', async (event, name) => {
  const filePath = path.join(RECORDINGS_DIR, name.endsWith('.cjs') ? name : `${name}.cjs`);
  return await fs.exists(filePath);
});

ipcMain.handle('delete-recording', async (event, name) => {
  const filePath = path.join(RECORDINGS_DIR, name);
  await fs.remove(filePath);
  
  // If there was a schedule for this recording, it should be cleaned up
  if (schedules.has(name)) {
    schedules.get(name).job.stop();
    schedules.delete(name);
    const schedulePath = path.join(app.getPath('userData'), 'schedules.json');
    if (await fs.exists(schedulePath)) {
      const data = await fs.readJson(schedulePath);
      delete data[name];
      await fs.writeJson(schedulePath, data);
    }
  }
  
  updateTrayMenu();
  return { success: true };
});

let codegenProcess = null;

ipcMain.handle('install-browsers', () => {
  return new Promise((resolve, reject) => {
    const localPlaywright = path.join(__dirname, 'node_modules', 'playwright', 'cli.js');
    let cmd = fs.existsSync(localPlaywright) ? process.execPath : 'npx';
    const env = { ...process.env };
    if (cmd === process.execPath) {
      env.ELECTRON_RUN_AS_NODE = '1';
    }

    const args = fs.existsSync(localPlaywright) 
      ? [localPlaywright, 'install', 'chromium']
      : ['playwright', 'install', 'chromium'];

    const installProcess = spawn(cmd, args, {
      shell: false,
      env
    });

    let output = '';
    installProcess.stdout.on('data', (data) => {
      output += data.toString();
      if (mainWindow) mainWindow.webContents.send('run-output', `[Install] ${data}`);
    });

    installProcess.stderr.on('data', (data) => {
      output += data.toString();
      if (mainWindow) mainWindow.webContents.send('run-output', `[Install Error] ${data}`);
    });

    installProcess.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true });
      } else {
        resolve({ success: false, error: `Installation failed with code ${code}` });
      }
    });

    installProcess.on('error', (err) => {
      reject(err);
    });
  });
});


ipcMain.handle('start-codegen', (event, url = 'https://google.com', options = {}) => {
  return new Promise((resolve, reject) => {
    if (codegenProcess) {
      codegenProcess.kill();
    }

    const { saveStorage, loadStorage, storageName = 'auth.json' } = options;
    const tempPath = path.join(RECORDINGS_DIR, 'recording-temp.cjs');
    const storagePath = path.join(STORAGE_DIR, storageName);
    
    // Attempt to find local playwright CLI for more robustness
    const localPlaywright = path.join(__dirname, 'node_modules', 'playwright', 'cli.js');
    
    // In packaged app, 'node' might not be in PATH. 
    // We can use process.execPath with ELECTRON_RUN_AS_NODE=1
    let cmd = fs.existsSync(localPlaywright) ? process.execPath : 'npx';
    const env = { ...process.env, PW_HEADLESS: '0' }; // Codegen should be headed
    if (cmd === process.execPath) {
      env.ELECTRON_RUN_AS_NODE = '1';
    }

    const args = fs.existsSync(localPlaywright) 
      ? [localPlaywright, 'codegen']
      : ['playwright', 'codegen'];
    
    args.push('--target', 'javascript', '-o', tempPath);
    
    if (saveStorage) {
      args.push('--save-storage', storagePath);
    }
    if (loadStorage) {
      args.push('--load-storage', storagePath);
    }
    
    args.push(url);

    codegenProcess = spawn(cmd, args, {
      shell: false,
      env
    });

    let errorOutput = '';
    codegenProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
      console.error(`Codegen Stderr: ${data}`);
    });

    codegenProcess.on('close', async (code) => {
      codegenProcess = null;
      if (await fs.exists(tempPath)) {
        const content = await fs.readFile(tempPath, 'utf-8');
        await fs.remove(tempPath); // Delete temp file after reading
        resolve({ success: true, content });
      } else {
        const isMissingBrowser = errorOutput.includes('Executable doesn\'t exist') || errorOutput.includes('playwright install');
        resolve({ 
          success: false, 
          error: errorOutput || `Process exited with code ${code}`,
          isMissingBrowser
        });
      }
    });

    codegenProcess.on('error', async (err) => {
      codegenProcess = null;
      const tempPath = path.join(RECORDINGS_DIR, 'recording-temp.cjs');
      await fs.remove(tempPath).catch(() => {}); // Attempt to cleanup
      reject(err);
    });
  });
});

ipcMain.handle('start-smart-recording', (event, url = 'https://google.com', options = {}) => {
  return new Promise(async (resolve, reject) => {
    const { saveStorage, loadStorage, storageName = 'auth.json' } = options;
    const storagePath = path.join(STORAGE_DIR, storageName);

    try {
      const browser = await chromium.launch({ 
        headless: false,
        args: ['--start-maximized']
      });
      
      const contextOptions = {};
      if (loadStorage && await fs.exists(storagePath)) {
        contextOptions.storageState = storagePath;
      }

      const context = await browser.newContext(contextOptions);

      // Expose function to record elements
      await context.exposeFunction('onElementRecorded', (data) => {
        if (mainWindow) {
          mainWindow.webContents.send('recording-action', data);
        }
      });

      // Inject extraction helper script
      await context.addInitScript(() => {
        window.addEventListener('contextmenu', (e) => {
          if (e.ctrlKey) {
            e.preventDefault();
            const el = e.target;
            
            // Simple selector generation
            let selector = el.tagName.toLowerCase();
            if (el.id) {
              selector = `#${el.id}`;
            } else if (el.className) {
              const classes = Array.from(el.classList).join('.');
              if (classes) selector += `.${classes}`;
            }
            
            window.onElementRecorded({
              type: 'extract',
              selector: selector,
              text: el.innerText || el.value || '',
              tagName: el.tagName
            });

            // Visual feedback
            const originalOutline = el.style.outline;
            el.style.outline = '3px solid #3b82f6';
            el.style.outlineOffset = '2px';
            setTimeout(() => el.style.outline = originalOutline, 1000);
          }
        });
        
        // Simple click recorder
        window.addEventListener('click', (e) => {
          if (e.ctrlKey) return;
          const el = e.target;
          let selector = el.tagName.toLowerCase();
          if (el.id) selector = `#${el.id}`;
          else if (el.className) selector += `.${Array.from(el.classList)[0]}`;

          window.onElementRecorded({
            type: 'click',
            selector: selector
          });
        }, true);
      });

      const page = await context.newPage();
      
      browser.on('disconnected', async () => {
        if (saveStorage) {
          await context.storageState({ path: storagePath });
        }
        resolve({ success: true });
      });

      await page.goto(url);
    } catch (error) {
      console.error('Smart Recording Error:', error);
      resolve({ success: false, error: error.message });
    }
  });
});

ipcMain.handle('run-recording', (event, { name, headless }) => {
  return new Promise((resolve, reject) => {
    const filePath = path.join(RECORDINGS_DIR, name);
    
    runningTasks.add(name);
    updateTrayMenu();

    // Pass headless option via environment variable
    const env = { 
      ...process.env, 
      PW_HEADLESS: headless ? '1' : '0',
      ELECTRON_RUN_AS_NODE: '1',
      NODE_PATH: path.join(__dirname, 'node_modules')
    };

    // Use process.execPath to ensure we use the bundled node/electron runtime
    const runProcess = spawn(process.execPath, [filePath], {
      shell: false,
      env
    });

    let output = '';
    runProcess.stdout.on('data', (data) => {
      output += data.toString();
      event.sender.send('run-output', data.toString());
    });

    runProcess.stderr.on('data', (data) => {
      output += data.toString();
      event.sender.send('run-output', `ERROR: ${data.toString()}`);
    });

    runProcess.on('close', (code) => {
      runningTasks.delete(name);
      updateTrayMenu();
      const isMissingBrowser = output.includes('Executable doesn\'t exist') || output.includes('playwright install');
      resolve({ success: code === 0, output, isMissingBrowser });
    });
  });
});

ipcMain.handle('update-schedule', async (event, { name, cron, enabled, headless }) => {
  const schedulePath = path.join(app.getPath('userData'), 'schedules.json');
  let data = {};
  if (await fs.exists(schedulePath)) {
    data = await fs.readJson(schedulePath);
  }

  // Normalize: Remove any existing entry that might match case-insensitively to prevent duplicates on macOS
  const existingKey = Object.keys(data).find(k => k.toLowerCase() === name.toLowerCase());
  if (existingKey && existingKey !== name) {
    console.log(`Normalizing schedule name from ${existingKey} to ${name}`);
    delete data[existingKey];
  }

  // Always stop and remove existing job from memory (using exact name and case-insensitive check)
  for (const [jobName, entry] of schedules.entries()) {
    if (jobName.toLowerCase() === name.toLowerCase()) {
      console.log(`Stopping and removing existing job: ${jobName}`);
      entry.job.stop();
      schedules.delete(jobName);
    }
  }

  if (enabled && cron) {
    setupCron(name, cron, headless);
  }

  data[name] = { cron, enabled, headless };
  await fs.writeJson(schedulePath, data);
  updateTrayMenu();
  
  return { success: true };
});

ipcMain.handle('get-schedule', async (event, name) => {
  const schedulePath = path.join(app.getPath('userData'), 'schedules.json');
  if (await fs.exists(schedulePath)) {
    const data = await fs.readJson(schedulePath);
    return data[name] || null;
  }
  return null;
});

ipcMain.handle('get-next-run', (event, cronExpression) => {
  try {
    const c = new Cron(cronExpression);
    const next = c.nextRun();
    c.stop(); // Important: Stop the temporary job immediately
    return { success: true, next: next ? next.toLocaleString() : null };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('set-auto-launch', (event, enabled) => {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath,
    args: []
  });
  return { success: true };
});

ipcMain.handle('get-auto-launch', () => {
  const settings = app.getLoginItemSettings();
  return settings.openAtLogin;
});

ipcMain.handle('get-logs', async () => {
  await fs.ensureDir(LOGS_DIR);
  const files = await fs.readdir(LOGS_DIR);
  const logs = await Promise.all(files.filter(f => f.endsWith('.log')).map(async (file) => {
    const filePath = path.join(LOGS_DIR, file);
    const stats = await fs.stat(filePath);
    return {
      name: file,
      size: stats.size,
      mtime: stats.mtime
    };
  }));
  // Sort by modification time descending
  return logs.sort((a, b) => b.mtime - a.mtime);
});

ipcMain.handle('read-log', async (event, name) => {
  const filePath = path.join(LOGS_DIR, name);
  if (await fs.exists(filePath)) {
    return await fs.readFile(filePath, 'utf-8');
  }
  return null;
});

ipcMain.handle('delete-log', async (event, name) => {
  const filePath = path.join(LOGS_DIR, name);
  if (await fs.exists(filePath)) {
    await fs.remove(filePath);
    return { success: true };
  }
  return { success: false, error: 'File not found' };
});

ipcMain.handle('open-log-folder', async () => {
  const { shell } = await import('electron');
  await fs.ensureDir(LOGS_DIR);
  shell.openPath(LOGS_DIR);
});
