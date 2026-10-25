import Foundation
import SQLite3

enum QueueFailure: LocalizedError {
    case unavailable, full, invalidOwner, invalidPoint
    var errorDescription: String? {
        switch self {
        case .full: return "Storage is full. Connect to sync before recording more trips."
        case .invalidOwner: return "Sign in again before recording trips."
        case .invalidPoint: return "GPS fix could not be saved."
        case .unavailable: return "Trip storage is unavailable. Tracking has stopped."
        }
    }
}

/// SQLite owns monotonically increasing sequences; retries cannot count a fix twice.
/// All reads, writes and acknowledgements are scoped to a verified driver's ID.
actor PointQueue {
    private var db: OpaquePointer?
    private let capacity: Int
    private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    init(url: URL, capacity: Int = 50_000) throws {
        self.capacity = capacity
        guard sqlite3_open_v2(url.path, &db, SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else {
            sqlite3_close(db); db = nil; throw QueueFailure.unavailable
        }
        sqlite3_busy_timeout(db, 5000)
        guard sqlite3_exec(db, "CREATE TABLE IF NOT EXISTS points (seq INTEGER PRIMARY KEY AUTOINCREMENT, driver TEXT NOT NULL, payload BLOB NOT NULL)", nil, nil, nil) == SQLITE_OK else {
            sqlite3_close(db); db = nil; throw QueueFailure.unavailable
        }
    }
    deinit { sqlite3_close(db) }

    private func statement(_ sql: String) throws -> OpaquePointer {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, let statement else { throw QueueFailure.unavailable }
        return statement
    }
    private func count() throws -> Int {
        let query = try statement("SELECT COUNT(*) FROM points")
        defer { sqlite3_finalize(query) }
        guard sqlite3_step(query) == SQLITE_ROW else { throw QueueFailure.unavailable }
        return Int(sqlite3_column_int64(query, 0))
    }
    func pendingCount(driver: String) throws -> Int {
        guard !driver.isEmpty else { throw QueueFailure.invalidOwner }
        let query = try statement("SELECT COUNT(*) FROM points WHERE driver = ?")
        defer { sqlite3_finalize(query) }
        sqlite3_bind_text(query, 1, driver, -1, transient)
        guard sqlite3_step(query) == SQLITE_ROW else { throw QueueFailure.unavailable }
        return Int(sqlite3_column_int64(query, 0))
    }
    func advanceSequence(past floor: Int64) throws {
        guard floor >= 0, floor < 9_007_199_254_700_000 else { throw QueueFailure.invalidPoint }
        let update = try statement("UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = 'points'")
        defer { sqlite3_finalize(update) }
        sqlite3_bind_int64(update, 1, floor)
        guard sqlite3_step(update) == SQLITE_DONE else { throw QueueFailure.unavailable }
        let insert = try statement("INSERT INTO sqlite_sequence(name, seq) SELECT 'points', ? WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'points')")
        defer { sqlite3_finalize(insert) }
        sqlite3_bind_int64(insert, 1, floor)
        guard sqlite3_step(insert) == SQLITE_DONE else { throw QueueFailure.unavailable }
    }
    @discardableResult func add(driver: String, point: GPSPoint, now: Date = Date()) throws -> Int64 {
        guard !driver.isEmpty else { throw QueueFailure.invalidOwner }
        guard point.isUsable(now: now) else { throw QueueFailure.invalidPoint }
        guard try count() < capacity else { throw QueueFailure.full }
        let data = try JSONEncoder().encode(point)
        // Epoch-based floor prevents a recreated local database from replaying old
        // sequence numbers if the same device consent survives in Keychain.
        let insert = try statement("INSERT INTO points (seq, driver, payload) VALUES (MAX(?, COALESCE((SELECT seq + 1 FROM sqlite_sequence WHERE name = 'points'), 1)), ?, ?)")
        defer { sqlite3_finalize(insert) }
        sqlite3_bind_int64(insert, 1, Int64(now.timeIntervalSince1970 * 1000))
        sqlite3_bind_text(insert, 2, driver, -1, transient)
        _ = data.withUnsafeBytes { sqlite3_bind_blob(insert, 3, $0.baseAddress, Int32(data.count), transient) }
        guard sqlite3_step(insert) == SQLITE_DONE else { throw QueueFailure.unavailable }
        return sqlite3_last_insert_rowid(db)
    }
    func batch(driver: String) throws -> [GPSPoint] {
        guard !driver.isEmpty else { throw QueueFailure.invalidOwner }
        let query = try statement("SELECT seq, payload FROM points WHERE driver = ? ORDER BY seq LIMIT 100")
        defer { sqlite3_finalize(query) }
        sqlite3_bind_text(query, 1, driver, -1, transient)
        var result: [GPSPoint] = []
        var code = sqlite3_step(query)
        while code == SQLITE_ROW {
            guard let bytes = sqlite3_column_blob(query, 1) else { throw QueueFailure.unavailable }
            let data = Data(bytes: bytes, count: Int(sqlite3_column_bytes(query, 1)))
            var point = try JSONDecoder().decode(GPSPoint.self, from: data)
            point.seq = sqlite3_column_int64(query, 0)
            result.append(point)
            code = sqlite3_step(query)
        }
        guard code == SQLITE_DONE else { throw QueueFailure.unavailable }
        return result
    }
    func acknowledge(driver: String, through sequence: Int64, sentThrough: Int64) throws {
        guard !driver.isEmpty, sequence >= 0, sequence <= sentThrough else { throw QueueFailure.invalidOwner }
        let query = try statement("DELETE FROM points WHERE driver = ? AND seq <= ?")
        defer { sqlite3_finalize(query) }
        sqlite3_bind_text(query, 1, driver, -1, transient)
        sqlite3_bind_int64(query, 2, sequence)
        guard sqlite3_step(query) == SQLITE_DONE else { throw QueueFailure.unavailable }
    }
}
