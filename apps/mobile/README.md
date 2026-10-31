# RIO GPS mobile app

One Expo (React Native) codebase for Android and iOS. It talks to the same server as the web app through `/api/v1` and signs in with a bearer token.

## Why it is not in the pnpm workspace

`pnpm-workspace.yaml` excludes this folder. React Native brings React 19 and a large dependency tree; inside the workspace it changed what the web app resolved (and broke its type check). Installed on its own with npm, the server images and `pnpm-lock.yaml` stay exactly as they were. `.dockerignore` also keeps this folder out of the server images.

Shared code still comes from `packages/core` (`"@rio-gps/core": "file:../../packages/core"`). `metro.config.js` explains the three settings that make that work.

## Run it on a phone

```bash
cd apps/mobile
npm ci
npx expo start
```

Install **Expo Go** on the phone, keep the phone and laptop on the same Wi-Fi, and scan the QR code. From the live-map phase onward Expo Go is not enough (the map needs native code) and a development build is installed instead.

To point the app at another server: `EXPO_PUBLIC_API_URL=http://192.168.x.x:3000 npx expo start`.

## Checks

```bash
npm run typecheck
npm run lint
npm test
npx expo export --platform android   # proves the JavaScript bundles
```

## Layout

```
app/            screens (file-based routes); (tabs) holds Map, Vehicles, Alerts, Account
src/api/        client.ts (plain TypeScript, unit-tested) and index.ts (secure token storage)
src/auth/       service.ts (sign-in logic, unit-tested) and SessionProvider.tsx (who is signed in)
src/alerts/     model.ts (labels, wording, paging; unit-tested) and AlertsProvider.tsx
src/trips/      model.ts (days, playback maths; unit-tested) and TripMap.tsx
src/map/        model.ts (map features, camera bounds; unit-tested) and LiveMap.tsx
src/fleet/      model.ts (status, search, wording; unit-tested) and FleetProvider.tsx (shared, auto-refreshing fleet data)
src/theme.ts    colours and sizes copied from the web app's globals.css
src/config.ts   server address
```

## Status

- Phase 1 (skeleton): navigation, theme, API client, server connection check on the Account tab.
- Phase 2 (sign-in): email and password, two-step verification (authenticator app or backup code), sign out. The token is kept in the phone's secure storage. `src/auth/service.ts` explains how the second step works without a cookie jar.
- Phase 4 (vehicles): searchable list with Moving, Idling, Stopped and Offline filters, refreshed every 20 seconds, and a detail screen with Open in Maps. `src/fleet/model.ts` holds the status rules (a copy of the web app's).
- Phase 6a (alerts list): newest first, All and Unread views, mark one or all as read, unread count on the tab, refreshed every 30 seconds.
- Phase 3 (live map): MapLibre with the same OpenFreeMap style as the web. Vehicles coloured by status, grouped when zoomed out, tap for a card with Follow and Details, a button to show the whole fleet. Runs only in an installed build; in Expo Go the Map tab shows a notice.
- Phase 5 (trip history): pick a day, see that day's trips and totals, tap a trip to replay its route on the map with play, pause, three speeds and a progress bar you can drag. Days and times use the organization's time zone.

Still to come: push notifications.

## Installable builds (EAS)

The map is native code, so it needs a real build. Builds run on Expo's servers:

```bash
cd apps/mobile
npx eas-cli login
npx eas-cli build --platform android --profile preview   # an APK to install directly
```

Use `npm ci`, not `npm install`, on machines that only build or run the app: `npm install` can rewrite `package-lock.json`, and the build servers refuse a lock file that does not match. `eas.json` pins the Node version used on the build servers to the one the lock file was made with.

`eas.json` has three profiles: `preview` (standalone APK for testing), `development` (connects to `npx expo start` for live code changes) and `production` (store builds). iPhone builds need an Apple Developer account.
