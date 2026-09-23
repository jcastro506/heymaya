import SwiftUI

/// The most important screen: her pitch, the version, why it fits, the proof, and what to do.
struct IdeaDetailView: View {
  let idea: Idea
  @State private var busy = false
  @State private var done: String?

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        MayaThread(text: idea.messageText)

        if let v = idea.version {
          VStack(alignment: .leading, spacing: 10) {
            SectionHeader(text: "The version")
            Card {
              if let hook = v.hook { row("Hook", hook) }
              if let text = v.onScreenText, !text.isEmpty { row("On screen", text) }
              if let len = v.lengthSec { row("Length", "\(Int(len))s") }
              if let sound = v.sound, !sound.isEmpty { row("Sound", sound) }
            }
          }
        }

        VStack(alignment: .leading, spacing: 10) {
          SectionHeader(text: "Why it fits you")
          Text(idea.fitWhy).font(MayaFont.body).foregroundStyle(Palette.ink)
        }

        if !idea.evidenceLinks.isEmpty {
          VStack(alignment: .leading, spacing: 10) {
            SectionHeader(text: "The proof")
            ForEach(idea.evidenceLinks, id: \.self) { link in
              if let url = URL(string: link) {
                Link(destination: url) {
                  Label(EvidenceLabel.text(link), systemImage: "play.rectangle")
                    .font(MayaFont.callout)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
                    .background(Palette.wash, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
              }
            }
          }
        }

        actions
      }
      .padding(20)
      .padding(.bottom, 100) // room above the floating tab bar
    }
    .background(Palette.ground.ignoresSafeArea())
    .navigationTitle("Idea")
    .navigationBarTitleDisplayMode(.inline)
  }

  @ViewBuilder
  private var actions: some View {
    if let done {
      Label(done, systemImage: "checkmark.circle.fill").foregroundStyle(Palette.ok).font(MayaFont.callout)
    } else if idea.status != "posted" {
      VStack(spacing: 12) {
        Button {
          Task { await run("She'll learn from how it does.") { await Actions.markPosted(ideaId: idea.id) } }
        } label: {
          Text("I posted it").font(MayaFont.headline).frame(maxWidth: .infinity, minHeight: 50)
        }
        .buttonStyle(.borderedProminent)
        .buttonBorderShape(.roundedRectangle(radius: 14))

        if idea.status == "sent" || idea.status == "hearted" {
          Button {
            Task { await run("Passed. She'll weigh it next time.") { await Actions.passIdea(ideaId: idea.id) } }
          } label: {
            Text("Not for me").font(MayaFont.headline).frame(maxWidth: .infinity, minHeight: 50)
          }
          .buttonStyle(.bordered)
          .buttonBorderShape(.roundedRectangle(radius: 14))
        }
      }
      .disabled(busy)
    }
  }

  private func run(_ success: String, _ action: () async -> Bool) async {
    busy = true
    let ok = await action()
    busy = false
    done = ok ? success : nil
  }

  private func row(_ label: String, _ value: String) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(label).font(MayaFont.caption).foregroundStyle(Palette.muted)
      Text(value).font(MayaFont.body).foregroundStyle(Palette.ink)
    }
  }
}

enum EvidenceLabel {
  /// "@andi.renay on TikTok" from the post URL, never a raw link.
  static func text(_ link: String) -> String {
    if let r = link.range(of: #"tiktok\.com/@([^/?]+)"#, options: .regularExpression) {
      return "\(link[r].replacingOccurrences(of: "tiktok.com/", with: "")) on TikTok"
    }
    if link.contains("instagram.com") { return "A post on Instagram" }
    return "The post"
  }
}
