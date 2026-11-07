import Testing
@testable import StashCore

@Test func vaultLocationFromIOSPaths() {
    #expect(VaultLocation(path: "/private/var/mobile/Library/Mobile Documents/com~apple~CloudDocs/Stash") == .iCloudDrive)
    #expect(VaultLocation(path: "/private/var/mobile/Containers/Shared/AppGroup/1A2B3C/File Provider Storage/Stash") == .onThisPhone)
    #expect(VaultLocation(path: "/var/mobile/Containers/Data/Application/ABC/Library/Caches/sample-vault") == .onThisPhone)
    #expect(VaultLocation(path: "/private/var/mobile/Library/Mobile Documents/iCloud~md~obsidian/Documents/Vault") == .other)
    #expect(VaultLocation.iCloudDrive.syncsWithMac)
    #expect(!VaultLocation.onThisPhone.syncsWithMac)
}
