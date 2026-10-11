# Architecture

TourneyLab has two applications: an Electron desktop client and an optional Cloudflare publishing service. The desktop client owns tournament data and calculations. The service stores published reports and manages access to hosted publishing.

![Architecture diagram](architecture.svg)

## Desktop boundaries

The renderer uses plain JavaScript modules and DOM rendering. Its store holds events, sections, registrations, players, rounds, and settings. Store changes notify the UI and schedule workspace persistence with a 400 ms debounce.

An event holds shared setup and registrations. Sections hold their own format, player assignments, rounds, and results. Setup inheritance allows an event default to apply across sections while retaining section overrides.

The chess engine receives a section-shaped tournament object. It computes player state, selects the pairing system, produces pairings, and calculates standings. Separating these modules from Electron lets the Node test runner exercise tournament logic directly.

The renderer cannot access Node APIs directly. Electron enables context isolation and sandboxing and disables Node integration. A preload bridge exposes named operations through `window.tl`; the main process implements them through IPC handlers.

The main process owns workspace JSON, tournament file dialogs, rotating backups, report bundle writes, and the managed-publishing client. Publishing device credentials are encrypted through Electron `safeStorage` and stored separately from tournament files.

## Pairing and result flow

1. The operator selects a section and requests the next round.
2. Readiness checks inspect missing results, player eligibility, and tournament settings.
3. The pairing dispatcher selects the configured engine. Dutch pairing uses score groups, constraints, colour preferences, and a bounded candidate search.
4. The application stores pairings and displays warnings for operator review.
5. Entered results update round state. Standings and tie-breaks are derived from the recorded rounds.
6. Store updates trigger autosave through the preload bridge.

Manual controls are part of the workflow. Operators can adjust pairings and byes; modified pairs are marked in pairing reports. Rule settings are stored with the tournament so calculations can distinguish configured rule versions.

## Reports and publishing

The renderer generates reports from tournament data. Local exports pass through the main process to a chosen file or report bundle. This path does not require the hosted service.

For managed publishing, the main-process client sends report content to the Worker API. D1 stores accounts, entitlements, report metadata, and audit records. R2 stores versioned report content. Google provides sign-in; Stripe handles checkout, subscriptions, and billing events. Public report requests are served through the Worker.

Provider secrets belong in the service environment. The desktop stores its device credential separately from the workspace. Deploying the service requires configuring providers, resources, and migrations as described in the publisher documentation.

## Design decisions and tradeoffs

| Decision | Benefit | Tradeoff |
| --- | --- | --- |
| Local tournament state | Events can run without a publishing account or network connection. | Workspace files and backups must be managed on the operator's computer. |
| Plain JavaScript renderer | Shared data and engine modules run in the browser and in Node tests. | DOM updates and UI state are maintained directly. |
| Separate engine modules | Pairing and ranking logic can be tested without a desktop window. | UI flows still need separate verification. |
| Explicit IPC bridge | Filesystem and credential access stay in the main process. | Desktop operations need bridge methods and IPC handlers. |
| Separate publishing service | Hosting and billing do not block local tournament operations. | Hosted publishing adds deployment and provider configuration. |
| Bounded pairing search | Limits work spent exploring candidate pairings. | Difficult fields may require fallback handling and arbiter intervention. |

## Verification boundaries

Node tests cover the engine, workspace operations, file adapters, and reports. Worker tests run with local D1 and R2 bindings, and TypeScript checks the publishing service. Neither suite establishes certification, live provider configuration, or complete interoperability with proprietary file formats.
