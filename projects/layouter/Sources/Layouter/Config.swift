import Foundation
import CoreGraphics

// MARK: - Model

struct AppConfig: Codable {
    /// Seconds to wait after displays change (or wake) before applying — lets macOS settle.
    var settleDelay: Double = 1.5
    /// Seconds to wait after switching desktops (lower if "Reduce motion" is on).
    var spaceSwitchDelay: Double = 0.7
    /// Max seconds to wait for a freshly launched app to show its first window.
    var launchTimeout: Double = 20
    /// Move windows between desktops (Spaces). Needs "Switch to Desktop N" shortcuts enabled.
    var manageSpaces: Bool = true
    /// Place an app's windows when it is launched later (by you), using the active profile.
    var applyOnAppLaunch: Bool = true
    /// Pixels of space between windows and screen edges.
    var gap: Double = 0
    var profiles: [Profile] = []

    static let empty = AppConfig()

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = AppConfig()
        settleDelay = try c.decodeIfPresent(Double.self, forKey: .settleDelay) ?? d.settleDelay
        spaceSwitchDelay = try c.decodeIfPresent(Double.self, forKey: .spaceSwitchDelay) ?? d.spaceSwitchDelay
        launchTimeout = try c.decodeIfPresent(Double.self, forKey: .launchTimeout) ?? d.launchTimeout
        manageSpaces = try c.decodeIfPresent(Bool.self, forKey: .manageSpaces) ?? d.manageSpaces
        applyOnAppLaunch = try c.decodeIfPresent(Bool.self, forKey: .applyOnAppLaunch) ?? d.applyOnAppLaunch
        gap = try c.decodeIfPresent(Double.self, forKey: .gap) ?? d.gap
        profiles = try c.decode([Profile].self, forKey: .profiles)
    }
}

/// One environment (work / home / laptop-only…), selected by which displays are connected.
struct Profile: Codable {
    var name: String
    var match: DisplayMatch
    /// Bundle IDs to launch if not already running.
    var launch: [String]?
    /// Window placement rules. First matching rule wins for each window.
    var rules: [Rule]?
}

struct DisplayMatch: Codable {
    /// Display references that must all be present (see Displays.resolve for syntax).
    var displays: [String]?
    /// Exact number of connected displays, if set.
    var count: Int?
}

struct Rule: Codable {
    /// Bundle ID, e.g. "com.google.Chrome".
    var app: String
    /// Optional regex matched (case-insensitively) against the window title.
    var title: String?
    /// Display reference; defaults to the display the window is already on.
    var display: String?
    /// 1-based desktop number *on that display*.
    var space: Int?
    /// Named preset or {x,y,w,h} fractions of the display's usable area. Omit to keep size.
    var layout: Layout?

    func matches(title windowTitle: String?) -> Bool {
        guard let pattern = title, !pattern.isEmpty else { return true }
        guard let t = windowTitle else { return false }
        return t.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
    }
}

enum Layout: Codable, Equatable {
    case named(String)
    case fraction(CGRect)

    private struct Frac: Codable { var x, y, w, h: Double }

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let s = try? c.decode(String.self) {
            self = .named(s)
        } else {
            let f = try c.decode(Frac.self)
            self = .fraction(CGRect(x: f.x, y: f.y, width: f.w, height: f.h))
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .named(let s): try c.encode(s)
        case .fraction(let r): try c.encode(Frac(x: r.minX, y: r.minY, w: r.width, h: r.height))
        }
    }

    /// Unit rects, origin top-left.
    static let presets: [String: CGRect] = [
        "maximize":         CGRect(x: 0,     y: 0,   width: 1,     height: 1),
        "left-half":        CGRect(x: 0,     y: 0,   width: 0.5,   height: 1),
        "right-half":       CGRect(x: 0.5,   y: 0,   width: 0.5,   height: 1),
        "top-half":         CGRect(x: 0,     y: 0,   width: 1,     height: 0.5),
        "bottom-half":      CGRect(x: 0,     y: 0.5, width: 1,     height: 0.5),
        "left-third":       CGRect(x: 0,     y: 0,   width: 1.0/3, height: 1),
        "center-third":     CGRect(x: 1.0/3, y: 0,   width: 1.0/3, height: 1),
        "right-third":      CGRect(x: 2.0/3, y: 0,   width: 1.0/3, height: 1),
        "left-two-thirds":  CGRect(x: 0,     y: 0,   width: 2.0/3, height: 1),
        "right-two-thirds": CGRect(x: 1.0/3, y: 0,   width: 2.0/3, height: 1),
        "top-left":         CGRect(x: 0,     y: 0,   width: 0.5,   height: 0.5),
        "top-right":        CGRect(x: 0.5,   y: 0,   width: 0.5,   height: 0.5),
        "bottom-left":      CGRect(x: 0,     y: 0.5, width: 0.5,   height: 0.5),
        "bottom-right":     CGRect(x: 0.5,   y: 0.5, width: 0.5,   height: 0.5),
        "center":           CGRect(x: 0.15,  y: 0.1, width: 0.7,   height: 0.8),
    ]

    var unitRect: CGRect? {
        switch self {
        case .named(let s):
            let key = s.lowercased()
            return Layout.presets[key == "full" || key == "fill" ? "maximize" : key]
        case .fraction(let r):
            return r
        }
    }

    /// Frame in global top-left coordinates for a display's usable area.
    func frame(in visible: CGRect, gap: CGFloat) -> CGRect? {
        guard let u = unitRect else { return nil }
        let area = visible.insetBy(dx: gap / 2, dy: gap / 2)
        let r = CGRect(x: area.minX + u.minX * area.width,
                       y: area.minY + u.minY * area.height,
                       width: u.width * area.width,
                       height: u.height * area.height)
        return r.insetBy(dx: gap / 2, dy: gap / 2).integral
    }

    /// Used by Capture: snap a measured unit rect to a preset when close.
    static func closest(to u: CGRect, tolerance: CGFloat = 0.03) -> Layout {
        for name in presets.keys.sorted() {
            let p = presets[name]!
            if abs(p.minX - u.minX) < tolerance, abs(p.minY - u.minY) < tolerance,
               abs(p.width - u.width) < tolerance, abs(p.height - u.height) < tolerance {
                return .named(name)
            }
        }
        func r(_ v: CGFloat) -> CGFloat { (v * 1000).rounded() / 1000 }
        return .fraction(CGRect(x: r(u.minX), y: r(u.minY), width: r(u.width), height: r(u.height)))
    }
}

// MARK: - Storage

enum ConfigStore {
    static let dir = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(".config/layouter", isDirectory: true)
    static let file = dir.appendingPathComponent("config.json")

    static func load() throws -> AppConfig {
        if !FileManager.default.fileExists(atPath: file.path) {
            try writeExample()
        }
        let data = try Data(contentsOf: file)
        return try JSONDecoder().decode(AppConfig.self, from: data)
    }

    static func writeExample() throws {
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        if let bundled = Bundle.main.url(forResource: "config.example", withExtension: "json") {
            try FileManager.default.copyItem(at: bundled, to: file)
        } else {
            try Data(#"{ "profiles": [] }"#.utf8).write(to: file)
        }
        Log.info("wrote starter config to \(file.path)")
    }
}

extension Array {
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}
