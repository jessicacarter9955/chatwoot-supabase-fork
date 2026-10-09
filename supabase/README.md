# Supabase backend migration slice

This directory is the first TypeScript/Supabase backend slice for the unified inbox. The existing Chatwoot UI remains the presentation reference; Chatwoot's Rails API is not used by these new tables or the Edge Function.

## Reused product behavior

- The inbox data model follows OpenChannels' provider-neutral contact, conversation, and message timeline, with delivery status and an outbox.
- Workspace, user profile, connection, contact, conversation, and message IDs use integer identities to match Chatwoot's current UI assumptions. Supabase Auth UUIDs are mapped through `profiles.auth_user_id`; they are never substituted for numeric UI IDs.
- The migration adds the personal workspace and membership boundary needed for Supabase Auth and Row Level Security.
- Quick replies and automation rule records fit Chatwoot's existing UI concepts.
- `queue-reply` validates a Supabase user session and atomically queues an outbound reply through the database RPC. `clientRequestId` makes retrying a UI request idempotent.
- `update-conversation-status` supports Chatwoot's open, pending, resolved, and snoozed states; snoozes require a future wake time. A new inbound message reopens resolved, pending, or snoozed conversations.
- `inbox-read` exposes the first Chatwoot-shaped read contract for a paginated conversation list, conversation detail, and message history. It uses the caller's JWT and RLS rather than a service-role key.
- Chatwoot's existing canned-response settings screen now reads and writes `quick_replies` directly through the authenticated Supabase client.
- `ingest-message` ports OpenChannels' normalized ingest behavior. A trusted provider adapter can upsert contacts, conversations, and deduplicated messages through one transactional database function.

## Data/security boundary

Provider OAuth secrets do not belong in `provider_connections` or any client-readable table. The connection table stores display and status metadata only. The OAuth callback and channel adapters must store and retrieve credentials through Supabase Vault or another server-only secret store. Provider-specific OAuth callbacks, webhook signature validation, and outbound delivery workers are later migration slices; a queued reply is not yet sent to Gmail, Slack, or WhatsApp. `ingest-message` is an internal normalized endpoint, not a public provider webhook: provider-specific handlers must validate provider signatures before forwarding events to it.

RLS scopes user-visible rows to workspace membership. The outbox has no authenticated-client policy; only trusted server-side workers should claim and deliver jobs. The signup trigger creates a personal workspace for each Supabase Auth user.

## Existing Supabase projects

This migration and UI adapter currently target a fresh database created from this repository's migration. They are not yet compatible with an existing RelayDesk project: that schema uses UUID primary keys, links `profiles.id` directly to `auth.users.id`, and stores canned responses in `canned_responses`, while this adapter currently expects integer IDs, `profiles.auth_user_id`, and `quick_replies`. Do not enable `SUPABASE_AUTH_ENABLED` against that existing project or apply this migration there until the schema adapter and a non-destructive migration plan are completed.

## Local Supabase setup

1. Install the Supabase CLI and run `supabase start` from the repository root.
2. Apply migrations with `supabase db reset`.
3. Deploy with `supabase functions deploy inbox-read`, `supabase functions deploy queue-reply`, `supabase functions deploy update-conversation-status`, and `supabase functions deploy ingest-message`.
4. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in the Chatwoot web process; the Rails dashboard exposes these public client values to the page. Set `SUPABASE_AUTH_ENABLED=true` only after the migration and functions are deployed. Never expose the service-role key.
5. Add `<APP_ORIGIN>/app/login` to Supabase Auth's allowed redirect URLs, and configure signup confirmation email delivery before enabling self-registration.
6. Set `APP_ORIGIN` to the UI origin for the Edge Functions, and set a high-entropy `INGEST_WEBHOOK_SECRET` for trusted server-side callers of `ingest-message`.

With `SUPABASE_AUTH_ENABLED=false` (the default), Chatwoot keeps its existing Rails authentication and API. When enabled, the email login/signup and dashboard bootstrap use Supabase Auth, and the existing inbox stores route core list/thread/history/status/reply calls through the Supabase adapter. Canned responses use the Supabase `quick_replies` table. This first UI slice does not yet cover inbox filters, unread counts, private notes, attachments, assignment, labels, or realtime updates. Outbound messages remain queued until a provider delivery worker is added. Other Chatwoot settings and ancillary dashboard APIs can still call Rails, so this is a staged migration rather than a Rails-free deployment.
## Verification status (2026-10-08)

The frontend inbox bridge has four passing unit tests covering authenticated read headers, rejection without a session, snooze timestamp conversion, and queued-message mapping. Supabase is mocked in these tests: they are not evidence that database migrations, RLS, deployed functions, or provider delivery work end to end. The latest broad frontend run recorded 5,157 passing tests but ended with two Vitest worker fetch timeouts, so the full suite remains incomplete. No valid running-inbox screenshot has been captured. See `PROJECT_STATUS.md` for remaining work and verified progress.

### Message history pagination

Fixed initial history loading to return the latest 20 messages in display order, matching Chatwoot's `MessageFinder`. Older pages return 20, newer pages 100, and bounded history includes the lower cursor and excludes the upper cursor (up to 1000). Seven Node tests exercise the real Supabase PostgREST query builder with mocked HTTP, including empty history and database errors. Run with Node 24: `node --test supabase/tests/inbox-queries.test.mjs`. All seven passed on October 9. This does not validate live database behavior or RLS.

### Local UI preview diagnostics (2026-10-08)

Declared the PostCSS configuration's missing direct dependency, postcss-import 15.1.0, and explicitly bound Histoire to 127.0.0.1. Loading all four PostCSS plugins and compiling CSS passed with Node 24. The browser no longer shows the missing-module overlay, but Histoire still reports zero stories and screenshot capture is blank. Isolating the Button story in a one-story production build fails inside `@histoire/plugin-vue` with `TypeError: (0, __vite_ssr_import_1__.resolveComponent) is not a function`. The installed Histoire 0.17.15 peer range lists Vite through version 5 while this app uses Vite 6.4.2; that compatibility mismatch is confirmed, but has not been proven to cause the renderer exception. Attempts to test alternate SSR alias/bundling settings did not complete within the local runtime budget. Treat visual verification as blocked. No running inbox or database integration is demonstrated by this preview.

### Histoire renderer isolation (2026-10-09)

A temporary build restricted to the existing Button story confirms the failure is in Histoire's Vue story collector, before a browser can render the component. The stack reports esolveComponent is not a function from the Histoire generated story stub. Histoire 0.17.15's declared peer dependency supports Vite through 5, while the project runs Vite 6.4.2; this is an unsupported combination, but the isolated build has not established causation. Alternate alias and SSR bundling probes stalled under high memory use and were stopped. No product UI screenshot is available; the previously captured white screenshot is diagnostic only.

### Additional runtime checks (2026-10-09)

Using Histoire's resolved Vite server configuration, `ssrLoadModule('vue')` returned functions for both `resolveComponent` and `defineComponent`; the Vue package alias resolves correctly. This narrows the blank-story error to the Histoire collection/transform path, but does not yet identify the faulty transform. A one-story build that attempted to capture the transformed SFC stalled while consuming about 1 GB RAM and was stopped. `supabase db lint --local --schema public` was attempted with Supabase CLI 2.20.5; it could not connect to localhost:54322, and Docker is not installed. No local Postgres lint, migration run, or database verification has passed.
### Inbox ordering

Conversation lists now sort newest activity first, put conversations without activity at the end, and use descending numeric IDs as a stable tie-breaker for pagination. A PostgREST query-builder test verifies the generated order expression. It does not validate PostgreSQL execution or the target RelayDesk schema.

### Inbox count metadata

The list endpoint returns Chatwoot's `mine_count`, `unassigned_count`, `assigned_count`, and `all_count` metadata. Counts are independent of the selected status tab, and the authenticated Supabase UUID is first mapped through `profiles.auth_user_id` to the numeric profile ID used by `conversations.assigned_to`. Nine Node tests now pass, including mocked-HTTP PostgREST checks for the profile mapping, status-independent counts, and propagation of RLS/permission errors rather than silently returning zero. Counts currently cover the workspace visible through RLS; inbox, team, label, and conversation-type filters are not implemented, so this is not full `ConversationFinder` parity.
