import NukeUI
import SwiftUI

/// A post's 9:16 cover: the real thumbnail when the platform shares it, otherwise a designed
/// placeholder in Maya's colours with the platform and handle. Never a broken image.
struct PostCover<Overlay: View>: View {
  let url: String
  /// The cover the server stored (both platforms). Preferred over TikTok's oEmbed.
  var stored: String? = nil
  var cornerRadius: CGFloat = 16
  @ViewBuilder var overlay: (PostPreview?) -> Overlay
  @State private var preview: PostPreview?

  var body: some View {
    // Color.clear takes exactly the size it is offered; the cover fills it and is clipped to
    // it. (A bare fill image sizes itself to the photo and spills out of its card.)
    Color.clear
      .overlay { FallbackCover(platform: preview?.platform ?? PostPreview.platform(of: url)) }
      .overlay {
        if let thumb = stored.flatMap(URL.init(string:)) ?? preview?.thumbnail {
          LazyImage(url: thumb) { state in
            if let image = state.image {
              image.resizable().aspectRatio(contentMode: .fill)
            }
          }
          .transition(.opacity)
        }
      }
      .overlay { overlay(preview) }
      .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
      .contentShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
      .task(id: url) {
        guard stored == nil || preview == nil else { return }
        let p = await PostPreviews.shared.preview(for: url)
        withAnimation(.easeOut(duration: 0.25)) { preview = p }
      }
  }
}

extension PostCover where Overlay == EmptyView {
  init(url: String, stored: String? = nil, cornerRadius: CGFloat = 16) {
    self.init(url: url, stored: stored, cornerRadius: cornerRadius) { _ in EmptyView() }
  }
}

struct FallbackCover: View {
  let platform: PostPreview.Platform
  var body: some View {
    ZStack {
      Palette.panel
      MeshGradient(
        width: 2, height: 2,
        points: [[0, 0], [1, 0], [0, 1], [1, 1]],
        colors: [Palette.wash, Palette.purple.opacity(0.35), Palette.coral.opacity(0.35), Palette.wash])
      Image(systemName: platform == .instagram ? "camera.fill" : "music.note")
        .font(.system(size: 28, weight: .semibold))
        .foregroundStyle(Palette.ink.opacity(0.35))
    }
  }
}

/// Bottom scrim so white text reads on any cover.
struct CoverScrim: View {
  var body: some View {
    LinearGradient(colors: [.clear, .black.opacity(0.65)], startPoint: .center, endPoint: .bottom)
  }
}
