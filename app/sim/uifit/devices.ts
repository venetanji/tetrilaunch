/**
 * The device matrix the UI has to fit.
 *
 * All viewports are LANDSCAPE CSS pixels — the app locks landscape (lib/
 * platform's lockLandscape) and shows a rotate guard otherwise, so portrait is
 * out of scope by design.
 *
 * `insets` are the landscape safe-area insets. On iOS the notch/Dynamic Island
 * eats a SIDE in landscape (not the top), and the home indicator eats the
 * bottom — which is why the iPhone rows carry symmetric left/right values: the
 * app has to survive the device being held either way up. These are the numbers
 * that make the field small while the HUD's pixel floors stay fixed, so the
 * inset rows are the ones that catch the plant-panel overflow.
 *
 * dpr is carried because Playwright's deviceScaleFactor changes text
 * rasterisation and therefore sub-pixel layout rounding; a fit that only holds
 * at dpr 2 is not a fit.
 */
export interface Device {
  name: string;
  platform: "android" | "ios" | "web";
  w: number;
  h: number;
  dpr: number;
  insets: { left: number; right: number; top: number; bottom: number };
  /** Which pointer the row emulates. Defaults to "coarse" — every handset and
   *  tablet row above — and this is NOT a cosmetic flag: `@media (pointer:
   *  fine)` is a structural switch in app.css. It hides the rail's game
   *  buttons, changes what the rail budget asks the layout solver for, and is
   *  the ONLY condition under which the keyboard hint strip is drawn at all.
   *  A matrix with no fine row therefore measures a build in which a whole
   *  control surface does not exist — which is exactly how a hint strip
   *  centred on the wrong axis reached production. */
  pointer?: "coarse" | "fine";
}

const NONE = { left: 0, right: 0, top: 0, bottom: 0 };

export const DEVICES: Device[] = [
  // --- Android -------------------------------------------------------------
  // Mostly no safe-area insets: Android gesture bars are drawn over by the
  // immersive fullscreen the app requests. Cutouts are NOT letterboxed away,
  // though — the native build explicitly sets
  // windowLayoutInDisplayCutoutMode=shortEdges (scripts/patch-android.mjs),
  // which disables exactly that letterboxing so the app renders under the
  // punch-hole — hence the one cutout row below.
  { name: "Android · 640x360 budget", platform: "android", w: 640, h: 360, dpr: 2, insets: NONE },
  { name: "Android · Galaxy S8+", platform: "android", w: 740, h: 360, dpr: 4, insets: NONE },
  { name: "Android · OnePlus 12", platform: "android", w: 792, h: 360, dpr: 3, insets: NONE },
  { name: "Android · Pixel 5", platform: "android", w: 851, h: 393, dpr: 2.75, insets: NONE },
  { name: "Android · Pixel 7", platform: "android", w: 915, h: 412, dpr: 2.625, insets: NONE },
  // The shortEdges consequence, measured: a punch-hole phone in landscape has
  // its camera cutout on ONE side, surfaced to the WebView as a left or right
  // safe-area inset (~34px at this density). One side per row is the same
  // assumption the iPhone rows make about either-way-up handedness.
  {
    name: "Android · Pixel 7 cutout", platform: "android", w: 915, h: 412, dpr: 2.625,
    insets: { left: 34, right: 0, top: 0, bottom: 0 },
  },
  { name: "Android · Pixel Tablet", platform: "android", w: 1600, h: 1000, dpr: 2, insets: NONE },
  // --- iOS -----------------------------------------------------------------
  { name: "iOS · iPhone SE 3", platform: "ios", w: 667, h: 375, dpr: 2, insets: NONE },
  {
    name: "iOS · iPhone 13 mini", platform: "ios", w: 780, h: 360, dpr: 3,
    insets: { left: 50, right: 50, top: 0, bottom: 21 },
  },
  {
    name: "iOS · iPhone 15", platform: "ios", w: 852, h: 393, dpr: 3,
    insets: { left: 59, right: 59, top: 0, bottom: 21 },
  },
  {
    name: "iOS · iPhone 16 Pro Max", platform: "ios", w: 956, h: 440, dpr: 3,
    insets: { left: 62, right: 62, top: 0, bottom: 21 },
  },
  {
    name: "iOS · iPad mini", platform: "ios", w: 1024, h: 768, dpr: 2,
    insets: { left: 0, right: 0, top: 0, bottom: 20 },
  },
  {
    name: "iOS · iPad Pro 12.9", platform: "ios", w: 1366, h: 1024, dpr: 2,
    insets: { left: 0, right: 0, top: 0, bottom: 20 },
  },
  // --- Web (desktop browser, fine pointer) ---------------------------------
  // The app ships on the web as well as the two stores, and a desktop browser
  // is not a big tablet: it is the fine-pointer branch, where the rail sheds
  // its game buttons and the keyboard hint strip appears in their place. None
  // of that was measured anywhere until these rows existed.
  //
  // No safe-area insets — a browser window has none — so what these rows are
  // really sampling is the LAYOUT MODE, and the sample is chosen to cover all
  // three. The everyday laptop sizes are the interesting ones: at 16:9 and
  // 16:10 the solver cannot find a usable natural gutter and goes "snug",
  // reserving an 84px right band and refitting the world into what is left, so
  // the field's centre and the window's centre are 42px apart. Anything
  // anchored to the viewport that should be anchored to the field is off by
  // exactly that much, on the most common window in the world, and invisible
  // on the ultrawide row where the gutters are symmetric.
  { name: "Web · 1280x720 laptop", platform: "web", w: 1280, h: 720, dpr: 1, insets: NONE, pointer: "fine" },
  { name: "Web · 1512x945 MacBook", platform: "web", w: 1512, h: 945, dpr: 2, insets: NONE, pointer: "fine" },
  { name: "Web · 1920x1080 desktop", platform: "web", w: 1920, h: 1080, dpr: 1, insets: NONE, pointer: "fine" },
  { name: "Web · 2560x1080 ultrawide", platform: "web", w: 2560, h: 1080, dpr: 1, insets: NONE, pointer: "fine" },
  // Two windows the player dragged narrow. Both are 4:3-ish, so the solver goes
  // "tall" and the hint strip takes its one override; the 800x600 row is here
  // because it is the width at which a hint strip sized by its CONTENT rather
  // than by the field stops fitting, and a bound nothing ever tests is a bound
  // that is not there. It is a legitimate browser window, not a synthetic
  // worst case — narrower than any tablet row, and taller than every phone.
  { name: "Web · 1000x760 window", platform: "web", w: 1000, h: 760, dpr: 1, insets: NONE, pointer: "fine" },
  { name: "Web · 800x600 window", platform: "web", w: 800, h: 600, dpr: 1, insets: NONE, pointer: "fine" },
];

/** The smallest box anything has to fit in — the one worth quoting in a plan. */
export const WORST_CASE = DEVICES[0];
