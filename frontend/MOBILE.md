# Native apps (Capacitor) - App Store & Play Store

The web app is wrapped with **Capacitor 8** so the same React UI ships as:

| Platform | Project | Bundle / package ID |
|----------|---------|---------------------|
| iOS | `frontend/ios/` | `ie.studentpadel.app` |
| Android | `frontend/android/` | `ie.studentpadel.app` |
| Web / PWA | Vercel `frontend/` | unchanged |

## Prerequisites

- **Node 22+** (Capacitor 8 CLI requires it; `npx cap` fails on Node 20)
- Xcode 16+ (iOS) + Apple Developer Program ($99/yr) for TestFlight / App Store
- Android Studio (optional, for Play Store)
- A **live HTTPS API** (`VITE_API_URL`) - the native shell cannot use Vite’s local proxy
- No committed `.env` — set `VITE_API_URL` / `VITE_WEB_ORIGIN` in your shell (or a local `.env`) before `build:native`

## Build & open

```bash
cd frontend

# Required for any native build - point at your Render (or other) API
export VITE_API_URL=https://your-api.onrender.com
export VITE_WEB_ORIGIN=https://studentpadel.ie   # QR / invite links

npm run build:native    # vite build + cap sync
npm run cap:ios         # opens Xcode
# or
npm run cap:android     # opens Android Studio
```

Regenerate icons/splash from `frontend/assets/` after changing brand art:

```bash
npm run assets:native
```

## What was wired for App Store readiness

- Absolute Vite `base: '/'` so nested mobile routes (`/t/...`) load JS/CSS correctly (Capacitor uses https hostname)
- Capacitor plugins: App, Browser, Keyboard, SplashScreen, StatusBar, Share
- Service worker **disabled** inside the native shell (PWA still works on web)
- Stripe Checkout opens in the system browser; returning to the app confirms registration
- Deep link scheme `studentpadel://…` + Associated Domains / App Links stubs
- iOS privacy strings (camera / photo library for profile media)
- Portrait phone orientations; iPhone-only target (no iPad screenshots required)
- Export compliance flag (`ITSAppUsesNonExemptEncryption` = false)
- CORS allows `https://app.studentpadel.ie` (Capacitor WebView hostname)
- In-app **Delete account** (password confirm) + hosted **Privacy** / **Terms** pages

## Windows-only: ship iOS updates with Xcode Cloud

You do **not** need a Mac. Apple’s Macs build the app; you use [App Store Connect](https://appstoreconnect.apple.com) in a browser.

`frontend/ios/App/ci_scripts/ci_post_clone.sh` installs Node, runs `npm run build:native`, and syncs the web UI into the iOS project before Archive.

### One-time setup (browser)

1. Push `main` (version bump + `ci_scripts` must be on GitHub).
2. Open [App Store Connect](https://appstoreconnect.apple.com) → **Apps** → **Student Padel Ireland** → **Xcode Cloud**.
3. **Get Started** / create a workflow. Connect the GitHub repo if asked.
4. Set:
   - **Project / workspace:** `frontend/ios/App/App.xcodeproj`
   - **Scheme:** `App`
   - **Start condition:** Branch changes on `main` (or Manual only)
   - **Actions:** Archive → App Store Connect / TestFlight
5. **Environment** → Environment Variables (not secret unless you prefer):
   - `VITE_API_URL` = `https://student-padel-ireland.onrender.com`
   - `VITE_WEB_ORIGIN` = `https://studentpadel.ie`
6. Save and start a build (or push any commit to `main`).

If Connect says you must finish setup in Xcode once: use a cheap cloud Mac for ~30 minutes ([MacinCloud](https://www.macincloud.com/) / [MacStadium](https://www.macstadium.com/)) only for that first “Grant Access / Create Workflow” click, then never again.

### Every update after that

1. Bump iOS version/build if needed (`MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` in `project.pbxproj`).
2. Commit + push to `main`.
3. Wait for the Xcode Cloud build (App Store Connect → Xcode Cloud).
4. When it appears in **TestFlight**, open the app version → add **1.0.1** (or next) → What’s New → **Submit for Review**.

Apple often rejects thin “website wrappers.” Strong points for review: live scores, organiser scoring, community competitions, rankings, account deletion, native share / status bar / splash.

## App Store Connect checklist (first release)

1. Enroll in [Apple Developer](https://developer.apple.com)
2. Screenshots 6.7" + 6.1", privacy policy `https://studentpadel.ie/privacy`, age rating, support URL
3. Review notes: Stripe charges **real-world tournament entry fees** (not digital goods / IAP)
4. Ship via Xcode Cloud (above) or a Mac Archive

## Play Store (optional)

1. Generate a release keystore / use Play App Signing
2. Put the release cert SHA-256 into `public/.well-known/assetlinks.json`
3. `cd android && ./gradlew bundleRelease`

## Honest limits

Capacitor makes this **App Store–buildable**, not automatically approved. You still need Apple review, a privacy policy, screenshots, and a hosted API. Native chat, push, and App Store IAP are not in this MVP.

Native UX extras (4.2 readiness): bottom tab bar, compact welcome (not marketing site), payment verify-on-return, Share sheet for invites, haptics, offline banner.

## Privacy manifest

`ios/App/App/PrivacyInfo.xcprivacy` declares Required Reason APIs and collected data types (email, name, phone, photos) for App Store Connect. Update it if you add analytics / tracking SDKs.
