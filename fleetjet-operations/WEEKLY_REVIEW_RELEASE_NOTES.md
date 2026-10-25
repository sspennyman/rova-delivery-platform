# Weekly mileage review repair — September 30, 2026

## Changed

- Review a Monday–Sunday week in one workspace with selection, bulk business/personal classification, a shared business purpose, and submission.
- Carry recorded GPS endpoints into reports; editing human-readable place names is optional. Coordinates are explicitly labelled GPS, not reverse-geocoded addresses.
- Distinguish routine classification from actual GPS gaps/corrections. Dropped individual low-quality fixes alone no longer force a warning on every drive; real discontinuities remain flagged.
- Save the driver's configured CAD/km rate and rounded per-trip/total reimbursement in each new report. Historical reports without a saved rate are not retroactively priced. The CSV includes rate, reimbursement, driver, week and totals.
- Preserve private personal trips, submitted-report locks, batch ownership checks and correction audit trails. No report approval generates a payment.
- Change completed delivery status from “Needs review” to “Completed”; keep delivery payment records separate from automatic mileage.
- Fix Google route markers for address-based routes using route-leg coordinates, preserve draft stop order, reject oversized previews instead of silently truncating, and ignore obsolete route responses.
- Refresh app-cache version to 52.

## Verification

Passed: full Sites worker integration suite, tracking regressions, automatic mileage/replay/privacy tests, new weekly bulk-review and rate/CSV tests, UI markup/state tests, and Google marker regression tests. No production trip, category, report, rate or payment record was changed during testing.

## Remaining real-device verification

Background recording requires the native tracking companion with location permission and its ongoing service enabled. A browser/PWA cannot reliably record with the screen locked. The Android pilot exists locally; installation on Adila's device is unverified. Full Xcode/signing and physical iPhone tests remain outstanding. Browser session was signed out, so authenticated visual QA and Adila's private mileage ledger were not accessible this turn.

This release does not recover GPS data that was never recorded, assume all driving is business, or certify tax deductibility.

## Driver workspace follow-up — September 30, 2026

- Make Trips, Report, Deliveries and Settings real separate screens rather than anchor links on one long page. Trips is the default. The delivery map loads only on its screen and retains the current assigned route.
- Put tracking health, weekly totals and classification first. Reduce card borders, spacing and competing headings, and keep delivery/payment records collapsed separately.
- Add a private saved business purpose for one-tap routine Business classification, including bulk selection. Choosing a preference does not categorize any trip. Real unacknowledged GPS warnings still open review.
- Show stale GPS after two minutes instead of retaining a false connected message. Reject stale/inaccurate browser fixes before showing a valid current location. Distinguish native tracking from a website shortcut and browser-only tracking.
- Add tracking-source/last-GPS diagnostics, an explicit pause control and realistic setup limitations in Settings. No driver tracking is enabled without consent.
- Add regression tests for separate panels, the correct current delivery map, private preferences, one-tap classification and stale GPS. Refresh app-cache version to 53.

The existing Android pilot has not been rebuilt by this web release. Installation and a screen-locked physical drive remain unverified; iPhone native background tracking remains unfinished. The change does not establish that every trip has been captured on a real phone.
