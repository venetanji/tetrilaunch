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
  platform: "android" | "ios";
  w: number;
  h: number;
  dpr: number;
  insets: { left: number; right: number; top: number; bottom: number };
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
];

/** The smallest box anything has to fit in — the one worth quoting in a plan. */
export const WORST_CASE = DEVICES[0];
