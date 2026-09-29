import ClerkKit
@preconcurrency import ConvexMobile

/// Clerk → Convex, with the token the server accepts. ClerkConvex's provider sends Clerk's default
/// session token, which carries no `aud`; our server only accepts `aud: "convex"`
/// (`convex/auth.config.ts`, the same token the web asks for). Without it every call from the app
/// was silently unauthenticated and the app sat on its launch screen (2026-09-29, first sign-up).
/// So this asks for the `convex` template, and hands the server a fresh one whenever Clerk refreshes.
@MainActor
final class MayaAuthProvider: AuthProvider {
  typealias T = String
  static let template = "convex"

  private var onIdToken: (@Sendable (String?) -> Void)?
  private var refreshTask: Task<Void, Never>?
  private var sessionTask: Task<Void, Never>?
  private weak var client: ConvexClientWithAuth<String>?

  func bind(client: ConvexClientWithAuth<String>) {
    self.client = client
    sessionTask?.cancel()
    sessionTask = Task { @MainActor [weak self] in
      guard let self else { return }
      await self.sync(old: nil, new: Clerk.shared.session)
      for await event in Clerk.shared.auth.events {
        guard !Task.isCancelled else { break }
        if case .sessionChanged(let old, let new) = event { await self.sync(old: old, new: new) }
      }
    }
  }

  func login(onIdToken: @Sendable @escaping (String?) -> Void) async throws -> String { try await start(onIdToken) }
  func loginFromCache(onIdToken: @Sendable @escaping (String?) -> Void) async throws -> String { try await start(onIdToken) }

  func logout() async throws {
    refreshTask?.cancel()
    refreshTask = nil
    onIdToken = nil
    try await Clerk.shared.auth.signOut()
  }

  nonisolated func extractIdToken(from authResult: String) -> String { authResult }

  private func start(_ onIdToken: @Sendable @escaping (String?) -> Void) async throws -> String {
    self.onIdToken = onIdToken
    let token = try await fetch()
    refreshTask?.cancel()
    refreshTask = Task { @MainActor [weak self] in
      for await event in Clerk.shared.auth.events {
        guard let self, !Task.isCancelled else { break }
        if case .tokenRefreshed = event { self.onIdToken?(try? await self.fetch()) }
      }
    }
    return token
  }

  private func fetch() async throws -> String {
    guard let session = Clerk.shared.session, session.status == .active,
          let token = try await session.getToken(.init(template: Self.template)) else {
      throw NoActiveSession()
    }
    return token
  }

  struct NoActiveSession: Error {}

  private func sync(old: Session?, new: Session?) async {
    guard let client else { return }
    if new?.status == .active, old?.status != .active || old?.id != new?.id {
      _ = await client.loginFromCache()
    } else if old?.id != nil, new == nil {
      await client.logout()
    }
  }
}
