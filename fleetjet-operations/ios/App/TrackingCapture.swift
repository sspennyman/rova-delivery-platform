import Foundation
import CoreLocation
import UIKit

extension TrackingController {
    func enable() async {
        guard !busy else { return }
        busy = true; defer { busy = false }
        errorMessage = nil
        await refreshIdentity(force: true)
        guard session != nil, queue != nil else { errorMessage = "Sign in and add your driver profile in My Mileage before enabling."; return }
        wantsEnable = true
        requestedAlways = false
        switch manager.authorizationStatus {
        case .notDetermined: manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse: requestAlwaysIfNeeded()
        case .authorizedAlways: await completeEnable()
        default: wantsEnable = false; errorMessage = "Allow Always and Precise Location in iPhone Settings to enable auto-track."
        }
    }
    func requestAlwaysIfNeeded() {
        status = "Finish setup: allow Always and Precise Location"
        guard !requestedAlways else { return }
        requestedAlways = true
        manager.requestAlwaysAuthorization()
    }
    func completeEnable() async {
        guard wantsEnable, manager.authorizationStatus == .authorizedAlways,
              manager.accuracyAuthorization == .fullAccuracy,
              let driver = session, driver.expiresAt > Date() else {
            errorMessage = "Always and Precise Location are required for this tracking pilot."; return
        }
        wantsEnable = false
        let revision = generation
        let device = consent?.driverID == driver.driverID ? consent!.deviceID : UUID().uuidString
        do {
            guard await currentCookie() == driver.token else { throw MileageAPIError.response(401, "Sign in again before enabling tracking.") }
            let body = try JSONSerialization.data(withJSONObject: ["enabled": true, "deviceId": device, "source": "ios"])
            let result = try await api.call("/api/my-mileage/consent", token: driver.token, body: body, as: NativeMileage.self)
            guard revision == generation, await currentCookie() == driver.token else { return }
            guard result.tracking.enabled, result.tracking.source == "ios", result.tracking.deviceId == device else {
                throw MileageAPIError.response(409, "The server needs the iPhone tracking update. Recording has not started.")
            }
            let next = NativeConsent(driverID: driver.driverID, sessionFingerprint: driver.fingerprint, deviceID: device, paused: false)
            try await queue?.advanceSequence(past: result.tracking.lastSeq ?? 0)
            try ConsentStore.save(next); consent = next; remote = result.tracking; lastFix = nil
            errorMessage = nil; startCaptureIfAllowed()
        } catch { handle(error) }
    }
    func pause() async {
        stopCapture(); wantsEnable = false; generation += 1
        guard var next = consent else { status = "Auto-track off"; errorMessage = nil; return }
        next.paused = true; next.pendingServerPause = true; consent = next
        do { try ConsentStore.save(next); errorMessage = nil; status = "Auto-track off · syncing saved trips"; await flush() }
        catch { handle(error) }
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus != .authorizedAlways || manager.accuracyAuthorization != .fullAccuracy {
            stopCapture()
        }
        if wantsEnable {
            if manager.authorizationStatus == .authorizedWhenInUse { requestAlwaysIfNeeded() }
            else if manager.authorizationStatus == .authorizedAlways { Task { await completeEnable() } }
            else if manager.authorizationStatus == .denied || manager.authorizationStatus == .restricted {
                wantsEnable = false; status = "Auto-track off · allow Location in Settings"
            }
        } else if allowed { startCaptureIfAllowed() }
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard allowed else { stopCapture(); return }
        let ordered = locations.sorted { $0.timestamp < $1.timestamp }
        let revision = generation
        guard let driver = session, let queue else { return }
        for location in ordered {
            guard location.timestamp.timeIntervalSince1970 - lastQueuedAt >= 8 else { continue }
            let fix = GPSPoint(at: location.timestamp.timeIntervalSince1970 * 1000,
                lat: location.coordinate.latitude, lng: location.coordinate.longitude,
                accuracy: location.horizontalAccuracy, speed: location.speed < 0 ? nil : location.speed)
            guard fix.isUsable(now: Date()) else { continue }
            lastQueuedAt = location.timestamp.timeIntervalSince1970
            Task {
                guard revision == generation, allowed, session?.driverID == driver.driverID else { return }
                do {
                    try await queue.add(driver: driver.driverID, point: fix)
                    guard revision == generation else { return }
                    await refreshQueueCount()
                    lastFix = location.timestamp; updateHealth(); await flush()
                } catch { handle(error) }
            }
        }
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        if (error as? CLError)?.code == .denied { stopCapture(); status = "Location permission stopped · check iPhone Settings" }
        else { status = "Waiting for GPS · mileage may be incomplete" }
    }
    func flush() async {
        guard !syncing, let driver = session, let chosen = consent, let queue,
              chosen.driverID == driver.driverID, chosen.sessionFingerprint == driver.fingerprint,
              driver.expiresAt > Date(), !chosen.paused || chosen.pendingServerPause else { return }
        syncing = true; defer { syncing = false }
        let revision = generation
        var background = UIBackgroundTaskIdentifier.invalid
        background = UIApplication.shared.beginBackgroundTask(withName: "Save Rivo mileage") {
            if background != .invalid { UIApplication.shared.endBackgroundTask(background); background = .invalid }
        }
        defer { if background != .invalid { UIApplication.shared.endBackgroundTask(background) } }
        do {
            guard await currentCookie() == driver.token else { throw MileageAPIError.response(401, "Account changed · tracking stopped") }
            let state = try await api.call("/api/my-mileage", token: driver.token, as: NativeMileage.self)
            guard revision == generation else { return }
            remote = state.tracking
            guard remote.enabled, remote.deviceId == chosen.deviceID, remote.source == "ios" else {
                throw MileageAPIError.response(409, "Tracking was paused or moved to another phone. Check settings before resuming.")
            }
            // Bound each wake-up; further batches run on the next location event or timer.
            for _ in 0..<5 {
                let points = try await queue.batch(driver: driver.driverID)
                guard revision == generation, await currentCookie() == driver.token else { return }
                if points.isEmpty {
                    if chosen.pendingServerPause {
                        let body = try JSONSerialization.data(withJSONObject: ["enabled": false, "deviceId": chosen.deviceID])
                        let result = try await api.call("/api/my-mileage/consent", token: driver.token, body: body, as: NativeMileage.self)
                        guard revision == generation else { return }
                        var paused = chosen; paused.pendingServerPause = false
                        try ConsentStore.save(paused); consent = paused; remote = result.tracking; status = "Auto-track paused"
                    }
                    errorMessage = nil; return
                }
                struct Batch: Encodable { let deviceId: String; let points: [GPSPoint] }
                let bytes = try JSONEncoder().encode(Batch(deviceId: chosen.deviceID, points: points))
                let ack = try await api.call("/api/my-mileage/points", token: driver.token, body: bytes, as: PointAcknowledgement.self)
                guard revision == generation, await currentCookie() == driver.token else { return }
                try await queue.acknowledge(driver: driver.driverID, through: ack.ack, sentThrough: points.last!.seq)
                await refreshQueueCount()
                if ack.rejected > 0 { status = "Some GPS fixes were skipped · check the trip log" }
                errorMessage = nil
            }
        } catch { handle(error) }
    }
}
