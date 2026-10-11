const { contextBridge, ipcRenderer } = require('electron');

const publisherInvoke = (channel, args) => ipcRenderer.invoke(channel, args).then(result => {
  if (result?.ok) return result.data;
  const error = new Error(result?.error || 'Publishing request failed.');
  error.status = result?.status ?? 0;
  error.data = result?.data ?? null;
  throw error;
});

contextBridge.exposeInMainWorld('tl', {
  platform: process.platform,
  windowMode: () => ipcRenderer.invoke('window:mode'),
  onWindowModeChanged: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, mode) => {
      if (['windowed', 'fullscreen'].includes(mode)) callback(mode);
    };
    ipcRenderer.on('window-mode:changed', listener);
    return () => ipcRenderer.removeListener('window-mode:changed', listener);
  },
  loadWorkspace: () => ipcRenderer.invoke('workspace:load'),
  saveWorkspace: (data) => ipcRenderer.invoke('workspace:save', data),
  saveTournament: (args) => ipcRenderer.invoke('file:saveTournament', args),
  openTournament: () => ipcRenderer.invoke('file:openTournament'),
  exportFile: (args) => ipcRenderer.invoke('file:export', args),
  prepareReportBundle: (bundle) => ipcRenderer.invoke('file:prepareReportBundle', bundle),
  exportReportBundle: (args) => ipcRenderer.invoke('file:exportReportBundle', args),
  openCsv: () => ipcRenderer.invoke('file:openCsv'),
  openText: (opts) => ipcRenderer.invoke('file:openText', opts),
  openBinary: (opts) => ipcRenderer.invoke('file:openBinary', opts),
  exportBinary: (args) => ipcRenderer.invoke('file:exportBinary', args),
  onContentZoomShortcut: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, action) => {
      if (['in', 'out', 'reset'].includes(action)) callback(action);
    };
    ipcRenderer.on('content-zoom:shortcut', listener);
    return () => ipcRenderer.removeListener('content-zoom:shortcut', listener);
  },
  publisher: {
    connection: () => publisherInvoke('publisher:connection'),
    connectStart: (deviceName) => publisherInvoke('publisher:connectStart', { deviceName }),
    connectPoll: (deviceCode) => publisherInvoke('publisher:connectPoll', { deviceCode }),
    disconnect: () => publisherInvoke('publisher:disconnect'),
    createReport: (title, visibility) => publisherInvoke('publisher:createReport', { title, visibility }),
    report: (reportId) => publisherInvoke('publisher:report', { reportId }),
    publish: (reportId, html, revision) => publisherInvoke('publisher:publish', { reportId, html, revision }),
    publishBundle: (reportId, bundle, revision) => publisherInvoke('publisher:publishBundle', { reportId, bundle, revision }),
    updateReport: (reportId, changes) => publisherInvoke('publisher:updateReport', { reportId, changes }),
    action: (reportId, action, body) => publisherInvoke('publisher:action', { reportId, action, body }),
    checkout: (reportId) => publisherInvoke('publisher:checkout', { reportId }),
    proCheckout: () => publisherInvoke('publisher:proCheckout'),
    billingPortal: () => publisherInvoke('publisher:billingPortal'),
    openExternal: (url) => publisherInvoke('publisher:openExternal', { url }),
    copyText: (text) => publisherInvoke('publisher:copyText', { text })
  }
});
