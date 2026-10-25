# Rivo launch readiness — October 17, 2026

## Verified in this release

- iPhone Rivo Pilot 0.1.5 (6) signed and installed on the paired iPhone 16 Pro.
- The actual phone shows Auto-track enabled, Always Location, Precise Location on, and recent GPS fixes. The signed-in private mileage log contains saved trips. This observation does not establish odometer accuracy or uninterrupted background operation.
- Native app settings show connection, GPS receipt and pending upload diagnostics. Native SMS links open the messaging app; the web view starts with the dark background.
- Mobile route, mileage, report and settings layouts use touch-sized controls. Duplicate route headings and nested padding are reduced. Driver navigation uses recognizable icons. Native drivers use native Auto-track rather than starting a second browser recorder.
- A stale workspace cookie no longer blocks signing in to a different valid workspace.
- Versioned API supports scoped, expiring, revocable keys; order creation and duplicate replay; queued-order edits; delivery-status reads; minimal driver roster reads. Personal mileage and authentication material are excluded. API access is not gated by subscription tier.
- API guide is available at /api-guide.html. Generic HTTP steps in automation tools can use the API; dedicated marketplace apps and outgoing webhooks are not implemented.

## Evidence

- Native core: 18 Swift tests passed; signed Xcode device build passed.
- Focused validators: public API, launch hardening, self-serve signup/invite/dispatch/proof/completion, native companion protocol, mileage, mileage UI, driver navigation, dispatch workspace and trip maps.
- Browser workflow: synthetic driver signed in, read assigned route, entered recipient, completed delivery and advanced to next stop. No production delivery records changed by this QA.
- Read-only physical-phone inspection confirmed the installed app and location settings. Existing tracking consent was preserved.

## Still required before broad public mobile launch

1. Durable iOS distribution. The current account uses development provisioning; signing renewal and TestFlight/App Store distribution must be distinguished from local installation. Do not advertise an App Store release until approved and available.
2. Physical drive acceptance: lock the screen, drive a known route, include a stop and an offline segment, reopen, verify all queued fixes upload, compare mileage to the odometer, and review battery use. Automated tests do not replace this.
3. Android device acceptance has not been run in this release.
4. Verify the selected pilot workspace's real store credentials, invitation email delivery, push configuration and proof media with its operator. Test fixtures prove the code path, not each external provider's live credentials.

Launch scope: controlled pilot, with these limits disclosed. Broad public native launch is not yet verified.

## Interaction polish follow-up

- Fixed light-on-light hover on expandable management rows; retained dark colors in open and keyboard-focus states.
- Added semantic hover feedback and consistent selected/disabled states.
- Tools menus dismiss on Escape (returning focus) or outside click; on small screens they expand inline rather than falling outside the viewport.
- Native iPhone Auto-track switch moved into Settings; main screen has a compact tracking status and settings button. A warning state remains visible for capture/permission/GPS issues. Duplicate web tracking card removed only in the native iPhone app. Existing consent, privacy boundaries, and recording behavior are retained.
- Local browser QA used synthetic records: reproduced and corrected management-row hover, verified menu click/Escape/focus/outside behavior, and checked mobile menu bounds at 390 and 320 requested viewport widths (CSS widths 355 and 291 at browser zoom).
- Signed iPhone build and 18 native core tests pass. Mileage UI, driver navigation, dispatch workspace and native companion validators pass.

## October 18 release check — corrected signing and Android evidence

- Android source is present. AGP 8.10.1 / Gradle 8.11.1, API 36 builds pass: debug APK, unsigned release AAB and release lint. No physical Android device connected; no Android drive acceptance.
- The previous iOS signing error used the certificate identifier as the team ID. Correct team `9Q36V45P7R` builds and signs successfully. Pilot 0.1.6 (7), with animated logo, Settings tracking control and icon, installed successfully on the paired iPhone. Development provisioning expires October 24, 2026. Unsigned Release archive also builds.
- Neither paid Apple Developer nor Google Play Console accounts exist, confirmed by the owner October 18. No store submission has occurred.
- Signup/invitation/dispatch/proof/completion, tenant privacy, launch-hardening, public API and assignment-alert synthetic integration checks pass. These do not verify live provider email/push or a real store order.
- Native Android now has the compact animated logo/status and Settings Auto-track control. Both native shells hide the duplicate web tracking card and browser pause control.
- Account deletion initiation now records reauthenticated, tenant-scoped, idempotent pending requests. It does **not** delete data. Manual fulfillment, retention decisions, operator monitoring and an end-to-end deletion rehearsal remain store-launch gates.
- Store metadata/review/privacy drafts and exact artifact signing status are in `STORE_RELEASE_PREPARATION.md`. Native APNs/FCM assignment notifications remain unimplemented.

## Latest launch decision, October 18

- Marketing version 49 and Operations version 91 are active. Both production pages return HTTP 200, and `/api/health` returns `ok: true`.
- The website's interactive tour and full demo now use the app's typography, dark panels and controls. Browser checks covered tour steps, sample mileage classification, full-demo order actions and phone-width layouts.
- Ready for demonstrations and a controlled pilot with the known limits. Broad public mobile launch remains unverified until native distribution, measured background/offline driving and the real business's order-to-completion flow, invitations and notification delivery are accepted.
