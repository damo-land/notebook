// swift-tools-version: 6.0
// Pure note-format + view-logic layer shared by the iOS app and its tests.
// No UIKit/SwiftUI here, so `swift test` runs on the Mac with no simulator.

import PackageDescription

let package = Package(
    name: "StashCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "StashCore", targets: ["StashCore"]),
    ],
    targets: [
        .target(name: "StashCore"),
        .testTarget(
            name: "StashCoreTests",
            dependencies: ["StashCore"],
            resources: [.copy("Fixtures")]
        ),
    ]
)
