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
src/theme.ts    colours and sizes copied from the web app's globals.css
src/config.ts   server address
```

## Status

Phase 1 (skeleton): navigation, theme, API client, server connection check on the Account tab. Sign-in, the live map, vehicles, trip history and alerts follow in that order.
