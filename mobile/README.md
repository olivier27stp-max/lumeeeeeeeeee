# Lume CRM — Mobile

Field-worker companion app for Lume CRM. Built with Expo (SDK 56), expo-router,
NativeWind, Supabase, and TanStack Query.

**The web app is in the parent directory** (`../src`, `../server`, `../supabase`).
This mobile app is fully isolated — it has its own `node_modules`, its own
build, and its own deploy pipeline (Expo / EAS). Running, modifying, or breaking
the mobile app cannot affect the web app.

---

## Setup

1. **Install dependencies** (already done if you ran `create-expo-app`):

   ```bash
   npm install
   ```

2. **Configure environment variables**. Copy the example and fill in the
   Supabase project URL + anon key from the same project the web app uses:

   ```bash
   cp .env.example .env.local
   # then edit .env.local
   ```

   Required:
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`

   ⚠️ **Never put the service-role key here.** Anything `EXPO_PUBLIC_*` is
   bundled into the JS shipped to every device.

3. **Run the dev server**:

   ```bash
   npx expo start
   ```

   Then either press `i` for the iOS simulator (requires Xcode) or scan the QR
   code with the Expo Go app on your iPhone.

---

## What's included (MVP)

- **Supabase auth**: sign in, sign up, forgot password, session persisted in
  AsyncStorage, auto-refresh.
- **Tab navigation**:
  - **Today** — today's scheduled jobs.
  - **Clients** — searchable client directory.
  - **Profile** — signed-in user + sign out.
- **Job detail screen**: title, schedule, client, address (tap → Apple Maps),
  total, description, existing notes. Action buttons: *Start job* (sets
  `in_progress` + `start_at`) and *Mark complete* (sets `completed` +
  `completed_at` + appends notes).
- **Client detail screen**: phone (tap → call), email (tap → mail), address
  (tap → map), notes.

All data flows through Supabase with the same RLS policies as the web app —
no separate backend, no service role exposed.

---

## Project structure

```
src/
  app/                          # expo-router file-based routes
    _layout.tsx                 # providers (QueryClient, Auth) + root Stack
    index.tsx                   # auth-aware redirect
    (auth)/                     # public routes (sign-in, sign-up, reset)
    (app)/                      # authenticated routes
      _layout.tsx               # auth guard
      (tabs)/                   # bottom tabs
      jobs/[id].tsx             # job detail + complete flow
      clients/[id].tsx          # client detail
  components/
    ui/                         # Button, Input, Card, ScreenContainer, StatusPill
    JobCard.tsx
    ClientCard.tsx
  lib/
    supabase.ts                 # Supabase client (AsyncStorage session)
    auth.tsx                    # AuthProvider + useAuth hook
    queryClient.ts              # TanStack Query config
    format.ts                   # currency / date helpers
    api/
      jobs.ts                   # listTodaysJobs, getJob, markJobInProgress, markJobCompleted
      clients.ts                # listClients, getClient
  types/
    db.ts                       # DB-aligned types (Job, ClientRecord, Profile)
  global.css                    # @tailwind directives (NativeWind)
```

---

## Next steps

In rough priority order:

1. **Photo attachments on job completion** (camera + Supabase Storage upload).
2. **Offline support** — cache today's jobs in `expo-sqlite`, queue mutations
   when offline.
3. **Push notifications** for new job assignments (Expo notifications + a
   Supabase trigger that sends to `expo_push_token`).
4. **Map view** of today's jobs (`react-native-maps`).
5. **Time tracking** screen (manual time entries against a job).
6. **Quote acceptance / signature capture** at job site.
7. **EAS Build + TestFlight** for internal beta.
