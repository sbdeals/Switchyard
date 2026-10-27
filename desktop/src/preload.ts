/**
 * Bridge for the bundled status/wizard view. The dashboard (http origin) also
 * gets this preload, but the main process accepts IPC only from the bundled
 * status view in this window's main frame, so exposure there is inert.
 */
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("switchyardDesktop", {
  getState: () => ipcRenderer.invoke("getState"),
  action: (id: string, payload?: unknown) => ipcRenderer.invoke("action", id, payload),
  onState: (cb: (state: unknown) => void) => {
    ipcRenderer.on("state", (_event, state) => cb(state));
  },
});
