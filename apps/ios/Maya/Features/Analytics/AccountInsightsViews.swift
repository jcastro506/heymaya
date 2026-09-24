import Charts
import SwiftUI

/// A1: the account-level cards on "Your numbers": follower growth per platform, and on
/// Instagram "From your profile" and "Who follows you". Only what the server stored; an
/// empty card says why in plain words (server status → InsightsWords).
enum InsightsWords {
  static func platformName(_ p: String) -> String { p == "instagram" ? "Instagram" : "TikTok" }

  /// Why the follower chart is empty.
  static func growthEmpty(connected: Bool, platform: String) -> String {
    connected
      ? "Your follower history shows up after the first daily read. Check back tomorrow."
      : "Connect \(platformName(platform)) to see how your followers change day by day."
  }

  /// Why "From your profile" is empty, by the server's status.
  static func profileEmpty(_ status: String) -> String {
    switch status {
    case "not_connected": "Connect Instagram to see taps on your profile link and who followed you."
    case "not_available": "Instagram doesn't share these for your account right now."
    default: "Instagram hasn't sent these yet. They usually arrive within two days of connecting."
    }
  }

  /// Why "Who follows you" is empty, by the server's status.
  static func audienceEmpty(_ status: String) -> String {
    switch status {
    case "not_connected": "Connect Instagram to see who follows you: their ages and where they live."
    case "too_few_followers": "Instagram shares who follows you once you reach 100 followers."
    case "not_available": "Instagram doesn't share this for your account right now."
    default: "Instagram hasn't sent this yet. It updates once a week."
    }
  }

  static let statuses = ["ok", "not_connected", "too_few_followers", "not_reported", "not_available"]
}

private enum DayParse {
  static let formatter: DateFormatter = {
    let f = DateFormatter()
    f.calendar = Calendar(identifier: .gregorian)
    f.locale = Locale(identifier: "en_US_POSIX")
    f.timeZone = TimeZone(identifier: "UTC")
    f.dateFormat = "yyyy-MM-dd"
    return f
  }()
  static func date(_ s: String) -> Date? { formatter.date(from: s) }
}

private struct Panel<Content: View>: View {
  @ViewBuilder let content: Content
  var body: some View {
    VStack(alignment: .leading, spacing: 12) { content }
      .padding(16)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(Palette.panel, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(Palette.line))
  }
}

// MARK: - Follower growth

struct FollowerGrowthCard: View {
  let account: AnalyticsAccount
  @State private var range = 30

  var body: some View {
    Panel {
      HStack {
        SectionHeader(text: "Follower growth")
        Spacer()
        PlatformBadge(platform: account.platform)
      }
      if let g = account.growth, g.days.count >= 2 {
        let days = Array(g.days.suffix(range))
        if g.days.count > 30 {
          Picker("Range", selection: $range) {
            Text("30 days").tag(30)
            Text("90 days").tag(90)
          }
          .pickerStyle(.segmented)
        }
        summary(g, days: days)
        FollowersLine(days: days)
        if g.flowReported {
          FlowBars(days: days)
          Text("Bars above the line are people who followed that day; below, people who unfollowed.")
            .font(MayaFont.caption).foregroundStyle(Palette.muted).fixedSize(horizontal: false, vertical: true)
        } else {
          Text("\(InsightsWords.platformName(account.platform)) doesn't report daily follows and unfollows for your account, so this shows your total only.")
            .font(MayaFont.caption).foregroundStyle(Palette.muted).fixedSize(horizontal: false, vertical: true)
        }
      } else {
        EmptyNote(text: InsightsWords.growthEmpty(connected: account.connected, platform: account.platform))
      }
    }
  }

  @ViewBuilder
  private func summary(_ g: FollowerGrowth, days: [FollowerGrowth.Day]) -> some View {
    let first = days.first!.followers, last = days.last!.followers
    let net = last - first
    HStack(alignment: .firstTextBaseline, spacing: 10) {
      Text("\(net >= 0 ? "+" : "")\(Format.count(net))")
        .font(.title2.weight(.bold).monospacedDigit())
        .foregroundStyle(net >= 0 ? Palette.ok : Palette.err)
      Text("in \(days.count) days").font(MayaFont.callout).foregroundStyle(Palette.muted)
      Spacer()
      if g.flowReported {
        // Flows after the first day, so followed − left matches the net above.
        let after = days.dropFirst()
        let gained = after.compactMap(\.gained).reduce(0, +), lost = after.compactMap(\.lost).reduce(0, +)
        Text("\(Format.count(gained)) followed · \(Format.count(lost)) left")
          .font(.caption.weight(.semibold).monospacedDigit()).foregroundStyle(Palette.muted)
      }
    }
    .accessibilityElement(children: .combine)
  }
}

private struct FollowersLine: View {
  let days: [FollowerGrowth.Day]
  var body: some View {
    Chart {
      ForEach(days, id: \.self) { d in
        if let date = DayParse.date(d.day) {
          LineMark(x: .value("Day", date, unit: .day), y: .value("Followers", d.followers))
            .interpolationMethod(.monotone)
            .foregroundStyle(Palette.purple)
            .accessibilityLabel(d.day)
            .accessibilityValue("\(Format.count(d.followers)) followers")
        }
      }
    }
    .chartYScale(domain: .automatic(includesZero: false))
    .chartXAxis { AxisMarks(values: .stride(by: .day, count: days.count > 45 ? 30 : 7)) { _ in AxisValueLabel(format: .dateTime.month(.abbreviated).day()) } }
    .chartYAxis { AxisMarks(position: .trailing, values: .automatic(desiredCount: 3)) }
    .frame(height: 150)
  }
}

private struct FlowBars: View {
  let days: [FollowerGrowth.Day]
  var body: some View {
    Chart {
      ForEach(days, id: \.self) { d in
        if let date = DayParse.date(d.day) {
          if let g = d.gained {
            BarMark(x: .value("Day", date, unit: .day), y: .value("Followed", g))
              .foregroundStyle(Palette.ok.opacity(0.8))
              .accessibilityLabel(d.day).accessibilityValue("\(Int(g)) followed")
          }
          if let l = d.lost {
            BarMark(x: .value("Day", date, unit: .day), y: .value("Left", -l))
              .foregroundStyle(Palette.coral.opacity(0.8))
              .accessibilityLabel(d.day).accessibilityValue("\(Int(l)) unfollowed")
          }
        }
      }
      RuleMark(y: .value("Zero", 0)).foregroundStyle(Palette.line)
    }
    .chartXAxis(.hidden)
    .chartYAxis { AxisMarks(position: .trailing, values: .automatic(desiredCount: 3)) }
    .frame(height: 70)
  }
}

// MARK: - From your profile (Instagram)

struct ProfileNumbersCardView: View {
  let profile: ProfileNumbers

  var body: some View {
    Panel {
      HStack {
        SectionHeader(text: "From your profile")
        Spacer()
        PlatformBadge(platform: "instagram")
      }
      if profile.status == "ok" {
        HStack(spacing: 10) {
          tile(profile.profileLinkTaps, "link taps")
          tile(profile.follows, "followed you")
          tile(profile.unfollows, "unfollowed")
        }
        if let reach = profile.reach {
          Text("Your whole account reached \(Format.count(reach)) accounts\(profile.accountsEngaged.map { ", and \(Format.count($0)) of them engaged" } ?? "").")
            .font(MayaFont.callout).foregroundStyle(Palette.ink)
        }
        Text("Last 30 days\(profile.asOf.map { " · read \(Format.ago($0))" } ?? "") · Instagram runs up to 2 days behind.")
          .font(MayaFont.caption).foregroundStyle(Palette.muted)
      } else {
        EmptyNote(text: InsightsWords.profileEmpty(profile.status))
      }
    }
  }

  private func tile(_ value: Double?, _ label: String) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(value.map(Format.count) ?? "—").font(.title3.weight(.bold).monospacedDigit()).foregroundStyle(value == nil ? Palette.muted : Palette.ink)
      Text(value == nil ? "not reported" : label).font(MayaFont.caption).foregroundStyle(Palette.muted)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(12)
    .background(Palette.wash, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    .accessibilityElement(children: .combine)
  }
}

// MARK: - Who follows you (Instagram)

struct WhoFollowsCardView: View {
  let audience: AudienceCard

  var body: some View {
    Panel {
      HStack {
        SectionHeader(text: "Who follows you")
        Spacer()
        PlatformBadge(platform: "instagram")
      }
      if audience.status == "ok", !(audience.gender.isEmpty && audience.age.isEmpty && audience.countries.isEmpty && audience.cities.isEmpty) {
        if !audience.gender.isEmpty { GenderSplit(shares: audience.gender) }
        if !audience.age.isEmpty { ShareBars(title: "Ages", shares: audience.age) }
        if !audience.countries.isEmpty { ShareBars(title: "Top countries", shares: audience.countries.map { .init(label: CountryWords.name($0.label), share: $0.share) }) }
        if !audience.cities.isEmpty { ShareBars(title: "Top cities", shares: audience.cities.map { .init(label: CityWords.short($0.label), share: $0.share) }) }
        Text("Share of all your followers\(audience.followersCounted.map { " (\(Format.count($0)) counted)" } ?? "")\(audience.asOf.map { " · read \(Format.ago($0))" } ?? ""). Updates weekly.")
          .font(MayaFont.caption).foregroundStyle(Palette.muted).fixedSize(horizontal: false, vertical: true)
      } else {
        EmptyNote(text: InsightsWords.audienceEmpty(audience.status == "ok" ? "not_reported" : audience.status))
      }
    }
  }
}

/// One stacked bar for the gender split: it always adds up to the whole.
private struct GenderSplit: View {
  let shares: [PostNumbers.Share]
  private let colors: [Color] = [Palette.purple, Palette.coral, Palette.muted]
  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      GeometryReader { g in
        HStack(spacing: 2) {
          ForEach(Array(shares.enumerated()), id: \.offset) { i, s in
            Rectangle().fill(colors[i % colors.count]).frame(width: max(2, g.size.width * s.share))
          }
        }
        .clipShape(Capsule())
      }
      .frame(height: 12)
      HStack(spacing: 14) {
        ForEach(Array(shares.enumerated()), id: \.offset) { i, s in
          HStack(spacing: 5) {
            Circle().fill(colors[i % colors.count]).frame(width: 8, height: 8)
            Text("\(s.label) \(Int((s.share * 100).rounded()))%").font(.caption.weight(.semibold).monospacedDigit()).foregroundStyle(Palette.ink)
          }
        }
      }
    }
    .accessibilityElement(children: .combine)
  }
}

/// The server sends country names; a bare two-letter code (when it couldn't) is named here.
enum CountryWords {
  static func name(_ label: String) -> String {
    guard label.count == 2, label == label.uppercased() else { return label }
    return Locale.current.localizedString(forRegionCode: label) ?? label
  }
}

/// "Los Angeles, California" → "Los Angeles" so the bar label fits; VoiceOver reads the same.
enum CityWords {
  static func short(_ label: String) -> String {
    label.split(separator: ",").first.map { String($0).trimmingCharacters(in: .whitespaces) } ?? label
  }
}
