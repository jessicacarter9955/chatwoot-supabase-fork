# Project status

Updated: 2026-10-08 (Europe/Rome)

Green means the named deliverable was verified; yellow means partial implementation or verification; red means missing or blocked.

| Workstream | Status | Evidence and remaining work |
| --- | --- | --- |
| Chatwoot source/UI base | 🟩 Cloned | Chatwoot source is present. This does not establish that the complete application runs. |
| Supabase inbox backend | 🟨 Partial | TypeScript Edge Functions and a fresh-database migration cover reads, status changes, queueing, and normalized ingest. Database integration has not been verified. |
| Supabase frontend bridge unit tests | 🟩 Verified | Four tests passed on October 8: JWT read headers, refusal without a session, snooze timestamp conversion, and queued-message mapping. ESLint passed for the spec. These tests mock Supabase and do not verify a deployed backend. |
| Existing RelayDesk compatibility | 🟥 Blocked | UUID IDs and existing profiles/canned_responses differ from the prototype schema. Adapt and verify before any migration or enabling the bridge. |
| Gmail, Slack, WhatsApp integration | 🟥 Missing in migrated backend | Provider OAuth, inbound signature verification, and channel adapters remain. This status does not describe upstream Chatwoot capabilities. |
| Provider delivery / scheduled sending | 🟥 Missing | A reply can be queued in the prototype; no verified worker delivers it to a provider. |
| Quick replies / automation | 🟨 Partial | Quick-reply UI adapter and rule records exist; integration and automation execution remain. |
| Rails-free deployment | 🟥 Missing | Dashboard bootstrap and ancillary APIs still depend on Rails. |
| RLS / tenant isolation | 🟨 Unverified | Policies are defined in the fresh schema; no database integration/security checks have passed yet. |
| Full frontend suite | 🟨 Incomplete | Latest broad run recorded 5,157 passing tests and two worker fetch timeouts (exit 1). Earlier billing assertion failures were fixed; their focused rerun passed 11 tests. |
| Runtime / screenshots | 🟥 Unverified | No valid screenshot of a running inbox. Ruby/Postgres/Redis/Docker were unavailable locally; the Histoire attempt showed no stories. |
| GitHub | 🟨 Destination pending | Private personal repository push failed again with HTTP 408 on October 8. Incremental work is being pushed to the existing public personal fork; private delivery remains unresolved. |

## Next tasks

1. Push each significant verified increment on `codex/supabase-inbox` to the private personal repository and verify the remote SHA; never push upstream Chatwoot.
2. Adapt the backend to the actual target schema without overwriting existing RelayDesk tables or data.
3. Complete standalone UI bootstrap and remove remaining required Rails calls.
4. Run database integration and tenant-isolation checks; launch and inspect the real UI with screenshots.
5. Implement and verify provider authentication, inbound adapters, outbound workers, and automation execution.
