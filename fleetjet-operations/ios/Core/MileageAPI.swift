import Foundation

enum MileageAPIError: LocalizedError {
    case response(Int, String), invalidResponse, untrustedURL
    var errorDescription: String? {
        switch self {
        case .response(_, let message): return message
        case .invalidResponse: return "Rivo returned an unexpected response. Recording has not been confirmed."
        case .untrustedURL: return "Rivo refused a connection outside its secure app."
        }
    }
    var mustStop: Bool {
        if case .response(let code, _) = self { return [400, 401, 403, 409].contains(code) }
        return true
    }
}

struct NativeTrackingStatus: Codable {
    var enabled: Bool
    var deviceId: String
    var source: String?
    var lastFixAt: String?
    var lastSeq: Int64?
}
struct NativeMileage: Decodable { let tracking: NativeTrackingStatus }
struct NativeIdentity: Decodable {
    struct Session: Decodable { let token: String; let role: String; let driverId: String; let mileageDriverId: String?; let expiresAt: String }
    struct Snapshot: Decodable {
        struct Mileage: Decodable { let tracking: NativeTrackingStatus? }
        let mileage: Mileage
        let myMileage: Mileage?
    }
    let session: Session
    let snapshot: Snapshot
    var ownTracking: NativeTrackingStatus? { session.role == "dispatcher" ? snapshot.myMileage?.tracking : snapshot.mileage.tracking }
    func driver(matching token: String, now: Date = Date()) throws -> DriverSession {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let precise = iso.date(from: session.expiresAt)
        iso.formatOptions = [.withInternetDateTime]
        let driverID = session.role == "driver" ? session.driverId : session.role == "dispatcher" ? session.mileageDriverId ?? "" : ""
        guard !driverID.isEmpty,
              !token.isEmpty, session.token == token,
              let expiry = precise ?? iso.date(from: session.expiresAt), expiry > now else {
            throw MileageAPIError.response(401, "Sign in, then open My Mileage to add your own driver profile. Your dispatcher access stays unchanged.")
        }
        return DriverSession(driverID: driverID, token: token, expiresAt: expiry)
    }
}
struct NativeConsent: Codable {
    var driverID: String
    var sessionFingerprint: String
    var deviceID: String
    var paused: Bool
    var pendingServerPause: Bool = false
}
struct PointAcknowledgement: Decodable { let ack: Int64; let rejected: Int }

/// Cookies and redirects are disabled: a bearer token only reaches the fixed Rivo origin.
final class MileageAPI: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private var client: URLSession!
    override init() {
        super.init()
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieStorage = nil
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 20
        config.timeoutIntervalForResource = 30
        client = URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }
    static func endpoint(_ path: String) throws -> URL {
        guard path.hasPrefix("/api/"), !path.contains("\\"),
              let url = URL(string: "https://app.floraljet.llc" + path),
              TrackingPolicy.trusted(url), url.fragment == nil else { throw MileageAPIError.untrustedURL }
        return url
    }
    func call<T: Decodable>(_ path: String, token: String, body: Data? = nil, as type: T.Type) async throws -> T {
        guard !token.isEmpty, !token.contains("\r"), !token.contains("\n") else {
            throw MileageAPIError.response(401, "Sign in again before recording.")
        }
        var request = URLRequest(url: try Self.endpoint(path))
        request.httpMethod = body == nil ? "GET" : "POST"
        request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("RivoIOS/0.1.4", forHTTPHeaderField: "User-Agent")
        if let body { request.httpBody = body; request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let (bytes, response) = try await client.data(for: request)
        guard let http = response as? HTTPURLResponse, bytes.count <= 10_000_000 else { throw MileageAPIError.invalidResponse }
        guard (200...201).contains(http.statusCode) else {
            let message = (try? JSONSerialization.jsonObject(with: bytes) as? [String: Any])?["error"] as? String
            throw MileageAPIError.response(http.statusCode, message ?? "Rivo could not sync. Please check your connection.")
        }
        do { return try JSONDecoder().decode(type, from: bytes) }
        catch { throw MileageAPIError.invalidResponse }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
