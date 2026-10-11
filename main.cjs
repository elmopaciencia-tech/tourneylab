// TourneyLab — Electron main process (MIT)
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, clipboard, net } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { createPublisherClient } = require('./publisher-client.cjs');
const { contentZoomAction } = require('./content-zoom-shortcuts.cjs');
const { writeReportBundle } = require('./report-bundle.cjs');

let win;
let managedPublisher;

function openPublisherExternal(value) {
  const url = new URL(value);
  const localDevelopment = ['localhost', '127.0.0.1'].includes(url.hostname) && url.protocol === 'http:';
  const trustedHttps = url.protocol === 'https:' && (
    url.hostname === 'tourneylab.app' || url.hostname.endsWith('.tourneylab.app') ||
    url.hostname === 'checkout.stripe.com' || url.hostname === 'billing.stripe.com'
  );
  if (!localDevelopment && !trustedHttps) {
    const error = new Error('Only trusted TourneyLab or Stripe links can be opened.');
    error.status = 400;
    throw error;
  }
  return shell.openExternal(url.href);
}

function publisherClient() {
  if (!managedPublisher) {
    managedPublisher = createPublisherClient({
      safeStorage,
      fileSystem: fs,
      credentialFile: path.join(app.getPath('userData'), 'publisher-credential.bin'),
      fetchImpl: (url, init) => net.fetch(url, init),
      openExternal: openPublisherExternal
    });
  }
  return managedPublisher;
}

async function publisherResult(work) {
  try { return { ok: true, data: await work }; }
  catch (error) {
    return { ok: false, error: error?.message || 'Publishing request failed.', status: error?.status ?? 0, data: error?.data ?? null };
  }
}

function createWindow() {
  const macWindowChrome = process.platform === 'darwin' ? {
    titleBarStyle: 'hiddenInset',
    titleBarOverlay: true,
    trafficLightPosition: { x: 16, y: 18 }
  } : {};

  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#ffffff',
    title: 'TourneyLab',
    ...macWindowChrome,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.setMenuBarVisibility(false);
  win.webContents.setZoomFactor(1);
  const sendWindowMode = () => {
    if (!win?.isDestroyed()) win.webContents.send('window-mode:changed', win.isFullScreen() ? 'fullscreen' : 'windowed');
  };
  win.on('enter-full-screen', sendWindowMode);
  win.on('leave-full-screen', sendWindowMode);
  win.webContents.on('before-input-event', (event, input) => {
    const action = contentZoomAction(input, process.platform);
    if (!action) return;
    event.preventDefault();
    win.webContents.send('content-zoom:shortcut', action);
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

ipcMain.handle('window:mode', () => win?.isFullScreen() ? 'fullscreen' : 'windowed');

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------- workspace persistence (autosave) ----------
const workspaceFile = () => path.join(app.getPath('userData'), 'workspace.json');

ipcMain.handle('workspace:load', async () => {
  try {
    return JSON.parse(fs.readFileSync(workspaceFile(), 'utf8'));
  } catch {
    return null;
  }
});

ipcMain.handle('workspace:save', async (_e, data) => {
  backupPreV3Migration(workspaceFile(), data);
  backupMigration(workspaceFile(), data, 4);
  backupMigration(workspaceFile(), data, 5);
  backupMigration(workspaceFile(), data, 6);
  backupMigration(workspaceFile(), data, 7);
  rotateBackups(workspaceFile(), data?.settings?.backupGenerations ?? 3);
  fs.mkdirSync(path.dirname(workspaceFile()), { recursive: true });
  fs.writeFileSync(workspaceFile(), JSON.stringify(data, null, 1), 'utf8');
  return true;
});

function backupPreV3Migration(file, incoming) {
  const backup = `${file}.pre-v3.bak`;
  if (!fs.existsSync(file) || fs.existsSync(backup)) return;
  try {
    const current = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Number(current?.schemaVersion ?? 0) < 3 && Number(incoming?.schemaVersion ?? 0) >= 3) {
      fs.copyFileSync(file, backup);
    }
  } catch (e) {
    console.error('pre-v3 workspace backup failed', e);
  }
}

function backupMigration(file, incoming, version) {
  const backup = `${file}.pre-v${version}.bak`;
  if (!fs.existsSync(file) || fs.existsSync(backup)) return;
  try {
    const current = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Number(current?.schemaVersion ?? 0) < version && Number(incoming?.schemaVersion ?? 0) >= version) {
      fs.copyFileSync(file, backup);
    }
  } catch (e) {
    console.error(`pre-v${version} workspace backup failed`, e);
  }
}

// Backup rotation: file.bak1 is newest. Mirrors Swiss-Manager's ".bak generations".
function rotateBackups(file, generations) {
  if (!fs.existsSync(file) || generations <= 0) return;
  try {
    for (let i = generations - 1; i >= 1; i--) {
      const from = `${file}.bak${i}`;
      const to = `${file}.bak${i + 1}`;
      if (fs.existsSync(from)) fs.copyFileSync(from, to);
    }
    fs.copyFileSync(file, `${file}.bak1`);
  } catch (e) {
    console.error('backup rotation failed', e);
  }
}

// ---------- tournament file open/save (.tlab JSON) ----------
ipcMain.handle('file:saveTournament', async (_e, { suggestedName, json, backupGenerations }) => {
  const res = await dialog.showSaveDialog(win, {
    title: 'Save tournament',
    defaultPath: suggestedName,
    filters: [{ name: 'TourneyLab tournament', extensions: ['tlab', 'json'] }]
  });
  if (res.canceled || !res.filePath) return null;
  rotateBackups(res.filePath, backupGenerations ?? 3);
  fs.writeFileSync(res.filePath, json, 'utf8');
  return res.filePath;
});

ipcMain.handle('file:openTournament', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Open tournament',
    properties: ['openFile'],
    filters: [{ name: 'TourneyLab tournament', extensions: ['tlab', 'json'] }]
  });
  if (res.canceled || !res.filePaths.length) return null;
  return { path: res.filePaths[0], json: fs.readFileSync(res.filePaths[0], 'utf8') };
});

// ---------- generic export (HTML / CSV / TXT / PGN / TRF) ----------
ipcMain.handle('file:export', async (_e, { suggestedName, content, filterName, ext, openAfterExport }) => {
  const res = await dialog.showSaveDialog(win, {
    title: 'Export',
    defaultPath: suggestedName,
    filters: [{ name: filterName, extensions: [ext] }]
  });
  if (res.canceled || !res.filePath) return null;
  fs.writeFileSync(res.filePath, content, 'utf8');
  if (openAfterExport) {
    try {
      await shell.openExternal(pathToFileURL(res.filePath).href);
    } catch (e) {
      console.error('open exported file failed', e);
    }
  }
  return res.filePath;
});

ipcMain.handle('file:prepareReportBundle', (_e, bundle) => require('./report-assets.cjs').prepareReportBundle(bundle));

ipcMain.handle('file:exportReportBundle', async (_e, { suggestedName, bundle }) => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Choose report site location',
    buttonLabel: 'Export here',
    properties: ['openDirectory', 'createDirectory']
  });
  if (res.canceled || !res.filePaths.length) return null;
  const written = writeReportBundle(fs, path, res.filePaths[0], suggestedName, bundle);
  try {
    await shell.openExternal(pathToFileURL(written.indexPath).href);
  } catch (error) {
    console.error('open report site failed', error);
  }
  return written;
});

// ---------- import players from CSV (national rating list style) ----------
ipcMain.handle('file:openCsv', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Import players (CSV)',
    properties: ['openFile'],
    filters: [{ name: 'CSV', extensions: ['csv', 'txt'] }]
  });
  if (res.canceled || !res.filePaths.length) return null;
  return fs.readFileSync(res.filePaths[0], 'utf8');
});

ipcMain.handle('file:openText', async (_e, { title, extensions } = {}) => {
  const res = await dialog.showOpenDialog(win, {
    title: title || 'Open file',
    properties: ['openFile'],
    filters: [{ name: (extensions || ['xml']).join('/').toUpperCase(), extensions: extensions || ['xml'] }]
  });
  if (res.canceled || !res.filePaths.length) return null;
  return fs.readFileSync(res.filePaths[0], 'utf8');
});

// ---------- binary tournament interchange (.TUNx and future codecs) ----------
ipcMain.handle('file:openBinary', async (_e, { title, extensions } = {}) => {
  const allowedExtensions = Array.isArray(extensions) && extensions.length ? extensions : ['tunx'];
  const res = await dialog.showOpenDialog(win, {
    title: title || 'Open binary tournament file',
    properties: ['openFile'],
    filters: [{ name: allowedExtensions.join('/').toUpperCase(), extensions: allowedExtensions }]
  });
  if (res.canceled || !res.filePaths.length) return null;
  const filePath = res.filePaths[0];
  return { name: path.basename(filePath), bytes: fs.readFileSync(filePath) };
});

ipcMain.handle('file:exportBinary', async (_e, { suggestedName, bytes, filterName, ext }) => {
  if (!(bytes instanceof Uint8Array) && !Array.isArray(bytes)) throw new Error('Binary export requires bytes.');
  const res = await dialog.showSaveDialog(win, {
    title: 'Export',
    defaultPath: suggestedName,
    filters: [{ name: filterName || String(ext || 'binary').toUpperCase(), extensions: [ext || 'bin'] }]
  });
  if (res.canceled || !res.filePath) return null;
  fs.writeFileSync(res.filePath, Buffer.from(bytes));
  return res.filePath;
});

// ---------- managed results publishing ----------
ipcMain.handle('publisher:connection', () => publisherResult(publisherClient().connection()));
ipcMain.handle('publisher:connectStart', (_e, { deviceName } = {}) => publisherResult(publisherClient().connectStart(deviceName || 'TourneyLab desktop')));
ipcMain.handle('publisher:connectPoll', (_e, { deviceCode }) => publisherResult(publisherClient().connectPoll(deviceCode)));
ipcMain.handle('publisher:disconnect', () => publisherResult(publisherClient().disconnect()));
ipcMain.handle('publisher:createReport', (_e, { title, visibility }) => publisherResult(publisherClient().createReport(title, visibility)));
ipcMain.handle('publisher:report', (_e, { reportId }) => publisherResult(publisherClient().report(reportId)));
ipcMain.handle('publisher:publish', (_e, { reportId, html, revision }) => publisherResult(publisherClient().publish(reportId, html, revision)));
ipcMain.handle('publisher:publishBundle', (_e, { reportId, bundle, revision }) => publisherResult(publisherClient().publishBundle(reportId, bundle, revision)));
ipcMain.handle('publisher:updateReport', (_e, { reportId, changes }) => publisherResult(publisherClient().updateReport(reportId, changes)));
ipcMain.handle('publisher:action', (_e, { reportId, action, body }) => {
  if (!['rollback', 'unpublish', 'delete'].includes(action)) return { ok: false, error: 'Unsupported publishing action.', status: 400 };
  return publisherResult(publisherClient().action(reportId, action, body));
});
ipcMain.handle('publisher:checkout', (_e, { reportId }) => publisherResult(publisherClient().checkout(reportId)));
ipcMain.handle('publisher:proCheckout', () => publisherResult(publisherClient().proCheckout()));
ipcMain.handle('publisher:billingPortal', () => publisherResult(publisherClient().billingPortal()));
ipcMain.handle('publisher:openExternal', (_e, { url }) => publisherResult(Promise.resolve().then(() => openPublisherExternal(url))));
ipcMain.handle('publisher:copyText', (_e, { text }) => publisherResult(Promise.resolve().then(() => { clipboard.writeText(String(text ?? '')); return true; })));
