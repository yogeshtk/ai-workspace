// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "Layouter",
    platforms: [.macOS(.v13)],
    targets: [
        // Declarations for the handful of private macOS APIs needed for Spaces.
        .target(name: "CPrivate", path: "Sources/CPrivate"),
        .executableTarget(
            name: "Layouter",
            dependencies: ["CPrivate"],
            path: "Sources/Layouter",
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("ApplicationServices"),
                .linkedFramework("ServiceManagement"),
            ]
        ),
    ]
)
