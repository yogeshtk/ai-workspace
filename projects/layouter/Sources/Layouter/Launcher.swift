import AppKit

enum Launcher {
    static func running(_ bundleID: String) -> NSRunningApplication? {
        NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).first { !$0.isTerminated }
    }

    /// Launch (in the background) every app in `bundleIDs` that isn't running.
    /// Returns the bundle IDs that were launched.
    @discardableResult
    static func ensureRunning(_ bundleIDs: [String]) -> [String] {
        var launched: [String] = []
        for id in bundleIDs where running(id) == nil {
            guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: id) else {
                Log.info("launch: no app installed with bundle id \(id)")
                continue
            }
            let cfg = NSWorkspace.OpenConfiguration()
            cfg.activates = false
            cfg.addsToRecentItems = false
            let done = DispatchSemaphore(value: 0)
            NSWorkspace.shared.openApplication(at: url, configuration: cfg) { _, error in
                if let error { Log.info("launch \(id) failed: \(error.localizedDescription)") }
                done.signal()
            }
            _ = done.wait(timeout: .now() + 10)
            Log.info("launched \(id)")
            launched.append(id)
        }
        return launched
    }

    /// Block until each app shows a standard window (or timeout).
    static func waitForWindows(_ bundleIDs: [String], timeout: Double) {
        var remaining = Set(bundleIDs)
        let deadline = Date().addingTimeInterval(timeout)
        while !remaining.isEmpty && Date() < deadline {
            remaining = remaining.filter { id in
                guard let app = running(id) else { return true }
                return !AX.windows(of: app).contains { $0.isStandard }
            }
            if !remaining.isEmpty { Thread.sleep(forTimeInterval: 0.3) }
        }
        if !remaining.isEmpty { Log.info("no window yet from: \(remaining.sorted().joined(separator: ", "))") }
        Thread.sleep(forTimeInterval: 0.5) // let restored windows finish appearing
    }
}
