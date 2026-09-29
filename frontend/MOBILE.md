# Native apps (Capacitor) - App Store & Play Store

The web app is wrapped with **Capacitor 8** so the same React UI ships as:

| Platform | Project | Bundle / package ID |
|----------|---------|---------------------|
| iOS | `frontend/ios/` | `ie.studentpadelireland.app` |
| Android | `frontend/android/` | `ie.studentpadelireland.app` |
| Web / PWA | Vercel `frontend/` | unchanged |

## Prerequisites

- Node 20+
- Xcode 16+ (iOS) + Apple Developer Program ($99/yr) for TestFlight / App Store
- Android Studio (optional, for Play Store)
- A **live HTTPS API** (`VITE_API_URL`) - the native shell cannot use Vite’s local proxy

## Build & open

```bash
cd frontend

# Required for any native build - point at your Render (or other) API
export VITE_API_URL=https://your-api.onrender.com
export VITE_WEB_ORIGIN=https://studentpadelireland.ie   # QR / invite links

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

- Relative Vite `base: './'` so WebView assets resolve
- Capacitor plugins: App, Browser, Keyboard, SplashScreen, StatusBar, Share
- Service worker **disabled** inside the native shell (PWA still works on web)
- Stripe Checkout opens in the system browser; returning to the app confirms registration
- Deep link scheme `studentpadel://…` + Associated Domains / App Links stubs
- iOS privacy strings (camera / photo library for profile media)
- Portrait phone orientations; export compliance flag (`ITSAppUsesNonExemptEncryption` = false)
- CORS allows `https://app.studentpadelireland.ie` (Capacitor WebView hostname)

## App Store Connect checklist (you still do this)

1. Enroll in [Apple Developer](https://developer.apple.com)
2. In Xcode: Team + signing for `ie.studentpadelireland.app`
3. Replace `TEAMID` in `public/.well-known/apple-app-site-association` with your Team ID, deploy the site, then enable Associated Domains
4. Create the app in App Store Connect (name, screenshots 6.7" + 6.1", privacy policy URL, age rating)
5. Archive → Upload → TestFlight → Submit for review

Apple often rejects thin “website wrappers.” Strong points for review: live scores, organiser scoring, community competitions, rankings, offline shell branding, native share / status bar / splash. Keep Privacy Policy + Terms live on the web domain before submit.

## Play Store (optional)

1. Generate a release keystore / use Play App Signing
2. Put the release cert SHA-256 into `public/.well-known/assetlinks.json`
3. `cd android && ./gradlew bundleRelease`

## Honest limits

Capacitor makes this **App Store–buildable**, not automatically approved. You still need Apple review, a privacy policy, screenshots, and a hosted API. Native chat, push, and App Store IAP are not in this MVP.

## Privacy manifest

`ios/App/App/PrivacyInfo.xcprivacy` declares Required Reason APIs and collected data types (email, name, phone, photos) for App Store Connect. Update it if you add analytics / tracking SDKs.
