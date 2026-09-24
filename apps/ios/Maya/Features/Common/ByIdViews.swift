import SwiftUI

/// A deep-linked idea: theirs, or a plain "this changed" — never a blank screen.
struct IdeaByIdView: View {
  let id: String
  @State private var data: Live<Idea?>

  init(id: String) {
    self.id = id
    _data = State(initialValue: Live<Idea?>("ui:idea", args: ["id": id]))
  }

  var body: some View {
    Group {
      switch data.state {
      case .loading: ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity).background(Palette.ground)
      case .failed(let m): ChangedView(message: m)
      case .value(nil): ChangedView(message: "This idea isn't here any more. It may have been replaced by a newer one.")
      case .value(let idea?): IdeaDetailView(idea: idea)
      }
    }
    .task { await data.run() }
  }
}

/// A deep-linked post of theirs.
struct PostByIdView: View {
  let id: String
  @State private var data: Live<PostNumbers?>

  init(id: String) {
    self.id = id
    _data = State(initialValue: Live<PostNumbers?>("ui:post", args: ["id": id]))
  }

  var body: some View {
    Group {
      switch data.state {
      case .loading: ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity).background(Palette.ground)
      case .failed(let m): ChangedView(message: m)
      case .value(nil): ChangedView(message: "This post isn't here any more.")
      case .value(let n?):
        PostNumbersView(post: AnalyticsPost(id: n.id, url: n.url, platform: n.platform, createTime: n.createTime, contentType: n.contentType, cover: n.cover,
                                            headline: n.headline, multiple: n.multiple, diagnosis: n.derived?.diagnosis))
      }
    }
    .task { await data.run() }
  }
}

struct ChangedView: View {
  let message: String
  var body: some View {
    VStack(spacing: 14) {
      FlowerMark(size: 52)
      Text("This changed").font(MayaFont.title).foregroundStyle(Palette.ink)
      Text(message).font(MayaFont.callout).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
    }
    .padding(32)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Palette.ground.ignoresSafeArea())
  }
}
