import AppKit
import WebKit

@MainActor
final class RelayDelegate: NSObject, NSApplicationDelegate, NSPopoverDelegate, WKNavigationDelegate, WKScriptMessageHandlerWithReply {
    var statusItem: NSStatusItem!
    let popover = NSPopover()
    var webView: WKWebView!
    var service: Process?
    var serviceInput: Pipe?
    var servicePort: Int = 0
    var browserWindow: NSWindow?
    var localMonitor: Any?
    var showOnReady = !ProcessInfo.processInfo.arguments.contains("--background")

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        NSApp.appearance = NSAppearance(named: .aqua)
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = statusItem.button {
            button.image = NSImage(systemSymbolName: "arrow.up.arrow.down", accessibilityDescription: "Relay")
            button.target = self
            button.action = #selector(toggle)
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "clipboard")
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 490, height: 790), configuration: configuration)
        webView.navigationDelegate = self
        webView.setValue(false, forKey: "drawsBackground")
        let controller = NSViewController()
        controller.view = webView
        popover.contentViewController = controller
        popover.contentSize = NSSize(width: 490, height: 790)
        popover.behavior = .transient
        popover.animates = true
        popover.delegate = self
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            if event.modifierFlags.contains(.command) && event.charactersIgnoringModifiers == "q" {
                NSApp.terminate(nil); return nil
            }
            return event
        }
        let mainMenu=NSMenu()
        let appItem=NSMenuItem(); let appMenu=NSMenu(title:"Relay")
        appMenu.addItem(withTitle:"Relayを終了",action:#selector(quit),keyEquivalent:"q").target=self
        appItem.submenu=appMenu;mainMenu.addItem(appItem)
        let editItem=NSMenuItem();let editMenu=NSMenu(title:"編集")
        for (title,selector,key) in [("取り消す","undo:","z"),("切り取り","cut:","x"),("コピー","copy:","c"),("貼り付け","paste:","v"),("すべてを選択","selectAll:","a")] {
            editMenu.addItem(withTitle:title,action:Selector(selector),keyEquivalent:key)
        }
        editItem.submenu=editMenu;mainMenu.addItem(editItem);NSApp.mainMenu=mainMenu
        startService()
    }

    func startService() {
        guard let resources = Bundle.main.resourceURL else { return }
        let project = resources.appendingPathComponent("app")
        let options = [ProcessInfo.processInfo.environment["RELAY_NODE"], "/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"].compactMap { $0 }
        guard let node = options.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) else {
            showError("Node.js 22.13以降をインストールしてください。")
            return
        }
        let data = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("GlassRelay")
        let process = Process()
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = [project.appendingPathComponent("server/index.mjs").path]
        process.currentDirectoryURL = project
        var environment = ProcessInfo.processInfo.environment
        environment["RELAY_DATA_DIR"] = data.path
        environment["RELAY_PORT"] = "0"
        environment["PATH"] = "/opt/homebrew/bin:/usr/local/bin:\(NSHomeDirectory())/.local/bin:" + (environment["PATH"] ?? "/usr/bin:/bin")
        if ProcessInfo.processInfo.arguments.contains("--demo") { environment["RELAY_DEMO"] = "1" }
        environment["RELAY_NATIVE"] = "1"
        process.environment = environment
        let input = Pipe()
        process.standardInput = input
        serviceInput = input
        let output = Pipe()
        process.standardOutput = output
        process.standardError = FileHandle.standardError
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let chunk = handle.availableData
            if chunk.isEmpty { handle.readabilityHandler = nil; return }
            guard let text = String(data: chunk, encoding: .utf8) else { return }
            if text.contains("RelayOpen") {
                Task { @MainActor in if let self, !self.popover.isShown { self.toggle() } }
            }
            guard let range = text.range(of: "http://127.0.0.1:") else { return }
            let portString = text[range.upperBound...].prefix(while: { $0.isNumber })
            guard let port = Int(portString) else { return }
            Task { @MainActor in
                guard let self, self.servicePort == 0 else { return }
                self.servicePort = port
                self.webView.load(URLRequest(url: URL(string: "http://127.0.0.1:\(port)/?compact=1&native=1")!))
            }
        }
        process.terminationHandler = { [weak self] process in
            Task { @MainActor in
                guard let self else { return }
                if process.terminationStatus != 0 { self.showError("ローカルサービスを起動できませんでした。") }
            }
        }
        do { try process.run(); service = process }
        catch { showError("ローカルサービスを起動できませんでした。") }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if showOnReady {
            showOnReady = false
            if !popover.isShown { toggle() }
        }
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if servicePort > 0 {
            if !popover.isShown { toggle() }
        } else { showOnReady = true }
        return false
    }

    func showError(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "Relay"
        alert.informativeText = message
        alert.addButton(withTitle: "閉じる")
        alert.runModal()
    }

    @objc func toggle() {
        if NSApp.currentEvent?.type == .rightMouseUp {
            let menu = NSMenu()
            menu.addItem(withTitle: "ブラウザで開く", action: #selector(openBrowser), keyEquivalent: "")
            menu.addItem(.separator())
            menu.addItem(withTitle: "Relayを終了", action: #selector(quit), keyEquivalent: "q")
            for item in menu.items { item.target = self }
            statusItem.menu = menu
            statusItem.button?.performClick(nil)
            statusItem.menu = nil
            return
        }
        if popover.isShown { popover.performClose(nil) }
        else if let button = statusItem.button {
            NSApp.activate(ignoringOtherApps: true)
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        }
    }
    @objc func openBrowser() {
        if servicePort > 0 { NSWorkspace.shared.open(URL(string: "http://127.0.0.1:\(servicePort)/")!) }
    }
    @objc func quit() { NSApp.terminate(nil) }
    func applicationWillTerminate(_ notification: Notification) {
        try? serviceInput?.fileHandleForWriting.close()
        service?.terminate()
        if let localMonitor { NSEvent.removeMonitor(localMonitor) }
    }
    func application(_ application: NSApplication, open urls: [URL]) {
        guard urls.contains(where: { $0.scheme == "glassrelay" }) else { return }
        if !popover.isShown { toggle() }
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        decisionHandler(url.host == "127.0.0.1" && url.port == servicePort ? .allow : .cancel)
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.host == "127.0.0.1", message.frameInfo.request.url?.port == servicePort, let text = message.body as? String else { replyHandler(nil,"Invalid clipboard request"); return }
        NSPasteboard.general.clearContents()
        let success = NSPasteboard.general.setString(text, forType: .string)
        replyHandler(success, success ? nil : "コピーできませんでした")
    }
}

@main
struct RelayApplication {
    @MainActor static func main() {
        let application = NSApplication.shared
        let delegate = RelayDelegate()
        application.delegate = delegate
        application.run()
    }
}
