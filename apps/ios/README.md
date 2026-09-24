# Maya for iOS

Native SwiftUI app (docs/CREATOR_COMPANION_APP_SPEC.md §0 D1). It reads the same Convex
queries the web Mission Control used (`convex/ui.ts`) and signs in with the same Clerk
instance, so a creator's data is already there.

## Run it

```bash
cd apps/ios
xcodegen          # generates Maya.xcodeproj from project.yml (the project file is not committed)
open Maya.xcodeproj
```

Pick an iPhone simulator and press Run. Debug builds talk to the creator dev deployment
(`impressive-roadrunner-997`) and the Clerk development instance (`Config/Debug.xcconfig`).

> Build output goes to Xcode's DerivedData, outside Desktop. Building *inside* an
> iCloud-synced Desktop folder fails code signing with "resource fork, Finder information,
> or similar detritus not allowed".

## Tests

`MayaTests/ContractTests` decodes real outputs of every app-facing query, captured with
`npx convex run ui:<name> --identity '{"subject":"eval:vanessaalopezz",…}'`. Re-capture a
fixture whenever its query changes; a failing decode means the app would break.

## TestFlight (operator)

1. Create `Config/Local.xcconfig` with `MAYA_DEVELOPMENT_TEAM = <your Apple team id>`.
2. Create the app record in App Store Connect with bundle id `ai.heymaya.maya`.
3. In Xcode: Product → Archive → Distribute → TestFlight.

## Clerk dashboard (operator, once)

- **Native applications:** register the iOS app (team id + `ai.heymaya.maya`).
- **Sign in with Apple:** enable it as a social connection (it's missing from the sign-in sheet until then).
- **Convex integration:** make sure it's enabled, so the session token Convex receives is accepted.
