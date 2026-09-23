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
}

struct Idea: Decodable, Equatable, Identifiable {
  let id: String
  let status: String
  let saved: Bool
  let reaction: String?
  let newForYou: Bool
  let features: IdeaFeatures?
  let fitWhy: String
  let evidenceLinks: [String]
  let version: IdeaVersion?
  let messageText: String
  let sentAt: Double?
  let postedAt: Double?

  var hook: String? { version?.hook }
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
}
