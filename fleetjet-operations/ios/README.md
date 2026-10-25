# Rivo iPhone companion — local development

Status, October 18, 2026: **Rivo Pilot 0.1.6 (7) built, development-signed and installed on the paired iPhone 16 Pro.** The signed team is `9Q36V45P7R`; the earlier signing failure used the certificate identifier as a team ID. Personal provisioning expires October 24, 2026. The Release archive also builds unsigned. No paid Apple Developer account, TestFlight release or App Store submission exists. A measured locked-screen/offline drive remains required.

The animated native mark respects reduced motion; a 1024px app icon is included. Auto-track is in native Settings, with a compact status in the header. Previous read-only phone checks saw Always/Precise permissions and GPS fixes; these observations do not prove odometer accuracy or uninterrupted background tracking.

## What is implemented

- A SwiftUI iPhone shell with the existing Rivo driver sign-in, Trips, Report and Deliveries screens inside a restricted WKWebView.
- A compact native status bar and tracking settings. Background capture begins only after explicit all-trip consent and Always + Precise Location permission. Pause stops local recording immediately, including offline.
- Core Location standard updates, automotive activity, background-location mode and a visible system location indicator. Significant-change monitoring requests system wake-ups; restoration verifies the existing account and consent before restarting GPS.
- Persistent, driver-scoped SQLite queue with file protection, a 50,000-point capacity, bounded uploads, monotonic replay-safe sequence numbers and acknowledgement validation. Storage failures stop capture rather than silently discarding new records.
- Existing secure web-session cookie is verified through `/api/me`. Logout/account changes, expired sessions, device conflicts and revoked permissions stop recording. Consent is stored in a device-only Keychain item; no credentials are added to JavaScript, project settings or source files.
- The local backend recognizes `source: "ios"`. Driving/stops feed the existing automatic trip detector. Personal/business selection and weekly reporting reuse the existing private mileage ledger; submitted business reports retain the driver CAD/km rate and reimbursement amount.
- Native confirmation dialogs and CSV download/share support for the existing driver workflows.
- One restricted main-frame `signOut` command stops capture and clears the session cookie even when the web logout fails offline. This command cannot enable GPS, read private points or retrieve credentials.

The interface uses native controls, labelled touch targets and a separate settings sheet. Simulator rendering was checked previously. VoiceOver and large Dynamic Type acceptance remain outstanding.

## Compatibility gate — do not skip

The app points only to `https://app.floraljet.llc`. This source release includes these required web changes:

- `worker/mileage.js`: accept the iOS recording source.
- `public/mileage.js`: identify `RivoIOS/`, avoid browser/native double mileage capture, and show platform-specific settings.
- `public/app.js`: notify the native recorder of logout before making a potentially offline server request.

Native Enable intentionally refuses to record if the server does not confirm the `ios` source. Confirm a successful deployment of this source before enabling the pilot against production. The deployed web release must include native source recognition and logout protection; verify its live version before testing.

## Local checks

From the application root:

```sh
bash ios/Checks/check-core.sh
node scripts/validate-ios-companion.mjs
node scripts/validate-mileage.mjs
node scripts/validate-mileage-ui.mjs
bash scripts/build.sh
node scripts/validate-site.mjs
node scripts/validate-tracking.mjs
node scripts/validate-route-preview.mjs
node scripts/validate-driver-navigation.mjs
xcrun swiftc -frontend -parse ios/App/*.swift
plutil -lint ios/App/Info.plist ios/App/PrivacyInfo.xcprivacy ios/RivoMileage.xcodeproj/project.pbxproj
```

The core check compiles and executes the Foundation/CryptoKit/SQLite code on this Mac. The integration check uses fake accounts and simulated GPS in memory. Neither accesses a real account or proves physical GPS, iOS lifecycle, battery life, phone permissions, camera or email delivery.

Reverified on October 3: 47 compiled core checks passed; the iPhone integration, mileage, mileage UI, rebuilt Sites bundle, authenticated Sites regression, driver navigation, tracking and route-preview checks passed. The actual iOS device target built successfully unsigned; 17 XCTest tests passed. Tests use fresh isolated databases and simulated points, not production driver records.

`ios/Package.swift` also contains XCTest tests for use with a suitable Xcode toolchain. The standalone core checks do not require XCTest.

## Distribution and device setup

The shared scheme is `RivoMileage`; iPhone/iOS 17+, bundle identifier `ca.rivo.mileage.pilot`. The current development-signed app is installed. Rebuild with the enrolled team's distribution credentials after owner enrollment; personal provisioning is temporary.

```sh
xcodebuild -project ios/RivoMileage.xcodeproj -scheme RivoMileage \
  -destination 'generic/platform=iOS' -derivedDataPath /tmp/rivo-launch-phone \
  DEVELOPMENT_TEAM=9Q36V45P7R -allowProvisioningUpdates build
```

The unsigned archive at `outputs/RivoPilot-0.1.6.xcarchive` is build evidence, not a store-upload package. Review native and hosted-app data disclosures together before submitting. The code currently supports web push and in-app assignment alerts, not native APNs/FCM registration.

## Required real-iPhone acceptance test

Use a consenting test driver, retain an independent odometer/mileage log, and have a passenger handle any testing during travel.

1. Enable auto-track; verify the permission/status UI and fresh GPS. No Start Trip button should be necessary.
2. Drive with the phone locked and Rivo backgrounded for at least 15 minutes. Stop for at least 3 minutes, then take a second drive. Verify two correctly timed records against the reference log, including start/end points and distance.
3. Repeat with a period of no connectivity. Reconnect; verify saved points upload once, distance does not double and old GPS does not appear as a current delivery location.
4. Pause offline, relaunch, then reconnect. Confirm capture stays paused, queued fixes sync before the server is paused, and no later private movement is added.
5. Test location revocation, approximate location, expired/revoked login, logout, account switching and moving tracking to a second phone. No new capture or cross-account upload is permitted after those states are observed.
6. Test system termination/relaunch, force-quit and reboot separately. Never label a simulated system restart as force-quit recovery. Verify the warning and reopening path; log any missed interval honestly.
7. Mark trips Business or Personal in bulk; submit the week. Check report totals and CAD/km rate. Verify personal records remain invisible to dispatch; download/share the business CSV manually.
8. Check camera upload, delivery confirmation, navigation links, VoiceOver, large text, small-screen layout, denied permissions and connection failures. Check battery use on a realistic working day before any battery-life claim.

## Deliberate limitations

- iOS background execution is controlled by the operating system. **Force-quitting is not supported as a tracking state**; reopen Rivo afterward. A browser shortcut is not the native app.
- Cold restoration currently needs an online identity check. Offline capture continues only for an already verified, enabled session in the running process. Do not promise offline reboot recovery.
- Continuous GPS with automatic pausing disabled prioritizes capture and stop detection over battery savings. Battery use is unmeasured; motion-adaptive power optimization is not implemented.
- Server login lifetime is currently 14 days. This companion respects expiry; it does not invent a permanent credential or silently bypass reauthentication.
- Existing detector thresholds apply: roughly 150 m movement to confirm a drive, 3 minutes stopped to finish, and a 5-minute GPS gap that splits/flags incomplete records. Short drives, poor signal and intervals without fixes may be missing. Missing historical mileage cannot be reconstructed as real GPS.
- The queue holds about 4.6 days at one accepted fix per 8 seconds; the server accepts replay up to 14 days old. There is no silent unlimited offline retention promise.

References: [Apple background-location guidance](https://developer.apple.com/documentation/corelocation/handling-location-updates-in-the-background), [automatic-pausing behavior](https://developer.apple.com/documentation/corelocation/cllocationmanager/pauseslocationupdatesautomatically).
