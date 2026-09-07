import { contextBridge, ipcRenderer } from 'electron';

/**
 * The bridge between the window and the file system.
 *
 * Deliberately small: four file operations and a title. The renderer has no
 * other way out, which means a label file can never be more than data.
 */
const api = {
  openProject: (): Promise<{ path: string; content: string } | undefined> =>
    ipcRenderer.invoke('project:open'),

  saveProject: (request: {
    path?: string;
    content: string;
    suggestedName: string;
  }): Promise<string | undefined> => ipcRenderer.invoke('project:save', request),

  exportFile: (request: {
    suggestedName: string;
    content: string | Uint8Array;
    extensions: string[];
  }): Promise<string | undefined> => ipcRenderer.invoke('file:export', request),

  setTitle: (title: string): Promise<void> => ipcRenderer.invoke('window:set-title', title),

  onMenu: (handler: (action: string) => void): void => {
    for (const action of ['new', 'open', 'save', 'save-as', 'export', 'export-png']) {
      ipcRenderer.on(`menu:${action}`, () => handler(action));
    }
  },
};

contextBridge.exposeInMainWorld('btpd', api);

export type BtpdApi = typeof api;
