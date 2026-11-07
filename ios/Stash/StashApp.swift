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
        // `-resetUI`: start from default view settings (UI tests). Passing the
        // keys as launch arguments instead would pin them for the whole run.
        if CommandLine.arguments.contains("-resetUI") {
            for key in ["section", "taskCategory", "showCompleted", "notesKind"] {
                UserDefaults.standard.removeObject(forKey: key)
            }
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
                #if DEBUG
                .task {
                    // `-chatEval [runs]`: on-device model eval (ChatEval.swift).
                    if CommandLine.arguments.contains("-chatEval"), #available(iOS 26, *) {
                        let runs = SampleVault.argument("-chatEval").flatMap(Int.init) ?? 2
                        await ChatEval.run(store: store, runs: runs)
                    }
                }
                #endif
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
