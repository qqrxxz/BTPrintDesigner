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
/** Set once the renderer has said the window may close. */
let closeConfirmed = false;
/** Set when the close is part of quitting, so the app follows the window. */
let quitting = false;

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
        // Reload throws the label away without a word, and Cmd+R is in every
        // browser user's fingers. Kept for development, gone from the build.
        ...(app.isPackaged
          ? []
          : ([
              { role: 'reload' },
              { role: 'toggleDevTools' },
              { type: 'separator' },
            ] as Electron.MenuItemConstructorOptions[])),
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

  // A file dropped on a window is, by default, a page to navigate to: the
  // editor was replaced by the dropped file's raw text and the label was gone.
  // The renderer opens dropped files itself; nothing may navigate the window.
  window_.webContents.on('will-navigate', (event) => event.preventDefault());

  // Closing asks the renderer first, because only it knows whether there is
  // unsaved work. It answers through `app:close-confirmed`. A renderer that
  // has crashed cannot answer, and must not keep the window open forever.
  window_.on('close', (event) => {
    if (closeConfirmed || window_ === undefined || window_.webContents.isCrashed()) return;
    event.preventDefault();
    window_.webContents.send('app:close-requested');
  });
  window_.on('closed', () => {
    window_ = undefined;
    closeConfirmed = false;
  });

  if (app.isPackaged) {
    await window_.loadFile(join(__dirname, '../dist/index.html'));
  } else {
    await window_.loadURL(DEV_SERVER);
  }
}

/**
 * Reads a file as text, whatever a label was written in.
 *
 * Templates that come back from customers are as often Windows-1251 as UTF-8 —
 * TSPL's own `CODEPAGE 1251` line says which — and reading one as UTF-8 turns
 * every Russian word into replacement characters. UTF-8 is tried strictly
 * first, because a file that decodes as UTF-8 is UTF-8.
 */
function decodeText(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1251').decode(bytes);
  }
}

ipcMain.handle('project:open', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Open label',
    filters: [
      // One list rather than two: a customer's template and this program's own
      // project are both "the label I want to look at".
      {
        name: 'Label or printer code',
        extensions: ['btpd.json', 'json', 'prn', 'prq', 'lbl', 'txt', 'zpl', 'tspl', 'cpcl'],
      },
      { name: 'All files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  const path = result.filePaths[0];
  if (result.canceled || path === undefined) return undefined;
  return { path, content: decodeText(await readFile(path)) };
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

/**
 * Asks about unsaved work before something throws it away.
 *
 * The wording comes from the renderer because the interface has two languages
 * and the main process has none.
 */
ipcMain.handle(
  'dialog:ask-save',
  async (
    _event,
    request: { message: string; detail: string; save: string; discard: string; cancel: string },
  ) => {
    const answer = await dialog.showMessageBox(window_!, {
      type: 'warning',
      message: request.message,
      detail: request.detail,
      buttons: [request.save, request.discard, request.cancel],
      defaultId: 0,
      cancelId: 2,
    });
    return (['save', 'discard', 'cancel'] as const)[answer.response] ?? 'cancel';
  },
);

ipcMain.handle('app:close-confirmed', () => {
  closeConfirmed = true;
  if (quitting) app.quit();
  else window_?.close();
});

ipcMain.handle('app:close-cancelled', () => {
  quitting = false;
});

/**
 * Reads a file that was dropped on the window.
 *
 * The renderer can name any path here, so only the kinds of file the Open
 * dialog offers are read, and nothing large: a label is a few kilobytes.
 */
ipcMain.handle('project:open-path', async (_event, path: string) => {
  const allowed = /\.(btpd\.json|json|prn|prq|lbl|txt|zpl|tspl|cpcl)$/i;
  if (typeof path !== 'string' || !allowed.test(path)) return undefined;
  const bytes = await readFile(path);
  if (bytes.length > 4 * 1024 * 1024) return undefined;
  return { path, content: decodeText(bytes) };
});

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

app.on('before-quit', () => {
  quitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
