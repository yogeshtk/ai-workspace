import AppKit

/// Snapshot what is on screen right now into a profile you can paste into config.json.
/// Captures the desktop currently visible on each display — repeat per desktop and merge.
enum Capture {
    static func run() throws -> URL {
        let ds = Displays.current()
        let spaces = Spaces.all()
        var rules: [Rule] = []

        for app in NSWorkspace.shared.runningApplications where app.activationPolicy == .regular {
            guard let bid = app.bundleIdentifier, bid != Bundle.main.bundleIdentifier else { continue }
            let windows = AX.windows(of: app).filter { $0.isStandard && !$0.isMinimized }
            for w in windows {
                guard let f = w.frame, let d = Displays.containing(f, in: ds) else { continue }
                let v = d.visibleFrame
                let unit = CGRect(x: (f.minX - v.minX) / v.width, y: (f.minY - v.minY) / v.height,
                                  width: f.width / v.width, height: f.height / v.height)
                var space: Int?
                if let wid = w.id {
                    let ids = Spaces.ids(forWindow: wid)
                    space = Spaces.spaces(for: d, in: spaces).first { ids.contains($0.id) }?.localIndex
                }
                // Only pin by title when an app has several windows (titles change, so edit these).
                let title = windows.count > 1 ? w.title.map { NSRegularExpression.escapedPattern(for: $0) } : nil
                rules.append(Rule(app: bid, title: title, display: Displays.ref(for: d, in: ds),
                                  space: space, layout: Layout.closest(to: unit)))
            }
        }

        let profile = Profile(
            name: "captured",
            match: DisplayMatch(displays: ds.map { Displays.ref(for: $0, in: ds) }, count: ds.count),
            launch: Array(Set(rules.map(\.app))).sorted(),
            rules: rules
        )
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        let data = try enc.encode(profile)

        let fmt = DateFormatter()
        fmt.dateFormat = "yyyy-MM-dd-HHmmss"
        try FileManager.default.createDirectory(at: ConfigStore.dir, withIntermediateDirectories: true)
        let url = ConfigStore.dir.appendingPathComponent("captured-\(fmt.string(from: Date())).json")
        try data.write(to: url)
        Log.info("captured \(rules.count) windows → \(url.path)")
        return url
    }

    /// Human-readable summary of displays and desktops, with the refs to use in config.
    static func displayReport(config: AppConfig) -> String {
        let ds = Displays.current()
        let spaces = Spaces.all()
        var lines: [String] = []
        for (i, d) in ds.enumerated() {
            let own = Spaces.spaces(for: d, in: spaces)
            let cur = own.first(where: \.isCurrent).map { " (now on \($0.localIndex))" } ?? ""
            var tags: [String] = []
            if d.isMain { tags.append("main") }
            tags.append(d.isBuiltin ? "builtin" : "external")
            lines.append("""
            \(i + 1). \(d.name) — \(tags.joined(separator: ", ")), \(Int(d.frame.width))×\(Int(d.frame.height)), serial \(d.serial)
                ref: "\(Displays.ref(for: d, in: ds))"  •  desktops: \(own.count)\(cur)
            """)
        }
        let p = Displays.bestProfile(config.profiles, for: ds)?.name ?? "none"
        lines.append("\nMatching profile: \(p)")
        if spaces.contains(where: { $0.displayUUID == "Main" }) && ds.count > 1 {
            lines.append("Note: \"Displays have separate Spaces\" is off — desktops are shared across displays.")
        }
        return lines.joined(separator: "\n")
    }
}
