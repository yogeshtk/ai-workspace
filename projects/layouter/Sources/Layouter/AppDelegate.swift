import AppKit
import ServiceManagement

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private var statusItem: NSStatusItem!
    private var config = AppConfig.empty
    private let engine = LayoutEngine()
    private var displaySignature = ""
    private var pendingDisplayCheck: DispatchWorkItem?

    /// Profile picked by hand from the menu; cleared whenever displays change.
    private var manualProfile: String? {
        get { UserDefaults.standard.string(forKey: "manualProfile") }
        set { UserDefaults.standard.set(newValue, forKey: "manualProfile") }
    }

    // MARK: - Lifecycle

    func applicationWillFinishLaunching(_ notification: Notification) {
        // layouter://apply, layouter://apply?profile=work, layouter://auto, layouter://capture, layouter://reload
        NSAppleEventManager.shared().setEventHandler(
            self, andSelector: #selector(handleURL(_:reply:)),
            forEventClass: AEEventClass(kInternetEventClass), andEventID: AEEventID(kAEGetURL))
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        Log.rotate()
        Log.info("Layouter started")
        AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), 1.0) // never hang on a stuck app

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.image = NSImage(systemSymbolName: "rectangle.3.group", accessibilityDescription: "Layouter")
        let menu = NSMenu()
        menu.delegate = self
        statusItem.menu = menu
        engine.onStateChange = { [weak self] busy in self?.statusItem.button?.appearsDisabled = busy }

        reloadConfig(showErrors: true)
        _ = accessibilityTrusted(prompt: true)

        NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
        ) { [weak self] _ in self?.scheduleDisplayCheck() }

        let ws = NSWorkspace.shared.notificationCenter
        ws.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
            self?.scheduleDisplayCheck()
        }
        ws.addObserver(forName: NSWorkspace.didLaunchApplicationNotification, object: nil, queue: .main) { [weak self] note in
            self?.appLaunched(note)
        }

        displaySignature = Displays.signature(Displays.current())
        DispatchQueue.main.asyncAfter(deadline: .now() + config.settleDelay) { [weak self] in
            self?.applyActive(reason: "startup")
        }
    }

    // MARK: - Triggers

    private func scheduleDisplayCheck() {
        pendingDisplayCheck?.cancel()
        let item = DispatchWorkItem { [weak self] in
            guard let self else { return }
            let sig = Displays.signature(Displays.current())
            guard sig != self.displaySignature else { return }   // dock/menu-bar changes etc.
            self.displaySignature = sig
            self.manualProfile = nil
            self.applyActive(reason: "displays changed")
        }
        pendingDisplayCheck = item
        DispatchQueue.main.asyncAfter(deadline: .now() + config.settleDelay, execute: item)
    }

    private func appLaunched(_ note: Notification) {
        guard config.applyOnAppLaunch,
              let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
              let bid = app.bundleIdentifier,
              let profile = activeProfile(),
              profile.rules?.contains(where: { $0.app == bid }) == true,
              accessibilityTrusted(prompt: false) else { return }
        engine.apply(profile, config: config, onlyApp: bid)
    }

    private func activeProfile() -> Profile? {
        if let m = manualProfile, let p = config.profiles.first(where: { $0.name == m }) { return p }
        return Displays.bestProfile(config.profiles, for: Displays.current())
    }

    private func applyActive(reason: String) {
        guard accessibilityTrusted(prompt: false) else {
            Log.info("\(reason): skipped — Accessibility permission not granted")
            return
        }
        guard let p = activeProfile() else {
            Log.info("\(reason): no profile matches displays [\(Displays.current().map(\.name).joined(separator: ", "))]")
            return
        }
        Log.info("\(reason) → profile '\(p.name)'")
        engine.apply(p, config: config)
    }

    // MARK: - Menu

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        let ds = Displays.current()
        let auto = Displays.bestProfile(config.profiles, for: ds)
        let active = activeProfile()

        menu.addItem(label("Profile: \(active?.name ?? "none")" + (manualProfile == nil ? " (auto)" : " (manual)")))
        menu.addItem(label("\(ds.count) display\(ds.count == 1 ? "" : "s"): \(ds.map(\.name).joined(separator: ", "))"))
        if !accessibilityTrusted(prompt: false) {
            menu.addItem(item("⚠︎ Grant Accessibility Access…", #selector(openAccessibilitySettings)))
        }
        menu.addItem(.separator())
        menu.addItem(item("Apply Layout", #selector(applyNow), key: "l"))

        let sub = NSMenu()
        let autoItem = item("Automatic" + (auto.map { " (\($0.name))" } ?? ""), #selector(selectProfile(_:)))
        autoItem.state = manualProfile == nil ? .on : .off
        sub.addItem(autoItem)
        sub.addItem(.separator())
        for p in config.profiles {
            let i = item(p.name, #selector(selectProfile(_:)), rep: p.name)
            i.state = manualProfile == p.name ? .on : .off
            sub.addItem(i)
        }
        let profiles = NSMenuItem(title: "Use Profile", action: nil, keyEquivalent: "")
        profiles.submenu = sub
        menu.addItem(profiles)

        menu.addItem(.separator())
        menu.addItem(item("Capture Current Layout", #selector(capture)))
        menu.addItem(item("Show Displays & Desktops", #selector(showDisplays)))
        menu.addItem(item("Edit Config", #selector(editConfig), key: ","))
        menu.addItem(item("Reload Config", #selector(reloadFromMenu), key: "r"))
        menu.addItem(item("Open Log", #selector(openLog)))
        menu.addItem(.separator())
        let login = item("Launch at Login", #selector(toggleLogin))
        login.state = SMAppService.mainApp.status == .enabled ? .on : .off
        menu.addItem(login)
        menu.addItem(item("Quit Layouter", #selector(NSApplication.terminate(_:)), key: "q", target: NSApp))
    }

    private func item(_ title: String, _ action: Selector, key: String = "", rep: Any? = nil, target: AnyObject? = nil) -> NSMenuItem {
        let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
        i.target = target ?? self
        i.representedObject = rep
        return i
    }

    private func label(_ title: String) -> NSMenuItem {
        let i = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        i.isEnabled = false
        return i
    }

    // MARK: - Actions

    @objc private func applyNow() { applyActive(reason: "manual") }

    @objc private func selectProfile(_ sender: NSMenuItem) {
        manualProfile = sender.representedObject as? String
        applyActive(reason: "profile selected")
    }

    @objc private func capture() {
        guard accessibilityTrusted(prompt: true) else { return }
        do {
            NSWorkspace.shared.open(try Capture.run())
        } catch {
            alert("Capture failed", error.localizedDescription)
        }
    }

    @objc private func showDisplays() {
        alert("Displays & Desktops", Capture.displayReport(config: config))
    }

    @objc private func editConfig() {
        if !FileManager.default.fileExists(atPath: ConfigStore.file.path) { try? ConfigStore.writeExample() }
        NSWorkspace.shared.open(ConfigStore.file)
    }

    @objc private func reloadFromMenu() {
        if reloadConfig(showErrors: true) { applyActive(reason: "config reloaded") }
    }

    @objc private func openLog() { NSWorkspace.shared.open(Log.url) }

    @objc private func openAccessibilitySettings() {
        _ = accessibilityTrusted(prompt: true)
        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!)
    }

    @objc private func toggleLogin() {
        do {
            if SMAppService.mainApp.status == .enabled {
                try SMAppService.mainApp.unregister()
            } else {
                try SMAppService.mainApp.register()
            }
        } catch {
            alert("Couldn't change login item", error.localizedDescription)
        }
    }

    @objc private func handleURL(_ event: NSAppleEventDescriptor, reply: NSAppleEventDescriptor) {
        guard let s = event.paramDescriptor(forKeyword: AEKeyword(keyDirectObject))?.stringValue,
              let comps = URLComponents(string: s) else { return }
        let profile = comps.queryItems?.first { $0.name == "profile" }?.value
        switch comps.host {
        case "apply":
            if let profile { manualProfile = profile }
            applyActive(reason: "url")
        case "auto":
            manualProfile = nil
            applyActive(reason: "url")
        case "capture": capture()
        case "reload": reloadFromMenu()
        default: Log.info("unknown url \(s)")
        }
    }

    // MARK: - Helpers

    @discardableResult
    private func reloadConfig(showErrors: Bool) -> Bool {
        do {
            config = try ConfigStore.load()
            Log.info("config loaded: \(config.profiles.map(\.name).joined(separator: ", "))")
            return true
        } catch {
            Log.info("config error: \(error)")
            if showErrors { alert("Config error in \(ConfigStore.file.path)", String(describing: error)) }
            return false
        }
    }

    private func accessibilityTrusted(prompt: Bool) -> Bool {
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        return AXIsProcessTrustedWithOptions([key: prompt] as CFDictionary)
    }

    private func alert(_ title: String, _ text: String) {
        NSApp.activate(ignoringOtherApps: true)
        let a = NSAlert()
        a.messageText = title
        a.informativeText = text
        a.runModal()
    }
}
