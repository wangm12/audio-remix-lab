# Batch 3 implementation report — UI liveness and feedback

## Result

Implemented Batch 3 F1, F3, F5 UI feedback, F7 layout placement/layering, and F8 API/form error handling. No backend source, schema, dependencies, models, or services were changed. UI gates used Node v24.22.2; the global nvm default was not changed.

## Changes

- `song-remix-ui/src/pages/SongStudioPage.tsx`: send the controlled lyrics exactly, including an intentional empty string and whitespace/newlines. Seed active history tasks into the monitor.
- `song-remix-ui/src/components/layout/TaskMonitorProvider.tsx` and `TaskMonitorContext.ts`: add one AppShell-lifetime owner with all-page `/tasks` discovery, merge-safe cache seeding, per-ID watchers, terminal dedupe, deletion tombstones, and logout cleanup. Keep Song detail task ordering and update cached detail/history/list data without manufacturing absent Song objects or assigning an old task's state to `latest_status`.
- `song-remix-ui/src/hooks/useTaskStream.ts`: whitelist named SSE partial fields, recover from malformed/error events with continuing REST polling/backoff, abort pending requests and ignore stale replies; 404 and 401 stop monitoring.
- `GeneratePanel.tsx`: remove component-owned SSE and imperative cache display; subscribe to the full task query so status/result changes render reactively. Restore the newest active history task, even when a newer terminal task exists, and keep later mutation failures visible.
- `TaskTimeline.tsx` and `LibraryPage.tsx`: retain rows and display scalar conflict errors on 409; successful deletes prune related monitor/query caches.
- `lib/api.ts` and `RegisterForm.tsx`: add bounded safe `ApiError` normalization for scalar and FastAPI validation errors, preserve auth-form versus non-auth 401 behavior, multipart and 204 handling, and associate sanitized registration field errors accessibly while retaining entered values and the password hint.
- `NowPlaying.tsx`, `Nav.tsx`: confine desktop player to the main-pane x-offset (`md:left-56`); put the mobile drawer above the player and keep its header above the drawer.
- Added focused API, registration, monitor lifecycle/pagination/race, Studio route/navigation, and delete-conflict regressions.

## Verification

- UI tests: **41 passed across 10 files**. Full output: `.superpowers/sdd/patches/batch3-ui-test-final.log`.
- ESLint: passed. `.superpowers/sdd/patches/batch3-ui-lint-final.log`.
- `tsc -b` and Vite production build: passed. `.superpowers/sdd/patches/batch3-ui-build-final.log`.
- `git diff --check`: passed.
- Tests cover >50 paginated discovery and an older active task beneath a newer terminal one; one stream across Studio/Library navigation; immediate accepted-task seeding against an in-flight discovery; repeated REST failures then recovery; malformed SSE; terminal SSE/REST race, duplicate terminal notification and no initial-completed notification; 404 cleanup; StrictMode/unmount abort; exact empty and whitespace lyrics before autosave; stale Task/Song 409 row retention; safe validation errors/secrets; auth 401 distinction; and registration field semantics.
- First full UI regression output remains preserved at `.superpowers/sdd/patches/batch3-first-targeted.log` (27 passed / 3 failed). The issues were test expectation/timer setup errors, corrected in later runs. Initial lint/build failures are preserved in `batch3-ui-lint.log` and `batch3-ui-build.log`; final gates passed without changing dependencies.

## Residual verification

No browser/runtime/service operation was performed by this implementation turn. Controller must still perform the approved post-restart browser checks: player-open and paused logout hit testing at 1440×1050 and 1024×900, pointer logout without toggling playback, player play/pause/seek/close, and narrow mobile drawer/content smoke. Backend/full-app final review and service restart are controller-owned.

## Commit

Committed as `2427fe7` (`fix: monitor remix tasks across UI routes`).

## Fix round 1 — independent Batch 3 findings

Fresh Luna implementation on `2427fe7`; no backend, dependency, service, database, browser, or model changes. The original independent RED harness was run unchanged and its complete first output was saved before edits to `batch3-review/fix1-red-first.log` (**7 failed / 7**). The final unchanged harness passes **7 / 7** in `batch3-review/fix1-probes-final.log`.

### Changes

- Fresh `/tasks` discovery records now reconcile into known task state. Processing-to-terminal discovery calls the same `update` path as SSE/REST, including one-time notification, exact invalidation, and synchronous watcher teardown. Terminal state wins over stale active scans, and canonical newly accepted IDs remain included when an older scan omits them.
- Task IDs and deleted Song IDs remain tombstoned for the monitor lifetime. `track`, `update`, discovery, Song detail/list query publication, history merges, and exact task cache writes filter or reject deleted records. A Song GET that completes after task deletion is filtered through the same visible-song boundary; successful Song deletion prunes the Song list before invalidating it.
- Each watcher registers a synchronous stop callback. Deletion, terminal status, logout, and provider stop close its EventSource, clear its timer, abort its poll and block queued valid, malformed, and error callbacks before parsing or recovery updates. Owner recovery writes reject absent, terminal, tombstoned, or invalidated sessions.
- Any non-auth-form 401 notifies the monitor session before redirect, stopping every watcher and cancelling task, Song, and discovery queries. The existing clear-token, redirect, and rejection behavior remains; `/auth/login` and `/auth/register` 401 responses remain form errors and keep the token.
- Validation locations now require string members and recognized own allowlist values. Prototype names and malformed locations produce the bounded generic fallback and do not enter public issues.
- Added real QueryClient/provider regressions for later discovery, tombstones, delayed stale Song response, terminal/deletion callbacks, and global 401 cleanup. Task and Song deletion tests now exercise 409, a terminal transition, 204, cache/row removal, and stale-response/track no-resurrection.

### Fix round 1 verification

All final UI gates used Node **v24.22.2**. No tests were run against the live database or service.

| Check | Result | Evidence |
| --- | --- | --- |
| Unchanged independent provider/MSW/FakeEventSource harness | **7 passed / 7** | `batch3-review/fix1-probes-final.log` |
| Full UI test suite | **50 passed / 10 files** (the existing 41 plus 9 added cases) | `batch3-review/fix1-ui-test-final.log` |
| ESLint | passed | `batch3-review/fix1-ui-lint-final.log` |
| `tsc -b` and Vite production build | passed | `batch3-review/fix1-ui-build-final.log` |
| `git diff --check` | passed | controller output before commit |

First-failure evidence was retained: baseline RED at `batch3-review/fix1-red-first.log`; initial build type diagnostic at `batch3-review/fix1-ui-build-first-failure.log`; first lint run at `batch3-review/fix1-ui-lint.log` caught the harness's temporary test file because lint overlapped the harness run. The harness removes that file; serial reruns passed at the final lint log. No test expectations in the independent harness were changed.

### Commit

Committed as `38c4bc7` (`fix: reconcile task monitor session lifecycle`). No push. Controller owns independent Sol review and the later real-browser/app restart gates.

## Fix round 2 — independent Batch 3 findings

Implemented the remaining four review contracts on top of `38c4bc7`. No backend, dependency, service, database, browser, or model changes. Reused the recorded UI design lookup. All UI commands used Node **v24.22.2**.

### Changes

- One monitor generation now gates all owned async task publication. Discovery captures the generation before the first page request and validates it after each awaited page and before reconciliation. Task watchers capture before opening asynchronous polling and validate the generation before parsing callbacks, publishing responses, changing recovery state, or scheduling another poll. Studio and Library Song queries capture before GET, pass React Query's AbortSignal into the API request, and validate after the await before returning cache data.
- Unmount, logout/401, and token identity changes synchronously invalidate the generation, close watchers, clear timers, abort watcher reads, and close discovery admission. Discovery is reactively disabled and has a synchronous prefetch guard; query cancellation remains in place for explicit session stops. StrictMode setup opens a new generation while old leases remain invalid; deletion tombstones are never cleared by owner reset.
- Song detail publication now reconciles each visible task with canonical state, and a terminal canonical task cannot be replaced by a stale active or conflicting terminal snapshot. Existing task/song tombstone filtering remains in place.
- FastAPI validation locations now accept only one allowlisted scalar field, with at most one optional `body`, `query`, or `path` prefix. Longer paths, unknown members, prototype names, and nonstring members fall back to the generic message.
- Added committed provider regressions for delayed Song results after terminal, unmount, logout, and auth identity replacement, plus invalidation/focus after stop. Existing StrictMode, terminal, deletion, and discovery tests remain unchanged.

### Verification

First-run RED evidence was retained before code changes: the unchanged original harness passed **7/7** (`batch3-fix2-probes-first.log`); the unchanged expanded harness showed **8 passed / 5 failed / 13** (`batch3-fix2-expanded-first.log`), corresponding to the four findings and two nested-path table cases. The first lint diagnostic is saved at `batch3-fix2-ui-lint-first.log` (unused import and query-result binding), fixed before final verification.

| Check | Result | Evidence |
| --- | --- | --- |
| Unchanged independent provider/MSW/FakeEventSource harness | **7 passed / 7** | `batch3-fix2-probes-final.log` |
| Unchanged expanded independent harness | **13 passed / 13** | `batch3-fix2-expanded-final.log` |
| Full UI tests | **55 passed / 10 files** | `batch3-fix2-ui-test-final.log` |
| ESLint | passed | `batch3-fix2-ui-lint-final.log` |
| TypeScript `tsc -b` + Vite production build | passed | `batch3-fix2-ui-build-final.log` |
| `git diff --check` | passed | final terminal check |

No backend `make test`, browser/runtime, service restart, or live inference gate was run in this implementation round; those remain controller-owned as specified in preflight. No dependencies or global Node defaults changed.

### Commit

Round 2 changes are committed separately; no push.

## Fix round 3 — authoritative Song terminal observations

Implemented the remaining confirmed F3 defect on top of `e019ce9`. No backend, dependency, service, database, browser, or inference changes. Reused the feature's existing design research.

### Changes

- `TaskMonitorProvider` now routes task records returned by both Song detail and Song list GETs through the shared canonical `track` publisher before exposing them. A full terminal observation for a known active task updates the exact Task cache and visible history, removes it from active monitor state, closes its watcher, invalidates related data, and emits the existing one-time terminal notification. Existing reconciliation preserves terminal monotonicity and merge-safe full task fields; a new terminal history record remains silent and does not start a watcher.
- Added real Studio route/provider/QueryClient regressions for Song GET completion and failure, including exact Task/history/panel result, valid-config generation button release, watcher cleanup, one terminal toast after duplicate observations, and initial terminal history silence.

### Verification

All UI commands used Node **v24.22.2**. The unchanged saved terminal route probe was run before editing and failed all five behavioral assertions; full output: `.superpowers/sdd/patches/batch3-fix2-review/song-terminal-implementation-first.log`. After the change it passes (**1/1**), saved at `song-terminal-implementation-final.log`.

| Check | Result | Evidence |
| --- | --- | --- |
| Original independent monitor harness, unchanged | **7 passed / 7** | `batch3-fix2-review/song-terminal-original7-final.log` |
| Expanded monitor harness, unchanged | **13 passed / 13** | `batch3-fix2-review/song-terminal-expanded13-final.log` |
| Lifecycle/admission boundary harness, unchanged | **6 passed / 6** | `batch3-fix2-review/song-terminal-boundary6-final.log` |
| Studio route tests | **6 passed / 6** | `batch3-fix2-review/song-terminal-route-tests-final.log` |
| Full UI tests | **58 passed / 10 files** | `batch3-fix2-review/song-terminal-ui-test-final.log` |
| ESLint | passed | `batch3-fix2-review/song-terminal-ui-lint-final.log` |
| `tsc -b` and Vite production build | passed | `batch3-fix2-review/song-terminal-ui-build-final.log` |
| `git diff --check` | passed | command output |

No backend Make/DB gate, browser/runtime, service restart, or live inference gate was run in this implementation turn; controller owns those gates and the independent review. No push.
