import AppKit
import CPrivate

/// A user desktop (fullscreen-app spaces are ignored).
struct Space {
    let id: UInt64
    let displayUUID: String  // "Main" when "Displays have separate Spaces" is off
    let localIndex: Int      // 1-based, per display
    let globalIndex: Int     // 1-based "Desktop N" number used by Ctrl+N
    let isCurrent: Bool
}

/// macOS has no public Spaces API. Reading uses private CGS calls (stable for years);
/// switching uses the Ctrl+N "Switch to Desktop N" shortcuts; moving a window drags it
/// by its title bar while switching desktops — the same thing you'd do by hand.
enum Spaces {
    private static let cid = CGSMainConnectionID()
    private static let digitKeys: [CGKeyCode] = [18, 19, 20, 21, 23, 22, 26, 28, 25] // 1…9

    static func all() -> [Space] {
        guard let cf = CGSCopyManagedDisplaySpaces(cid),
              let displays = (cf as NSArray) as? [[String: Any]] else { return [] }
        var result: [Space] = []
        var global = 0
        for entry in displays {
            let uuid = entry["Display Identifier"] as? String ?? ""
            let currentID = ((entry["Current Space"] as? [String: Any])?["ManagedSpaceID"] as? NSNumber)?.uint64Value
            var local = 0
            for s in entry["Spaces"] as? [[String: Any]] ?? [] {
                guard ((s["type"] as? NSNumber)?.intValue ?? 0) == 0,
                      let id = (s["ManagedSpaceID"] as? NSNumber)?.uint64Value else { continue }
                local += 1
                global += 1
                result.append(Space(id: id, displayUUID: uuid, localIndex: local,
                                    globalIndex: global, isCurrent: id == currentID))
            }
        }
        return result
    }

    static func spaces(for d: Display, in all: [Space]) -> [Space] {
        if all.contains(where: { $0.displayUUID == "Main" }) { return all }
        return all.filter { $0.displayUUID.caseInsensitiveCompare(d.uuid) == .orderedSame }
    }

    static func current(on d: Display, in all: [Space]) -> Space? {
        spaces(for: d, in: all).first { $0.isCurrent }
    }

    static func ids(forWindow wid: CGWindowID) -> Set<UInt64> {
        let arr = [NSNumber(value: wid)] as CFArray
        guard let cf = CGSCopySpacesForWindows(cid, 0x7, arr),
              let res = (cf as NSArray) as? [NSNumber] else { return [] }
        return Set(res.map { $0.uint64Value })
    }

    static func isCurrent(_ space: Space) -> Bool {
        all().contains { $0.id == space.id && $0.isCurrent }
    }

    @discardableResult
    static func switchTo(_ space: Space, delay: Double) -> Bool {
        if isCurrent(space) { return true }
        guard space.globalIndex <= digitKeys.count else {
            Log.info("desktop \(space.globalIndex) > 9 — can't switch by shortcut")
            return false
        }
        postKey(digitKeys[space.globalIndex - 1], flags: .maskControl)
        Thread.sleep(forTimeInterval: delay)
        let ok = isCurrent(space)
        if !ok {
            Log.info("switch to Desktop \(space.globalIndex) failed — enable System Settings › Keyboard › Keyboard Shortcuts › Mission Control › \"Switch to Desktop \(space.globalIndex)\"")
        }
        return ok
    }

    /// Drag the window by its title bar and press Ctrl+N; the window travels with the drag.
    static func move(_ window: Window, to space: Space, delay: Double) -> Bool {
        guard space.globalIndex <= digitKeys.count, let grab = window.grabPoint() else { return false }
        let restore = CGEvent(source: nil)?.location ?? grab
        let src = CGEventSource(stateID: .hidSystemState)
        func mouse(_ type: CGEventType, _ p: CGPoint) {
            CGEvent(mouseEventSource: src, mouseType: type, mouseCursorPosition: p, mouseButton: .left)?
                .post(tap: .cghidEventTap)
        }
        let dragged = CGPoint(x: grab.x + 1, y: grab.y)
        mouse(.mouseMoved, grab);          usleep(40_000)
        mouse(.leftMouseDown, grab);       usleep(80_000)
        mouse(.leftMouseDragged, dragged); usleep(80_000)
        postKey(digitKeys[space.globalIndex - 1], flags: .maskControl)
        Thread.sleep(forTimeInterval: delay)
        mouse(.leftMouseUp, dragged);      usleep(60_000)
        CGWarpMouseCursorPosition(restore)

        guard let wid = window.id else { return false }
        return ids(forWindow: wid).contains(space.id)
    }

    private static func postKey(_ key: CGKeyCode, flags: CGEventFlags) {
        let src = CGEventSource(stateID: .hidSystemState)
        let down = CGEvent(keyboardEventSource: src, virtualKey: key, keyDown: true)
        let up = CGEvent(keyboardEventSource: src, virtualKey: key, keyDown: false)
        down?.flags = flags
        up?.flags = flags
        down?.post(tap: .cghidEventTap)
        up?.post(tap: .cghidEventTap)
    }
}
