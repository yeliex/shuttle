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
            let url = resourceURL(named: name),
            let image = NSImage(contentsOf: url)
        else {
            return NSImage(size: NSSize(width: 18, height: 18))
        }

        return image
    }

    private static func resourceURL(named name: String) -> URL? {
        let bundleName = "Shuttle_Shuttle.bundle"
        let candidateURLs = [Bundle.main.resourceURL, Bundle.main.bundleURL]
            .compactMap { $0?.appending(path: bundleName, directoryHint: .isDirectory) }

        for candidateURL in candidateURLs {
            if let bundle = Bundle(url: candidateURL),
               let url = bundle.url(forResource: name, withExtension: "svg") {
                return url
            }
        }

        return nil
    }
}
