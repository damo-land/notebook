// Where the chosen vault folder lives, from its path. Two folders can both be
// called "Stash": one in iCloud Drive (shared with the Mac) and one under
// On My iPhone (never leaves the phone). Settings shows which one is in use.

public enum VaultLocation: Equatable, Sendable {
    /// iCloud Drive: syncs with the Mac.
    case iCloudDrive
    /// On My iPhone (local Files storage): never syncs.
    case onThisPhone
    /// Another provider (an app's iCloud folder, a cloud storage app, …).
    case other

    public init(path: String) {
        if path.contains("/Mobile Documents/com~apple~CloudDocs") {
            self = .iCloudDrive
        } else if path.contains("/File Provider Storage") && path.contains("/Containers/Shared/AppGroup/") {
            self = .onThisPhone
        } else if path.contains("/Containers/Data/Application/") {
            self = .onThisPhone
        } else {
            self = .other
        }
    }

    public var label: String {
        switch self {
        case .iCloudDrive: "iCloud Drive"
        case .onThisPhone: "On My iPhone"
        case .other: "Other location"
        }
    }

    /// Notes in this folder reach the Mac.
    public var syncsWithMac: Bool { self == .iCloudDrive }
}
