import Charts
import SwiftUI

/// A1: the follower-growth card on "Your numbers", for their TikTok. Only what the server stored; an empty card
/// says why in plain words.
enum InsightsWords {
  /// Why the follower chart is empty.
  static func growthEmpty(connected: Bool, platform: String) -> String {
    connected
      ? "Your follower history shows up after the first daily read. Check back tomorrow."
      : "Connect TikTok to see how your followers change day by day."
  }
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
          Text("TikTok doesn't report daily follows and unfollows for your account, so this shows your total only.")
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
