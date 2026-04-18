# HolidogInn — Maestro E2E

End-to-end tests for the Expo app in `apps/mobile`, driven by
[Maestro](https://maestro.mobile.dev).

## Install the CLI

Maestro is a stand-alone binary — it is **not** an npm package. Install once
per workstation:

```bash
curl -fsSL "https://get.maestro.mobile.dev" | bash
```

Verify with `maestro --version`. On macOS you also need Xcode (for `xcrun
simctl`) and/or Android Studio with an emulator image.

## Run flows

From the monorepo root:

```bash
# Run the whole suite
npm run test:e2e

# Single flow
maestro test e2e/flows/00_launch.yaml

# Only smoke-tagged flows
maestro test --include-tags=smoke e2e/flows/

# Pass credentials for the auth flow
maestro test \
  -e E2E_EMAIL="qa+e2e@holidoginn.com" \
  -e E2E_PASSWORD="********" \
  e2e/flows/01_auth_signin.yaml
```

Maestro auto-detects a running iOS simulator or Android emulator. If both
are running, pass `--device <id>` (list with `xcrun simctl list devices` or
`adb devices`).

## Record new flows with Maestro Studio

```bash
npm run test:e2e:studio
```

Studio opens a browser UI mirroring the device. Interact with the app and
Studio writes a flow YAML you can save into `e2e/flows/`. Prefer recording
a flow first, then tightening the selectors to use `testID`s afterwards —
text matchers break the moment copy changes.

## Why a dev build, not Expo Go

This app uses Clerk (`@clerk/clerk-expo`), Stripe (`@stripe/stripe-react-native`),
and `expo-secure-store`, all of which require native modules that are **not**
bundled into Expo Go. Running these flows against Expo Go will fail at
launch.

Build and install the dev client once per machine:

```bash
# iOS simulator
npm run ios

# Android emulator / device
npm run android
```

Then start the Metro bundler (`cd apps/mobile && npx expo start --dev-client`)
and run the Maestro flows against the installed app.

## The `appId`

Flows pin to the app via `appId`, which must match the platform bundle:

| Platform | Value                 | Source                                   |
| -------- | --------------------- | ---------------------------------------- |
| iOS      | `com.holidoginn.app`  | `apps/mobile/app.json` → `ios.bundleIdentifier` |
| Android  | `com.holidoginn.app`  | `apps/mobile/app.json` → `android.package`      |

If the bundle ID ever changes (e.g. a `com.holidoginn.app.dev` staging
variant), update every `appId:` line in `e2e/config.yaml` and
`e2e/flows/*.yaml`. A quick sanity check:

```bash
grep -r "appId:" e2e/
```

## Selector conventions

Flows use `testID` selectors exclusively (no text matchers) so Spanish copy
changes do not break tests. Naming convention: `screen-element-action`, e.g.
`pets-create-fab`, `reservation-create-submit-button`, `tabbar-reservations`.

When adding a new interactive element that will be covered by a flow, add a
matching `testID` prop at the same time.

## Known limitations / TODOs

- **Stripe PaymentSheet** (`03_reservation_create.yaml`): Maestro cannot
  reliably drive the native payment modal. The flow stops at the submit
  tap. Extending past that point will need a Stripe test key + card stub.
- **Clerk 2FA** (`01_auth_signin.yaml`): the QA user must have email-code
  2FA disabled. If it is enforced, wire in a test mailbox (e.g. Mailosaur)
  and read the code from there.
- **Date pickers** (`03_reservation_create.yaml`): the flow accepts whatever
  dates the native picker opens to. Swap in explicit dates once backend
  fixtures guarantee room availability.
