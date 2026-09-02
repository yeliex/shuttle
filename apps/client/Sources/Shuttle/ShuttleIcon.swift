import AppKit

@MainActor
enum ShuttleIcon {
    static let application = image(named: "ShuttleAppIcon")

    static let menuBar: NSImage = {
        let icon = image(named: "ShuttleMenuBar")
        icon.isTemplate = true
        icon.size = NSSize(width: 18, height: 18)
        return icon
    }()

    private static func image(named name: String) -> NSImage {
        guard
            let url = Bundle.module.url(forResource: name, withExtension: "svg"),
            let image = NSImage(contentsOf: url)
        else {
            return NSImage(size: NSSize(width: 18, height: 18))
        }

        return image
    }
}
