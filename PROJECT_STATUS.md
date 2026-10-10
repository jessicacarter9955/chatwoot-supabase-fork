# Project status

Updated: 2026-10-10 (Europe/Rome)

Green means the named deliverable was verified; yellow means partial implementation or verification; red means missing or blocked.

| Workstream | Status | Evidence and remaining work |
| --- | --- | --- |
| Chatwoot source/UI base | 🟩 Cloned | Chatwoot source is present. This does not establish that the complete application runs. |
| Supabase inbox backend | 🟨 Partial | TypeScript Edge Functions and a fresh-database migration cover reads, status changes, queueing, and normalized ingest. Database integration has not been verified. |
| Supabase frontend bridge unit tests | 🟩 Verified | Four tests passed on October 8: JWT read headers, refusal without a session, snooze timestamp conversion, and queued-message mapping. ESLint passed for the spec. These tests mock Supabase and do not verify a deployed backend. |
| Inbox queries | 🟨 Unit verified, contract corrected | Eleven Node tests and four focused frontend API tests cover message pages, empty history, errors, stable ordering, status/inbox-scoped Chatwoot counts, and all/me/unassigned/assigned plus inbox filters. Counts map Supabase Auth UUID to numeric profile ID and preserve permission errors. Live DB verification remains pending; team/label/conversation-type filters are not represented in counts. |
| Existing RelayDesk compatibility | 🟨 Schema inspected, adapter pending | Read-only Supabase MCP inspection on October 10 confirmed UUID primary keys plus bigint Chatwoot mappings, `conversations.display_id` without a unique index in returned metadata, existing `canned_responses`, teams, labels, and `conversation_reads`. RLS is enabled on all inspected entities, with workspace-membership policies. No database changes were made. Adapter, enum/count mapping, and end-to-end tenant-isolation verification remain. |
| Gmail, Slack, WhatsApp integration | 🟥 Missing in migrated backend | Provider OAuth, inbound signature verification, and channel adapters remain. This status does not describe upstream Chatwoot capabilities. |
| Provider delivery / scheduled sending | 🟥 Missing | A reply can be queued in the prototype; no verified worker delivers it to a provider. |
| Quick replies / automation | 🟨 Partial | Quick-reply UI adapter and rule records exist; integration and automation execution remain. |
| Local Supabase database checks | 🟥 Blocked | `supabase db lint --local --schema public` could not reach localhost:54322; Docker is unavailable. No migration or RLS checks have run. |
| Rails-free deployment | 🟥 Missing | Dashboard bootstrap and ancillary APIs still depend on Rails. |
| RLS / tenant isolation | 🟨 Unverified | Policies are defined in the fresh schema; no database integration/security checks have passed yet. |
| Full frontend suite | 🟨 Incomplete | Latest broad run recorded 5,157 passing tests and two worker fetch timeouts (exit 1). Earlier billing assertion failures were fixed; their focused rerun passed 11 tests. |
| Local CSS build | 🟩 Verified | Added missing direct postcss-import dependency; all four PostCSS plugins load and CSS compilation passes. Histoire binds to IPv4 localhost. |
| Runtime / screenshots | 🟥 Unverified | No valid screenshot of a running inbox. Ruby/Postgres/Redis/Docker were unavailable locally; Histoire still shows zero stories after fixing its missing CSS dependency. Vue exports resolveComponent and defineComponent correctly in Histoire Vite SSR; a one-story Button build still fails in Histoire Vue collection with `resolveComponent is not a function`. Histoire 0.17.15 declares Vite <=5 compatibility while Vite 6.4.2 is installed; cause is not proven. Alternate probes stalled. Screenshot remains blank and is not UI verification. |
| GitHub | 🟨 Destination pending | Private personal repository push did not complete: repeated attempts on October 9 stalled without output and were stopped; `git ls-remote` does not show the target branch. Earlier attempts ended with HTTP 408. Commits through `1b7e17363` are pushed and SHA-verified on the existing public personal fork. HTTP/1.1 with a larger request buffer also failed; the GitHub REST import endpoint is deprecated (404). Private delivery remains unresolved. |

## Next tasks

1. Push each significant verified increment on `codex/supabase-inbox` to the private personal repository and verify the remote SHA; never push upstream Chatwoot.
2. Adapt the backend to the actual target schema without overwriting existing RelayDesk tables or data.
3. Complete standalone UI bootstrap and remove remaining required Rails calls.
4. Run database integration and tenant-isolation checks; launch and inspect the real UI with screenshots.
5. Implement and verify provider authentication, inbound adapters, outbound workers, and automation execution.
