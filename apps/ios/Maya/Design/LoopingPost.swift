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
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
      // The page finishes before the first frame paints; a beat keeps the cover from flashing.
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { self.onReady() }
    }
  }
}
