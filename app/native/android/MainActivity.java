package com.tetrilaunch.app;

import android.os.Build;
import android.os.Bundle;
import android.view.Display;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

/**
 * Sticky-immersive shell for the game.
 *
 * This file is the SOURCE OF TRUTH for MainActivity; scripts/patch-android.mjs
 * copies it over the stub that `cap add android` generates. It lives here
 * rather than in app/android/ because that directory is gitignored and
 * regenerated — see docs/NATIVE.md.
 *
 * Why this is needed at all: the web build's fullscreen path
 * (lib/platform.ts's autoEnterFullscreenForRun) deliberately bails on
 * standalone / Capacitor contexts, because the Fullscreen API is a no-op
 * inside a WebView. Nothing else hides the system bars, so without this the
 * status and navigation bars sit on top of a landscape-locked play field —
 * measured at 2256x1080 of a 2376x1080 panel on a OnePlus 12, i.e. 120px of
 * the field lost to chrome.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        applyImmersive();
        lockTextZoom();
        requestHighestRefreshRate();
    }

    /**
     * Ask for the panel's fastest mode, because nothing else does.
     *
     * Android hands an app that expresses no preference whatever refresh rate
     * its power policy likes, and on a 120Hz OnePlus CPH2573 that measured as
     * a ~2s courtesy boost on touch followed by a hard park at 60Hz. Tracked
     * through the WebView's own devtools in 2s windows: 8.3ms rAF gaps while a
     * finger was down, then a flat 16.5-16.6ms for the next 22s once it lifted.
     *
     * That default is close to worst-case for THIS game specifically. The
     * player aims with a finger down, fires, and then WATCHES the piece fly
     * without touching anything — so the rate drops mid-flight, at the one
     * moment the screen holds fast motion and nothing else. The interpolated
     * renderer (main.ts's loop, engine.ts's lerpX/lerpY) is time-correct and
     * rides a steady 60 or a steady 120 equally well; what it cannot hide is
     * the cadence CHANGING under it while a body is in the air.
     *
     * preferredDisplayModeId rather than preferredRefreshRate: the latter is a
     * hint OEM policy is free to ignore, and this device did. The mode is
     * filtered to the CURRENT physical resolution so pinning the rate can
     * never also change the resolution out from under game/layout.ts's solver.
     *
     * Set once, in onCreate, and deliberately NOT re-applied on focus gain the
     * way applyImmersive() is: it is a window attribute and it persists, and
     * setAttributes triggers a relayout — which, per the note in applyImmersive
     * below, would re-fit the world and move the aim origin under the player's
     * finger. The cost is battery, which is the accepted trade for a game.
     */
    private void requestHighestRefreshRate() {
        Display display = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                ? getDisplay()
                : getWindowManager().getDefaultDisplay();
        if (display == null) return;

        Display.Mode current = display.getMode();
        Display.Mode best = current;
        for (Display.Mode mode : display.getSupportedModes()) {
            if (mode.getPhysicalWidth() == current.getPhysicalWidth()
                    && mode.getPhysicalHeight() == current.getPhysicalHeight()
                    && mode.getRefreshRate() > best.getRefreshRate()) {
                best = mode;
            }
        }

        // Deliberately NOT skipped when the best mode is already the active
        // one. The panel being AT 120Hz and this app being GIVEN 120Hz are two
        // different things: since Android 12 the system can hand an individual
        // app a divisor of the display rate (a frame rate override) while the
        // display itself keeps running flat out, which is exactly the state
        // measured here — dumpsys reported mActiveSfDisplayMode id=2 (120Hz)
        // while the WebView's rAF sat on 16.6ms gaps. An early return on
        // "already current" therefore expresses no preference at all and
        // leaves the override in place, which is the bug this comment exists
        // to stop someone re-introducing as an optimisation.
        WindowManager.LayoutParams params = getWindow().getAttributes();
        params.preferredDisplayModeId = best.getModeId();
        // Belt and braces: the mode id pins the DISPLAY, the refresh rate is
        // the app's own vote against the override. Neither alone was enough on
        // the CPH2573.
        params.preferredRefreshRate = best.getRefreshRate();
        getWindow().setAttributes(params);
    }

    /**
     * WebView follows the OS accessibility "Font size" setting
     * (Settings.System.FONT_SCALE) by scaling every CSS px font-size at
     * layout time, not just paint time — on a Samsung A14 with font_scale
     * 1.5 this measured as a flat 1.5x on every element (an 18px override
     * came back from getComputedStyle as 27px), which is what pushed the
     * short-viewport menu's button rail and wordmark past their pixel
     * budgets even after they were fixed to fit the app.css short-viewport
     * tuning at 1.0x. Every screen in this app is a fixed-pixel HUD sized in
     * px/cqw against a specific viewport, not reflowable prose, so there is
     * no layout budget that can absorb a user-configurable text multiplier —
     * lock it to 100% the same way a canvas-based game would.
     *
     * Reproduced independently on a OnePlus CPH2573 at 792x360 CSS px, by
     * modelling the same multiplier inside the shipping build over the
     * WebView's own devtools: computed font-size went 16px -> 24px, the action
     * rail's bottom edge went 346 -> 383.6 against a 360px viewport, and
     * documentElement.scrollHeight stayed pinned at 360 — so the overflow is
     * CLIPPED, not scrollable, and the bottom of the rail becomes invisible
     * and untappable rather than merely awkward. That is the failure this one
     * line prevents, and it is invisible to CI: sim/uifit's device matrix
     * carries w/h/dpr/insets and renders every fixture at textZoom 100, so no
     * amount of layout testing can catch it.
     */
    private void lockTextZoom() {
        getBridge().getWebView().getSettings().setTextZoom(100);
    }

    /**
     * Re-hide on every focus gain. Android restores the bars after an unlock,
     * a task switch, or a swipe, and never calls back to say it did.
     */
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyImmersive();
    }

    private void applyImmersive() {
        // false, so the WebView is laid out edge-to-edge and
        // env(safe-area-inset-*) reports the cutout — which is the input
        // game/layout.ts's solver reserves its bands from. With the default
        // (true) the decor eats the insets and the solver sees zeros.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());

        controller.hide(WindowInsetsCompat.Type.systemBars());

        // Transient-by-swipe rather than the default: an edge swipe overlays
        // the bars and they auto-hide again, so the WebView is never resized
        // mid-run. A relayout would re-fit the world and move the aim origin
        // under the player's finger.
        controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
