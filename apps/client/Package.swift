// swift-tools-version: 6.1

import PackageDescription

let package = Package(
    name: "Shuttle",
    platforms: [
        .macOS(.v15),
    ],
    products: [
        .executable(name: "Shuttle", targets: ["Shuttle"]),
    ],
    dependencies: [
        .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.9.6"),
    ],
    targets: [
        .executableTarget(
            name: "Shuttle",
            dependencies: [
                .product(name: "Sparkle", package: "Sparkle"),
            ],
            resources: [
                .process("Resources"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("ApproachableConcurrency"),
            ],
        ),
        .testTarget(
            name: "ShuttleTests",
            dependencies: ["Shuttle"],
            swiftSettings: [
                .enableUpcomingFeature("ApproachableConcurrency"),
            ],
        ),
    ]
)
