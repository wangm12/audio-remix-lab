# Unit 1 implementation report — R2/R5 session ownership and media release

Commit: `4cf8b08` (`fix auth session media lifetime`), based on `13f09bf`.

## Scope and implementation

Changed only the Unit 1 session/API/player/monitor/root-route paths and tests. `auth.ts` now creates monotonically changing session epochs and exposes request leases. API calls send the captured token, invalidate only the matching current session on 401, and reject successful stale responses before React Query or mutation callers can publish them. A request that began without a token cannot clear or redirect a later identity; repeated current-session 401s trigger one invalidation/redirect.

Logout now stops the monitor and registered media synchronously, sends the logout request with the captured identity, clears local token/query state immediately, and navigates to login without waiting for that request. Completion of the old request has no local token/cache/route side effect. The actual HTML audio elements used by both the mini-player and result player register with the global player owner; teardown pauses, removes `src`, resets time and calls `load()` before clearing track state. Mini-player elapsed metrics are keyed to the source URL so queued events from a prior track cannot display its progress after a switch.

`TaskMonitorProvider` now stays structurally owned by the real root route around both public and protected outlets. It is inactive without an authenticated protected route, and identity changes cancel reads, clear old owner queries/tombstones/watchers and re-admit only the new owner. This removes the observed outlet/provider lifetime gap without weakening `useTaskMonitor` or supplying an inert context. Test-only mounted monitor fixtures now set an explicit synthetic owner token.

## RED, GREEN and validation

- Initial meaningful RED: `logs/01-api-red-first.log` reproduced delayed A401 clearing B and late A success resolving after B; both final-state assertions failed (2 failed, 18 passed).
- Actual-router RED: `logs/01-session-red-first.log` also reproduced logout leaving the active player store under A (3 expected failures total, 18 passed). The final router regression was expanded to mount the generated route tree on `/studio/owner-song`, keep a real task watcher active, hold logout, and assert actual audio-element `pause`, source removal, `load`, `currentTime=0`, local logout before response, B login and watcher continuity, then release A's completion and verify B route/token survive.
- Final focused API, monitor and actual-router group: 42/42 passed (`logs/01-targeted-final.log`). Existing task monitor coverage remained green.
- Full UI: Node24.22.2, 64 tests across 11 files passed (`logs/01-final-tests.log`); ESLint passed (`logs/01-final-lint.log`); `tsc -b` passed (`logs/01-final-tsc.log`).
- Production Vite build passed to ignored private staging directory `.superpowers/sdd/fix-full-e2e/build-01-final`; served `song-remix-ui/dist` was not touched. Main JS SHA-256: `65ae13a2dc36a7dc355971471c9e827c9432a06356b2b0ef4a1733e9c153ff28`; CSS SHA-256: `241ee9194955f95587858a92757b28040695749cf8b1522482e1d100d7bb52af`. Full build output: `logs/01-final-build.log`.
- First whole-suite/lint/typecheck attempt is preserved in `logs/01-full-tests.log`, `logs/01-full-lint.log`, and `logs/01-full-tsc.log`: it exposed two existing direct-provider test fixtures that lacked a token after the provider became correctly inactive without an identity, a media registration gap when the mini-player initially rendered without an audio node, a linted synchronous-effect reset, and a TypeScript parameter-property incompatibility. These were corrected; the final full gates above passed.

No Python process, database, live API, app, engine, browser tab, model, service or runtime `dist` was touched. No dependency or backend change was made. Scratch preparation from before dispatch remains unused; no DDL or test database was created. `git diff --check` passed before commit.

## Provider-boundary result and limits

The actual generated-router logout transition from an active Song Studio page was exercised across pending render/query frames, with the monitor watcher active and `console.error`/`window` errors captured. No “Task monitor is unavailable outside the app shell” exception was observed in this deterministic router run. This is a scoped reproduction result, not a claim that every browser logout/provider timing path has been certified.

Local session token/cache/watcher/player protection is tested. An HTTP-only same-origin media-cookie response has a separate race: a delayed logout response may carry `Set-Cookie` deleting the shared cookie after account B's login response sets B's cookie. Frontend token epochs cannot fence browser cookie processing. This unit preserves normal server logout cookie clearing and does **not** claim cookie epoch safety. Resolving that boundary needs a separately reviewed protocol/backend design (for example a per-session cookie identity that lets A's delayed deletion target only A); no backend logout file is in this lease. The jsdom media test proves actual element calls/source removal but does not certify browser decoder-buffer release or physical playback progression.

## Unit1 Fix1 — fresh Luna implementation after independent review

Commit: `744a9f1` (`fix auth cookie writer and media ownership races`), based on `4cf8b08`. Scope remains frontend session/API/media lifecycle; no server cookie-protocol change was needed after the independent Sol browser reproduction validated ordered fetch admission.

### Implementation

- Added `song-remix-ui/src/lib/auth-cookie-writers.ts`: one FIFO admission queue for login, register, logout and `/auth/me`, with a separate latest-auth-intent counter, real per-writer `AbortController`, caller-signal forwarding, 5-second abort timeout, and queue release only in `finally` after the operation settles. New auth intent aborts the current writer; stale queued `/me` and form work is skipped. Logout is enqueued as `alwaysRun` before local token clearing, retains A's captured Authorization lease, and its stale response has no local effects.
- `api.ts` now holds the writer through fetch plus response-body consumption, and checks both session and intent after body decoding and before every successful publication including 204. Stale ordinary 401s continue rejecting as 401 without invalidating the replacement session; current 401 dedupe and auth-form 401 behavior remain. Login/register return their intent marker; hook callbacks check it before setting token, invalidating user data or navigating.
- Audio player global state now owns progress/duration and identity epoch. The real mini and inline audio callbacks are owner-fenced; source release clears time and store metrics. AppShell cleanup stops media/player state only while its captured owner remains current, preserving the stable root provider and throwing monitor context.
- Added committed tests for delayed JSON and DELETE204 publication, ordered logout abort before B login, latest intent skipping stale queued `/me` and login, timeout abort while admission waits for fetch settlement, actual SongSetup callback fencing after unmount/session replacement, and generated-router AppShell unmount/remount with actual audio source release and global metric reset.

### Reproduction and validation

- Fresh baseline against unchanged reviewed source: **4 failed / 5 passed** in `logs/review-unit1-sol/probes-fix1-first.log`, matching the four documented assertions (post-JSON publication, actual SongSetup callback, DELETE204 success publication, retained player state).
- Same external adversarial probe after the fix: **9/9 passed** in `logs/review-unit1-sol/probes-fix1-final.log`.
- Isolated real Chrome cookie protocol probe used the actual bundled `auth-cookie-writers.ts`, host-only HttpOnly `remix_media` cookies with fake values A/B, and a private `*.localhost:41989` origin. Browser output in `logs/review-unit1-sol/fix1-cookie2/browser-result.json`; ordered network evidence in `fix1-cookie2/network.log`. Both delayed A logout deletion and delayed A `/auth/me` renewal settled with AbortError after abort; before and after late response release, `/api/media` remained authenticated as B. No real service, user token, credential, live API, database, or ambient browser application origin was used. Exact owned harness process was stopped and port closed.
- Full Node24 UI staged gate: **71 tests across 11 files passed**, ESLint passed, `tsc -b` passed, and Vite production build passed. Evidence: `builds/fix1-reviewed/{test,lint,tsc,build}.log` and `result.json`; 65.60 GiB free after build. Complete `song-remix-ui/dist` SHA256 inventory matched before/after; staged files are only under ignored `builds/fix1-reviewed/dist`.
- No Python application import, DB operation, test fixture, product API request, service restart, engine/model activity, dependency install, or live `dist` write occurred. The root provider structure was left intact; prior actual-router provider investigation remains unchanged. Browser verification here concerns auth-cookie response ordering, not physical audio decoder-buffer disposal or playback progression.

## Unit 1 Fix 2 — fresh Luna implementation after independent review

Implementation commit: pending. Based on `744a9f1`; this fix responds only to the four Fix1 review findings and the downstream publication gaps explicitly permitted in that review.

### Changes and scope

- Login/register now install their returned token inside the active FIFO cookie-writer operation, before the writer releases queue admission. A queued `/auth/me` carries an admission predicate for its captured session and is rejected before fetch if that lease has been replaced. The shared writer retains intent checks, finite abort timeout, caller cancellation, queue settlement semantics, and reserved captured-session logout behavior.
- `SongSetup` captures session and mounted lifetime at submit. It checks ownership after Song creation, before and after source upload, and immediately before the navigation callback; stale errors and finalizers cannot publish into a replacement view.
- The surviving `AppShell` updates its teardown owner on synchronous identity notification. Its unmount releases the current owner’s media/store, including B after an in-place A→B change; an old cleanup still checks its current lease.
- `ResultPlayer` registers the actual media node until unmount, independent from task-specific listener effects. Task source changes therefore cannot run the old passive-effect cleanup against the new `src`. Playback metrics reset with source identity; events and rejected play promises require both the current source and current session.
- The same final-callback session fence was applied to GeneratePanel task publication/monitor tracking, Library and TaskTimeline delete callbacks, and LyricsEditor save/structure success/error callbacks. These are the narrow mutation-publishing paths checked for the same post-helper microtask gap; no unrelated business behavior changed.
- Added `song-remix-ui/src/test/session-lifetime-regressions.test.tsx` with nine actual-product regressions: SongSetup’s post-helper microtask gap; B teardown after same-shell A→B; direct ResultPlayer and actual GeneratePanel task reuse; actual `useLogin` plus queued `/me` publication/admission race; login/register stale success callbacks; reserved logout lease; and caller cancellation / settlement ordering.

### RED, GREEN and browser evidence

- Fresh unchanged focused harness first run: **5 failed / 4 passed**, with intended failures at final SongSetup callback, same-shell B cleanup, direct ResultPlayer task reuse, actual GeneratePanel task reuse, and A `/me` cookie-writer admission. Complete first output: `logs/fix2-luna/focused-first-red.log`.
- Same focused external probes after fix: **9/9 passed** (`logs/fix2-luna/focused-after-first-implementation.log`). Existing API, SongSetup and actual-router session lifecycle tests plus the new committed regressions passed **42/42** (the final whole-suite log is `builds/fix2-luna-gate/test.log`; the first targeted terminal run covered four files and 42 tests).
- Independently exercised the changed actual `api.ts`, `auth.ts` and `auth-cookie-writers.ts` bundled for a real browser. An isolated unique `*.localhost` server used only fake A/B values and the product’s host-only `remix_media`, `Path=/api`, `HttpOnly`, `SameSite=lax` cookie attributes. B login was held after fetch admission; while it was pending, the browser queued `/auth/me` with its captured A lease; then B’s response/cookie was released. Browser result: `localToken=B`, queued `/me` returned `AbortError`, and `/api/media` observed cookie owner B. Result, ordered network trace and harness sources are in `logs/fix2-luna/cookie-browser/`. The exact owned server process/listener was verified and stopped and its browser tab closed. No application endpoint, real credential, ambient tab, user cookie, database or service was used.

### Validation and limits

- Fresh Node **24.22.2** staged UI gate passed: **80 tests / 12 files**, ESLint, installed local `tsc -b`, and Vite build to `builds/fix2-luna-gate/dist`. `result.json` confirms **61.668 GiB free** after the gate and `live_dist_unchanged: true`; the complete served `song-remix-ui/dist` SHA inventory matched before and after.
- Catalog design lookup used accessibility and micro-interaction dimensions; both returned scenario-unmatched general principles. Resource search for React audio lifecycle references returned no candidates. Existing app framework, design system and components remain unchanged.
- No backend, database, app/engine service, real API, dependency, model, live `dist` or global Node changes. `git diff --check` passed. Browser proof is specifically cookie-writer ordering; jsdom regressions prove calls, DOM source ownership and callback fencing, not buffered decoder disposal or physical playback progression.
