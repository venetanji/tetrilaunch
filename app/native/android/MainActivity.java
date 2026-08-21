package com.tetrilaunch.app;

import android.os.Bundle;

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
