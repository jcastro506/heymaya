import ConvexMobile
import CoreLocation
import Foundation

/// What's on near them (2026-11-13): with their permission ("while using the app", never always), the phone names
/// the city it's in and sends only that, at most once a day when the app opens. Never coordinates. Maya's weekly
/// look uses it for a week, so a trip shows what's on there and doesn't become home.
@MainActor
final class Nearby: NSObject, CLLocationManagerDelegate {
  static let shared = Nearby()
  private let manager = CLLocationManager()
  private var asking: CheckedContinuation<Bool, Never>?
  private var locating: CheckedContinuation<CLLocation?, Never>?
  private static let sentKey = "nearby.sentAt"
  private static let everyHours: Double = 20

  override private init() {
    super.init()
    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyKilometer // a city is all she needs
  }

  static var answered: Bool { CLLocationManager().authorizationStatus != .notDetermined }
  static var granted: Bool { [.authorizedWhenInUse, .authorizedAlways].contains(CLLocationManager().authorizationStatus) }

  /// The iPhone's prompt; true if they allowed it. Then the first city goes up right away.
  func ask() async -> Bool {
    if Fixtures.enabled { return true }
    guard manager.authorizationStatus == .notDetermined else { return Self.granted }
    let ok = await withCheckedContinuation { (c: CheckedContinuation<Bool, Never>) in
      asking = c
      manager.requestWhenInUseAuthorization()
    }
    if ok { await refresh(force: true) }
    return ok
  }

  /// When the app opens: if they allowed it and it's been most of a day, send the city. If they turned it off, forget it.
  func refresh(force: Bool = false) async {
    guard !Fixtures.enabled else { return }
    let status = manager.authorizationStatus
    if status == .denied || status == .restricted {
      if UserDefaults.standard.double(forKey: Self.sentKey) > 0 {
        UserDefaults.standard.removeObject(forKey: Self.sentKey)
        struct R: Decodable { let ok: Bool }
        _ = try? await convex.mutation("scout/local:clearWhereNow", with: [:]) as R
      }
      return
    }
    guard Self.granted else { return }
    let last = UserDefaults.standard.double(forKey: Self.sentKey)
    if !force, Date().timeIntervalSince1970 - last < Self.everyHours * 3600 { return }
    guard let location = await locate(), let place = await Self.city(of: location) else { return }
    struct R: Decodable { let ok: Bool }
    if let r: R = try? await convex.mutation("scout/local:setWhereNow", with: ["place": place]), r.ok {
      UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: Self.sentKey)
    }
  }

  /// "Austin, TX" in the US, "Lisbon, Portugal" elsewhere: the words a person would say. Done on the phone.
  static func city(of location: CLLocation) async -> String? {
    guard let p = try? await CLGeocoder().reverseGeocodeLocation(location).first, let town = p.locality else { return nil }
    let region = p.isoCountryCode == "US" ? p.administrativeArea : p.country
    return [town, region].compactMap { $0 }.joined(separator: ", ")
  }

  private func locate() async -> CLLocation? {
    await withCheckedContinuation { (c: CheckedContinuation<CLLocation?, Never>) in
      locating?.resume(returning: nil)
      locating = c
      manager.requestLocation()
    }
  }

  nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    let status = manager.authorizationStatus
    Task { @MainActor in
      guard status != .notDetermined, let c = self.asking else { return }
      self.asking = nil
      c.resume(returning: status == .authorizedWhenInUse || status == .authorizedAlways)
    }
  }

  nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    let last = locations.last
    Task { @MainActor in
      self.locating?.resume(returning: last)
      self.locating = nil
    }
  }

  nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    Task { @MainActor in
      self.locating?.resume(returning: nil)
      self.locating = nil
    }
  }
}
