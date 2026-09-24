// Desktop host for the existing studio. No Node APIs or IPC bridge are exposed to the page.
import { app, BrowserWindow, dialog, Menu, session } from "electron";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const indexPath = fileURLToPath(new URL("../dist/index.html", import.meta.url));
const smokeTest = process.argv.includes("--smoke-test");
let window;

app.setName("AniStudio 2D");

function createWindow() {
  window = new BrowserWindow({
    title: "AniStudio 2D",
    width: 1360,
    height: 880,
    minWidth: 940,
    minHeight: 620,
    show: false,
    backgroundColor: "#0b0c12",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  const current = window;
  current.once("ready-to-show", () => {
    if (!smokeTest) current.show();
  });
  current.on("closed", () => { window = undefined; });
  current.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  // The studio is one local page; do not let a dropped file or link navigate away from it.
  current.webContents.on("will-navigate", (event) => event.preventDefault());
  current.webContents.on("will-attach-webview", (event) => event.preventDefault());
  current.webContents.on("render-process-gone", (_event, details) => {
    console.error("Renderer exited:", details.reason);
    if (smokeTest) app.exit(1);
  });

  void current.loadFile(indexPath).then(async () => {
    if (!smokeTest) return;
    // Exercise the packaged file:// entry, not a Vite server. React must have mounted a canvas.
    const rendered = await current.webContents.executeJavaScript(`new Promise((resolve) => {
      const deadline = Date.now() + 15000;
      function check() {
        if (document.querySelector('#root canvas')) return resolve(true);
        if (Date.now() > deadline) return resolve(false);
        setTimeout(check, 100);
      }
      check();
    })`);
    if (!rendered) throw new Error("Packaged studio did not render its canvas");
    console.log("Desktop smoke test passed");
    app.exit(0);
  }).catch((error) => {
    console.error(error);
    if (!smokeTest) dialog.showErrorBox("AniStudio could not start", String(error));
    app.exit(1);
  });
}

app.whenReady().then(() => {
  // Existing <a download> exports work without an IPC bridge; Electron supplies the save dialog.
  session.defaultSession.on("will-download", (_event, item) => {
    item.setSaveDialogOptions({
      title: "Save AniStudio export",
      defaultPath: join(app.getPath("documents"), item.getFilename()),
    });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
    { label: "File", submenu: [{ role: process.platform === "darwin" ? "close" : "quit" }] },
    // Leave edit accelerators to the studio (undo/redo and copy/paste operate on poses).
    { role: "viewMenu" },
    { role: "windowMenu" },
  ]));
  createWindow();
  app.on("activate", () => { if (!window) createWindow(); });
}).catch((error) => {
  console.error(error);
  app.exit(1);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
