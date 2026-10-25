import Foundation
import CryptoKit

struct DriverSession: Codable, Equatable {
    let driverID: String
    let token: String
    let expiresAt: Date

    var fingerprint: String { TrackingPolicy.fingerprint(token) }
}

enum TrackingPolicy {
    static func health(localFix: Date?, serverFix: Date?, now: Date = Date()) -> String {
        guard let localFix else { return "Auto-track on · waiting for accurate GPS" }
        guard now.timeIntervalSince(localFix) < 120 else { return "GPS is stale · check location permissions" }
        guard let serverFix, now.timeIntervalSince(serverFix) < 120 else {
            return "GPS saved on iPhone · waiting to sync"
        }
        return "GPS connected · trips sync automatically"
    }
    static func acceptsSignOutCommand(host: String, scheme: String, port: Int, command: String?) -> Bool {
        host == "app.floraljet.llc" && scheme == "https" && [0, 443].contains(port) && command == "signOut"
    }
    static func fingerprint(_ token: String) -> String {
        guard !token.isEmpty else { return "" }
        return Data(SHA256.hash(data: Data(token.utf8))).base64EncodedString()
    }

    static func mayTrack(session: DriverSession?, cookieToken: String, consentedDriver: String,
                         device: String, selectedDevice: String, paused: Bool,
                         alwaysLocation: Bool, preciseLocation: Bool, now: Date = Date()) -> Bool {
        guard let session else { return false }
        return !session.driverID.isEmpty && !session.token.isEmpty && !cookieToken.isEmpty
            && session.driverID == consentedDriver && session.token == cookieToken
            && !device.isEmpty && device == selectedDevice && !paused
            && session.expiresAt > now && alwaysLocation && preciseLocation
    }

    static func trusted(_ url: URL) -> Bool {
        url.scheme == "https" && url.host == "app.floraljet.llc"
            && (url.port == nil || url.port == 443) && url.user == nil && url.password == nil
    }
}

struct GPSPoint: Codable, Equatable {
    var seq: Int64 = 0
    let at: Double
    let lat: Double
    let lng: Double
    let accuracy: Double
    let speed: Double?

    func isUsable(now: Date) -> Bool {
        [at, lat, lng, accuracy].allSatisfy(\.isFinite)
            && abs(lat) <= 90 && abs(lng) <= 180 && accuracy >= 0 && accuracy <= 60
            && abs(now.timeIntervalSince1970 * 1000 - at) <= 60_000
            && (speed == nil || (speed!.isFinite && speed! >= 0))
    }
}
