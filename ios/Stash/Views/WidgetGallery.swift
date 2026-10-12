#if DEBUG
// `-screen widgets`: the home-screen widget's three sizes rendered in the app
// at iPhone widget sizes, on a wallpaper-ish backdrop — for screenshots, since
// there's no command-line way to place a widget on the simulator's home screen.

import SwiftUI
import WidgetKit
import StashCore

struct WidgetGallery: View {
    @Environment(VaultStore.self) private var store

    var body: some View {
        let snapshot = store.notes.isEmpty ? nil : WidgetSnapshot(notes: store.notes)
        let due = TasksWidgetEntry(date: .now, snapshot: snapshot, order: .due, category: nil)
        let work = TasksWidgetEntry(date: .now, snapshot: snapshot, order: .newest, category: "work")
        ScrollView {
            VStack(spacing: 22) {
                HStack(spacing: 22) {
                    tile(due, .systemSmall, width: 170, height: 170)
                    tile(work, .systemSmall, width: 170, height: 170)
                }
                tile(due, .systemMedium, width: 362, height: 170)
                tile(due, .systemLarge, width: 362, height: 382)
            }
            .padding(.vertical, 24)
            .frame(maxWidth: .infinity)
        }
        .background(
            LinearGradient(colors: [Color(white: 0.55), Color(white: 0.3)], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
        )
    }

    private func tile(_ entry: TasksWidgetEntry, _ family: WidgetFamily, width: CGFloat, height: CGFloat) -> some View {
        TasksWidgetView(entry: entry, family: family)
            .padding(16) // WidgetKit's default content margins
            .frame(width: width, height: height)
            .background(Theme.background, in: .rect(cornerRadius: 24))
    }
}
#endif
