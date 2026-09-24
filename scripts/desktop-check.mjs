// Unit-check the actual desktop entry against Electron stubs. The real packaged runtime is
// smoke-tested separately on Linux in build.yml; this test does not claim to launch Electron.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { EventEmitter } from "node:events";

const entry = new URL("../electron/main.mjs", import.meta.url);
const source = readFileSync(entry, "utf8")
  .replace(/^import .*;$/gm, "")
  .replaceAll("import.meta.url", JSON.stringify(entry.href));

async function check(platform, smokeTest = false, rendered = true) {
  const windows = [];
  const downloads = new EventEmitter();
  const app = new EventEmitter();
  Object.assign(app, {
    whenReady: () => Promise.resolve(),
    setName: (name) => { app.name = name; },
    getPath: () => "/documents",
    quit: () => { app.quitCalled = true; },
    exit: (code) => { app.exitCode = code; },
  });
  downloads.setPermissionRequestHandler = (fn) => { downloads.permissions = fn; };
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = (fn) => { this.popup = fn; };
      this.webContents.executeJavaScript = async (script) => {
        assert.match(script, /#root canvas/);
        return rendered;
      };
      windows.push(this);
    }
    loadFile(path) { this.path = path; return Promise.resolve(); }
    show() { this.visible = true; }
  }
  let menu;
  const errors = [];
  runInNewContext(source, {
    app, BrowserWindow: Window,
    dialog: { showErrorBox: (...args) => errors.push(args) },
    Menu: { buildFromTemplate: (t) => t, setApplicationMenu: (t) => { menu = t; } },
    session: { defaultSession: downloads },
    join, fileURLToPath, URL,
    process: { platform, argv: smokeTest ? ["--smoke-test"] : [] },
    console: { log() {}, error: (...args) => errors.push(args) },
  });
  // All stubbed I/O uses already-resolved promises; drain their continuations deterministically.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(windows.length, 1);
  const win = windows[0];
  assert.equal(app.name, "AniStudio 2D");
  assert.equal(win.path, fileURLToPath(new URL("../dist/index.html", import.meta.url)));
  assert.equal(win.options.webPreferences.nodeIntegration, false);
  assert.equal(win.options.webPreferences.contextIsolation, true);
  assert.equal(win.options.webPreferences.sandbox, true);
  assert.equal(win.options.show, false);
  assert.equal(win.popup({ url: "https://example.com" }).action, "deny");
  for (const event of ["will-navigate", "will-attach-webview"]) {
    let prevented = false;
    win.webContents.emit(event, { preventDefault() { prevented = true; } });
    assert.equal(prevented, true, event);
  }
  downloads.permissions(null, "camera", (allowed) => assert.equal(allowed, false));
  let saveOptions;
  downloads.emit("will-download", {}, {
    getFilename: () => "scene.gif",
    setSaveDialogOptions: (options) => { saveOptions = options; },
  });
  assert.equal(saveOptions.defaultPath, join("/documents", "scene.gif"));
  assert.equal(menu.some((item) => item.role === "appMenu"), platform === "darwin");
  win.emit("ready-to-show");
  assert.equal(!!win.visible, !smokeTest);
  if (smokeTest) {
    assert.equal(app.exitCode, rendered ? 0 : 1, "smoke-test exit code");
  } else {
    assert.equal(errors.length, 0);
    app.emit("window-all-closed");
    assert.equal(!!app.quitCalled, platform !== "darwin");
    win.emit("closed");
    app.emit("activate");
    assert.equal(windows.length, 2, "reopen after closing");
  }
  console.log(`desktop shell: ${platform}, smoke=${smokeTest}, rendered=${rendered} passed`);
}
for (const platform of ["linux", "win32", "darwin"]) await check(platform);
await check("linux", true, true);
await check("linux", true, false);
console.log("All desktop shell checks passed (stubbed Electron API)");
