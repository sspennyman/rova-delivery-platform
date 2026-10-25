# Automatic mileage and weekly reports — 2026-09-26

## Web implementation

- Separate private mileage ledger; existing delivery/payroll histories are unchanged.
- Driver opt-in, selected-device tracking, automatic drive start (about 150 m of driving movement), automatic stop after 3 stationary minutes, and pause/logout handling.
- Browser foreground GPS with IndexedDB offline queue. Server sequence acknowledgements prevent duplicate distance on retry. Browser capture is not reliable with the screen locked or another app foregrounded.
- GPS accuracy and jump filtering; missing-signal gaps are flagged and not bridged with invented distance. Short or missed drives can be entered manually and clearly marked as such.
- Business/personal review, route descriptions and business purpose; distance corrections retain original GPS distance and an audit record.
- Driver weekly business report submission, withdrawal before approval, dispatcher approval/return, and immutable report snapshots. Personal records are excluded from dispatcher snapshots and operational backups.
- Weekly/yearly personal CSV exports and business-only submitted-report exports, with spreadsheet formula protection. Driver UI shows the most recent 95 days; annual exports include all retained records.
- Fixed report timezone: America/Toronto. Annual vehicle odometer readings must still be retained separately. Mileage classification does not determine tax eligibility or create payroll payments.

## Validation performed

- `scripts/validate-site.mjs`: existing account/invitation/PBKDF2, authorization, delivery, export and deployment-bundle regression checks, plus authenticated mileage persistence and private-backup checks.
- `scripts/validate-tracking.mjs`: existing GPS timeout, reload, pause, permission, identity, completion and freshness checks.
- `scripts/validate-mileage.mjs`: automatic start/stop, movement distance, idempotent replay, gap handling, primary-device guard, driver isolation, private report sharing, classification gate, approval locks, manual records/corrections, CSV escaping and local-week boundaries.
- `scripts/validate-mileage-ui.mjs`: generated HTML balance, escaping, classification actions, report gating and browser-limit disclosure.
- JavaScript syntax checks and `git diff --check`.

## Not yet verified / not release-ready claims

- Browser preview permission was denied; no visual or interactive browser verification was performed in this turn.
- Android source is under `android/`. SDK license approval is pending. It has not been compiled, linted, installed or tested on Adila's phone.
- No production driver or trip data was seeded for testing. No real driver location was captured.
- Android signing, distribution, a measured real-phone drive with locked-screen/navigation/offline tests, and WebView camera/exports remain release gates.
- The public browser app cannot be described as equivalent to Driversnote's native background tracker.

## Driver instructions for the web version

Open **Today → Enable browser tracking**, read the disclosure and allow location. Keep Rivo open while driving. In **Trips**, classify each drive and add place names/purpose for business mileage. In **Report**, select a week and submit business mileage. Use the Android companion only after its pilot build and real-phone checks are complete.
