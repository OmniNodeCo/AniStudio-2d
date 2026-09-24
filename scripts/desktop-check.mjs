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

// The installers a release advertises are configured in three places that can drift apart:
// electron-builder's targets, the `dist:*` npm scripts, and the two workflows that carry the files
// to a release. Pin them to each other so a rename cannot quietly drop a platform from a release.
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const builderConfig = read("../electron-builder.yml");
const releaseWorkflow = read("../.github/workflows/release.yml");
const buildWorkflow = read("../.github/workflows/build.yml");
const { scripts } = JSON.parse(read("../package.json"));

function asserts(label, text, needle) {
  assert.ok(text.includes(needle), `${label} no longer mentions ${JSON.stringify(needle)}`);
}

// Each target we ship, and the file name electron-builder gives it (${...} is literal here).
for (const target of ["nsis", "portable", "dmg", "zip", "AppImage", "deb", "rpm"]) {
  asserts("electron-builder.yml", builderConfig, `target: ${target}`);
}
for (const artifactName of [
  "AniStudio-2D-${version}-windows-${arch}-setup.${ext}",
  "AniStudio-2D-${version}-windows-${arch}-portable.${ext}",
  "AniStudio-2D-${version}-macos-${arch}.${ext}",
  "AniStudio-2D-${version}-linux-${arch}.${ext}",
]) {
  asserts("electron-builder.yml", builderConfig, artifactName);
}
assert.match(scripts["dist:win"], /--win nsis portable/, "dist:win must build the setup and portable executables");
assert.match(scripts["dist:mac"], /--mac dmg zip/, "dist:mac must build the dmg and the portable zip");
assert.match(scripts["dist:linux"], /--linux AppImage deb rpm/, "dist:linux must build AppImage, deb and rpm");

for (const [label, workflow] of [["build.yml", buildWorkflow], ["release.yml", releaseWorkflow]]) {
  // Upload globs: the four families of file a release carries.
  for (const glob of ["release/*-setup.exe", "release/*-portable.exe", "release/*.dmg", "release/*.zip", "release/*.AppImage", "release/*.deb", "release/*.rpm"]) {
    asserts(label, workflow, glob);
  }
  // Per-platform expectations, so "packaging exited 0" is never mistaken for "the file exists".
  for (const expect of ["*-setup.exe *-portable.exe", "*.dmg *.zip", "*.AppImage *.deb *.rpm"]) {
    asserts(label, workflow, expect);
  }
  for (const script of ["dist:win", "dist:mac", "dist:linux"]) {
    asserts(label, workflow, script);
  }
  asserts(label, workflow, "npm run desktop:check");
}
// Only the release workflow publishes, and it does so from a draft that is filled first.
for (const needle of ["gh release create", "gh release upload", "gh release edit", "sha256sum", "assets/*", "out/SHA256SUMS.txt", "npm version \"$version\" --no-git-tag-version"]) {
  asserts("release.yml", releaseWorkflow, needle);
}
const uploadIndex = releaseWorkflow.indexOf("gh release upload");
assert.ok(
  uploadIndex !== -1 && uploadIndex < releaseWorkflow.indexOf("--draft=false"),
  "release.yml must attach the assets before it publishes the release",
);
console.log(`packaging wiring: 7 targets, 4 artifact names, 2 workflows agree on setup/portable/dmg/zip/AppImage/deb/rpm`);
console.log("All desktop shell checks passed (stubbed Electron API + workflow wiring)");
