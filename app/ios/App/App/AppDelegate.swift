import UIKit
import AVFoundation
import Capacitor

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
    /// `.playback` is the category for audio that IS the point of the app, and
    /// it puts both mechanisms under one rule — the rule the soundtrack already
    /// follows today, so nothing a player has heard so far changes.
    ///
    /// mixWithOthers: NOT set, deliberately. The option would let a podcast or
    /// a music app keep playing underneath, which is the right choice for an
    /// app whose own audio is incidental. This one ships ~29MB of beds, scores
    /// each bay to its own track and drops the bed entirely under a stinger so
    /// the jingle lands into silence (playStinger's whole design). Two
    /// soundtracks at once is not a mix anyone chose, and the ducking that
    /// would make it bearable does not exist here. Plain `.playback` therefore
    /// INTERRUPTS other audio, which is the normal and expected behaviour for a
    /// game and what the player can undo by muting us in Settings or not
    /// launching us over their podcast.
    ///
    /// Errors are logged, never thrown. Same contract the web module keeps:
    /// audio is decoration, and a session the OS refuses to configure must
    /// leave the game running — worst case it degrades to exactly the
    /// behaviour of the build before this one.
    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .default)
        } catch {
            NSLog("[audio] AVAudioSession.setCategory(.playback) failed: \(error.localizedDescription)")
            return
        }
        do {
            try session.setActive(true)
        } catch {
            // Activation is the half that can lose to something outside the app
            // (a call in progress at launch). The category is already set, so a
            // later activation — the system's own, when the first sound plays —
            // still gets .playback.
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
        do {
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            NSLog("[audio] AVAudioSession re-activation failed: \(error.localizedDescription)")
        }
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
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
        reactivateAudioSession()
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
