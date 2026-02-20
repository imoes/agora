import Foundation

protocol WebSocketClientDelegate: AnyObject {
    func webSocketDidReceiveMessage(_ client: WebSocketClient, type: String, data: [String: Any])
    func webSocketDidConnect(_ client: WebSocketClient)
    func webSocketDidDisconnect(_ client: WebSocketClient, error: Error?)
}

class WebSocketClient: NSObject, URLSessionWebSocketDelegate {
    private var webSocket: URLSessionWebSocketTask?
    private var session: URLSession?
    private let url: URL
    private var isConnected = false
    private var pingTimer: Timer?
    weak var delegate: WebSocketClientDelegate?
    let identifier: String

    init(url: URL, identifier: String = "default") {
        self.url = url
        self.identifier = identifier
        super.init()
    }

    func connect() {
        let config = URLSessionConfiguration.default
        session = URLSession(configuration: config, delegate: self, delegateQueue: OperationQueue.main)
        webSocket = session?.webSocketTask(with: url)
        webSocket?.resume()
        receiveMessage()
        startPingTimer()
    }

    func disconnect() {
        stopPingTimer()
        isConnected = false
        webSocket?.cancel(with: .goingAway, reason: nil)
        webSocket = nil
        session?.invalidateAndCancel()
        session = nil
    }

    func send(_ message: [String: Any]) {
        guard isConnected else { return }
        do {
            let data = try JSONSerialization.data(withJSONObject: message)
            let string = String(data: data, encoding: .utf8) ?? ""
            webSocket?.send(.string(string)) { error in
                if let error = error {
                    print("WebSocket send error: \(error)")
                }
            }
        } catch {
            print("WebSocket serialization error: \(error)")
        }
    }

    func sendTyping() {
        send(["type": "typing"])
    }

    func sendStatusChange(status: String) {
        send(["type": "status_change", "status": status])
    }

    func sendReaction(emoji: String, messageId: String, action: String) {
        send(["type": "reaction", "emoji": emoji, "message_id": messageId, "action": action])
    }

    func sendEditMessage(messageId: String, content: String) {
        send(["type": "edit_message", "message_id": messageId, "content": content])
    }

    func sendDeleteMessage(messageId: String) {
        send(["type": "delete_message", "message_id": messageId])
    }

    func sendRead(userId: String) {
        send(["type": "read", "user_id": userId])
    }

    func sendChatMessage(content: String, messageType: String = "text", fileReferenceId: String? = nil) {
        var msg: [String: Any] = [
            "type": "message",
            "content": content,
            "message_type": messageType
        ]
        if let fileRef = fileReferenceId {
            msg["file_reference_id"] = fileRef
        }
        send(msg)
    }

    // MARK: - Private

    private func receiveMessage() {
        webSocket?.receive { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .success(let message):
                switch message {
                case .string(let text):
                    self.handleTextMessage(text)
                case .data(let data):
                    if let text = String(data: data, encoding: .utf8) {
                        self.handleTextMessage(text)
                    }
                @unknown default:
                    break
                }
                self.receiveMessage()
            case .failure(let error):
                self.isConnected = false
                self.delegate?.webSocketDidDisconnect(self, error: error)
            }
        }
    }

    private func handleTextMessage(_ text: String) {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String else {
            return
        }

        if type == "pong" { return }

        DispatchQueue.main.async {
            self.delegate?.webSocketDidReceiveMessage(self, type: type, data: json)
        }
    }

    private func startPingTimer() {
        pingTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            self?.send(["type": "ping"])
        }
    }

    private func stopPingTimer() {
        pingTimer?.invalidate()
        pingTimer = nil
    }

    // MARK: - URLSessionWebSocketDelegate

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        isConnected = true
        delegate?.webSocketDidConnect(self)
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        isConnected = false
        delegate?.webSocketDidDisconnect(self, error: nil)
    }

    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
           let trust = challenge.protectionSpace.serverTrust {
            completionHandler(.useCredential, URLCredential(trust: trust))
        } else {
            completionHandler(.performDefaultHandling, nil)
        }
    }
}
