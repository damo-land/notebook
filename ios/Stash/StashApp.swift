import SwiftUI

@main
struct StashApp: App {
    @State private var store = VaultStore()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
        }
        .onChange(of: scenePhase, initial: true) { _, phase in
            // Live refresh only while in front; rescan on every return.
            switch phase {
            case .active: store.activate()
            case .background: store.deactivate()
            default: break
            }
        }
    }
}
