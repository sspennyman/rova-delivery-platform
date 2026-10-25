import Foundation
import SwiftUI
import WebKit
import CoreLocation

@MainActor final class TrackingController: NSObject, ObservableObject, @preconcurrency CLLocationManagerDelegate, WKHTTPCookieStoreObserver, WKScriptMessageHandler {
    static let shared = TrackingController()
    @Published var appearanceMode = "auto"
    @Published var lightAppearance = (7..<19).contains(Calendar.current.component(.hour, from: Date()))
    @Published var status = "Sign in to your Rivo account below"
    @Published var isRecording = false
    @Published var busy = false
    @Published var errorMessage: String?
    let webView: WKWebView
    let manager = CLLocationManager()
    let api = MileageAPI()
    var queue: PointQueue?
    @Published var consent: NativeConsent?
    @Published var session: DriverSession?
    @Published var remote = NativeTrackingStatus(enabled: false, deviceId: "")
    @Published var queuedFixes = 0
    var cookieToken = ""
    var generation = 0
    var verifying = false
    var syncing = false
    @Published var wantsEnable = false
    var requestedAlways = false
    var autoTrackEnabled: Bool { wantsEnable || consent?.paused == false }
    @Published var lastFix: Date?
    var lastQueuedAt: TimeInterval = 0
    var lastVerify = Date.distantPast
    var timer: Timer?

    override init() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.applicationNameForUserAgent = "RivoIOS/0.1.7"
        webView = WKWebView(frame: .zero, configuration: config)
        super.init()
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.02, green: 0.02, blue: 0.025, alpha: 1)
        webView.scrollView.backgroundColor = webView.backgroundColor
        manager.delegate = self
        manager.activityType = .automotiveNavigation
        manager.desiredAccuracy = kCLLocationAccuracyBest
        // Stationary updates are necessary to close a trip after the stop threshold.
        manager.distanceFilter = kCLDistanceFilterNone
        manager.pausesLocationUpdatesAutomatically = false
        manager.showsBackgroundLocationIndicator = true
        do { queue = try ConsentStore.makeQueue(); consent = try ConsentStore.load() }
        catch { errorMessage = "Private trip storage could not open. Tracking is disabled." }
        webView.configuration.websiteDataStore.httpCookieStore.add(self)
        // One reduction-only command: trusted main-frame logout can stop recording,
        // but web content can never enable GPS, read the queue or obtain a token.
        webView.configuration.userContentController.add(self, name: "rivoPrivacy")
        timer = Timer.scheduledTimer(withTimeInterval: 20, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.tick() }
        }
        Task { await refreshIdentity(force: true) }
    }
    func currentCookie() async -> String {
        let cookies = await webView.configuration.websiteDataStore.httpCookieStore.allCookies()
        updateAppearance(cookies)
        return cookies.first { $0.name == "rivo_session" && $0.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")) == "app.floraljet.llc"
            && $0.isSecure && ($0.expiresDate == nil || $0.expiresDate! > Date()) }?.value ?? ""
    }
    func updateAppearance(_ cookies: [HTTPCookie]) {
        let value = cookies.first { cookie in
            let domain = cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: "."))
            return cookie.name == "rivo_theme" && ["floraljet.llc", "app.floraljet.llc"].contains(domain)
                && cookie.isSecure && (cookie.expiresDate == nil || cookie.expiresDate! > Date())
        }?.value ?? "auto"
        appearanceMode = ["auto", "light", "dark"].contains(value) ? value : "auto"
        lightAppearance = appearanceMode == "light" || (appearanceMode == "auto" && (7..<19).contains(Calendar.current.component(.hour, from: Date())))
        webView.backgroundColor = lightAppearance ? UIColor(red: 0.957, green: 0.969, blue: 0.984, alpha: 1) : UIColor(red: 0.02, green: 0.02, blue: 0.025, alpha: 1)
        webView.scrollView.backgroundColor = webView.backgroundColor
        webView.overrideUserInterfaceStyle = lightAppearance ? .light : .dark
    }
    func setAppearance(_ value: String) {
        guard ["auto", "light", "dark"].contains(value),
              let cookie = HTTPCookie(properties: [.name: "rivo_theme", .value: value,
                .domain: ".floraljet.llc", .path: "/", .secure: "TRUE",
                .expires: Date().addingTimeInterval(365 * 86400)]) else { return }
        Task {
            await webView.configuration.websiteDataStore.httpCookieStore.setCookie(cookie)
            _ = await currentCookie()
        }
    }
    func cookiesDidChange(in cookieStore: WKHTTPCookieStore) {
        Task {
            let token = await currentCookie()
            if token != cookieToken {
                generation += 1; stopCapture(); session = nil; lastFix = nil; queuedFixes = 0; cookieToken = token
                status = token.isEmpty ? "Signed out · tracking stopped" : "Checking your mileage profile…"
                await refreshIdentity(force: true)
            }
        }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        let origin = message.frameInfo.securityOrigin
        guard message.name == "rivoPrivacy", message.frameInfo.isMainFrame,
              TrackingPolicy.acceptsSignOutCommand(host: origin.host, scheme: origin.protocol, port: origin.port,
                                                   command: message.body as? String) else { return }
        generation += 1; stopCapture(); wantsEnable = false
        try? suspendConsent("Signed out · tracking stopped")
        session = nil; lastFix = nil; queuedFixes = 0; cookieToken = ""
        Task {
            let store = webView.configuration.websiteDataStore.httpCookieStore
            for cookie in await store.allCookies() where cookie.name == "rivo_session"
                && cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")) == "app.floraljet.llc" {
                await store.deleteCookie(cookie)
            }
        }
    }
    func refreshIdentity(force: Bool = false) async {
        guard !verifying, force || Date().timeIntervalSince(lastVerify) > 60 else { return }
        verifying = true; defer { verifying = false }
        let token = await currentCookie(), revision = generation
        guard !token.isEmpty else { stopCapture(); session = nil; cookieToken = ""; status = "Sign in to your Rivo account below"; return }
        do {
            let identity = try await api.call("/api/me", token: token, as: NativeIdentity.self)
            let driver = try identity.driver(matching: token)
            guard revision == generation, await currentCookie() == token else { return }
            guard let verifiedTracking = identity.ownTracking else { throw MileageAPIError.invalidResponse }
            session = driver; cookieToken = token; remote = verifiedTracking; lastVerify = Date()
            await refreshQueueCount()
            if remote.deviceId == consent?.deviceID { try await queue?.advanceSequence(past: remote.lastSeq ?? 0) }
            if let consent, !consent.paused,
               consent.driverID == driver.driverID, consent.sessionFingerprint == driver.fingerprint {
                if remote.enabled && remote.source == "ios" && remote.deviceId == consent.deviceID { startCaptureIfAllowed() }
                else { try suspendConsent("Auto-track was paused or moved to another phone") }
            } else { stopCapture(); status = "Auto-track off · enable once before driving" }
        } catch { handle(error) }
    }
    var allowed: Bool {
        guard let consent, consent.sessionFingerprint == session?.fingerprint, queue != nil else { return false }
        return remote.enabled && remote.source == "ios" && TrackingPolicy.mayTrack(session: session, cookieToken: cookieToken,
            consentedDriver: consent.driverID, device: consent.deviceID, selectedDevice: remote.deviceId,
            paused: consent.paused, alwaysLocation: manager.authorizationStatus == .authorizedAlways,
            preciseLocation: manager.accuracyAuthorization == .fullAccuracy)
    }
    func startCaptureIfAllowed() {
        guard allowed else { stopCapture(); status = "Auto-track needs Always and Precise Location in Settings"; return }
        if !isRecording {
            manager.allowsBackgroundLocationUpdates = true
            manager.startUpdatingLocation()
            if CLLocationManager.significantLocationChangeMonitoringAvailable() { manager.startMonitoringSignificantLocationChanges() }
            isRecording = true
        }
        updateHealth()
    }
    func stopCapture() {
        manager.stopUpdatingLocation(); manager.stopMonitoringSignificantLocationChanges()
        manager.allowsBackgroundLocationUpdates = false; isRecording = false
    }
    func updateHealth() {
        guard isRecording else { return }
        if (session?.expiresAt ?? .distantPast) <= Date() { stopCapture(); status = "Session expired · sign in again"; return }
        if let errorMessage { status = errorMessage; return }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let received = remote.lastFixAt.flatMap { iso.date(from: $0) }
        status = TrackingPolicy.health(localFix: lastFix, serverFix: received)
    }
    func refreshQueueCount() async {
        guard let driver = session, let queue else { queuedFixes = 0; return }
        do {
            let count = try await queue.pendingCount(driver: driver.driverID)
            guard session?.fingerprint == driver.fingerprint else { return }
            queuedFixes = count
        } catch { handle(error) }
    }
    var locationAccess: String {
        switch manager.authorizationStatus {
        case .authorizedAlways: return "Always allowed"
        case .authorizedWhenInUse: return "Change to Always"
        case .denied, .restricted: return "Allow Location in Settings"
        default: return "Not requested yet"
        }
    }
    var preciseLocation: Bool { manager.accuracyAuthorization == .fullAccuracy }
    var serverFix: Date? {
        guard let text = remote.lastFixAt else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: text) ?? ISO8601DateFormatter().date(from: text)
    }
    func suspendConsent(_ message: String) throws {
        stopCapture(); wantsEnable = false
        if var current = consent { current.paused = true; current.pendingServerPause = false; consent = current; try ConsentStore.save(current) }
        status = message
    }
    func handle(_ error: Error) {
        if let apiError = error as? MileageAPIError, apiError.mustStop {
            try? suspendConsent(apiError.localizedDescription)
            status = apiError.localizedDescription
        } else if error is QueueFailure {
            try? suspendConsent(error.localizedDescription); status = error.localizedDescription
        } else { status = isRecording ? "Offline · GPS is saving privately on this iPhone" : "Connection unavailable · open Rivo online to finish setup" }
        errorMessage = status
    }
    func tick() async {
        _ = await currentCookie()
        await refreshIdentity()
        await flush()
        if allowed && !isRecording { startCaptureIfAllowed() }
        if isRecording && !allowed { stopCapture(); status = "Tracking stopped · check your account and permissions" }
        if errorMessage == nil { updateHealth() }
    }
}
