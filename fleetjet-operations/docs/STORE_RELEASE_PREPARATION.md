# Rivo store release preparation — October 18, 2026

Status: buildable pilot; not approved for a broad public native launch. No Apple Developer or Play Console account exists yet. No payment, agreement acceptance, submission, reviewer account or public store link has been created.

## Owner enrollment

- Apple: https://developer.apple.com/programs/enroll/ — choose the real legal entity/account type. Organization enrollment requires legal authority and a D-U-N-S number. Individual enrollment displays the individual's legal seller name. Apple lists US$99/year, with regional pricing.
- Google: https://support.google.com/googleplay/android-developer/answer/6112435 — registration, identity verification, agreement and US$25 one-time fee. Choose the actual personal/organization status. New personal accounts have device verification and closed-testing requirements; do not promise instant production access. Current testing guidance: https://support.google.com/googleplay/android-developer/answer/14151465 (12 opted-in testers for 14 continuous days before applying for production).
- Owner must complete identity, legal agreements and payment. No credentials or government ID should be committed or shared in chat. Invite development access through each console once enrolled.

## Listing copy draft

Name: Rivo

Apple subtitle: Deliveries, trips and mileage

Google short description: Manage deliveries, record drives and review business mileage with your team.

Description:

Rivo brings delivery work and a private trip log into one driver app.

View assigned stops, open navigation, share location during active deliveries and record proof of completion. Enable Auto-track in Settings to record detected drives, then review each trip as personal or business. Submit selected business trips in a weekly mileage report.

Personal trip records stay private to your account. Dispatch sees submitted business reports and location shared during assigned active deliveries. Automatic recording requires your permission and may be interrupted by force-stop, revoked location permissions, weak GPS or phone battery restrictions. Review your records before using them for reimbursement.

A Rivo account is required. Team drivers use an invitation from their workspace. The app opens navigation in an external maps app. It does not guarantee tax eligibility or uninterrupted tracking.

Support: https://floraljet.llc/contact.html
Privacy: https://floraljet.llc/privacy.html
Deletion information: https://app.floraljet.llc/delete-account.html
Marketing: https://floraljet.llc

Copy is a draft. Confirm legal publisher/support identity and final app/package names in the consoles. Do not claim native background assignment push; APNs/FCM registration is not implemented.

## Build evidence

- iOS 0.1.6 (7), bundle `ca.rivo.mileage.pilot`, iOS 17+: signed development build installed on paired iPhone 16 Pro. Personal profile expires October 24, 2026. Release archive succeeded unsigned. Rebuild for paid-team distribution; do not upload a development IPA as a store release.
- Android 0.2.0 (2), min API 26, compile/target API 36, AGP 8.10.1, Gradle wrapper 8.11.1. Debug APK package `ca.rivo.mileage.pilot`; unsigned release AAB package `ca.rivo.mileage`. `assembleDebug`, `bundleRelease`, `lintRelease` pass. Configure upload key privately and Play App Signing after enrollment.
- Artifacts and SHA256 checksums: workspace `outputs/launch-2026-10-18/`; unsigned iOS archive is its sibling `RivoPilot-0.1.6.xcarchive`.
- Both apps currently display Rivo Pilot. Confirm final production display/bundle identifiers before reserving listings. Do not change installed pilot identity until distribution migration is planned.

## Data inventory for privacy labels and Data Safety — review required

| Data | Purpose and access | Draft disclosure |
| --- | --- | --- |
| Account name, email, phone, vehicle | Authentication, invitations, team operations | Collected, account linked; owner/assigned workspace access |
| Precise coordinates, timestamps, speed/accuracy, trip endpoints/distance | Consented trip detection, private mileage; active delivery location | Collected, account linked, functional use; private trips excluded from dispatch/public views |
| Submitted business mileage, purpose, report/rate | Team review and reimbursement records | Shared with workspace dispatcher after submission |
| Delivery/customer addresses, recipient/proof photos | Assigned delivery and proof workflow | Workspace/customer tracking access varies by record; review public-link scope |
| Session/device IDs and push subscriptions | Authentication, device selection, retry and web alerts | Collected for functionality/security; not advertising tracking |
| On-device GPS queue | Upload retry when disconnected | Device-local, driver scoped; inspect sign-out/reinstall/device backup behavior on hardware |

No advertising SDK was added. Native privacy manifest declares no tracking. Full web/runtime/provider inventory must be reviewed before checking store form answers. Do not mark "no data collected" because the native app hosts an authenticated web interface. Distinguish platform meanings of collected/shared/linked/tracking; location is transmitted to Rivo servers when enabled. Do not claim a storage/deletion retention period until the operator can honor it.

## Review notes draft

1. Provide isolated reviewer owner and driver credentials/invitation privately in each console, with synthetic orders. Never use production customer records or commit reviewer passwords. These accounts have not been created yet.
2. Open Settings with the native gear. Auto-track is initially off; read the all-drive disclosure. iPhone requires Always + Precise Location. Android uses a visible foreground location notification and no background-location permission. Tracking must only start after consent.
3. Drive detection records a private unclassified trip. The reviewer selects Business or Personal. Only selected business reports go to dispatch. Offline GPS is queued; replay must not duplicate trips.
4. Active delivery location is shared only during assigned active work with consent. Proof and completion use the hosted authenticated workflow. Explain actual background-location use in the platform permission/service declarations, with genuine capture video after hardware testing.
5. Settings includes Request account deletion, current-password confirmation and a durable request reference. This initiates manual processing; it does not immediately remove the account. Web instructions are linked above. Do not present this as completed compliance until fulfillment is implemented/rehearsed and monitored.

## Required acceptance gates

- Enroll both store accounts; configure distribution/upload signing, app access and actual listing records.
- Rehearse deletion fulfillment on synthetic owner/driver accounts: revoke sessions/invitations/API keys; stop capture; delete account profile, private GPS and local queue; cover normalized projections, media, directory lookups, connected providers and backups. Establish supported retention exceptions, processing period, customer confirmation and operator monitoring. Current request initiation alone does not close this gate. Never use a real account as the destructive test fixture.
- Test a measured locked-screen drive, stationary stop, offline segment, reconnection/replay, battery use and odometer comparison on iPhone and Android. No Android device is currently connected. Test pause/sign-out/account switch/permissions, WebView photo upload and CSV export.
- Run the real pilot store's order import -> dispatch -> driver -> proof -> completion flow with an agreed test order; verify invitation email and configured assignment-alert delivery. Local validators do not verify provider credentials.
- Choose notification scope for launch. Existing web push/in-app alerts are implemented; native APNs/FCM background assignment delivery is not. Implement/test it before promising that behavior.
- Capture real store screenshots, final privacy/Data Safety declarations, permission/service declarations, reviewer access, age/content questionnaires and store review. No fabricated screenshots, metrics or reviewers.

## Pending deletion queue operations

Requests are stored in the workspace's `delivery_tracker_state_v1.payload_json.accountDeletionRequests`. The authenticated endpoint `/api/account/deletion-request` returns only the caller's pending reference; it accepts no target user/workspace. It reauthenticates the current password and rate limits failures. No password is stored. Pending requests are idempotent.

There is currently no central cross-workspace queue dashboard, automatic privacy-operator notification, deletion processor or completion email. The operator must implement a supported monitoring/fulfillment path before store submission. Do not silently mark requests complete or advertise automatic erasure. Until then retain the explicit launch blocker and process any real request through a verified, scoped privacy operation.
