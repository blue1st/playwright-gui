const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getRecordings: () => ipcRenderer.invoke('get-recordings'),
  readRecording: (name) => ipcRenderer.invoke('read-recording', name),
  saveRecording: (name, content) => ipcRenderer.invoke('save-recording', { name, content }),
  deleteRecording: (name) => ipcRenderer.invoke('delete-recording', name),
  startCodegen: (url, options) => ipcRenderer.invoke('start-codegen', url, options),
  startSmartRecording: (url, options) => ipcRenderer.invoke('start-smart-recording', url, options),
  runRecording: (name, headless) => ipcRenderer.invoke('run-recording', { name, headless }),
  updateSchedule: (config) => ipcRenderer.invoke('update-schedule', config),
  getSchedule: (name) => ipcRenderer.invoke('get-schedule', name),
  getNextRun: (cron) => ipcRenderer.invoke('get-next-run', cron),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('set-auto-launch', enabled),
  getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),
  installBrowsers: () => ipcRenderer.invoke('install-browsers'),
  onRunOutput: (callback) => ipcRenderer.on('run-output', (event, ...args) => callback(...args)),
  onRecordingAction: (callback) => ipcRenderer.on('recording-action', (event, ...args) => callback(...args)),
});
