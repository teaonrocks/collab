import AppKit
import AuthenticationServices
import Darwin
import Foundation

private struct AuthenticationRequest: Decodable {
    let authorizationURL: String
    let callbackScheme: String
    let ephemeral: Bool
}

private struct AuthenticationEvent: Encodable {
    let type: String
    let callbackURL: String?
    let message: String?
}

private func emit(_ event: AuthenticationEvent) {
    guard let data = try? JSONEncoder().encode(event) else { return }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0A]))
    try? FileHandle.standardOutput.synchronize()
}

@MainActor
private final class AuthenticationRunner: NSObject,
    ASWebAuthenticationPresentationContextProviding,
    NSWindowDelegate
{
    private let request: AuthenticationRequest
    private var session: ASWebAuthenticationSession?
    private var presentationWindow: NSWindow?
    private var finished = false

    init(request: AuthenticationRequest) {
        self.request = request
    }

    func start() {
        guard
            let authorizationURL = URL(string: request.authorizationURL),
            authorizationURL.scheme == "https"
        else {
            finish(type: "error", message: "The authorization URL is invalid.", exitCode: 1)
            return
        }

        let window = makePresentationWindow()
        presentationWindow = window
        window.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)

        let authenticationSession = ASWebAuthenticationSession(
            url: authorizationURL,
            callbackURLScheme: request.callbackScheme
        ) { [weak self] callbackURL, error in
            Task { @MainActor in
                self?.complete(callbackURL: callbackURL, error: error)
            }
        }
        authenticationSession.presentationContextProvider = self
        authenticationSession.prefersEphemeralWebBrowserSession = request.ephemeral
        session = authenticationSession

        guard authenticationSession.start() else {
            finish(type: "error", message: "macOS could not start the authentication session.", exitCode: 1)
            return
        }
        emit(AuthenticationEvent(type: "started", callbackURL: nil, message: nil))
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        guard let presentationWindow else {
            fatalError("Authentication presentation window was not created.")
        }
        return presentationWindow
    }

    func windowWillClose(_ notification: Notification) {
        if !finished {
            session?.cancel()
        }
    }

    private func makePresentationWindow() -> NSWindow {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 380, height: 132),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "Aether Sign In"
        window.isReleasedWhenClosed = false
        window.center()
        window.delegate = self

        let title = NSTextField(labelWithString: "Continue signing in through WorkOS")
        title.font = NSFont.systemFont(ofSize: 15, weight: .medium)
        title.alignment = .center
        title.translatesAutoresizingMaskIntoConstraints = false

        let detail = NSTextField(labelWithString: "This window closes automatically when sign-in is complete.")
        detail.textColor = .secondaryLabelColor
        detail.alignment = .center
        detail.translatesAutoresizingMaskIntoConstraints = false

        let content = NSView()
        content.addSubview(title)
        content.addSubview(detail)
        NSLayoutConstraint.activate([
            title.centerXAnchor.constraint(equalTo: content.centerXAnchor),
            title.topAnchor.constraint(equalTo: content.topAnchor, constant: 34),
            detail.centerXAnchor.constraint(equalTo: content.centerXAnchor),
            detail.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 10)
        ])
        window.contentView = content
        return window
    }

    private func complete(callbackURL: URL?, error: Error?) {
        if let callbackURL {
            finish(type: "completed", callbackURL: callbackURL.absoluteString, exitCode: 0)
            return
        }

        let nsError = error as NSError?
        if nsError?.domain == ASWebAuthenticationSessionError.errorDomain,
           nsError?.code == ASWebAuthenticationSessionError.canceledLogin.rawValue
        {
            finish(type: "cancelled", exitCode: 0)
            return
        }
        finish(type: "error", message: nsError?.localizedDescription ?? "Authentication failed.", exitCode: 1)
    }

    private func finish(
        type: String,
        callbackURL: String? = nil,
        message: String? = nil,
        exitCode: Int32
    ) {
        guard !finished else { return }
        finished = true
        emit(AuthenticationEvent(type: type, callbackURL: callbackURL, message: message))
        presentationWindow?.orderOut(nil)
        Darwin.exit(exitCode)
    }
}

@main
private struct AetherWebAuthHelper {
    static func main() {
        let input = FileHandle.standardInput.readDataToEndOfFile()
        let decoder = JSONDecoder()
        guard let request = try? decoder.decode(AuthenticationRequest.self, from: input) else {
            emit(AuthenticationEvent(type: "error", callbackURL: nil, message: "The authentication request is invalid."))
            Darwin.exit(1)
        }

        let application = NSApplication.shared
        application.setActivationPolicy(.accessory)
        let runner = AuthenticationRunner(request: request)
        DispatchQueue.main.async {
            runner.start()
        }
        application.run()
    }
}
