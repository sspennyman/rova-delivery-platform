# Rivo driver experience

Use the shared mobile-first driver interface inside the existing iOS and Android native companions. Keep dispatch on the responsive website. Do not rebuild two independent delivery interfaces.

The native layer is required for consented background mileage capture, offline GPS storage and platform permissions. A browser/Home Screen shortcut is not a replacement for locked-screen mileage tracking.

## Assignment alerts

Each new dispatcher assignment creates a durable, driver-private notification. A batch of orders produces one notice. Drivers see a View orders banner until they review it. Assignment edits, GPS updates and reordering do not produce duplicate notices.

Supported mobile browsers/Home Screen web apps can opt into Web Push in Driver Settings → Order alerts. iPhone users must add the website to the Home Screen first. A test notification confirms only push-provider acceptance until the user actually sees it on their phone. Focus settings, network outages and OS restrictions can delay or silence alerts.

Push contains an order count and a link into Rivo, not customer addresses or session credentials. Sign-out disables the corresponding subscription; expired sessions are not contacted. The private VAPID key lives only in the hosted server secret configuration.

The current native shells do not yet register APNs/FCM tokens. Native lock-screen push is a separate integration and real-phone acceptance gate; web push is not silently presented as native push. App-store distribution and a real locked-screen drive remain release gates for background tracking.

## Acceptance test

1. Sign in as a consenting test driver on their phone.
2. For iPhone web push, add Rivo to the Home Screen and open it there.
3. In Settings, enable order notifications and grant permission. Confirm the test appears.
4. Close the web app and lock the phone. Dispatch one disposable test order to that driver.
5. Confirm one alert appears and opens Today's route. Assign a multi-order batch and confirm one batch alert.
6. Review the orders, then verify the banner disappears. Reordering must not send another new-order alert.
7. Sign out and verify later assignments do not alert that device.
8. Test native background mileage independently with the iOS/Android acceptance checklists. Web push success does not prove GPS capture.
