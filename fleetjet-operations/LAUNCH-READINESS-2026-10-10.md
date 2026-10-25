# Rivo release audit — October 10, 2026

## Scope and result

Existing single-business production workspace at https://app.floraljet.llc/.
This is a controlled-pilot release, not a verified public native-app launch.
No production orders, proof, mileage, credentials, or driver records were deleted.
Owner Chrome session worked; no password reset was performed.

## Implemented fixes

- Dispatcher polling no longer rebuilds the entire screen every four seconds when data is unchanged. Open menus and unsaved order edits defer background redraws.
- Recognized Wix carrier shipments and already-fulfilled, unstarted imports are held under Pickups & other instead of inflating local driver routes. A dispatcher can explicitly choose delivery. Pickup method wins; missing delivery details are not inferred from POS or billing addresses.
- Existing active/completed delivery work and recorded proof/mileage retain their meaning. Wix fulfillment is not invented proof of delivery.
- Cross-origin browser writes are rejected; native clients remain compatible. JSON requests are bounded to 1 MiB. Authenticated API responses are not cached; unexpected server failures no longer expose internal error details.
- Settings distinguish configured services from verified end-to-end functionality.
- Native Android builds now use an isolated output directory to avoid iCloud duplicate DEX artifacts.

## Checks performed

- All 16 web regression suites passed against rebuilt source, including auth, route preview/workbench, Wix fulfillment, driver navigation, tracking, mileage/privacy, reports, assignment alerts, auto-completion, trip maps, and request hardening.
- Local browser sign-in, mobile navigation, empty-map fallback, and order-entry screen checked. These do not certify real GPS or customer delivery.
- iOS: 50 core checks and 17 XCTest tests passed. Signed device build succeeded and was installed on the paired iPhone. Launch was blocked because the phone was locked. The renewed Personal Team provisioning profile expires October 17, 2026 at 23:28:18 UTC; this is temporary local distribution, not App Store/TestFlight.
- Android: assemble, 15 unit tests, and lint succeeded. Lint reports one WebView JavaScript warning and no errors. APK signature verified. No Android device drive test was performed.
- Production Google map loaded before release. The existing queue wrongly offered a 970.9 km route containing carrier and fulfilled orders; the new fulfillment guard addresses its cause.
- Production environment has separate Google browser/server keys, encrypted integrations, Wix credentials, D1 and R2 bindings. The bounded worker-log sample showed no server 500s; it is not a complete historical error audit.

## Required before a broader paid launch

1. iPhone and Android each need a consenting real drive with the screen locked: measured distance, fresh dispatcher location, automatic stop/start, later trip classification, offline recovery, weekly report submission, and camera proof upload. Never label simulated tests as this verification.
2. Production automatic invitation email is not configured: RESEND_API_KEY and INVITE_FROM_EMAIL are absent. Manual invite links remain available. Configure a verified sender and confirm receipt before promising automatic invitations.
3. Native APNs/FCM assignment push is not implemented; browser Web Push and in-app alerts are not equivalent to verified locked-screen native notifications.
4. Public iPhone distribution requires the user's Apple Developer setup; the current Personal Team profile expires. Android APK is a pilot artifact, not a Play Store release.
5. Current runtime is a Cloudflare Worker with D1 operational storage and R2 proof media through Sites. This is one business workspace, not verified self-service multi-tenant onboarding. Separate clients need isolated workspaces; do not mix them into the existing driver's business data.
6. Billing is manual reviewed invoicing. No automated subscription charging was verified.

Year mileage CSV export exists; the default private-trip screen shows a 95-day window, while reports and annual exports use retained records. This audit is not a determination that records satisfy any individual's tax claim.

## Android pilot artifact

SHA-256: a6305d8fd37fb51066e5ada0ebd21ba0a4ae9ed63b818bf0f60026b53d5f87d9

Keep Driversnote running until both native devices pass the locked-screen comparison. No missing historical trips were fabricated or reconstructed from guesses.
