import SwiftUI
import WebKit

/// The inspiring post, playing silently on a loop behind the idea's hook (spec §M1 additions).
/// TikTok's official embed player only; Instagram's embed carries its own chrome, so it keeps
/// the still cover. Off under Reduce Motion and Low Power Mode; the cover shows until ready.
struct LoopingPost: View {
  let url: String
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var ready = false

  private var videoId: String? {
    url.range(of: #"tiktok\.com/@[^/]+/video/(\d+)"#, options: .regularExpression).flatMap { r in
      String(url[r]).split(separator: "/").last.map(String.init)
    }
  }

  var body: some View {
    if let id = videoId, !reduceMotion, !ProcessInfo.processInfo.isLowPowerModeEnabled {
      GeometryReader { geo in
        // The player is 9:16; crop it to fill the hero, and 30% more so the player's own
        // edge controls (its like count sits bottom-right) fall outside the frame.
        let width = max(geo.size.width, geo.size.height * 9 / 16) * 1.3
        TikTokPlayer(videoId: id) { withAnimation(.easeIn(duration: 0.4)) { ready = true } }
          .frame(width: width, height: width * 16 / 9)
          .position(x: geo.size.width / 2, y: geo.size.height / 2)
          .opacity(ready ? 1 : 0)
      }
      .clipped()
      .allowsHitTesting(false)
      .accessibilityHidden(true)
    }
  }
}

private struct TikTokPlayer: UIViewRepresentable {
  let videoId: String
  let onReady: () -> Void

  func makeCoordinator() -> Coordinator { Coordinator(onReady: onReady) }

  func makeUIView(context: Context) -> WKWebView {
    let config = WKWebViewConfiguration()
    config.allowsInlineMediaPlayback = true
    config.mediaTypesRequiringUserActionForPlayback = []
    let web = WKWebView(frame: .zero, configuration: config)
    web.isOpaque = false
    web.backgroundColor = .clear
    web.scrollView.isScrollEnabled = false
    web.isUserInteractionEnabled = false
    web.navigationDelegate = context.coordinator
    let params = "autoplay=1&loop=1&muted=1&controls=0&progress_bar=0&play_button=0&volume_control=0&fullscreen_button=0&timestamp=0&music_info=0&description=0&rel=0&native_context_menu=0&closed_caption=0"
    if let url = URL(string: "https://www.tiktok.com/player/v1/\(videoId)?\(params)") { web.load(URLRequest(url: url)) }
    return web
  }

  func updateUIView(_ uiView: WKWebView, context: Context) {}

  final class Coordinator: NSObject, WKNavigationDelegate {
    let onReady: () -> Void
    init(onReady: @escaping () -> Void) { self.onReady = onReady }

    /// Shown only once OUR video is actually playing. A removed or private post makes TikTok's
    /// player say "Video currently unavailable" and then play someone else's video; that must
    /// never appear behind her idea, so anything but a clean, playing video keeps the cover.
    private static let probe = """
    (() => {
      const t = (document.body && document.body.innerText) || '';
      if (/unavailable|not available|isn't available|couldn't find|private/i.test(t)) return 'bad';
      const v = document.querySelector('video');
      return v && v.readyState >= 2 && !v.paused ? 'ok' : 'wait';
    })()
    """

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
      check(webView, attempt: 0)
    }

    private func check(_ webView: WKWebView, attempt: Int) {
      guard attempt < 10 else { return } // ~6 s and still not clean: the cover stays
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak webView] in
        guard let webView else { return }
        webView.evaluateJavaScript(Self.probe) { result, _ in
          switch result as? String {
          case "ok": self.onReady()
          case "bad": webView.stopLoading(); webView.loadHTMLString("", baseURL: nil) // stop the stranger's video
          default: self.check(webView, attempt: attempt + 1)
          }
        }
      }
    }
  }
}
