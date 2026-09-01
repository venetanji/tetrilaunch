import Capacitor
import UIKit

/**
 * The bridge view controller with a game's edge policy.
 *
 * Fullscreen landscape play puts the player's thumbs exactly where iOS puts
 * its system gestures. Bottom-edge swipes are deferred here: a slingshot
 * drag that ends low must not become "go home" mid-shot — with the edge
 * deferred, the first swipe only summons the indicator and the second one
 * acts, the standard posture for games.
 *
 * The home indicator's auto-hide is NOT overridden here, deliberately:
 * Capacitor's SystemBars plugin already overrides
 * prefersHomeIndicatorAutoHidden on CAPBridgeViewController (as public, so a
 * subclass override does not compile) and feeds it from the plugin config —
 * capacitor.config.ts's `SystemBars: { hidden: true }` is the supported
 * spelling of the same intent.
 *
 * Registered via Main.storyboard's customClass; everything else is stock
 * CAPBridgeViewController.
 */
class GameViewController: CAPBridgeViewController {
  override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { [.bottom] }
}
