import SwiftUI
import UIKit

/// B6 (§8.3): a brand's application, question by question. Each drafted answer has its own Copy
/// button; "Open the form" goes to the brand's own page; the creator submits it themselves and
/// taps "I submitted it" (or tells her in Messages; both write the same record).
struct ApplicationView: View {
  let id: String
  @State private var app: Live<ApplicationForm?>
  @State private var form: URL?
  @State private var copied: String?
  @State private var submitted = false

  init(id: String) {
    self.id = id
    _app = State(initialValue: Live<ApplicationForm?>("ui:application", args: ["id": id]))
  }

  private var title: String {
    if case .value(let a?) = app.state { return a.brand }
    return "Application"
  }

  var body: some View {
    List {
      switch app.state {
      case .loading: Section { ProgressView() }
      case .failed(let m): Section { Text(m).foregroundStyle(Palette.muted) }
      case .value(nil): Section { Text("This application isn't available.").foregroundStyle(Palette.muted) }
      case .value(let a?):
        Section {
          Text("Maya drafted these from your real posts. Check each one, paste it into the form, and submit it yourself.")
            .font(MayaFont.callout).foregroundStyle(Palette.muted)
        }
        if a.questions.isEmpty {
          Section { Text("The form didn't show its questions to her. Open it and she'll help with whatever it asks, just text her.").font(MayaFont.callout) }
        }
        ForEach(a.questions) { q in
          Section {
            if let answer = q.answer {
              Text(answer).font(MayaFont.body).textSelection(.enabled)
              Button {
                UIPasteboard.general.string = answer
                Haptics.tap()
                copied = q.label
              } label: { Label(copied == q.label ? "Copied" : "Copy", systemImage: copied == q.label ? "checkmark" : "doc.on.doc") }
                .accessibilityLabel("Copy the answer to \(q.label)")
            } else {
              Text(q.type == "file" ? "Attach this yourself." : "No drafted answer. Ask her for one in Messages.").font(MayaFont.callout).foregroundStyle(Palette.muted)
            }
          } header: {
            Text(q.label + (q.required ? " *" : ""))
          }
        }
        Section {
          if let s = a.formUrl, let url = URL(string: s) {
            Button { form = url } label: { Label("Open the form", systemImage: "arrow.up.right.square") }
          }
          if a.applied || submitted {
            Label("Submitted. She'll check back in a couple of weeks.", systemImage: "checkmark.circle.fill").foregroundStyle(Palette.ok)
          } else {
            Button {
              Task { if await Actions.markApplied(id: a.id) { withAnimation { submitted = true } } }
            } label: { Label("I submitted it", systemImage: "paperplane") }
          }
        }
      }
    }
    .scrollContentBackground(.hidden)
    .background(Palette.ground)
    .navigationTitle(title)
    .navigationBarTitleDisplayMode(.inline)
    .task { await app.run() }
    .sheet(item: $form) { SafariSheet(url: $0).ignoresSafeArea() }
  }
}

struct ApplicationForm: Decodable, Equatable {
  struct Question: Decodable, Equatable, Identifiable { let label: String; let required: Bool; let type: String; let answer: String?; var id: String { label } }
  let id: String
  let brand: String
  let formUrl: String?
  let applied: Bool
  let status: String
  let questions: [Question]
}
