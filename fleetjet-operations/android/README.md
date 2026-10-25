# Rivo Android mileage companion — pilot source

This companion uses the existing Rivo driver account and web interface, with a native Android foreground location service and a private SQLite upload queue. No API key or embedded password is required.

## Build status

Verified October 18, 2026: **assembleDebug, bundleRelease and lintRelease passed** for 0.2.0 (2). The APK is debug-signed; the release AAB is unsigned. No Android device was connected, so installation, background GPS and device acceptance remain unverified. These artifacts are not published in Google Play.

## Build prerequisites

- JDK 17, Gradle 8.11.1 (wrapper pinned with SHA256), Android SDK platform 36 and build tools required by AGP 8.10.1.
- `compileSdk` and `targetSdk` are 36. Minimum Android is 8/API 26.
- From the app root, set `JAVA_HOME`, `ANDROID_HOME`, and `RIVO_ANDROID_BUILD_ROOT` to an absolute temporary build directory, then run:

```sh
android/gradlew -p android -I ../scripts/android-build-local.gradle :app:assembleDebug :app:bundleRelease :app:lintRelease --no-daemon
```

- Debug package: `ca.rivo.mileage.pilot`. Release package: `ca.rivo.mileage`. Upload/production signing keys must be managed separately, never committed. No release signing configuration exists yet.

## Driver experience

1. Install the tested pilot APK when available; a browser home-screen shortcut is not this companion.
2. Sign into the existing driver account.
3. Open the gear **Settings**, turn on **Auto-track**, read the disclosure, and enable precise location and notifications.
4. Leave the foreground tracking notification running. Subsequent signed-in sessions resume only for the previously consented driver and selected device.
5. Drives appear in **Trips** after driving is detected. Classify business or personal, review the route endpoints and purpose, then submit business mileage in **Report**.

The visible notification can pause capture at any time. Signing out stops capture. Network outages queue GPS fixes on-device; records are sent only under the matching driver's authenticated session. Expired or revoked sessions stop capture. Only one device is selected per driver to avoid double-counting.

## Important boundaries

- Not a stealth tracker. The driver must consent and see the tracking notification.
- A foreground location service can run while the screen is locked, but OEM battery restrictions, force-stop, reboot, permission revocation, weak GPS, or service termination can still interrupt capture. This version does not silently restart after reboot; reopen the app before driving.
- No background-location permission, boot receiver, Google Play Services SDK, or third-party tracking SDK is included.
- WebView has no JavaScript-to-native bridge. Native requests use the existing secure session cookie and a fixed HTTPS origin. Cleartext traffic and third-party cookies are disabled; external navigation opens outside the app.
- Private GPS records are separate from delivery payroll. Only submitted business mileage reaches dispatcher reports. Fresh GPS also updates an assigned active delivery's live map, as disclosed before consent.
- GPS alone is not a guarantee of tax eligibility or a complete odometer log. Keep annual odometer readings and review missing/short trips.

## Release gate: real Android test required

Use a consenting test driver and clearly labelled test records:

- Enable tracking, drive a measured route with the screen locked for 15+ minutes, park for 3+ minutes, then drive again. Verify two trips and compare odometer distance.
- Repeat with Google Maps in the foreground; check dispatcher live location freshness.
- Disconnect networking during a trip, reconnect and verify exactly-once upload and no GPS distance bridging across a missing signal.
- Pause from the notification; confirm recording stops immediately. Resume explicitly.
- Sign out, change accounts, expire the session, and revoke precise location. Verify no other driver's records or post-sign-out capture.
- Reboot/force-stop and verify the UI does not claim recording until reopened and its notification is running.
- Classify personal and business trips; verify personal destinations cannot be read by dispatch, public tracking, another driver, or operational backup.
- Submit, export, return, correct, resubmit, and approve a weekly report.
- Verify photo picker/proof upload and CSV file saving in the actual Android WebView.

Do not call this release-ready until the build, lint, device checks, signing, and distribution steps pass.
