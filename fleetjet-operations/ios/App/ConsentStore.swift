import Foundation
import Security

enum ConsentStore {
    private static let service = "ca.rivo.mileage.pilot.consent"
    private static var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
         kSecAttrAccount as String: "tracking", kSecAttrSynchronizable as String: false]
    }
    static func load() throws -> NativeConsent? {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let code = SecItemCopyMatching(request as CFDictionary, &result)
        if code == errSecItemNotFound { return nil }
        guard code == errSecSuccess, let bytes = result as? Data else { throw QueueFailure.unavailable }
        return try JSONDecoder().decode(NativeConsent.self, from: bytes)
    }
    static func save(_ consent: NativeConsent) throws {
        let attributes: [String: Any] = [kSecValueData as String: try JSONEncoder().encode(consent),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let code = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if code == errSecItemNotFound {
            let item = query.merging(attributes) { _, value in value }
            guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw QueueFailure.unavailable }
        } else if code != errSecSuccess { throw QueueFailure.unavailable }
    }
    static func makeQueue() throws -> PointQueue {
        var folder = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                appropriateFor: nil, create: true).appendingPathComponent("PrivateMileage", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var excluded = URLResourceValues(); excluded.isExcludedFromBackup = true
        try folder.setResourceValues(excluded)
        let url = folder.appendingPathComponent("points.sqlite")
        let queue = try PointQueue(url: url)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path)
        return queue
    }
}
