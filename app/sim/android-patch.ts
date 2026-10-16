import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

type Check = (name: string, condition: boolean) => void;

export function checkAndroidPaywallPatch(check: Check): void {
  const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const fixture = fs.mkdtempSync(path.join(tmpdir(), "tetrilaunch-android-patch-"));
  const mainDir = path.join(fixture, "android", "app", "src", "main");
  const manifestPath = path.join(mainDir, "AndroidManifest.xml");
  const activityName = "com.revenuecat.purchases.ui.revenuecatui.activity.PaywallActivity";
  const existingEntries = `        <activity android:name=".MainActivity" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
        <activity android:name="${activityName}Preview" android:screenOrientation="portrait" />
        <provider android:name="androidx.core.content.FileProvider" android:exported="false">
            <meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/file_paths" />
        </provider>`;
  const patch = () => execFileSync(process.execPath, [path.join(fixture, "scripts", "patch-android.mjs")], {
    encoding: "utf8",
  });

  try {
    fs.mkdirSync(path.join(fixture, "scripts"));
    fs.copyFileSync(path.join(appDir, "scripts", "patch-android.mjs"), path.join(fixture, "scripts", "patch-android.mjs"));
    fs.cpSync(path.join(appDir, "native", "android"), path.join(fixture, "native", "android"), { recursive: true });
    fs.mkdirSync(path.join(mainDir, "res", "values"), { recursive: true });
    fs.writeFileSync(path.join(mainDir, "res", "values", "styles.xml"), `<resources>
    <style name="AppTheme.NoActionBar" parent="Theme.AppCompat.NoActionBar"></style>
    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen"></style>
</resources>`);
    fs.writeFileSync(path.join(fixture, "android", "app", "build.gradle"), "apply from: 'capacitor.build.gradle'\n");

    const cases = [
      { name: "fresh manifest", activity: "" },
      {
        name: "existing self-closing activity",
        activity: `        <activity android:exported="false"
            android:name="${activityName}" android:theme="@style/CustomPaywallTheme" />`,
      },
      {
        name: "existing activity with orientation and children",
        activity: `        <activity android:name='${activityName}' android:screenOrientation='portrait' android:exported='false'>
            <meta-data android:name="paywall-metadata" android:value="keep-me" />
        </activity>`,
      },
    ];

    for (const { name, activity } of cases) {
      fs.writeFileSync(manifestPath, `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <application android:allowBackup="true" android:label="@string/app_name">
${existingEntries}
${activity}
    </application>
</manifest>\n`);
      patch();
      const manifest = fs.readFileSync(manifestPath, "utf8");
      const application = manifest.match(/<application\b[^>]*>([\s\S]*?)<\/application>/)?.[1] ?? "";
      const paywalls = (application.match(/<activity\b[^>]*>/g) ?? []).filter((tag) =>
        tag.match(/\bandroid:name\s*=\s*(["'])(.*?)\1/)?.[2] === activityName);
      check(`${name}: exactly one RevenueCat paywall activity is inside the application`, paywalls.length === 1);
      check(`${name}: the paywall follows the underlying game's orientation`,
        /\bandroid:screenOrientation=["']behind["']/.test(paywalls[0] ?? ""));
      check(`${name}: other activities, intent filters and provider metadata survive`, manifest.includes(existingEntries));
      check(`${name}: application attributes and permissions survive`,
        manifest.includes('android:label="@string/app_name"')
          && manifest.includes('<uses-permission android:name="android.permission.INTERNET" />'));
      check(`${name}: backup exclusions still apply`,
        manifest.includes('android:fullBackupContent="@xml/backup_rules"')
          && manifest.includes('android:dataExtractionRules="@xml/data_extraction_rules"'));
      if (activity) {
        check(`${name}: existing paywall attributes survive`, /android:exported=["']false["']/.test(paywalls[0] ?? ""));
        check(`${name}: existing paywall theme or children survive`,
          name === "existing self-closing activity"
            ? manifest.includes('android:theme="@style/CustomPaywallTheme"')
            : manifest.includes('<meta-data android:name="paywall-metadata" android:value="keep-me" />'));
      }

      const modifiedAt = fs.statSync(manifestPath, { bigint: true }).mtimeNs;
      const repeatOutput = patch();
      check(`${name}: repeating the patch leaves identical manifest bytes`, fs.readFileSync(manifestPath, "utf8") === manifest);
      check(`${name}: repeating the patch does not rewrite the manifest`,
        fs.statSync(manifestPath, { bigint: true }).mtimeNs === modifiedAt);
      check(`${name}: the complete patch reports already applied`, repeatOutput.includes("patch-android: already applied"));
    }
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkAndroidPaywallPatch((name, condition) => assert.ok(condition, name));
  console.log("Android paywall manifest patch checks passed.");
}
