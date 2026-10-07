# Project status

Updated: 2026-10-07

| Workstream | Status | Evidence and remaining work |
| --- | --- | --- |
| Chatwoot UI base | 🟩 In place | Chatwoot is the cloned UI base; Supabase auth and inbox API bridges are behind `SUPABASE_AUTH_ENABLED`. Full app runtime has not been launched locally. |
| Supabase inbox slice | 🟨 Implemented, unverified | Migration and Edge Functions cover auth-scoped inbox reads, status updates, reply queueing, and normalized message ingest. No end-to-end run against a local Supabase instance yet. |
| Existing RelayDesk schema | 🟥 Incompatible today | The code expects integer IDs, `profiles.auth_user_id`, and `quick_replies`; the existing project uses UUID IDs, `profiles.id = auth.users.id`, and `canned_responses`. Keep the flag off and do not apply the fresh-database migration there. |
| Gmail, Slack, WhatsApp connections | 🟥 Not implemented | OAuth/callbacks, provider webhook verification, and provider-specific channel adapters are still required. `ingest-message` is an internal normalized endpoint only. |
| Outbound delivery and automation | 🟥 Not implemented | Replies can be queued, but no provider delivery worker or scheduled auto-send/automation execution is included. |
| RLS and database security | 🟨 Defined, not validated | The new migration defines membership policies and an outbox boundary, but it has not been applied or checked with Supabase advisors against the intended target. |
| Frontend verification | 🟨 Partial | Targeted ESLint passed. The full Vitest run had 5,155 passes and 4 failures caused by billing specs hard-coding `$`; those specs now derive the expected USD string from the active locale, and the focused rerun passed all 11 tests. The full suite has not been rerun after that test-only fix. |
| Visual verification | 🟥 Blocked | The full Rails app cannot run here (Ruby, Postgres, Redis, and Docker are unavailable). Histoire opened but listed 0 stories, so it did not produce a valid UI proof. |
| GitHub push | 🟩 Complete | `codex/supabase-inbox` is pushed to `https://github.com/jessicacarter9955/chatwoot-supabase-fork`. |

## Next steps

1. Confirm the intended Supabase project/schema and build a non-destructive adapter for it before enabling Supabase auth.
2. Start the application and database services in an environment with the required runtime, then capture and inspect a real inbox screenshot.
3. Add and verify provider OAuth, inbound webhook adapters, outbound delivery workers, and automation execution.
4. Normalize the billing test locale or make those tests locale-aware, then rerun the relevant checks.
