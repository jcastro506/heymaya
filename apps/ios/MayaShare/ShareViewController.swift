import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// "Send to Maya" from the TikTok or Instagram share sheet (app spec §10.1). It finds the post
/// link in what the app shared, takes an optional one-line note, and posts both to the server
/// with the creator's share token. Her answer comes back in Messages, not here.
final class ShareViewController: UIViewController {
  override func viewDidLoad() {
    super.viewDidLoad()
    let model = ShareModel(context: extensionContext)
    let host = UIHostingController(rootView: ShareSheet(model: model))
    addChild(host)
    host.view.frame = view.bounds
    host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.addSubview(host.view)
    host.didMove(toParent: self)
    Task { await model.load() }
  }
}

@MainActor
@Observable
final class ShareModel {
  enum Phase: Equatable { case finding, ready(url: String, platform: String), sending, sent(later: Bool), failed(String) }
  var phase: Phase = .finding
  var note = ""
  private weak var context: NSExtensionContext?

  init(context: NSExtensionContext?) { self.context = context }

  func load() async {
    let providers = (context?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
    var candidates: [String] = []
    for p in providers {
      if p.hasItemConformingToTypeIdentifier(UTType.url.identifier), let u = try? await p.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL { candidates.append(u.absoluteString) }
      if p.hasItemConformingToTypeIdentifier(UTType.plainText.identifier), let t = try? await p.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String { candidates.append(t) }
    }
    if let found = ShareLink.postLink(in: candidates) {
      phase = .ready(url: found.url, platform: found.platform)
    } else {
      phase = .failed("Maya can read TikTok and Instagram posts. This doesn't look like one.")
    }
  }

  func send() async {
    guard case .ready(let url, let platform) = phase else { return }
    guard let token = ShareLink.token else { phase = .failed("Open Maya once so she knows it's you, then share again."); return }
    guard let convexURL = Bundle.main.object(forInfoDictionaryKey: "MayaConvexURL") as? String, let endpoint = ShareLink.shareEndpoint(convexURL: convexURL) else { phase = .failed("Something's off with this build."); return }
    phase = .sending
    var req = URLRequest(url: endpoint)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "content-type")
    req.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
    req.httpBody = try? JSONSerialization.data(withJSONObject: ["url": url, "note": note.trimmingCharacters(in: .whitespacesAndNewlines), "app": platform])
    struct Reply: Decodable { let ok: Bool; let reason: String?; let later: Bool? }
    do {
      let (data, _) = try await URLSession.shared.data(for: req)
      let r = try JSONDecoder().decode(Reply.self, from: data)
      if r.ok {
        phase = .sent(later: r.later ?? false)
        try? await Task.sleep(for: .seconds(1.4))
        context?.completeRequest(returningItems: nil)
      } else {
        phase = .failed(r.reason.map { $0.prefix(1).uppercased() + $0.dropFirst() } ?? "That didn't go through. Try again?")
      }
    } catch {
      phase = .failed("Couldn't reach Maya. Check your connection and try again.")
    }
  }

  func cancel() { context?.completeRequest(returningItems: nil) }
}

struct ShareSheet: View {
  @Bindable var model: ShareModel

  var body: some View {
    NavigationStack {
      VStack(alignment: .leading, spacing: 18) {
        if case .finding = model.phase { ProgressView().frame(maxWidth: .infinity) }
        if case .ready(let url, let platform) = model.phase {
          Label("A \(platform) post", systemImage: "link").font(.headline)
          Text(url).font(.footnote).foregroundStyle(.secondary).lineLimit(2)
          TextField("Add a note (optional)", text: $model.note, axis: .vertical)
            .lineLimit(1...3)
            .textFieldStyle(.roundedBorder)
          Text("She'll text you her read in Messages.").font(.footnote).foregroundStyle(.secondary)
        }
        if case .sending = model.phase { ProgressView("Sending…").frame(maxWidth: .infinity) }
        if case .sent(let later) = model.phase {
          Label(later ? "Sent. She'll text you in the morning." : "Sent. She'll text you.", systemImage: "checkmark.circle.fill")
            .font(.headline).foregroundStyle(.green)
        }
        if case .failed(let reason) = model.phase {
          Label(reason, systemImage: "exclamationmark.circle").font(.callout)
        }
        Spacer()
      }
      .padding(20)
      .navigationTitle("Send to Maya")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { model.cancel() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("Send") { Task { await model.send() } }
            .disabled({ if case .ready = model.phase { return false }; return true }())
        }
      }
    }
  }
}
