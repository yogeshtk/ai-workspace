import AppKit
import CPrivate

/// Thin wrapper over an Accessibility (AX) window element.
final class Window {
    let element: AXUIElement
    let app: NSRunningApplication

    init(_ element: AXUIElement, app: NSRunningApplication) {
        self.element = element
        self.app = app
    }

    var title: String? { AX.string(element, kAXTitleAttribute) }
    var isStandard: Bool { AX.string(element, kAXSubroleAttribute) == kAXStandardWindowSubrole }
    var isMinimized: Bool { AX.bool(element, kAXMinimizedAttribute) ?? false }

    var id: CGWindowID? {
        var wid: CGWindowID = 0
        return _AXUIElementGetWindow(element, &wid) == .success && wid != 0 ? wid : nil
    }

    var frame: CGRect? {
        guard let p = AX.point(element, kAXPositionAttribute),
              let s = AX.size(element, kAXSizeAttribute) else { return nil }
        return CGRect(origin: p, size: s)
    }

    /// size → position → size: the first resize lets the window fit on the target display,
    /// the second fixes apps that clamp size against the display they were on.
    func setFrame(_ r: CGRect) {
        AX.withEnhancedUIDisabled(app) {
            AX.setSize(element, r.size)
            AX.setPoint(element, r.origin)
            AX.setSize(element, r.size)
        }
    }

    func unminimize() {
        AXUIElementSetAttributeValue(element, kAXMinimizedAttribute as CFString, kCFBooleanFalse)
    }

    /// A point on the title bar that is safe to "grab" for dragging (just right of the zoom button).
    func grabPoint() -> CGPoint? {
        if let zoom = AX.element(element, kAXZoomButtonAttribute),
           let p = AX.point(zoom, kAXPositionAttribute),
           let s = AX.size(zoom, kAXSizeAttribute) {
            return CGPoint(x: p.x + s.width + 6, y: p.y + s.height / 2)
        }
        guard let f = frame else { return nil }
        return CGPoint(x: f.minX + 80, y: f.minY + 10)
    }
}

enum AX {
    static func value(_ el: AXUIElement, _ attr: String) -> CFTypeRef? {
        var v: CFTypeRef?
        return AXUIElementCopyAttributeValue(el, attr as CFString, &v) == .success ? v : nil
    }

    static func string(_ el: AXUIElement, _ attr: String) -> String? { value(el, attr) as? String }
    static func bool(_ el: AXUIElement, _ attr: String) -> Bool? { value(el, attr) as? Bool }

    static func element(_ el: AXUIElement, _ attr: String) -> AXUIElement? {
        guard let v = value(el, attr), CFGetTypeID(v) == AXUIElementGetTypeID() else { return nil }
        return (v as! AXUIElement)
    }

    static func point(_ el: AXUIElement, _ attr: String) -> CGPoint? {
        guard let v = value(el, attr), CFGetTypeID(v) == AXValueGetTypeID() else { return nil }
        var p = CGPoint.zero
        return AXValueGetValue(v as! AXValue, .cgPoint, &p) ? p : nil
    }

    static func size(_ el: AXUIElement, _ attr: String) -> CGSize? {
        guard let v = value(el, attr), CFGetTypeID(v) == AXValueGetTypeID() else { return nil }
        var s = CGSize.zero
        return AXValueGetValue(v as! AXValue, .cgSize, &s) ? s : nil
    }

    static func setPoint(_ el: AXUIElement, _ p: CGPoint) {
        var p = p
        if let v = AXValueCreate(.cgPoint, &p) { AXUIElementSetAttributeValue(el, kAXPositionAttribute as CFString, v) }
    }

    static func setSize(_ el: AXUIElement, _ s: CGSize) {
        var s = s
        if let v = AXValueCreate(.cgSize, &s) { AXUIElementSetAttributeValue(el, kAXSizeAttribute as CFString, v) }
    }

    /// Windows the AX API can see for an app (in practice: those on currently visible desktops).
    static func windows(of app: NSRunningApplication) -> [Window] {
        let el = AXUIElementCreateApplication(app.processIdentifier)
        guard let arr = value(el, kAXWindowsAttribute) as? [AXUIElement] else { return [] }
        return arr.map { Window($0, app: app) }
    }

    /// Some apps (Chrome, Electron…) animate AX resizes when "enhanced UI" is on; turn it off while we move.
    static func withEnhancedUIDisabled(_ app: NSRunningApplication, _ body: () -> Void) {
        let el = AXUIElementCreateApplication(app.processIdentifier)
        let attr = "AXEnhancedUserInterface" as CFString
        var v: CFTypeRef?
        let wasOn = AXUIElementCopyAttributeValue(el, attr, &v) == .success && (v as? Bool) == true
        if wasOn { AXUIElementSetAttributeValue(el, attr, kCFBooleanFalse) }
        body()
        if wasOn { AXUIElementSetAttributeValue(el, attr, kCFBooleanTrue) }
    }
}
