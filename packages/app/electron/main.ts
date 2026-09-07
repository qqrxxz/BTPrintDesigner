import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';

/**
 * The Electron main process.
 *
 * It owns the window, the menu and the file system, and nothing else. Every
 * decision about labels lives in the renderer, which is where the rendering
 * engine runs; the main process only opens and saves what it is handed. Keeping
 * it that thin is what lets the whole engine stay testable in Node without an
 * app around it.
 */

const DEV_SERVER = process.env['VITE_DEV_SERVER_URL'] ?? 'http://localhost:5173';

let window_: BrowserWindow | undefined;

function send(channel: string): void {
  window_?.webContents.send(channel);
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([{ role: 'appMenu' }] as Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => send('menu:new') },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => send('menu:open') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send('menu:save') },
        {
          label: 'Save As…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => send('menu:save-as'),
        },
        { type: 'separator' },
        {
          label: 'Export printer code…',
          accelerator: 'CmdOrCtrl+E',
          click: () => send('menu:export'),
        },
        { label: 'Export preview as PNG…', click: () => send('menu:export-png') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow(): Promise<void> {
  window_ = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'BTPrintDesigner',
    backgroundColor: '#1b1d21',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Anything that tries to leave the app opens in the real browser instead of
  // navigating the editor away from the label.
  window_.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (app.isPackaged) {
    await window_.loadFile(join(__dirname, '../dist/index.html'));
  } else {
    await window_.loadURL(DEV_SERVER);
  }
}

ipcMain.handle('project:open', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Open label',
    filters: [{ name: 'Label', extensions: ['btpd.json', 'json'] }],
    properties: ['openFile'],
  });
  const path = result.filePaths[0];
  if (result.canceled || path === undefined) return undefined;
  return { path, content: await readFile(path, 'utf8') };
});

ipcMain.handle(
  'project:save',
  async (_event, request: { path?: string; content: string; suggestedName: string }) => {
    let path = request.path;
    if (path === undefined) {
      const result = await dialog.showSaveDialog({
        title: 'Save label',
        defaultPath: request.suggestedName,
        filters: [{ name: 'Label', extensions: ['btpd.json'] }],
      });
      if (result.canceled || !result.filePath) return undefined;
      path = result.filePath;
    }
    await writeFile(path, request.content, 'utf8');
    return path;
  },
);

ipcMain.handle(
  'file:export',
  async (
    _event,
    request: { suggestedName: string; content: string | Uint8Array; extensions: string[] },
  ) => {
    const result = await dialog.showSaveDialog({
      title: 'Export',
      defaultPath: request.suggestedName,
      filters: [{ name: request.extensions.join(', '), extensions: request.extensions }],
    });
    if (result.canceled || !result.filePath) return undefined;
    const data =
      typeof request.content === 'string' ? request.content : Buffer.from(request.content);
    await writeFile(result.filePath, data);
    return result.filePath;
  },
);

ipcMain.handle('window:set-title', (_event, title: string) => {
  window_?.setTitle(title);
});

void app.whenReady().then(async () => {
  buildMenu();
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
