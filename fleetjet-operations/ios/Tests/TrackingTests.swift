import XCTest
@testable import RivoMileageCore

final class TrackingTests: XCTestCase {
    func testHealthDoesNotClaimUnconfirmedSync() {
        let now = Date(timeIntervalSince1970: 1000)
        XCTAssertEqual(TrackingPolicy.health(localFix: nil, serverFix: nil, now: now), "Auto-track on · waiting for accurate GPS")
        XCTAssertEqual(TrackingPolicy.health(localFix: now, serverFix: nil, now: now), "GPS saved on iPhone · waiting to sync")
        XCTAssertEqual(TrackingPolicy.health(localFix: now, serverFix: now.addingTimeInterval(-121), now: now), "GPS saved on iPhone · waiting to sync")
        XCTAssertEqual(TrackingPolicy.health(localFix: now.addingTimeInterval(-121), serverFix: now, now: now), "GPS is stale · check location permissions")
        XCTAssertEqual(TrackingPolicy.health(localFix: now, serverFix: now, now: now), "GPS connected · trips sync automatically")
    }
    private let now = Date(timeIntervalSince1970: 1_790_000_000)
    private func allowed(driver: String = "adila", token: String = "test-token", cookie: String = "test-token",
                         consent: String = "adila", device: String = "phone-a", selected: String = "phone-a",
                         paused: Bool = false, always: Bool = true, precise: Bool = true, lifetime: Double = 60) -> Bool {
        TrackingPolicy.mayTrack(session: DriverSession(driverID: driver, token: token, expiresAt: now.addingTimeInterval(lifetime)),
            cookieToken: cookie, consentedDriver: consent, device: device, selectedDevice: selected, paused: paused,
            alwaysLocation: always, preciseLocation: precise, now: now)
    }
    func testConsentedBackgroundSessionAllowed() { XCTAssertTrue(allowed()) }
    func testAnotherDriverDenied() { XCTAssertFalse(allowed(consent: "other")) }
    func testMissingDriverDenied() { XCTAssertFalse(allowed(driver: "")) }
    func testAnotherPhoneDenied() { XCTAssertFalse(allowed(selected: "phone-b")) }
    func testPauseDenied() { XCTAssertFalse(allowed(paused: true)) }
    func testExpiredSessionDenied() { XCTAssertFalse(allowed(lifetime: 0)) }
    func testChangedCookieDenied() { XCTAssertFalse(allowed(cookie: "another-token")) }
    func testLogoutCookieDenied() { XCTAssertFalse(allowed(cookie: "")) }
    func testNoAlwaysPermissionDenied() { XCTAssertFalse(allowed(always: false)) }
    func testApproximateLocationDenied() { XCTAssertFalse(allowed(precise: false)) }
    func testHashDoesNotExposeToken() { XCTAssertNotEqual(TrackingPolicy.fingerprint("test-token"), "test-token") }
    func testOriginRestriction() {
        XCTAssertTrue(TrackingPolicy.trusted(URL(string: "https://app.floraljet.llc/driver")!))
        for url in ["http://app.floraljet.llc", "https://app.floraljet.llc.evil.test", "https://app.floraljet.llc:444", "https://evil@app.floraljet.llc"] {
            XCTAssertFalse(TrackingPolicy.trusted(URL(string: url)!))
        }
    }
    private func fix(accuracy: Double = 5, age: Double = 0) -> GPSPoint {
        GPSPoint(at: now.addingTimeInterval(-age).timeIntervalSince1970 * 1000, lat: 45.4, lng: -75.7, accuracy: accuracy, speed: 8)
    }
    func testBadGPSRejected() {
        XCTAssertTrue(fix().isUsable(now: now))
        XCTAssertFalse(fix(accuracy: -1).isUsable(now: now))
        XCTAssertFalse(fix(accuracy: 61).isUsable(now: now))
        XCTAssertFalse(fix(age: 61).isUsable(now: now))
    }
    func testQueueIsolationAndAcknowledgement() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".sqlite")
        defer { try? FileManager.default.removeItem(at: url) }
        let queue = try PointQueue(url: url)
        let a = try await queue.add(driver: "a", point: fix(), now: now)
        let b = try await queue.add(driver: "b", point: fix(), now: now)
        let countA = try await queue.pendingCount(driver: "a")
        let countB = try await queue.pendingCount(driver: "b")
        XCTAssertEqual(countA, 1, "Pending count must exclude another account")
        XCTAssertEqual(countB, 1)
        let aBatch = try await queue.batch(driver: "a")
        XCTAssertEqual(aBatch.map(\.seq), [a])
        try await queue.acknowledge(driver: "a", through: a, sentThrough: a)
        let remainingA = try await queue.batch(driver: "a")
        let remainingB = try await queue.batch(driver: "b")
        XCTAssertTrue(remainingA.isEmpty)
        let afterAck = try await queue.pendingCount(driver: "a")
        XCTAssertEqual(afterAck, 0)
        XCTAssertEqual(remainingB.map(\.seq), [b])
    }
    func testOfflineQueueSurvivesReopen() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".sqlite")
        defer { try? FileManager.default.removeItem(at: url) }
        let first = try PointQueue(url: url)
        let sequence = try await first.add(driver: "a", point: fix(), now: now)
        let reopened = try PointQueue(url: url)
        let records = try await reopened.batch(driver: "a")
        XCTAssertEqual(records.first?.seq, sequence)
    }
    func testQueueCapacityFailsClosed() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".sqlite")
        defer { try? FileManager.default.removeItem(at: url) }
        let queue = try PointQueue(url: url, capacity: 1)
        try await queue.add(driver: "a", point: fix(), now: now)
        do { try await queue.add(driver: "a", point: fix(), now: now); XCTFail("Must stop at capacity") }
        catch QueueFailure.full { }
    }
    func testUnsentAcknowledgementCannotDeleteData() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".sqlite")
        defer { try? FileManager.default.removeItem(at: url) }
        let queue = try PointQueue(url: url)
        let sequence = try await queue.add(driver: "a", point: fix(), now: now)
        do { try await queue.acknowledge(driver: "a", through: sequence + 1, sentThrough: sequence); XCTFail("Invalid acknowledgement") }
        catch QueueFailure.invalidOwner { }
        let records = try await queue.batch(driver: "a")
        XCTAssertEqual(records.count, 1)
    }
}
