// Electron shell for the desktop build (Windows/macOS/Linux, eventually Steam).
//
// This began as a spike that only had to answer "does the game run correctly in
// a real desktop window" — rendering, audio, input, leaderboard. It did, so it
// is now the shipping shell: electron-builder.yml turns it into an NSIS
// installer, a dmg/zip and an AppImage. Still no auto-update and no Steamworks;
// those are their own piece of work.
//
// It loads the `--mode native` bundle, not the web one. That mode exists because
// a service worker inside a shell that already ships every asset locally caches
// local files against local files and buys nothing, while adding a stale-code
// hazard that has already shipped the previous build twice on Android (see
// app/vite.config.ts). On Steam the same argument is sharper still: Steam owns
// updating, and a worker that outlives a depot update would silently run old
// code with nothing to evict it.

const { app, BrowserWindow, protocol, net, shell } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

/**
 * The built web bundle.
 *
 * Two locations, because the bundle is a sibling of this package in the repo
 * and a child of it once packaged. In the checkout `vite build` writes it to
 * app/dist/, one level up from here. A packaged app has no app/ around it at
 * all, so electron-builder copies that same tree INTO the archive as `dist/`
 * (see the `files` mapping in electron-builder.yml) and __dirname is then the
 * asar root rather than this directory.
 *
 * Both paths are read through net.fetch below, which resolves file:// URLs
 * inside an asar the same way it does on disk — so nothing downstream has to
 * know which of the two it got.
 */
const DIST = app.isPackaged
  ? path.join(__dirname, "dist")
  : path.join(__dirname, "..", "dist");

/**
 * WHY A CUSTOM SCHEME RATHER THAN file://.
 *
 * The obvious shell loads dist/index.html straight off disk, and `base: "./"`
 * in vite.config.ts means the relative asset paths would resolve. It still does
 * not work, for two reasons that both bite silently rather than loudly:
 *
 *   SOUND. Sound effects are loaded with fetch() (app/src/lib/audio.ts) so they
 *   can go through decodeAudioData. Chromium blocks fetch() against file://
 *   URLs outright. Music uses `new Audio()` and would have survived, so the
 *   failure mode is a game with a soundtrack and no effects — which reads as a
 *   mixing bug, not a protocol one.
 *
 *   THE SAVE. Settings, player name and all meta-progression live in
 *   localStorage (app/src/lib/store.ts). file:// documents get an opaque
 *   origin, so the store is unreliable across launches and can vanish outright.
 *   Losing a player's ladder progress on a shell detail is not a bug worth
 *   discovering after release.
 *
 * A registered standard scheme gives the page a real, stable origin, which
 * restores both. `standard` is what makes it origin-bearing at all; `secure`
 * puts it on the same footing as https for the APIs that gate on secure
 * contexts; `supportFetchAPI` is the fix for the sound; `stream` lets the
 * music elements pull progressively instead of buffering whole tracks.
 *
 * The origin is app://tetrilaunch. That matters for the leaderboard: apiBase()
 * in app/src/lib/api.ts treats anything that is not tetrilaunch.com or a
 * workers.dev host as remote and points it at https://tetrilaunch.com, whose
 * /api responses are CORS-open. So the board works here with no client change
 * — but it is the PRODUCTION board, exactly as it is for the Capacitor shell.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

/**
 * Map app://tetrilaunch/<path> onto DIST/<path>.
 *
 * The containment check is not ceremony. Everything under app:// is content we
 * built ourselves, but the game also renders remote leaderboard names, and a
 * request path is attacker-influenceable in general — resolving first and then
 * proving the result is still inside DIST is the cheap way to never have to
 * reason about which inputs reach here.
 */
function registerAppProtocol() {
  protocol.handle("app", async (request) => {
    const url = new URL(request.url);
    // Bare app://tetrilaunch/ and any unknown path both mean "the game".
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
    const resolved = path.resolve(DIST, rel);

    const root = path.resolve(DIST);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      return new Response("Forbidden", { status: 403 });
    }

    return net.fetch(pathToFileURL(resolved).toString());
  });
}

function createWindow() {
  const win = new BrowserWindow({
    // The game is landscape-locked on phones and its layout is built around a
    // reference box; 16:9 at 1280x720 is the smallest size that is unambiguously
    // "desktop" rather than a stretched tablet. Resizing is left ON deliberately
    // — the spike wants to see how the chrome magnification that landed in #93
    // behaves at sizes the ui-fit harness does not cover.
    width: 1280,
    height: 720,
    minWidth: 960,
    minHeight: 540,
    // Matches the manifest's theme/background colour, so the frame that appears
    // before the first paint is the game's black and not Electron's white.
    backgroundColor: "#07070f",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      // No preload and nothing exposed: the game is a plain web app and asks
      // for no privileged APIs. Keeping it that way means the shell adds no
      // attack surface over the browser it already runs in.
      contextIsolation: true,
      nodeIntegration: false,
      // The game drives its own loop and should keep running while the window
      // is behind another one — a background tab's throttling would stall the
      // physics rather than pause it.
      backgroundThrottling: false,
    },
  });

  win.once("ready-to-show", () => win.show());

  // Any http(s) link the page opens (policy pages, support) belongs in the
  // player's real browser, not in a second chromeless Electron window with no
  // way back to the game.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });

  win.loadURL("app://tetrilaunch/index.html");
  return win;
}

app.whenReady().then(() => {
  registerAppProtocol();
  const win = createWindow();

  // F11 is the fullscreen convention on Windows and Linux; Escape leaves it.
  // Steam builds normally launch fullscreen, but a spike you are trying to
  // observe is far easier to watch in a window.
  win.webContents.on("before-input-event", (_event, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F11") win.setFullScreen(!win.isFullScreen());
    if (input.key === "Escape" && win.isFullScreen()) win.setFullScreen(false);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
