import Capacitor
import UIKit

/**
 * The bridge view controller with a game's edge policy.
 *
 * Fullscreen landscape play puts the player's thumbs exactly where iOS puts
 * its system gestures, so both knobs move:
 *
 *  - The home indicator auto-hides. It cannot be removed — iOS always owns
 *    it — but with this hint it fades out after a couple of seconds without
 *    edge touches instead of sitting as a white line over the bay floor,
 *    and comes back the moment a finger nears the edge.
 *
 *  - Bottom-edge swipes are deferred. A slingshot drag that ends low must
 *    not become "go home" mid-shot: with the edge deferred, the first swipe
 *    only summons the indicator and the second one acts — the standard
 *    posture for games, and the reason the pause menu stays the honest way
 *    out of the app.
 *
 * Registered via Main.storyboard's customClass; everything else is stock
 * CAPBridgeViewController.
 */
class GameViewController: CAPBridgeViewController {
  override var prefersHomeIndicatorAutoHidden: Bool { true }
  override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { [.bottom] }
}
