import UIKit
import AVFoundation
import Capacitor
import WebKit

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    /// ONE APP, ONE AUDIO POLICY.
    ///
    /// NOT the fix for the missing sound effects — that theory was tested and
    /// is dead. The Ring/Silent switch was confirmed ON (ringer, not silent)
    /// for every device pass that reported no effects, so the hardware mute was
    /// never muting anything and the silent-switch explanation has to be struck
    /// from the list. The live diagnosis moved to lib/audio.ts's
    /// audioDiagnostics(), which is now the only instrument pointed at that
    /// device. This function stays because it is CORRECT PRODUCT BEHAVIOUR on
    /// its own merits, and it is worth being explicit that it is being landed
    /// as behaviour and not as a repair.
    ///
    /// The behaviour it fixes is a real incoherence, just not the reported one.
    /// An app that never configures a session runs in `.soloAmbient`, which the
    /// hardware mute switch silences. WKWebView promotes the session by itself
    /// when an <audio> ELEMENT plays; Web Audio output gets no such promotion.
    /// So the two mechanisms this game deliberately splits its audio across
    /// (lib/audio.ts's module note: elements for the 0.3–2.7MB long-form, Web
    /// Audio for the ~120KB of overlapping one-shots) answer to two DIFFERENT
    /// hardware policies for reasons that are an implementation detail of how
    /// the assets are sized. Flip the switch to silent on the stock
    /// configuration and you get a soundtrack with no impacts — a game that
    /// half-obeys a mute is worse than one that obeys it or ignores it, because
    /// the player cannot tell a setting from a fault. (Which is exactly the
    /// trap the last diagnosis fell into: the asymmetry is real and it is not
    /// what produced this bug.)
    ///
    /// `.ambient`, and it was `.playback` for exactly one build. `.playback`
    /// is the category for audio that IS the point of the app, and it looked
    /// right — until build 13 on hardware showed what it costs in a WKWebView:
    /// the streaming <audio> beds register the game on the lock screen as a
    /// Now Playing card with transport controls, and the system's play button
    /// would resume the soundtrack OUTSIDE the app (the web layer's
    /// MediaSession handlers now decline that resume, but the card itself is
    /// unremovable while an element streams under `.playback`). A game
    /// masquerading as a music app on the lock screen is worse than any of
    /// `.ambient`'s costs, and the owner called the trade.
    ///
    /// What `.ambient` trades away, knowingly: it MIXES with other audio
    /// instead of interrupting it (a podcast keeps playing under the game —
    /// two soundtracks at once is now the player's choice to resolve), and
    /// the hardware Ring/Silent switch silences the game. Both are coherent
    /// here: the one-policy-for-both-mechanisms argument above survives the
    /// category swap intact, because `.ambient` also covers elements and Web
    /// Audio alike — mute obeys the switch everywhere or nowhere, which was
    /// the whole point. What it buys: no Now Playing registration, no remote
    /// controls, no lock-screen card.
    ///
    /// Errors are logged, never thrown. Same contract the web module keeps:
    /// audio is decoration, and a session the OS refuses to configure must
    /// leave the game running — worst case it degrades to exactly the
    /// behaviour of the build before this one.
    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.ambient, mode: .default)
        } catch {
            NSLog("[audio] AVAudioSession.setCategory(.ambient) failed: \(error.localizedDescription)")
            return
        }
        do {
            try session.setActive(true)
        } catch {
            // Activation is the half that can lose to something outside the app
            // (a call in progress at launch). The category is already set, so a
            // later activation — the system's own, when the first sound plays —
            // still gets .ambient.
            NSLog("[audio] AVAudioSession.setActive(true) failed: \(error.localizedDescription)")
        }
    }

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Before the WebView exists, so the first sound of the session — the
        // menu bed, which starts at first render — already plays into the
        // category we chose rather than into the one WKWebView would promote
        // for elements alone.
        configureAudioSession()
        return true
    }

    /// The session is re-activated on foreground, not only at launch, because an
    /// interruption the OS owns (a call, an alarm, Siri) DEACTIVATES it on the
    /// way out and does not hand it back by itself. Without this, "audio worked
    /// until I took a call" is a permanent state for the rest of the session and
    /// the web layer sees only a context that will not leave "interrupted".
    private func reactivateAudioSession() {
        let session = AVAudioSession.sharedInstance()
        // The CATEGORY is re-asserted too, not just activation: WKWebView is
        // the other writer of this session (promoting it for a playing
        // element is how the stock unconfigured app behaves at all), so a
        // category it swapped while we were backgrounded would otherwise
        // survive into the foreground session untouched.
        do {
            try session.setCategory(.ambient, mode: .default)
        } catch {
            NSLog("[audio] AVAudioSession re-setCategory(.ambient) failed: \(error.localizedDescription)")
        }
        do {
            try session.setActive(true)
        } catch {
            NSLog("[audio] AVAudioSession re-activation failed: \(error.localizedDescription)")
        }
    }

    /// The web layer cannot see a SCREEN LOCK on its own: WKWebView does not
    /// reliably fire `visibilitychange` when the screen locks with the app
    /// frontmost, so the audio module's suspend path (which unloads the music
    /// elements precisely so iOS has no media session to put on the lock
    /// screen) never ran for the one gesture that shows the lock screen.
    /// Observed on the iPhone X: the Now Playing card gone after app-switching
    /// (where visibilitychange fires) but still present after a plain lock.
    /// willResignActive is the notification iOS DOES send for a lock — and for
    /// calls, Control Center and the app switcher, all moments a game should
    /// go quiet anyway — so it is relayed into the page as a window event that
    /// lib/audio.ts pairs with its visibilitychange handling (both paths are
    /// idempotent, so the double fire on a normal backgrounding is free).
    private func notifyWebView(_ event: String) {
        (window?.rootViewController as? CAPBridgeViewController)?
            .bridge?.triggerWindowJSEvent(eventName: event)
    }

    private var bridgeWebView: WKWebView? {
        (window?.rootViewController as? CAPBridgeViewController)?.bridge?.webView
    }

    func applicationWillResignActive(_ application: UIApplication) {
        notifyWebView("native-resign-active")
        // The SYNCHRONOUS half, and the one that cannot lose the race. The
        // relay above goes through evaluateJavaScript, which is asynchronous —
        // on a plain screen lock the WebContent process can freeze before the
        // event is delivered, and build 16 showed exactly that: the web-side
        // parking is correct and the lock-screen card survived anyway.
        // Suspending the web view's media playback here runs entirely in
        // native code before the lock screen renders, which ends WebKit's
        // media session for the <audio> beds — the session the Now Playing
        // card is built from. Media only: Web Audio (the effects graph) is
        // not "media playback" and is suspended web-side by suspendAudio.
        if #available(iOS 15.0, *) {
            bridgeWebView?.setAllMediaPlaybackSuspended(true)
        }
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
        // Unsuspend FIRST: the web layer's resume handler below calls play()
        // on the beds it rebuilds, and a play() into a media-suspended web
        // view is silently dropped.
        if #available(iOS 15.0, *) {
            bridgeWebView?.setAllMediaPlaybackSuspended(false)
        }
        reactivateAudioSession()
        // After the session re-assert, so the beds the web layer rebuilds on
        // this event play into the re-configured session (see notifyWebView).
        notifyWebView("native-did-become-active")
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
