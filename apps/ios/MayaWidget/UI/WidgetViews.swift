import SwiftUI
import UIKit
import WidgetKit

/// The home-screen and lock-screen widgets (app spec §10.2), in the app's own language: warm
/// ground, ink, purple and coral, real covers, bold numbers. Facts from rows only, never her
/// voice; every region opens the thing it shows. Views take the family explicitly so the app's
/// tests can render each size to a picture without a simulator (MayaTests/WidgetRenderTests).

// MARK: - Roots

/// The content for one family. The background comes from `MayaWidgetBackground` (the widget
/// puts it in `containerBackground`, which is full-bleed and dropped in tinted modes).
struct MayaWidgetView: View {
  let entry: MayaEntry
  let family: WidgetFamily
  /// The "Next shoot" widget leads with the block; the "Maya" widget leads with the idea.
  var blockFirst = false

  var body: some View {
    Group { content }.multilineTextAlignment(.leading)
  }

  @ViewBuilder private var content: some View {
    switch family {
    case .accessoryCircular: NewIdeasCircular(entry: entry)
    case .accessoryRectangular: blockFirst ? AnyView(ShootRectangular(entry: entry)) : AnyView(IdeaRectangular(entry: entry))
    case .accessoryInline: InlineLine(entry: entry, blockFirst: blockFirst)
    default:
      if entry.state != .ready || entry.data == nil {
        StateCard(entry: entry, family: family)
      } else if let data = entry.data {
        switch family {
        case .systemSmall: SmallView(entry: entry, data: data, blockFirst: blockFirst)
        case .systemMedium: MediumView(entry: entry, data: data)
        default: LargeView(entry: entry, data: data)
        }
      }
    }
  }
}

struct MayaWidgetBackground: View {
  let entry: MayaEntry
  let family: WidgetFamily
  var blockFirst = false

  var body: some View {
    if family == .systemSmall, entry.state == .ready, let data = entry.data, SmallView.showsIdea(data, blockFirst: blockFirst, now: entry.date) {
      IdeaBackdrop(cover: entry.ideaCover)
    } else {
      WarmGround()
    }
  }
}

// MARK: - Shared pieces

/// Maya's ground with a soft coral and purple glow in the corners, like her hero cards.
struct WarmGround: View {
  var body: some View {
    ZStack {
      Palette.ground
      RadialGradient(colors: [Palette.coral.opacity(0.16), .clear], center: .topTrailing, startRadius: 0, endRadius: 220)
      RadialGradient(colors: [Palette.purple.opacity(0.12), .clear], center: .bottomLeading, startRadius: 0, endRadius: 260)
    }
  }
}

/// The idea's cover, full-bleed, with a scrim so white text reads on any photo. Without a cover,
/// a deep brand gradient (never a broken image, never a grey box).
struct IdeaBackdrop: View {
  let cover: Data?
  var body: some View {
    ZStack {
      if let img = cover.flatMap(UIImage.init(data:)) {
        Color.clear.overlay {
          Image(uiImage: img).resizable().widgetAccentedRenderingMode(.accentedDesaturated).aspectRatio(contentMode: .fill)
        }
        .clipped()
        LinearGradient(stops: [.init(color: .black.opacity(0.35), location: 0), .init(color: .black.opacity(0.0), location: 0.3),
                               .init(color: .black.opacity(0.35), location: 0.55), .init(color: .black.opacity(0.82), location: 1)],
                       startPoint: .top, endPoint: .bottom)
      } else {
        BrandGradient()
      }
    }
  }
}

struct BrandGradient: View {
  var body: some View {
    MeshGradient(width: 2, height: 2, points: [[0, 0], [1, 0], [0, 1], [1, 1]],
                 colors: [Color(hex: 0x8C76CF), Color(hex: 0xE58A86), Color(hex: 0x4A3C7E), Color(hex: 0x6B56A8)])
  }
}

/// A cover inside a card (medium and large): the photo, or a designed stand-in in Maya's colours.
struct CoverTile: View {
  let cover: Data?
  var platform: String? = nil
  var radius: CGFloat = 14
  /// Deep when white text sits on it; soft when it's a picture on its own.
  var deep = false

  var body: some View {
    Color.clear
      .overlay {
        if let img = cover.flatMap(UIImage.init(data:)) {
          Image(uiImage: img).resizable().widgetAccentedRenderingMode(.accentedDesaturated).aspectRatio(contentMode: .fill)
        } else {
          ZStack {
            if deep {
              BrandGradient()
            } else {
              MeshGradient(width: 2, height: 2, points: [[0, 0], [1, 0], [0, 1], [1, 1]],
                           colors: [Palette.wash, Palette.purple.opacity(0.45), Palette.coral.opacity(0.45), Palette.wash])
            }
            Image(systemName: platform == "instagram" ? "camera.fill" : platform == "tiktok" ? "music.note" : "lightbulb.fill")
              .font(.system(size: 18, weight: .semibold))
              .foregroundStyle(deep ? .white.opacity(0.45) : Palette.ink.opacity(0.35))
          }
        }
      }
      .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).stroke(.white.opacity(0.08), lineWidth: 1))
  }
}

struct PlatformDot: View {
  let platform: String
  var size: CGFloat = 18
  var body: some View {
    Image(systemName: platform == "instagram" ? "camera.fill" : "music.note")
      .font(.system(size: size * 0.46, weight: .bold))
      .foregroundStyle(.white)
      .frame(width: size, height: size)
      .background(platform == "instagram" ? Palette.coral : .black.opacity(0.55), in: Circle())
      .accessibilityLabel(platform == "instagram" ? "Instagram" : "TikTok")
  }
}

/// A capsule label. In tinted modes the fill would become an opaque white slab over white text,
/// so it turns into a thin outline there.
struct Pill: View {
  let text: String
  var icon: String? = nil
  var color: Color = Palette.purple
  var solid = false
  @Environment(\.widgetRenderingMode) private var mode

  var body: some View {
    HStack(spacing: 4) {
      if let icon { Image(systemName: icon).font(.system(size: 9, weight: .bold)) }
      Text(text).font(.system(size: 11, weight: .bold, design: .rounded)).lineLimit(1)
    }
    .padding(.horizontal, 8)
    .padding(.vertical, 4)
    .foregroundStyle(mode == .fullColor ? (solid ? .white : color) : .primary)
    .background {
      if mode == .fullColor {
        Capsule().fill(solid ? color : color.opacity(0.13))
      } else {
        Capsule().stroke(.primary.opacity(0.5), lineWidth: 1)
      }
    }
    .fixedSize()
  }
}

struct Kicker: View {
  let text: String
  var color: Color = Palette.purple
  var body: some View {
    Text(text.uppercased())
      .font(.system(size: 10.5, weight: .bold, design: .rounded))
      .kerning(0.7)
      .foregroundStyle(color)
      .lineLimit(1)
      .widgetAccentable()
  }
}

/// "1.3×" against their normal, green when it clearly beat it; "so far" while the post is still growing.
struct MultipleBadge: View {
  let multiple: Double
  let settled: Bool
  var body: some View {
    Text(settled ? WidgetWords.multiple(multiple) : "\(WidgetWords.multiple(multiple)) so far")
      .font(.system(size: 11, weight: .heavy, design: .rounded).monospacedDigit())
      .foregroundStyle(.white)
      .padding(.horizontal, 6).padding(.vertical, 2.5)
      .background(multiple >= 1.5 ? Color(hex: 0x2F7D5B) : .black.opacity(0.45), in: Capsule())
      .lineLimit(1)
      .fixedSize()
  }
}

/// A calendar tile like the Plan screen's: weekday over the date.
struct DayTile: View {
  let ms: Double
  var body: some View {
    let d = Date(timeIntervalSince1970: ms / 1000)
    VStack(spacing: -1) {
      Text(d.formatted(.dateTime.weekday(.abbreviated)).uppercased())
        .font(.system(size: 9, weight: .heavy, design: .rounded)).foregroundStyle(Palette.coral).widgetAccentable()
      Text(d.formatted(.dateTime.day()))
        .font(.system(size: 17, weight: .bold, design: .rounded)).foregroundStyle(Palette.ink)
    }
    .frame(width: 38, height: 40)
    .background(Palette.panel, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Palette.line, lineWidth: 1))
  }
}

private func savedLine(_ entry: MayaEntry) -> String? {
  guard let at = entry.savedAt else { return nil }
  let mins = Int(entry.date.timeIntervalSince(at) / 60)
  if mins < 60 { return "Updated \(max(mins, 1))m ago" }
  if mins < 60 * 24 { return "Updated \(mins / 60)h ago" }
  return "Updated \(mins / (60 * 24))d ago"
}

// MARK: - Small

struct SmallView: View {
  let entry: MayaEntry
  let data: WidgetData
  var blockFirst = false

  /// The one thing to do next: a shoot within the next 12 hours wins; otherwise the best idea.
  static func showsIdea(_ data: WidgetData, blockFirst: Bool, now: Date = .now) -> Bool {
    guard data.bestIdea != nil else { return false }
    guard let b = data.nextBlock else { return !blockFirst }
    if blockFirst { return false }
    return Date(timeIntervalSince1970: b.start / 1000).timeIntervalSince(now) > 12 * 3600
  }

  var body: some View {
    if Self.showsIdea(data, blockFirst: blockFirst, now: entry.date), let idea = data.bestIdea {
      idea_(idea)
    } else if let b = data.nextBlock {
      block(b)
    } else {
      StateCard(entry: entry, family: .systemSmall)
    }
  }

  private func idea_(_ idea: WidgetData.Idea) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .top) {
        FlowerMark(size: 24)
        Spacer(minLength: 4)
        if data.newIdeas > 0 { Pill(text: "\(data.newIdeas) new", color: Palette.coral, solid: true) }
      }
      Spacer(minLength: 6)
      Text(idea.isNew ? "New idea" : "Her pick")
        .font(.system(size: 11, weight: .bold, design: .rounded))
        .foregroundStyle(.white.opacity(0.78))
        .padding(.bottom, 2)
      Text(idea.hook)
        .font(.system(size: 16, weight: .bold, design: .rounded))
        .foregroundStyle(.white)
        .lineLimit(4)
        .minimumScaleFactor(0.8)
        .shadow(color: .black.opacity(0.25), radius: 3, y: 1)
        .widgetAccentable()
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .widgetURL(WidgetLinks.idea(idea.id))
  }

  private func block(_ b: WidgetData.Block) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .top) {
        Image(systemName: "video.fill")
          .font(.system(size: 12, weight: .bold))
          .foregroundStyle(.white)
          .frame(width: 28, height: 28)
          .background(Palette.purple, in: Circle())
          .widgetAccentable()
        Spacer(minLength: 4)
        if !b.booked { Pill(text: "Not booked", color: Palette.coral) }
      }
      Spacer(minLength: 6)
      Kicker(text: "Next shoot")
      Text(WidgetWords.day(b.start, now: entry.date))
        .font(.system(size: 22, weight: .bold, design: .rounded))
        .foregroundStyle(Palette.ink)
        .lineLimit(1).minimumScaleFactor(0.7)
      Text(WidgetWords.time(b.start))
        .font(.system(size: 15, weight: .semibold, design: .rounded).monospacedDigit())
        .foregroundStyle(Palette.purple)
      Text(b.hook ?? b.title)
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(Palette.muted)
        .lineLimit(2)
        .padding(.top, 3)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .widgetURL(WidgetLinks.block(b))
  }
}

// MARK: - Medium

struct MediumView: View {
  let entry: MayaEntry
  let data: WidgetData

  var body: some View {
    if let idea = data.bestIdea {
      HStack(spacing: 14) {
        Link(destination: WidgetLinks.idea(idea.id)) {
          CoverTile(cover: entry.ideaCover, platform: idea.coverPlatform, radius: 16)
            .overlay(alignment: .topLeading) {
              if let p = idea.coverPlatform { PlatformDot(platform: p).padding(7) }
            }
            .frame(width: 80)
        }
        VStack(alignment: .leading, spacing: 0) {
          HStack(alignment: .center, spacing: 6) {
            Kicker(text: idea.isNew ? "New idea" : "Her pick")
            Spacer(minLength: 4)
            if data.newIdeas > 1 {
              Link(destination: WidgetLinks.ideas) { Pill(text: "\(data.newIdeas) new", color: Palette.coral) }
            }
          }
          .padding(.bottom, 5)
          Link(destination: WidgetLinks.idea(idea.id)) {
            VStack(alignment: .leading, spacing: 4) {
              Text(idea.hook)
                .font(.system(size: 16, weight: .bold, design: .rounded))
                .foregroundStyle(Palette.ink)
                .lineLimit(idea.fitWhy == nil ? 4 : 2)
                .minimumScaleFactor(0.85)
                .fixedSize(horizontal: false, vertical: true)
              if let why = idea.fitWhy {
                Text(why)
                  .font(.system(size: 12))
                  .foregroundStyle(Palette.muted)
                  .lineLimit(2)
              }
            }
            .multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, alignment: .leading)
          }
          Spacer(minLength: 6)
          footer
        }
      }
    } else if let b = data.nextBlock {
      ShootsOnly(entry: entry, blocks: data.blocks.isEmpty ? [b] : data.blocks)
    } else {
      StateCard(entry: entry, family: .systemMedium)
    }
  }

  private var lastPost: WidgetData.Post? { data.lastPosts.first }

  private func blockPill(_ b: WidgetData.Block, short: Bool) -> some View {
    Link(destination: WidgetLinks.block(b)) {
      Pill(text: short ? WidgetWords.shortWhen(b.start, now: entry.date) : WidgetWords.when(b.start, now: entry.date), icon: "video.fill", color: Palette.purple)
    }
  }

  private func statPill(_ p: WidgetData.Post, _ m: Double) -> some View {
    Link(destination: WidgetLinks.post(p.id)) {
      HStack(spacing: 4) {
        Text("Last post").font(.system(size: 11, weight: .semibold, design: .rounded)).foregroundStyle(Palette.muted)
        Text(p.settled ? WidgetWords.multiple(m) : "\(WidgetWords.multiple(m)) so far")
          .font(.system(size: 11, weight: .heavy, design: .rounded).monospacedDigit())
          .foregroundStyle(m >= 1.5 ? Palette.ok : Palette.ink)
      }
      .lineLimit(1)
      .padding(.horizontal, 8).padding(.vertical, 4)
      .background(Palette.wash.opacity(0.9), in: Capsule())
      .fixedSize()
    }
  }

  /// The next shoot and how the last post did, as much as fits on one line.
  @ViewBuilder private var footer: some View {
    let stat = lastPost.flatMap { p in p.multiple.map { (p, $0) } }
    if let b = data.nextBlock, let (p, m) = stat {
      ViewThatFits(in: .horizontal) {
        HStack(spacing: 6) { blockPill(b, short: false); statPill(p, m); Spacer(minLength: 0) }
        HStack(spacing: 6) { blockPill(b, short: true); statPill(p, m); Spacer(minLength: 0) }
        HStack(spacing: 6) { blockPill(b, short: false); Spacer(minLength: 0) }
      }
    } else if let b = data.nextBlock {
      HStack(spacing: 6) { blockPill(b, short: false); Spacer(minLength: 0) }
    } else if let (p, m) = stat {
      HStack(spacing: 6) {
        statPill(p, m)
        Spacer(minLength: 0)
        if let s = savedLine(entry) { Text(s).font(.system(size: 10)).foregroundStyle(Palette.muted) }
      }
    } else if let s = savedLine(entry) {
      Text(s).font(.system(size: 10)).foregroundStyle(Palette.muted)
    }
  }
}

/// Medium with no idea to show: the next shoots as a small agenda.
struct ShootsOnly: View {
  let entry: MayaEntry
  let blocks: [WidgetData.Block]
  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack { Kicker(text: "Next shoots"); Spacer(); FlowerMark(size: 20) }
      ForEach(Array(blocks.prefix(2).enumerated()), id: \.offset) { _, b in
        ShootRow(block: b, now: entry.date)
      }
      Spacer(minLength: 0)
    }
  }
}

struct ShootRow: View {
  let block: WidgetData.Block
  let now: Date
  var body: some View {
    Link(destination: WidgetLinks.block(block)) {
      HStack(spacing: 10) {
        DayTile(ms: block.start)
        VStack(alignment: .leading, spacing: 1) {
          HStack(spacing: 6) {
            Text(WidgetWords.when(block.start, now: now))
              .font(.system(size: 13, weight: .bold, design: .rounded).monospacedDigit())
              .foregroundStyle(Palette.ink)
              .lineLimit(1)
            if !block.booked {
              Text("not booked").font(.system(size: 10.5, weight: .bold, design: .rounded)).foregroundStyle(Palette.coral).lineLimit(1)
            }
          }
          Text(block.hook ?? block.title)
            .font(.system(size: 12))
            .foregroundStyle(Palette.muted)
            .lineLimit(1)
        }
        .multilineTextAlignment(.leading)
        Spacer(minLength: 0)
      }
    }
  }
}

// MARK: - Large

struct LargeView: View {
  let entry: MayaEntry
  let data: WidgetData

  var body: some View {
    if data.bestIdea == nil && data.blocks.isEmpty && data.lastPosts.isEmpty {
      StateCard(entry: entry, family: .systemLarge)
    } else {
      VStack(alignment: .leading, spacing: 12) {
        header
        if let idea = data.bestIdea { hero(idea) } else { noIdea }
        if !data.blocks.isEmpty {
          if data.bestIdea == nil { shootList } else { shoots }
        }
        if !data.lastPosts.isEmpty { posts }
        Spacer(minLength: 0)
      }
    }
  }

  private var header: some View {
    HStack(alignment: .center, spacing: 8) {
      FlowerMark(size: 24)
      Text("Today")
        .font(.system(size: 19, weight: .bold, design: .rounded))
        .foregroundStyle(Palette.ink)
      Spacer(minLength: 4)
      if let s = savedLine(entry) {
        Text(s).font(.system(size: 10.5)).foregroundStyle(Palette.muted)
      } else if data.newIdeas > 0 {
        Link(destination: WidgetLinks.ideas) {
          Pill(text: WidgetWords.newIdeas(data.newIdeas), icon: "lightbulb.fill", color: Palette.coral, solid: true)
        }
      }
    }
    .frame(height: 26)
  }

  private func hero(_ idea: WidgetData.Idea) -> some View {
    Link(destination: WidgetLinks.idea(idea.id)) {
      HStack(alignment: .top, spacing: 12) {
        CoverTile(cover: entry.ideaCover, platform: idea.coverPlatform, radius: 12)
          .overlay(alignment: .topLeading) {
            if let p = idea.coverPlatform { PlatformDot(platform: p, size: 16).padding(5) }
          }
          .frame(width: 60, height: 92)
        VStack(alignment: .leading, spacing: 3) {
          Kicker(text: idea.isNew ? "New idea" : "Her pick")
          Text(idea.hook)
            .font(.system(size: 15.5, weight: .bold, design: .rounded))
            .foregroundStyle(Palette.ink)
            .lineLimit(idea.fitWhy == nil ? 4 : 2)
            .minimumScaleFactor(0.85)
          if let why = idea.fitWhy {
            Text(why)
              .font(.system(size: 11.5))
              .foregroundStyle(Palette.muted)
              .lineLimit(2)
          }
          Spacer(minLength: 0)
        }
        .multilineTextAlignment(.leading)
        Spacer(minLength: 0)
      }
      .padding(9)
      .frame(height: 110)
      .background(Palette.panel, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Palette.coral.opacity(0.28), lineWidth: 1))
      .shadow(color: Palette.purple.opacity(0.10), radius: 12, y: 5)
    }
  }

  /// No idea waiting: say so plainly, in the hero's place.
  private var noIdea: some View {
    Link(destination: WidgetLinks.ideas) {
      HStack(spacing: 12) {
        ZStack { Circle().fill(Palette.wash); FlowerMark(size: 30) }.frame(width: 46, height: 46)
        VStack(alignment: .leading, spacing: 2) {
          Text("No new ideas right now").font(.system(size: 14, weight: .bold, design: .rounded)).foregroundStyle(Palette.ink)
          Text("She's watching your niche. New ones land here.").font(.system(size: 12)).foregroundStyle(Palette.muted).lineLimit(2)
        }
        .multilineTextAlignment(.leading)
        Spacer(minLength: 0)
      }
      .padding(12)
      .background(Palette.panel.opacity(0.75), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Palette.line.opacity(0.8), lineWidth: 1))
    }
  }

  /// With no idea above them, the shoots get full rows.
  private var shootList: some View {
    VStack(alignment: .leading, spacing: 8) {
      Kicker(text: data.blocks.count == 1 ? "Next shoot" : "Next shoots")
      ForEach(Array(data.blocks.prefix(2).enumerated()), id: \.offset) { _, b in ShootRow(block: b, now: entry.date) }
    }
  }

  /// The next two shoots side by side, each a small calendar card.
  private var shoots: some View {
    HStack(spacing: 8) {
      ForEach(Array(data.blocks.prefix(2).enumerated()), id: \.offset) { _, b in
        Link(destination: WidgetLinks.block(b)) {
          HStack(spacing: 8) {
            DayTile(ms: b.start)
            VStack(alignment: .leading, spacing: 1) {
              HStack(spacing: 4) {
                Image(systemName: "video.fill").font(.system(size: 9, weight: .bold)).foregroundStyle(Palette.purple).widgetAccentable()
                Text(WidgetWords.time(b.start))
                  .font(.system(size: 12.5, weight: .bold, design: .rounded).monospacedDigit())
                  .foregroundStyle(Palette.ink)
                  .lineLimit(1)
              }
              Text(b.booked ? (b.hook ?? b.title) : "Not booked yet")
                .font(.system(size: 11, weight: b.booked ? .regular : .semibold))
                .foregroundStyle(b.booked ? Palette.muted : Palette.coral)
                .lineLimit(2)
            }
            .multilineTextAlignment(.leading)
            Spacer(minLength: 0)
          }
          .padding(7)
          .frame(maxWidth: .infinity, minHeight: 56, maxHeight: 56, alignment: .leading)
          .background(Palette.panel.opacity(0.75), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
          .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Palette.line.opacity(0.8), lineWidth: 1))
        }
      }
      if data.blocks.count == 1 { Color.clear.frame(maxWidth: .infinity, maxHeight: 1) }
    }
  }

  private var posts: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(alignment: .firstTextBaseline) {
        Kicker(text: "Your last posts")
        Spacer()
        if data.lastPosts.contains(where: { $0.multiple != nil }) {
          Text("vs your normal").font(.system(size: 10.5, weight: .medium)).foregroundStyle(Palette.muted)
        }
      }
      HStack(spacing: 8) {
        ForEach(data.lastPosts.prefix(3), id: \.id) { p in
          Link(destination: WidgetLinks.post(p.id)) {
            CoverTile(cover: entry.postCovers[p.id], platform: p.platform, radius: 12, deep: true)
              .overlay {
                LinearGradient(colors: [.clear, .black.opacity(0.65)], startPoint: .top, endPoint: .bottom)
                  .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
              }
              .overlay(alignment: .topTrailing) { PlatformDot(platform: p.platform, size: 16).padding(5) }
              .overlay(alignment: .bottomLeading) {
                VStack(alignment: .leading, spacing: 3) {
                  if let m = p.multiple { MultipleBadge(multiple: m, settled: p.settled) }
                  Text("\(WidgetWords.count(p.views)) views")
                    .font(.system(size: 10.5, weight: .semibold, design: .rounded).monospacedDigit())
                    .foregroundStyle(.white)
                    .lineLimit(1)
                }
                .padding(6)
              }
          }
          .frame(maxWidth: .infinity)
        }
        ForEach(0..<max(0, 3 - data.lastPosts.count), id: \.self) { _ in Color.clear.frame(maxWidth: .infinity) }
      }
      .frame(minHeight: 70, maxHeight: 150)
    }
  }
}

// MARK: - States

/// Signed out, unreachable, or nothing yet: designed, plain, and still a door into the app.
struct StateCard: View {
  let entry: MayaEntry
  let family: WidgetFamily

  private var words: (title: String, detail: String, icon: String?) {
    switch entry.state {
    case .signedOut: return ("Open Maya to connect", "Your ideas and shoots will show up here.", nil)
    case .unreachable: return ("Can't reach Maya", "Trying again in a few minutes.", "wifi.slash")
    case .ready: return ("She's watching your niche", "New ideas and your next shoot land here.", nil)
    }
  }

  var body: some View {
    let w = words
    Group {
      if family == .systemMedium {
        HStack(spacing: 14) {
          mark(w.icon, size: 56)
          VStack(alignment: .leading, spacing: 4) { title(w.title); detail(w.detail) }
          Spacer(minLength: 0)
        }
        .frame(maxHeight: .infinity)
      } else if family == .systemLarge {
        VStack(spacing: 12) {
          Spacer(minLength: 0)
          mark(w.icon, size: 72)
          VStack(spacing: 4) { title(w.title); detail(w.detail) }.multilineTextAlignment(.center)
          ghostRows.padding(.top, 8)
          Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity)
      } else {
        VStack(alignment: .leading, spacing: 4) {
          mark(w.icon, size: 40)
          Spacer(minLength: 4)
          title(w.title)
          detail(w.detail)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
      }
    }
    .widgetURL(entry.state == .ready ? WidgetLinks.ideas : WidgetLinks.today)
  }

  @ViewBuilder private func mark(_ icon: String?, size: CGFloat) -> some View {
    ZStack {
      Circle().fill(Palette.wash)
      if let icon {
        Image(systemName: icon).font(.system(size: size * 0.36, weight: .semibold)).foregroundStyle(Palette.purple)
      } else {
        FlowerMark(size: size * 0.66)
      }
    }
    .frame(width: size, height: size)
  }

  private func title(_ s: String) -> some View {
    Text(s).font(.system(size: 15, weight: .bold, design: .rounded)).foregroundStyle(Palette.ink).lineLimit(2).minimumScaleFactor(0.85)
  }

  private func detail(_ s: String) -> some View {
    Text(s).font(.system(size: 12)).foregroundStyle(Palette.muted).lineLimit(3)
  }

  /// Faint shapes of what will be here, so the empty widget still reads as Maya's.
  private var ghostRows: some View {
    VStack(spacing: 8) {
      ForEach(0..<2, id: \.self) { i in
        HStack(spacing: 10) {
          RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Palette.wash).frame(width: 38, height: 40)
          VStack(alignment: .leading, spacing: 6) {
            Capsule().fill(Palette.wash).frame(width: i == 0 ? 150 : 110, height: 9)
            Capsule().fill(Palette.wash.opacity(0.7)).frame(width: i == 0 ? 200 : 170, height: 8)
          }
          Spacer(minLength: 0)
        }
      }
    }
    .padding(12)
    .background(Palette.panel.opacity(0.6), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    .accessibilityHidden(true)
  }
}

// MARK: - Lock screen

struct NewIdeasCircular: View {
  let entry: MayaEntry
  var body: some View {
    let n = entry.data?.newIdeas ?? 0
    ZStack {
      AccessoryWidgetBackground()
      VStack(spacing: -1) {
        Image(systemName: "lightbulb.fill").font(.system(size: 11, weight: .semibold))
        if entry.state == .ready {
          Text("\(n)").font(.system(size: 20, weight: .bold, design: .rounded).monospacedDigit()).minimumScaleFactor(0.6)
          Text("new").font(.system(size: 9, weight: .semibold, design: .rounded))
        }
      }
    }
    .widgetURL(WidgetLinks.ideas)
    .accessibilityLabel(entry.state == .ready ? WidgetWords.newIdeas(n) : "Open Maya")
  }
}

struct IdeaRectangular: View {
  let entry: MayaEntry
  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      if let idea = entry.data?.bestIdea {
        Label(entry.data.map { $0.newIdeas > 0 ? WidgetWords.newIdeas($0.newIdeas) : "Her pick" } ?? "Her pick", systemImage: "lightbulb.fill")
          .font(.system(size: 13, weight: .bold, design: .rounded))
          .widgetAccentable()
        Text(idea.hook).font(.system(size: 13)).lineLimit(2)
      } else {
        Label("Maya", systemImage: "lightbulb.fill").font(.system(size: 13, weight: .bold, design: .rounded)).widgetAccentable()
        Text(entry.state == .signedOut ? "Open Maya to connect" : "No new ideas yet").font(.system(size: 13)).lineLimit(2)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .widgetURL(entry.data?.bestIdea.map { WidgetLinks.idea($0.id) } ?? WidgetLinks.ideas)
  }
}

struct ShootRectangular: View {
  let entry: MayaEntry
  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      if let b = entry.data?.nextBlock {
        Label(WidgetWords.when(b.start, now: entry.date), systemImage: "video.fill")
          .font(.system(size: 13, weight: .bold, design: .rounded))
          .widgetAccentable()
        Text(b.hook ?? b.title).font(.system(size: 13)).lineLimit(2)
      } else {
        Label("Next shoot", systemImage: "video.fill").font(.system(size: 13, weight: .bold, design: .rounded)).widgetAccentable()
        Text(entry.state == .signedOut ? "Open Maya to connect" : "Nothing booked yet").font(.system(size: 13)).lineLimit(2)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .widgetURL(entry.data?.nextBlock.map(WidgetLinks.block) ?? WidgetLinks.today)
  }
}

struct InlineLine: View {
  let entry: MayaEntry
  let blockFirst: Bool
  var body: some View {
    if blockFirst, let b = entry.data?.nextBlock {
      Label("Shoot \(WidgetWords.when(b.start, now: entry.date))", systemImage: "video.fill")
    } else if let n = entry.data?.newIdeas, n > 0 {
      Label(WidgetWords.newIdeas(n), systemImage: "lightbulb.fill")
    } else {
      Label("Maya", systemImage: "lightbulb.fill")
    }
  }
}
