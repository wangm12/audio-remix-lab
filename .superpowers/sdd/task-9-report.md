# Task 9 — Scoped tokens and the media cookie

## Implemented

- Added `access` and `media` JWT scopes. Scope-less legacy JWTs continue to decode as access tokens only.
- Kept ordinary API authentication Bearer-only and access-scoped; cookie credentials do not authorize `/api/auth/me`, song reads, or song mutations.
- Added the `/api`-scoped HttpOnly, SameSite=Lax media cookie on registration, login, and `/me` refresh. `COOKIE_SECURE` controls its Secure flag and is documented in `.env.example`.
- Added logout cookie deletion with matching path and security attributes.
- Added the UI API logout call and made `useLogout()` await it while always clearing local auth state. The navigation invokes the async logout without leaving a floating promise.

## TDD evidence

### Backend

- **RED:** `cd song-remix-backend && .venv/bin/pytest tests/test_media_cookie.py -q`
- **Expected failure:** test collection failed with `ImportError: cannot import name 'ACCESS_SCOPE' from 'app.core.security'`.
- **GREEN:** same command after implementation — `12 passed in 3.28s`.
- The Task 9 brief defines 7 backend tests. The global offset is +14, so the expected minimum is 78 for the full suite. This implementation adds 5 extra cookie-only/invalid-cookie cases (four normal API token variations plus `/auth/me`), bringing the actual full backend count to 83.

### UI

- **RED:** `source ~/.nvm/nvm.sh && nvm use 24 && node -v && npx vitest run src/lib/api.test.ts`
- **Expected failure:** `TypeError: api.auth.logout is not a function`.
- **GREEN:** full UI gate below — 10 tests passed, including the logout API call.
- Node version recorded for npm evidence: `v24.22.2` (npm `11.19.1`).

## Gates

- Backend: `.venv/bin/ruff check .` — `All checks passed!`
- Backend: `.venv/bin/pytest -q` — `83 passed in 16.56s`.
- UI: `npm test` under Node `v24.22.2` — `10 passed` across 4 files.
- UI: `npm run lint` — passed.
- UI: `npm run build` — passed (`tsc -b` and Vite production build).
- `git diff --check` — passed.

## Files changed

- `.env.example`
- `song-remix-backend/app/api/auth.py`
- `song-remix-backend/app/config.py`
- `song-remix-backend/app/core/deps.py`
- `song-remix-backend/app/core/security.py`
- `song-remix-backend/tests/test_media_cookie.py`
- `song-remix-ui/src/components/layout/Nav.tsx`
- `song-remix-ui/src/hooks/useAuth.ts`
- `song-remix-ui/src/lib/api.test.ts`
- `song-remix-ui/src/lib/api.ts`

## Self-review and adaptations

- Compared the three whole-file replacement targets (`security.py`, `deps.py`, `auth.py`) against the specified clean base. They matched the pre-Task-9 implementation; no Task 1–8 behavior needed adaptation.
- Covered cookie flags for Secure false and true across issuance, refresh, and deletion; verified scope separation, legacy-token compatibility, media-token Bearer rejection, cookie-only read/mutation rejection, and invalid/expired/wrong-scope cookie rejection.
- The UI change is functional only and preserves the existing navigation styling and components. Consulted accessibility and typography taste guidance and searched the catalog for auth/navigation resources (`limit: 10`); the resource search returned no candidates, so no design resource affected implementation.
- No Task 10 media GET or credential-conflict behavior was added.
- No known concerns.
