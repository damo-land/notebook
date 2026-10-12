// Background app refresh for the widget. iOS decides when (and whether) it
// runs — typically a few times a day, more for apps used often — so the
// widget is "as of the last time stash ran", not live.

import BackgroundTasks
import Foundation

enum BackgroundRefresh {
    /// Also listed under BGTaskSchedulerPermittedIdentifiers in Info.plist.
    static let id = "land.damo.stash.ios.refresh"

    static func schedule() {
        let request = BGAppRefreshTaskRequest(identifier: id)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 30 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }
}
