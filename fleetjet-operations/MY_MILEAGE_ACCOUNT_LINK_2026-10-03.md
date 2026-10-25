# Dispatcher-owned mileage

The dispatcher login keeps its role and gains a server-linked, independent driver profile through **My Mileage** (`/my-mileage`). The profile can receive delivery assignments without requiring a second password or sending an invitation.

## Safety boundaries

- Identity is bound to the authenticated login identifier on the server. Client-supplied driver IDs, editable display names and driver emails do not establish ownership.
- Existing sessions without that verified identity must sign out and sign in once before enrollment.
- The personal mileage API resolves only the current account's profile. The staff mileage API and shared snapshots contain submitted business reports, never personal or unsubmitted trips.
- Enrollment is idempotent. Existing email collisions and archived profiles fail closed rather than automatically claiming or replacing a driver.
- Tracking starts disabled. A vehicle and CAD/km rate may be left unset, but a saved rate is required for report submission. Report amounts snapshot the agreed rate.
- Driver-editor changes cannot create a password or invitation for a linked dispatcher profile.

## iPhone build

Rivo Pilot 0.1.1 (2) supports this linked identity, opens My Mileage, and uses the owner-scoped native endpoints. The user must still explicitly enable all-trip recording and grant Always + Precise Location. Existing driver accounts remain supported.

## Validation

`scripts/validate-my-mileage.mjs` covers authentication, stable linking, idempotency, cross-account isolation, exports, private vs submitted reports, explicit native consent, rates, archived profiles and legacy sessions. Existing site, mileage, UI and iOS companion suites remain required. Swift and a signed device build are distinct checks from a physical locked-screen drive.

No production driver enrollment or physical driving verification is claimed by this source change; those require authenticated live-account and real-device evidence.
