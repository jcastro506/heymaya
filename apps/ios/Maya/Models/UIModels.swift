import Foundation

// Swift mirrors of the app-facing queries in convex/ui.ts. JS numbers decode as Double.
// MayaTests/ContractTests decodes real captured outputs, so a server-side rename fails CI
// instead of the app (spec §0 D1).

struct Today: Decodable, Equatable {
  let statusLine: String
  let paired: Bool
  let dossier: Bool
  let sentToday: [SentMessage]
  let nextBlock: NextBlock?
  let week: [OwnPost]
}

struct SentMessage: Decodable, Equatable, Identifiable {
  let id: String
  let kind: String
  let body: String
  let links: [String]
  let ts: Double
  let delivered: Bool
  let error: String?
}

struct NextBlock: Decodable, Equatable {
  let kind: String
  let start: Double
  let end: Double
  let title: String
  let status: String
}

struct OwnPost: Decodable, Equatable, Identifiable {
  let id: String
  let url: String
  let platform: String
  let createTime: Double
  let views: Double
  let multiple: Double?
  let metricsAsOf: Double
  var cover: String? = nil
}

struct Idea: Decodable, Equatable, Identifiable {
  let id: String
  let status: String
  let saved: Bool
  /// N1: in the app but not yet texted, offered, or on their screen. The server decides.
  var unseen: Bool? = nil
  let reaction: String?
  let newForYou: Bool
  let features: IdeaFeatures?
  let fitWhy: String
  let evidenceLinks: [String]
  let version: IdeaVersion?
  let messageText: String
  let sentAt: Double?
  let postedAt: Double?
  var evidenceCovers: [String?]? = nil

  var hook: String? { version?.hook }
  /// The stored cover for the idea's first proof post, when the server kept one.
  var firstCover: String? { evidenceCovers?.first ?? nil }
}

struct IdeaFeatures: Decodable, Equatable {
  let format: String?
  let topics: [String]?
  let tone: String?
  let lengthBucket: String?
  let sound: String?
  let source: String?
  let account: String?
}

struct IdeaVersion: Decodable, Equatable {
  let hook: String?
  let onScreenText: String?
  let lengthSec: Double?
  let sound: String?
}

struct CreatorSettings: Decodable, Equatable {
  let handles: Handles
  var avatars: Avatars? = nil
  let niche: String
  let timezone: String
  let quietHours: QuietHours
  let tone: String
  let paired: Bool
  let plan: String
  let tier: String
  let accountCap: Double
  let trialEndsAt: Double?
  let currentPeriodEnd: Double?
  let knows: Knows?
  let notes: [Note]
  let rules: [Rule]
  let taste: Taste
}

struct Handles: Decodable, Equatable {
  let tiktok: String?
  let instagram: String?
}

struct Avatars: Decodable, Equatable {
  let tiktok: String?
  let instagram: String?
}

struct QuietHours: Decodable, Equatable {
  let start: String
  let end: String
}

struct Knows: Decodable, Equatable {
  let summary: String?
  let register: String?
  let works: [String]
  let doesNot: [String]
  let keywords: [String]
  let mode: String?
}

struct Note: Decodable, Equatable, Identifiable {
  let id: String
  let text: String
  let kind: String
  let at: Double
}

struct Rule: Decodable, Equatable, Identifiable {
  let id: String
  let text: String
  let at: Double
}

struct Taste: Decodable, Equatable {
  let note: String?
  let updatedAt: Double?
}

struct Plan: Decodable, Equatable {
  let connected: Bool
  let timezone: String
  let blocks: [PlanBlock]
  let events: [PlanEvent]
  let bestHours: [Double]
}

struct PlanBlock: Decodable, Equatable, Identifiable {
  let id: String
  let kind: String
  let title: String
  let start: Double
  let end: Double
  let status: String
  let onCalendar: Bool
  let ideaId: String?
}

struct PlanEvent: Decodable, Equatable, Identifiable {
  let id: String
  let title: String
  let start: Double
  let end: Double
  let allDay: Bool
  let `class`: String
}

struct Results: Decodable, Equatable {
  let rung: Rung
  let lane: LaneBenchmark
  let week: [ResultPost]
  let experiments: [Experiment]
  let lastReview: Review?
  let openPredictions: Double
}

struct Rung: Decodable, Equatable {
  let rung: String
  let why: String
  let medianMultiple: Double?
  let planned: Double?
  let posted: Double
}

struct LaneBenchmark: Decodable, Equatable {
  let usable: Bool
  let medianViews: Double?
  let p75Views: Double?
  let why: String
}

struct ResultPost: Decodable, Equatable, Identifiable {
  let id: String
  let url: String
  let platform: String
  let createTime: Double
  let views: Double
  let multiple: Double?
  let engagementPerView: Double?
  let metricsAsOf: Double
  let sampled: Bool
}

struct Experiment: Decodable, Equatable, Identifiable {
  let id: String
  let text: String
  let proposedAt: Double
  let result: String?
}

struct Review: Decodable, Equatable {
  let body: String
  let ts: Double
}

struct Lane: Decodable, Equatable {
  let accounts: [WatchedAccount]
  let keywords: [String]
}

struct WatchedAccount: Decodable, Equatable, Identifiable {
  let id: String
  let platform: String
  let handle: String
  let status: String
  let baseline: Double?
  let lastSampledAt: Double?
  var avatar: String? = nil
}

struct Opportunities: Decodable, Equatable {
  let unlocked: Bool
  let tier: String
  let unlockTier: String
  let unlockPriceUsd: Double
  let teaser: Teaser
  /// B6 signal 1: real brands seen paying creators in their lane (absent in older captures).
  var brandsInLane: [LaneBrand]? = nil
  let opportunities: [Opportunity]

  struct LaneBrand: Decodable, Equatable { let handle: String; let platform: String; let posts: Double; let creators: [String] }

  struct Teaser: Decodable, Equatable {
    let paidPostsInLane: Double
    let accountsPaid: Double
    let days: Double
  }
}

struct Opportunity: Decodable, Equatable, Identifiable {
  let id: String
  let brand: String
  let campaign: String
  let type: String
  let fit: String
  let status: String
  let verdict: String
  let route: String
  let compensation: String
  let deadline: Double?
  let updatedAt: Double
}

struct Analytics: Decodable, Equatable {
  let accounts: [AnalyticsAccount]
  let posts: [AnalyticsPost]
}

struct AnalyticsAccount: Decodable, Equatable, Identifiable {
  var id: String { platform }
  let platform: String
  let handle: String?
  let connected: Bool
  let needsReconnect: Bool
  let followers: Double?
  let followersAsOf: Double?
  let followers30dAgo: Double?
  let posts: Double
  /// A1: personal | creator | business, from their public profile; nil until checked.
  let accountType: String?
  let setup: AccountSetup?
}

/// A1: the one change that would help Maya on this platform (Instagram must be Creator to connect).
struct AccountSetup: Decodable, Equatable {
  let needed: Bool
  let title: String
  let why: String
  let steps: [String]
}

struct Headline: Decodable, Equatable {
  let value: Double
  let what: String   // "reach" | "views"
  let basis: String  // "connected" | "public"
  let asOfHours: Double?
}

struct Multiple: Decodable, Equatable {
  let value: Double
  let basis: String  // "reach" | "views"
}

struct AnalyticsPost: Decodable, Equatable, Identifiable, Hashable {
  let id: String
  let url: String
  let platform: String
  let createTime: Double
  let contentType: String
  var cover: String? = nil
  let headline: Headline
  let multiple: Multiple?
  let diagnosis: String?

  func hash(into hasher: inout Hasher) { hasher.combine(id) }
  static func == (a: AnalyticsPost, b: AnalyticsPost) -> Bool { a.id == b.id && a.headline == b.headline }
}

struct PostNumbers: Decodable, Equatable {
  let id: String
  let url: String
  let platform: String
  let createTime: Double
  let contentType: String
  var cover: String? = nil
  let caption: String
  let publicCounts: [String: Double?]
  let publicAsOf: Double
  let connected: [String: Double?]?
  let connectedAsOf: Double?
  let headline: Headline
  let multiple: Multiple?
  let derived: Derived?
  let read: String?
  var shape: String? = nil
  let cannotKnow: [String]
  /// A1: TikTok's own splits (connected through TikTok's business app), biggest first; nil when not reported.
  var viewSources: [Share]? = nil
  var viewerTypes: [Share]? = nil

  struct Share: Decodable, Equatable, Hashable {
    let label: String
    let share: Double
  }

  struct Derived: Decodable, Equatable {
    let distribution: Double?
    let reachMultiple: Double?
    let engagementPerReach: Double?
    let retention: Double?
    let diagnosis: String
    let basis: String
  }
}
