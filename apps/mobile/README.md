# RIO GPS mobile app

One Expo (React Native) codebase for Android and iOS. It talks to the same server as the web app through `/api/v1` and signs in with a bearer token.

## Why it is not in the pnpm workspace

`pnpm-workspace.yaml` excludes this folder. React Native brings React 19 and a large dependency tree; inside the workspace it changed what the web app resolved (and broke its type check). Installed on its own with npm, the server images and `pnpm-lock.yaml` stay exactly as they were. `.dockerignore` also keeps this folder out of the server images.

Shared code still comes from `packages/core` (`"@rio-gps/core": "file:../../packages/core"`). `metro.config.js` explains the three settings that make that work.

## Run it on a phone

```bash
cd apps/mobile
npm install
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
src/fleet/      model.ts (status, search, wording; unit-tested) and FleetProvider.tsx (shared, auto-refreshing fleet data)
src/theme.ts    colours and sizes copied from the web app's globals.css
src/config.ts   server address
```

## Status

- Phase 1 (skeleton): navigation, theme, API client, server connection check on the Account tab.
- Phase 2 (sign-in): email and password, two-step verification (authenticator app or backup code), sign out. The token is kept in the phone's secure storage. `src/auth/service.ts` explains how the second step works without a cookie jar.
- Phase 4 (vehicles): searchable list with Moving, Idling, Stopped and Offline filters, refreshed every 20 seconds, and a detail screen with Open in Maps. `src/fleet/model.ts` holds the status rules (a copy of the web app's).

The live map (needs a development build, not Expo Go), trip history and alerts follow.
