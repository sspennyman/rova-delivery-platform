# Rivo dispatch redesign — 2026-10-04

## What changed

Rivo's default dispatch screen is now a task workspace rather than a customizable widget board. Orders and active work occupy the main column; the route plan, bounded map and driver visibility occupy the side column. History and mileage remain separate. The existing My layout view still preserves device-local customization.

- Select several queued orders, review their numbered stops, optimize with Google or reorder by drag and accessible up/down buttons, choose the driver and send the exact reviewed order.
- Route planning uses a new authenticated, read-only endpoint. It does not assign, start or modify deliveries. Invalid Google waypoint orders fall back without losing stops. Unavailable optimization is labelled explicitly.
- Appending work to an active driver previews from the last assigned stop and returns to the depot. Dispatch no longer silently re-optimizes a manually reviewed order.
- Driver rows distinguish fresh GPS, last seen and no GPS. They do not pretend a driver is visible when there are no fixes.
- Import, rates and less common batch actions are secondary controls. The map is bounded and remains in normal page flow; it can be hidden.
- Drivers with assigned work open to Today's route. The next destination and Navigate are prominent, proof/outcome entry and remaining route are expandable. Drivers without assigned work open to Trips. Business/personal classification and weekly mileage reports are preserved.
- The supplied per-km dispatch rate is validated and an explicit zero is retained. No database migration, account reset, driver modification or production fixture creation was performed.

## Product references used

These were workflow benchmarks, not copied designs or assets:

- [Onfleet last-mile delivery](https://onfleet.com/last-mile-delivery): live dispatch, visibility and operational clarity.
- [Upper route optimization](https://support.upperinc.com/docs/crew/optimization/optimize-a-route) and [dispatch to drivers](https://support.upperinc.com/docs/crew/dispatch-and-tracking/dispatch-routes-to-drivers): select, arrange, preview and send.
- [Driversnote classification](https://www.driversnote.com/classifying) and [reporting](https://www.driversnote.com/reporting): separate mileage review from delivery tasks.

## Verification and limits

The build and automated checks cover the hosted Worker, authentication, invitations, data persistence, route planning, exact stop order, delivery outcomes, proof, mileage privacy, classification, weekly reports and mobile navigation. New workbench tests exercise ordered selection, pruning, rate preservation and stale optimization responses.

Browser visual QA was blocked by a saved permission for the isolated localhost preview. The available production browser was signed out, so real account orders and Google rendering were not inspected in a signed-in session. The Google integration tests use a controlled response; they do not prove production key permissions or billing configuration.

This release changes dispatch and driver workflow presentation. It does not independently verify iPhone/Android locked-screen mileage capture, real camera behavior, GPS accuracy, battery behavior or production invitation email delivery. Native all-trip tracking still requires the consenting real-phone acceptance checks. Do not call the complete product release-ready on these automated results alone.

Local preview fixtures are stored under ignored `.preview-data/` and are not part of the source or deployed archive. Production data bindings and audience are retained.
