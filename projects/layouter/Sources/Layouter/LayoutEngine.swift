import AppKit

/// Applies a profile: launch apps → place windows visible now → visit other desktops that
/// hold ruled windows → return to where you were. Runs on a background queue.
final class LayoutEngine {
    private let queue = DispatchQueue(label: "layouter.engine", qos: .userInitiated)
    private var isRunning = false                       // main thread only
    private var queued: (Profile, AppConfig)?           // main thread only

    var onStateChange: ((Bool) -> Void)?

    func apply(_ profile: Profile, config: AppConfig, onlyApp: String? = nil) {
        dispatchPrecondition(condition: .onQueue(.main))
        if isRunning {
            if onlyApp == nil { queued = (profile, config) }
            return
        }
        isRunning = true
        onStateChange?(true)
        queue.async {
            self.run(profile, config, onlyApp)
            DispatchQueue.main.async {
                self.isRunning = false
                self.onStateChange?(false)
                if let next = self.queued {
                    self.queued = nil
                    self.apply(next.0, config: next.1)
                }
            }
        }
    }

    // MARK: - Run

    private struct Job {
        let window: Window
        let wid: CGWindowID
        let display: Display
        let frame: CGRect?
        let space: Space?
    }

    private struct Context {
        let cfg: AppConfig
        let rules: [Rule]
        let displays: [Display]
        let spaces: [Space]
        var useSpaces: Bool { cfg.manageSpaces && !spaces.isEmpty }
    }

    private func run(_ profile: Profile, _ cfg: AppConfig, _ onlyApp: String?) {
        let started = Date()
        var rules = profile.rules ?? []
        if let onlyApp { rules = rules.filter { $0.app == onlyApp } }
        Log.info("apply '\(profile.name)'" + (onlyApp.map { " for \($0)" } ?? ""))

        if let onlyApp {
            Launcher.waitForWindows([onlyApp], timeout: cfg.launchTimeout)
        } else {
            let launched = Launcher.ensureRunning(profile.launch ?? [])
            let ruled = Set(rules.map(\.app))
            Launcher.waitForWindows(launched.filter { ruled.contains($0) }, timeout: cfg.launchTimeout)
        }
        guard !rules.isEmpty else { return }

        let ctx = Context(cfg: cfg, rules: rules, displays: Displays.current(),
                          spaces: cfg.manageSpaces ? Spaces.all() : [])
        // Desktops visible right now, main display last so focus returns there.
        let home = ctx.useSpaces
            ? ctx.displays.sorted { !$0.isMain && $1.isMain }.compactMap { Spaces.current(on: $0, in: ctx.spaces) }
            : []

        var done = Set<CGWindowID>()
        pass(ctx, home: home, done: &done)

        if ctx.useSpaces && onlyApp == nil {
            for space in desktopsToVisit(ctx, done: done) {
                guard Spaces.switchTo(space, delay: cfg.spaceSwitchDelay) else { continue }
                pass(ctx, home: [space], done: &done)
            }
        }
        returnHome(home, ctx)
        Log.info(String(format: "applied '%@' to %d windows in %.1fs", profile.name, done.count, Date().timeIntervalSince(started)))
    }

    /// Place every ruled window AX can see right now.
    private func pass(_ ctx: Context, home: [Space], done: inout Set<CGWindowID>) {
        var stays: [Job] = []
        var moves: [Job] = []
        let visible = Set(Spaces.all().filter(\.isCurrent).map(\.id))

        for app in NSWorkspace.shared.runningApplications where app.activationPolicy == .regular {
            guard let bid = app.bundleIdentifier, ctx.rules.contains(where: { $0.app == bid }) else { continue }
            for w in AX.windows(of: app) where w.isStandard {
                guard let wid = w.id, !done.contains(wid),
                      let rule = ctx.rules.first(where: { $0.app == bid && $0.matches(title: w.title) })
                else { continue }
                if w.isMinimized { w.unminimize(); Thread.sleep(forTimeInterval: 0.3) }

                let winSpaces = Spaces.ids(forWindow: wid)
                // Windows on hidden desktops are handled when we visit that desktop.
                if ctx.useSpaces && !winSpaces.isEmpty && winSpaces.isDisjoint(with: visible) { continue }

                guard let job = makeJob(w, wid: wid, rule: rule, ctx: ctx) else { continue }
                if let s = job.space, !winSpaces.contains(s.id) { moves.append(job) } else { stays.append(job) }
            }
        }

        for job in stays {
            if let f = job.frame { job.window.setFrame(f) }
            done.insert(job.wid)
        }
        for (i, job) in moves.enumerated() {
            if i > 0 { returnHome(home, ctx) }   // the previous drag left us on another desktop
            guard let target = job.space else { continue }
            // 1. Put it on the right display (lands on that display's visible desktop).
            if let f = job.frame { job.window.setFrame(f) }
            // 2. Carry it to the right desktop, unless step 1 already did.
            if !Spaces.ids(forWindow: job.wid).contains(target.id) {
                if !Spaces.move(job.window, to: target, delay: ctx.cfg.spaceSwitchDelay) {
                    Log.info("could not move \(job.window.app.bundleIdentifier ?? "?") to Desktop \(target.globalIndex)")
                }
            }
            // 3. Final placement on the destination desktop.
            if let f = job.frame { job.window.setFrame(f) }
            done.insert(job.wid)
        }
    }

    private func makeJob(_ w: Window, wid: CGWindowID, rule: Rule, ctx: Context) -> Job? {
        let current = w.frame
        var display: Display?
        if let ref = rule.display {
            display = Displays.resolve(ref, in: ctx.displays)
            if display == nil { Log.info("rule for \(rule.app): display '\(ref)' not connected — using current") }
        }
        if display == nil, let f = current { display = Displays.containing(f, in: ctx.displays) }
        guard let d = display ?? ctx.displays.first(where: \.isMain) else { return nil }

        var frame: CGRect?
        if let layout = rule.layout {
            frame = layout.frame(in: d.visibleFrame, gap: CGFloat(ctx.cfg.gap))
            if frame == nil { Log.info("rule for \(rule.app): unknown layout \(layout)") }
        } else if let f = current, !d.frame.contains(CGPoint(x: f.midX, y: f.midY)) {
            // No layout: keep size, centre on the target display.
            let size = CGSize(width: min(f.width, d.visibleFrame.width), height: min(f.height, d.visibleFrame.height))
            frame = CGRect(x: d.visibleFrame.midX - size.width / 2, y: d.visibleFrame.midY - size.height / 2,
                           width: size.width, height: size.height).integral
        }

        var space: Space?
        if ctx.useSpaces, let n = rule.space {
            space = Spaces.spaces(for: d, in: ctx.spaces)[safe: n - 1]
            if space == nil { Log.info("rule for \(rule.app): '\(d.name)' has no desktop \(n) — add it in Mission Control") }
        }
        return Job(window: w, wid: wid, display: d, frame: frame, space: space)
    }

    /// Desktops (not currently visible) that hold windows of ruled apps we haven't placed.
    private func desktopsToVisit(_ ctx: Context, done: Set<CGWindowID>) -> [Space] {
        let pids = Set(NSWorkspace.shared.runningApplications.compactMap { app -> pid_t? in
            guard let b = app.bundleIdentifier, ctx.rules.contains(where: { $0.app == b }) else { return nil }
            return app.processIdentifier
        })
        guard let info = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID)
                as? [[String: Any]] else { return [] }

        var wanted = Set<UInt64>()
        for w in info {
            guard let pid = (w[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value, pids.contains(pid),
                  (w[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
                  let wid = (w[kCGWindowNumber as String] as? NSNumber)?.uint32Value, !done.contains(wid)
            else { continue }
            if let b = w[kCGWindowBounds as String] as? NSDictionary,
               let r = CGRect(dictionaryRepresentation: b as CFDictionary), r.width < 100 || r.height < 100 { continue }
            wanted.formUnion(Spaces.ids(forWindow: wid))
        }
        return Spaces.all().filter { wanted.contains($0.id) && !$0.isCurrent }
    }

    private func returnHome(_ home: [Space], _ ctx: Context) {
        for s in home where !Spaces.isCurrent(s) {
            Spaces.switchTo(s, delay: ctx.cfg.spaceSwitchDelay)
        }
    }
}
