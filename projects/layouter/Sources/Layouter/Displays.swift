import AppKit

struct Display {
    let id: CGDirectDisplayID
    let name: String
    let isBuiltin: Bool
    let isMain: Bool
    let serial: UInt32
    let uuid: String
    /// Global coordinates, origin at top-left of the primary display (same space as the AX API).
    let frame: CGRect
    /// Frame minus menu bar and Dock.
    let visibleFrame: CGRect
}

enum Displays {
    /// All connected displays, sorted left-to-right then top-to-bottom.
    static func current() -> [Display] {
        guard let primary = NSScreen.screens.first else { return [] }
        let primaryHeight = primary.frame.height
        let mainID = CGMainDisplayID()

        let list: [Display] = NSScreen.screens.compactMap { screen in
            guard let num = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber
            else { return nil }
            let id = CGDirectDisplayID(num.uint32Value)
            return Display(
                id: id,
                name: screen.localizedName,
                isBuiltin: CGDisplayIsBuiltin(id) != 0,
                isMain: id == mainID,
                serial: CGDisplaySerialNumber(id),
                uuid: uuidString(id),
                frame: flip(screen.frame, primaryHeight),
                visibleFrame: flip(screen.visibleFrame, primaryHeight)
            )
        }
        return list.sorted { ($0.frame.minX, $0.frame.minY) < ($1.frame.minX, $1.frame.minY) }
    }

    /// Changes whenever a display is added/removed/rearranged/resized.
    static func signature(_ ds: [Display]) -> String {
        ds.map { "\($0.id):\($0.name):\(Int($0.frame.minX)),\(Int($0.frame.minY)),\(Int($0.frame.width))x\(Int($0.frame.height))" }
            .joined(separator: "|")
    }

    /// AppKit (bottom-left origin) → global top-left origin.
    private static func flip(_ r: CGRect, _ primaryHeight: CGFloat) -> CGRect {
        CGRect(x: r.minX, y: primaryHeight - r.maxY, width: r.width, height: r.height)
    }

    private static func uuidString(_ id: CGDirectDisplayID) -> String {
        guard let uuid = CGDisplayCreateUUIDFromDisplayID(id)?.takeRetainedValue() else { return "" }
        return CFUUIDCreateString(nil, uuid) as String
    }

    /// Display references used in config:
    ///   "main" | "primary"            – display with the menu bar
    ///   "builtin" | "laptop"          – the MacBook screen
    ///   "external" | "external:2"     – 1st / 2nd external display, left to right
    ///   "left" | "right"              – leftmost / rightmost display
    ///   "index:3"                     – 3rd display, left to right
    ///   "serial:12345"                – exact serial number
    ///   "DELL U2723QE" | "DELL#2"     – name substring, optional #N for identical monitors (left to right)
    static func resolve(_ ref: String, in ds: [Display]) -> Display? {
        let l = ref.trimmingCharacters(in: .whitespaces).lowercased()
        switch l {
        case "main", "primary": return ds.first { $0.isMain }
        case "builtin", "built-in", "internal", "laptop": return ds.first { $0.isBuiltin }
        case "external": return ds.first { !$0.isBuiltin }
        case "left", "leftmost": return ds.first
        case "right", "rightmost": return ds.last
        default: break
        }
        if l.hasPrefix("external:"), let n = Int(l.dropFirst(9)) {
            return ds.filter { !$0.isBuiltin }[safe: n - 1]
        }
        if l.hasPrefix("index:"), let n = Int(l.dropFirst(6)) {
            return ds[safe: n - 1]
        }
        if l.hasPrefix("serial:") {
            let s = String(l.dropFirst(7))
            return ds.first { String($0.serial) == s }
        }
        var name = l
        var nth = 1
        if let hash = l.lastIndex(of: "#"), let n = Int(l[l.index(after: hash)...]) {
            name = String(l[..<hash]).trimmingCharacters(in: .whitespaces)
            nth = n
        }
        return ds.filter { $0.name.lowercased().contains(name) }[safe: nth - 1]
    }

    static func matches(_ p: Profile, _ ds: [Display]) -> Bool {
        if let c = p.match.count, c != ds.count { return false }
        return (p.match.displays ?? []).allSatisfy { resolve($0, in: ds) != nil }
    }

    /// Most specific matching profile wins; ties go to the one listed first.
    static func bestProfile(_ profiles: [Profile], for ds: [Display]) -> Profile? {
        var best: (profile: Profile, score: Int)?
        for p in profiles where matches(p, ds) {
            let score = (p.match.count != nil ? 100 : 0) + (p.match.displays?.count ?? 0)
            if best == nil || score > best!.score { best = (p, score) }
        }
        return best?.profile
    }

    /// Display holding the largest part of `rect`.
    static func containing(_ rect: CGRect, in ds: [Display]) -> Display? {
        ds.max { a, b in
            let ia = a.frame.intersection(rect), ib = b.frame.intersection(rect)
            return (ia.isNull ? 0 : ia.width * ia.height) < (ib.isNull ? 0 : ib.width * ib.height)
        }
    }

    /// Stable, human-readable reference for a display (used by Capture / info).
    static func ref(for d: Display, in ds: [Display]) -> String {
        if d.isBuiltin { return "builtin" }
        let same = ds.filter { $0.name == d.name }
        if same.count > 1, let i = same.firstIndex(where: { $0.id == d.id }) { return "\(d.name)#\(i + 1)" }
        return d.name
    }
}
