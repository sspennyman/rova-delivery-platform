// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "RivoMileageCore",
    platforms: [.macOS(.v13), .iOS(.v17)],
    products: [.library(name: "RivoMileageCore", targets: ["RivoMileageCore"])],
    targets: [
        .target(name: "RivoMileageCore", path: "Core", linkerSettings: [.linkedLibrary("sqlite3")]),
        .testTarget(name: "RivoMileageCoreTests", dependencies: ["RivoMileageCore"], path: "Tests")
    ]
)
