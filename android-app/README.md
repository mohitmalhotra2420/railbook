# RailBook Android app — **passenger installs app, NOT a Chrome extension**

## Problem this solves

> “Passenger extension thodi load karega — details RailBook se IRCTC pe khud bhar jaayein.”

Browser security blocks any normal website from writing into `www.irctc.co.in`.  
Isliye **Chrome extension** sirf desktop power-users ke liye tha.  
**Mobile + normal passengers** ke liye sahi model:

```
Play Store → RailBook app → details enter → Continue to IRCTC
        → in-app WebView opens IRCTC
        → app injects autofill JS (bundled assets)
        → From/To/Date/Class + passengers fill
        → USER: Search → Book → Login → OTP → Pay
```

## What auto-fills

- Journey: From, To, Date, Class (+ quota if present)
- Passengers: name, age, gender, berth (food only if IRCTC offers it in-row)

## What NEVER auto-runs (hard policy)

Search · Book Now · Login · OTP · CAPTCHA · Pay · UPI · submit

## Project layout

```
android-app/
  app/src/main/
    java/com/railbook/assist/
      MainActivity.kt       # WebView shell + inject
      HandoffStore.kt       # on-device payload (15 min)
      RailBookJsBridge.kt   # JS → native events
    assets/autofill/
      fieldmap.js
      irctc-passenger.js
      railbook-webview-bridge.js
    res/...
webview-bridge/             # shared JS + README (also used by tests)
e2e-webview-bridge.mjs      # node/jsdom suite (no Android SDK required)
```

## Build (on a machine with Android SDK)

```bash
cd android-app
# needs Android SDK 34 + JDK 17
./gradlew :app:assembleDebug
# APK: app/build/outputs/apk/debug/app-debug.apk
```

This Arena sandbox has **Java but no Android SDK / Gradle wrapper yet** — sources + JS bridge are complete; APK compile is on your laptop/CI.

## Wire to existing RailBook web

Already compatible: `gh-railbook` `storeHandoff()` posts `kind: "railbook-autofill-test"` and writes `localStorage`.  
App’s `injectRailbookCapture()` listens for that and saves to `HandoffStore`, then opens IRCTC.

No Render deploy required for the app path (WebView loads live `https://railbook-gegs.onrender.com`).

## Desktop

Optional: existing Chrome extension loader `5L.2b-AUTO` for power users.  
**Default passenger path = this app.**

## Safety checklist

- [x] HTTPS only WebView  
- [x] Host allowlist: Render origin + `*.irctc.co.in`  
- [x] Continue tap = approval (15 min TTL)  
- [x] Same fill engines as POC (tested)  
- [x] No Book/Pay/login automation  
- [x] No PII in native logs (bridge strips sensitive keys)  
- [x] No cleartext traffic  
