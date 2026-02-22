// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "AgoraMac",
    platforms: [
        .macOS(.v13)
    ],
    targets: [
        .executableTarget(
            name: "AgoraMac",
            path: "Sources/AgoraMac",
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("SwiftUI"),
                .linkedFramework("UserNotifications"),
                .linkedFramework("AVFoundation"),
                .linkedFramework("WebKit")
            ]
        )
    ]
)
