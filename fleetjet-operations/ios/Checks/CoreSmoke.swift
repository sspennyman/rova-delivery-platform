import Foundation

@main struct CoreSmoke {
    static var passed = 0
    static func check(_ condition: Bool, _ label: String) {
        guard condition else { fatalError("FAILED: " + label) }
        passed += 1
    }
    static func main() async throws {
        let now = Date(timeIntervalSince1970: 1_790_000_000)
        let session = DriverSession(driverID: "test-driver", token: "fixture-token", expiresAt: now.addingTimeInterval(60))
        func policy(cookie: String = "fixture-token", driver: String = "test-driver", selected: String = "phone-a",
                    paused: Bool = false, always: Bool = true, precise: Bool = true, at: Date = now) -> Bool {
            TrackingPolicy.mayTrack(session: session, cookieToken: cookie, consentedDriver: driver, device: "phone-a",
                selectedDevice: selected, paused: paused, alwaysLocation: always, preciseLocation: precise, now: at)
        }
        check(policy(), "matching consenting driver allowed")
        check(!policy(cookie: ""), "logout stops capture")
        check(!policy(cookie: "other"), "changed account stops capture")
        check(!policy(driver: "other-driver"), "driver isolation")
        check(!policy(selected: "phone-b"), "device isolation")
        check(!policy(paused: true), "pause")
        check(!policy(always: false), "always permission")
        check(!policy(precise: false), "precise permission")
        check(!policy(at: now.addingTimeInterval(60)), "expiry")
        check(session.fingerprint != session.token, "credential fingerprint is not a token")
        check(TrackingPolicy.acceptsSignOutCommand(host: "app.floraljet.llc", scheme: "https", port: 0, command: "signOut"), "trusted logout stops native capture")
        check(!TrackingPolicy.acceptsSignOutCommand(host: "evil.test", scheme: "https", port: 443, command: "signOut"), "external frame cannot invoke native command")
        check(!TrackingPolicy.acceptsSignOutCommand(host: "app.floraljet.llc", scheme: "http", port: 80, command: "signOut"), "insecure frame rejected")
        check(!TrackingPolicy.acceptsSignOutCommand(host: "app.floraljet.llc", scheme: "https", port: 443, command: "enable"), "web content cannot enable capture")
        check(!TrackingPolicy.acceptsSignOutCommand(host: "app.floraljet.llc", scheme: "https", port: 444, command: "signOut"), "wrong port rejected")
        check(TrackingPolicy.trusted(URL(string: "https://app.floraljet.llc/#trips")!), "trusted app")
        for value in ["http://app.floraljet.llc", "https://app.floraljet.llc.evil.test", "https://app.floraljet.llc:444", "https://user@app.floraljet.llc"] {
            check(!TrackingPolicy.trusted(URL(string: value)!), "untrusted origin")
        }
        check(try MileageAPI.endpoint("/api/mileage").host == "app.floraljet.llc", "API fixed origin")
        for path in ["https://evil.test/api/me", "//evil.test/api/me", "/api/me#leak", "/api/\\evil"] {
            do { _ = try MileageAPI.endpoint(path); check(false, "unsafe API path") }
            catch MileageAPIError.untrustedURL { passed += 1 }
        }
        let payload = """
        {"session":{"token":"fixture-token","role":"driver","driverId":"test-driver","expiresAt":"2026-12-01T00:00:00.000Z"},"snapshot":{"mileage":{"tracking":{"enabled":true,"deviceId":"phone-a","source":"ios","lastSeq":42}}}}
        """
        let identity = try JSONDecoder().decode(NativeIdentity.self, from: Data(payload.utf8))
        check(try identity.driver(matching: "fixture-token", now: now).driverID == "test-driver", "native server identity")
        do { _ = try identity.driver(matching: "other", now: now); check(false, "token mismatch") }
        catch { passed += 1 }
        let dispatchOnly = """
        {"session":{"token":"fixture-token","role":"dispatcher","driverId":"","expiresAt":"2026-12-01T00:00:00Z"},"snapshot":{"mileage":{"reports":[]}}}
        """
        let dispatchIdentity = try JSONDecoder().decode(NativeIdentity.self, from: Data(dispatchOnly.utf8))
        do { _ = try dispatchIdentity.driver(matching: "fixture-token", now: now); check(false, "real dispatcher snapshot") }
        catch MileageAPIError.response(401, _) { passed += 1 }
        let linkedPayload = """
        {"session":{"token":"fixture-token","role":"dispatcher","driverId":"","mileageDriverId":"own-driver","expiresAt":"2026-12-01T00:00:00Z"},"snapshot":{"mileage":{"reports":[]},"myMileage":{"tracking":{"enabled":false,"deviceId":""}}}}
        """
        let linked = try JSONDecoder().decode(NativeIdentity.self, from: Data(linkedPayload.utf8))
        check(try linked.driver(matching: "fixture-token", now: now).driverID == "own-driver", "dispatcher can use server-linked own profile")
        check(linked.ownTracking?.enabled == false, "linked profile starts with recording off")
        do { _ = try linked.driver(matching: "different-token", now: now); check(false, "linked token mismatch") }
        catch { passed += 1 }
        let disabled = try JSONDecoder().decode(NativeMileage.self, from: Data("{\"tracking\":{\"enabled\":false,\"deviceId\":\"\"}}".utf8))
        check(!disabled.tracking.enabled && disabled.tracking.source == nil, "unset server tracking decodes safely")
        let paused = NativeConsent(driverID: "a", sessionFingerprint: "hash", deviceID: "phone", paused: true, pendingServerPause: true)
        let restored = try JSONDecoder().decode(NativeConsent.self, from: JSONEncoder().encode(paused))
        check(restored.paused && restored.pendingServerPause, "offline pause survives relaunch")
        check(MileageAPIError.response(401, "fixture").mustStop, "revoked auth fails closed")
        check(MileageAPIError.response(409, "fixture").mustStop, "device conflict fails closed")
        check(!MileageAPIError.response(503, "fixture").mustStop, "temporary outage can retain offline recording")
        let owner = try JSONDecoder().decode(NativeIdentity.self, from: Data(payload.replacingOccurrences(of: "\"role\":\"driver\"", with: "\"role\":\"dispatcher\"").utf8))
        do { _ = try owner.driver(matching: "fixture-token", now: now); check(false, "dispatcher cannot capture mileage") }
        catch { passed += 1 }
        let point = GPSPoint(at: now.timeIntervalSince1970 * 1000, lat: 45.4, lng: -75.7, accuracy: 5, speed: 10)
        check(point.isUsable(now: now), "good GPS")
        check(!point.isUsable(now: now.addingTimeInterval(61)), "old GPS")
        check(!GPSPoint(at: point.at, lat: 91, lng: 0, accuracy: 5, speed: nil).isUsable(now: now), "invalid coordinate")
        check(!GPSPoint(at: point.at, lat: 45, lng: 0, accuracy: 61, speed: nil).isUsable(now: now), "weak accuracy")
        check(!GPSPoint(at: point.at, lat: 45, lng: 0, accuracy: 5, speed: .infinity).isUsable(now: now), "invalid speed")
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("rivo-core-check-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let url = folder.appendingPathComponent("checks.sqlite")
        let queue = try PointQueue(url: url)
        let first = try await queue.add(driver: "a", point: point, now: now)
        let second = try await queue.add(driver: "b", point: point, now: now)
        check(second > first, "monotonic sequence")
        check(try await queue.batch(driver: "a").map(\.seq) == [first], "private queue reads")
        let reopened = try PointQueue(url: url)
        check(try await reopened.batch(driver: "b").map(\.seq) == [second], "offline persistence")
        do { try await queue.acknowledge(driver: "a", through: first + 1, sentThrough: first); check(false, "unsafe ack") }
        catch QueueFailure.invalidOwner { passed += 1 }
        try await queue.acknowledge(driver: "a", through: first, sentThrough: first)
        check(try await queue.batch(driver: "a").isEmpty, "ack removes only confirmed points")
        check(try await queue.batch(driver: "b").count == 1, "another driver is not deleted")
        try await queue.advanceSequence(past: second + 1000)
        check(try await queue.add(driver: "a", point: point, now: now) > second + 1000, "server sequence floor survives clock rollback")
        let limited = try PointQueue(url: folder.appendingPathComponent("limit.sqlite"), capacity: 1)
        try await limited.add(driver: "a", point: point, now: now)
        do { try await limited.add(driver: "a", point: point, now: now); check(false, "capacity") }
        catch QueueFailure.full { passed += 1 }
        print("Rivo iOS core: \(passed) checks passed. This is not an iOS app build or a physical GPS test.")
    }
}
