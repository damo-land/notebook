// CoreGraphics window lookup for scripts/shoot.sh.
//
// `screencapture -l` wants a CoreGraphics window id, and nothing in the shell
// hands one out — so this asks CGWindowListCopyWindowInfo directly. Matching is
// by owner *pid* (the harness knows the app's pid) rather than by owner name:
// the dev binary's process name is not guaranteed, and kCGWindowName is
// redacted without Screen Recording permission anyway.
//
//   swift scripts/shoot-window.swift <pid>   -> "<windowId>\t<x>,<y>,<w>,<h>"
//                                               one line per on-screen window,
//                                               largest first; exit 1 if none
//   swift scripts/shoot-window.swift --preflight
//                                            -> "granted" / "denied" (exit 1)
//
// Bounds are in points; a Retina capture of that window is 2x those numbers.

import CoreGraphics
import Foundation

func die(_ message: String, _ code: Int32) -> Never {
    FileHandle.standardError.write("shoot-window: \(message)\n".data(using: .utf8)!)
    exit(code)
}

let args = CommandLine.arguments
guard args.count >= 2 else {
    die("usage: shoot-window.swift <pid> | --preflight", 2)
}

// Screen Recording (TCC) is granted to the app responsible for this process —
// the terminal the harness runs in. Without it `screencapture -l` fails
// outright, so shoot.sh checks this before it ever launches the app.
if args[1] == "--preflight" {
    let ok = CGPreflightScreenCaptureAccess()
    print(ok ? "granted" : "denied")
    exit(ok ? 0 : 1)
}

guard let pid = Int(args[1]) else {
    die("not a pid: \(args[1])", 2)
}

struct Found {
    let id: Int
    let x: Double, y: Double, width: Double, height: Double
    var area: Double { width * height }
}

// Menu-bar status items live at layer 25. This app is a tray app, so its
// status item is on screen from the moment it launches — and if it counted as
// a match the harness would decide the app was "ready" and screenshot a 34x24
// menu bar icon. The overlay panel is a floating panel (layer 3).
let statusItemLayer = 20

func panels(_ options: CGWindowListOption, floatingOnly: Bool = false) -> [Found] {
    guard let windows = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
        die("window list unavailable", 1)
    }
    var found: [Found] = []
    for window in windows {
        guard window[kCGWindowOwnerPID as String] as? Int == pid,
              let id = window[kCGWindowNumber as String] as? Int,
              let bounds = window[kCGWindowBounds as String] as? [String: Any]
        else { continue }
        let layer = window[kCGWindowLayer as String] as? Int ?? 0
        if layer >= statusItemLayer { continue }
        // `floatingOnly` excludes layer 0 as well, leaving the band a floating
        // panel lives in (NSFloatingWindowLevel is 3). Only the .optionAll
        // fallback needs it: that list also contains the app's never-shown
        // helper windows, and one of them — 500x500 — has a LARGER area than
        // the 640x321 overlay, so "largest first" picked the wrong window and
        // wrote a fully transparent 1000x1000 PNG that still satisfied the
        // caller's bounds assertion.
        if floatingOnly && layer < 1 { continue }
        let width = bounds["Width"] as? Double ?? 0
        let height = bounds["Height"] as? Double ?? 0
        // A hidden or zero-sized window is not something worth screenshotting.
        if width < 1 || height < 1 { continue }
        found.append(Found(
            id: id,
            x: bounds["X"] as? Double ?? 0,
            y: bounds["Y"] as? Double ?? 0,
            width: width,
            height: height
        ))
    }
    return found
}

var found = panels([.optionOnScreenOnly, .excludeDesktopElements])

// Fallback, opt-in only (SHOOT_ALLOW_OFFSCREEN=1).
//
// `.optionOnScreenOnly` asks whether the window server is *compositing* the
// window, which is a strictly stronger condition than "the app has put it up".
// While every display is showing a full-screen app, this app's windows all
// report off-screen — its menu-bar status items included — so the on-screen
// pass finds nothing however many times the app re-presents the panel.
//
// `screencapture -l` still renders such a window from its backing store, so a
// shot is still possible; it just cannot show anything *behind* the window,
// because nothing behind it was ever composited. That makes this fallback fine
// for reading the panel's own content and wrong for judging translucency —
// shoot.sh says so loudly whenever it uses it.
if found.isEmpty, ProcessInfo.processInfo.environment["SHOOT_ALLOW_OFFSCREEN"] == "1" {
    found = panels([.optionAll, .excludeDesktopElements], floatingOnly: true)
}

if found.isEmpty {
    exit(1) // not an error: the caller polls until the panel appears
}
for window in found.sorted(by: { $0.area > $1.area }) {
    print("\(window.id)\t\(Int(window.x)),\(Int(window.y)),\(Int(window.width)),\(Int(window.height))")
}
