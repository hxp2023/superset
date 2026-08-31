# Usercontent origin — decision record (2026-08-30)

Companion to `plans/20260828-pages-usercontent-origin.html` (Superset page
`pages-on-their-own-origin-vjz0yb`) and `plans/20260830-device-content-cache.html`
(`device-content-cache-tc6594`). PR #6954 is the spike; main now carries #6932, #6952, #6930.

## Found while preparing

- `packages/trpc/src/router/page/page.ts` `list` mints a fresh ticket per row on every call
  (`mintPageTicket(row)`), so every thumbnail and view URL changes on each refetch — the
  browser cache never hits. `PAGE_TICKET_TTL_SECONDS = 3600` in `storage.ts` is the only knob.
- `apps/desktop/src/lib/trpc/routers/auth/index.ts` `signOut` stops host services and clears
  the token; nothing calls `session.clearCache()` / `clearStorageData()` on the
  `persist:superset` partition. Cached private media survives sign-out today.
- `.github/workflows/deploy-preview.yml` passes `R2_PRIVATE_BUCKET` from repo vars with no
  preview-specific value; a preview API would write manifests into whichever bucket that is.
- `apps/mobile`: no page viewer exists; the only WebView is the terminal (HTML string). No
  `expo-image` usage sets `cacheKey`/`cachePolicy` (`components/ai-elements/attachments.tsx`,
  avatars). `expo-video` is not a dependency.
- `apps/desktop/src/main/windows/main.ts`: renderer, page iframe and browser-pane `<webview>`
  share `partition: "persist:superset"`; protocol handlers in `main/index.ts` register on that
  session. An `https` handler there sits in front of the browser pane too.
- `packages/ui/.../PageFrame.tsx` `sandbox="allow-scripts allow-same-origin …"` and the
  Worker's `frame-ancestors https://app.superset.sh file:` are unverified in a packaged build.
- `packages/shared/src/usercontent/manifest.ts`: the `versions` map is now derivable from the
  key layout (`pageVersionKey`), so the manifest could shrink to visibility/shared/latest/slug
  once assets get a per-version file. Follow-up, not a decision.
- `writePageManifest` has no retry; a crash after `setVisibility` commits leaves a stale
  manifest until the next write. Follow-up: retry, not a redesign.

## Decision points (dependency order)

1. Asset door for page assets: ticket in the path vs partitioned cookie. Shapes step 2,
   URL stability for every cache, and the iOS viewer.
2. Ticket windows: how long a ticketed URL holds still (`storage.ts`, `mintPageTicket`).
3. Public Suffix List for `pages.supersetusercontent.com` + `Origin-Agent-Cluster` header
   (`packages/shared/src/usercontent/csp.ts`, `apps/content/src/index.ts`).
4. Preview environment: which bucket/Worker preview deploys use (`deploy-preview.yml`).
5. Desktop store mechanism: `https` intercept on the app session vs a dedicated page session.
6. Mobile scope for the pages release: WebView viewer + expo-image keys, WebKit ceiling accepted.
7. Upload completion: verify (HEAD + sniff) before `ready`, since presigned PUT enforces nothing.
8. Asset reuse across republishes: CLI hash-compare vs always upload.
9. Worker bucket bindings: `PRIVATE` only vs also `PUBLIC` (`apps/content/wrangler.jsonc`).
10. Host label zone: `.pages.` (built) vs `.page.`.

## Scope statement (2026-08-30, Satya)

v1 ships **video inside pages** (directory publish + media route with `Range`). The
**files/attachments layer ships as architecture in v1** — `files` + `attachments` tables,
presigned direct-to-R2 upload with verification, `/files/<fileId>` media route, serve-time
content policy — with the issue and chat attachment UI to follow. Consequences: decision 7
(upload verification) is a must; new decision points:

11. Codec policy: accept anything, play H.264 MP4 / WebM reliably; iPhone HEVC `.mov` —
    transcode in the mobile composer's native module, or document.
12. Desktop upload path: bucket CORS allowing the `file://` renderer's `Origin: null`, or
    upload through the main process.
13. Per-file size cap and single PUT vs multipart (R2 single PUT ≤ 5 GiB; no resume).
14. Desktop renderer CSP: `media-src` gains `https://media.supersetusercontent.com`
    (`apps/desktop/src/renderer/index.html`) — needed, not really a choice.
15. Built-in cache sizing as v1 scope: `--disk-cache-size`, `ContentImage`, `expo-video`
    `useCaching` (companion doc, layer 2).

## Log

| # | Decision | Choice |
|---|----------|--------|
| 1 | Asset door | Ticket in the document's path (`/versions/3/~<ticket>/`); relative references inherit it. |
| 2 | Ticket windows | Rounded expiry: one hour for `/`, one day for `/versions/<n>/` and file tickets. |
| 3 | Site isolation | File the PSL request for `pages.supersetusercontent.com` now; add `Origin-Agent-Cluster: ?1` in #6954. |
| 4 | Preview environment | Previews use `superset-private-dev` + dev secret; cleanup by a 30-day lifecycle rule on the bucket; no per-PR buckets. |
| 5 | Desktop content store | Deferred — SUPER-2076. Server contract + sized built-in caches only. When picked up: page viewer on its own `persist:superset-pages` session, not a session-wide intercept. |
| 6 | Codec policy | Accept originals; H.264 MP4 / WebM documented as what plays; `pages publish` warns on non-web-playable video; mobile transcode (`AVAssetExportSession`) lands with the composer's move to the files layer. |
| 7 | Desktop upload path | Main process streams the file to the presigned PUT over `net.fetch`; bucket CORS lists only real origins; no `null`. |
| 8 | Size cap / shape | 1 GiB per file, one presigned PUT; multipart when the cap is hit in practice. |
| 9 | Upload verification | At `files.complete`: HEAD for size, ranged sniff (8 KB) for type, stored on the row; `ready` or deleted. |
| 10 | Mobile v1 scope | WebView viewer as specified + `ContentImage` (`cacheKey = storageKey`) + `configureCache` at boot + sign-out clearing; page video plays natively in the WebView; `expo-video` waits for the attachments UI. |
| 11 | Asset reuse | Directory publish hashes each asset, reuses the previous version's file id on a match. |
| 12 | Worker buckets | `PRIVATE` only — the final architecture, not a deferral: the public bucket is CDN-served with no Worker, ever. |
| 13 | Host zone | `.pages.` (plural) confirmed; the earlier `.page.` comment was against a stale artifact. |
| — | Logged as needed | Desktop renderer CSP `media-src` gains `https://media.supersetusercontent.com`; desktop `--disk-cache-size` 1 GiB. |

Feedback recorded (Satya): push for the ideal end-state solution; explicitly yellow-flag any
non-standard mechanism with its standard alternative (here: ticket-in-path vs signed cookies);
correct a mistaken premise plainly instead of deferring to it. Walkthrough completed 2026-08-30.

Walkthrough paused 2026-08-30 after Satya judged the store premature ("punt the cache for now").

| 14 | Worker app name | Swapped back to `apps/usercontent` (Satya, 08-30 late): clearer, matches the domain and env names. Applied to #6954 only; stacked PRs pick it up on rebase. |
