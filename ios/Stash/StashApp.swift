import SwiftUI

@main
struct StashApp: App {
    @State private var store = VaultStore()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        #if DEBUG
        // `-requestRoute stash://…`: leave the request the small widget's +
        // leaves, then quit — the next launch must pick it up.
        if let raw = SampleVault.argument("-requestRoute"), let url = URL(string: raw) {
            AppGroup.requestRoute(url)
            exit(0)
        }
        #endif
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                // The palette's ink as the app-wide tint, set in code so the
                // black-and-white rule doesn't hinge on the AccentColor asset
                // resolving (it stopped applying once Info.plist was merged).
                .tint(Theme.ink)
        }
        .onChange(of: scenePhase, initial: true) { _, phase in
            // Live refresh only while in front; rescan on every return.
            switch phase {
            case .active: store.activate()
            case .background:
                store.deactivate()
                BackgroundRefresh.schedule()
            default: break
            }
        }
        // Runs when iOS grants a background refresh: rescan the vault, which
        // republishes the widget's tasks, then ask for the next one.
        .backgroundTask(.appRefresh(BackgroundRefresh.id)) {
            await store.backgroundRefresh()
            BackgroundRefresh.schedule()
        }
    }
}
