import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { readRelayDeskConversationList } from '../functions/inbox-read/relaydesk-list.ts';
import { readRelayDeskConversation } from '../functions/inbox-read/relaydesk-thread.ts';

const ids = {
  authUser: 'auth-user-uuid',
  workspace: 'workspace-uuid',
  inbox: 'inbox-uuid',
  conversation: 'conversation-uuid',
  contact: 'contact-uuid',
  message: 'message-uuid',
};

function createRelayDeskClient({
  duplicateDisplayId = false,
  noReadCursor = false,
} = {}) {
  const requests = [];
  const conversation = {
    id: ids.conversation,
    workspace_id: ids.workspace,
    inbox_id: ids.inbox,
    contact_id: ids.contact,
    assignee_id: ids.authUser,
    display_id: 101,
    status: 'open',
    snoozed_until: null,
    priority: 'none',
    additional_attributes: { source: 'email' },
    custom_attributes: {},
    last_activity_at: '2026-10-12T12:00:00Z',
    created_at: '2026-10-12T11:00:00Z',
    updated_at: '2026-10-12T12:00:00Z',
  };
  const contact = {
    id: ids.contact,
    chatwoot_id: 301,
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    phone: null,
    avatar_url: null,
    identifier: 'ada@example.com',
    blocked: false,
    custom_attributes: { tier: 'pro' },
  };
  const inbox = {
    id: ids.inbox,
    chatwoot_id: 201,
    channel: 'email',
    enabled: true,
  };
  const profile = {
    id: ids.authUser,
    chatwoot_id: 901,
    full_name: 'Agent One',
    avatar_url: null,
  };
  const message = {
    id: ids.message,
    chatwoot_id: 501,
    workspace_id: ids.workspace,
    conversation_id: ids.conversation,
    sender_contact_id: null,
    sender_user_id: ids.authUser,
    direction: 'outgoing',
    kind: 'text',
    content: 'Thanks for your email',
    content_html: null,
    metadata: {},
    private: false,
    sent_at: '2026-10-12T12:00:00Z',
    delivered_at: '2026-10-12T12:00:01Z',
    read_at: null,
    failed_at: null,
    created_at: '2026-10-12T12:00:00Z',
  };

  const client = createClient(
    'https://example.supabase.co',
    'public-test-key',
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input, init) => {
          const url = new URL(input);
          const params = url.searchParams;
          const table = url.pathname.split('/').pop();
          requests.push({ table, params, method: init?.method });

          if (table === 'workspaces')
            return Response.json([{ id: ids.workspace }]);
          if (table === 'profiles') return Response.json([profile]);
          if (table === 'inboxes') return Response.json([inbox]);
          if (table === 'contacts') return Response.json([contact]);
          if (table === 'conversation_reads') {
            return Response.json(
              noReadCursor
                ? []
                : [
                    {
                      conversation_id: ids.conversation,
                      last_read_at: '2026-10-12T11:30:00Z',
                    },
                  ]
            );
          }
          if (table === 'messages' && init?.method === 'HEAD') {
            return new Response(null, {
              status: 200,
              headers: { 'content-range': '*/1' },
            });
          }
          if (table === 'messages') return Response.json([message]);
          if (table === 'message_attachments') return Response.json([]);
          if (table === 'conversations' && init?.method === 'HEAD') {
            const assigned = params.get('assignee_id');
            const unassigned = params.get('assignee_id') === 'is.null';
            const count = unassigned ? 0 : assigned ? 1 : 1;
            return new Response(null, {
              status: 200,
              headers: { 'content-range': `*/${count}` },
            });
          }
          if (table === 'conversations' && params.has('display_id')) {
            return Response.json(
              duplicateDisplayId
                ? [
                    { id: ids.conversation, display_id: 101 },
                    { id: 'duplicate-uuid', display_id: 101 },
                  ]
                : [{ id: ids.conversation, display_id: 101 }]
            );
          }
          if (table === 'conversations') return Response.json([conversation]);
          throw new Error(`Unexpected PostgREST table: ${table}`);
        },
      },
    }
  );
  return { client, requests };
}

test('maps a RelayDesk list page to the Chatwoot conversation contract', async () => {
  const { client, requests } = createRelayDeskClient();
  const result = await readRelayDeskConversationList(client, {
    workspaceChatwootId: 42,
    inboxChatwootId: 201,
    authUserId: ids.authUser,
  });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.meta, {
    mine_count: 1,
    unassigned_count: 0,
    assigned_count: 1,
    all_count: 1,
  });
  assert.equal(result.body.data.payload.length, 1);
  const [row] = result.body.data.payload;
  assert.equal(row.id, 101);
  assert.equal(row.account_id, 42);
  assert.equal(row.inbox_id, 201);
  assert.equal(row.unread_count, 1);
  assert.equal(row.meta.sender.id, 301);
  assert.equal(row.meta.assignee.id, 901);
  assert.equal(row.messages[0].id, 501);
  assert.equal(row.messages[0].conversation_id, 101);
  assert.equal(row.messages[0].sender.id, 901);
  assert.equal(
    requests
      .find(request => request.table === 'inboxes')
      ?.params.get('chatwoot_id'),
    'eq.201'
  );
  const listRequest = requests.find(
    request =>
      request.table === 'conversations' &&
      request.method !== 'HEAD' &&
      !request.params.has('display_id')
  );
  assert.equal(
    listRequest?.params.get('order'),
    'last_activity_at.desc.nullslast,id.desc'
  );
  assert.match(listRequest?.params.get('select') ?? '', /display_id/);
});

test('rejects duplicate RelayDesk display IDs before mapping API IDs', async () => {
  const { client } = createRelayDeskClient({ duplicateDisplayId: true });
  const result = await readRelayDeskConversationList(client, {
    workspaceChatwootId: 42,
    authUserId: ids.authUser,
  });
  assert.equal(result.status, 409);
  assert.deepEqual(result.body, {
    error: 'conversation_display_id_is_ambiguous',
  });
});

test('treats inbound messages as unread until the user has a cursor', async () => {
  const { client } = createRelayDeskClient({ noReadCursor: true });
  const result = await readRelayDeskConversationList(client, {
    workspaceChatwootId: 42,
    authUserId: ids.authUser,
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.data.payload[0].unread_count, 1);
});

test('maps RelayDesk conversation detail and latest message', async () => {
  const { client } = createRelayDeskClient();
  const result = await readRelayDeskConversation(client, {
    workspaceChatwootId: 42,
    conversationChatwootId: 101,
    action: 'thread',
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.id, 101);
  assert.equal(result.body.account_id, 42);
  assert.equal(result.body.inbox_id, 201);
  assert.equal(result.body.meta.contact.id, 301);
  assert.equal(result.body.unread_count, 1);
  assert.equal(result.body.messages[0].id, 501);
  assert.equal(result.body.messages[0].conversation_id, 101);
  assert.equal(result.body.messages[0].sender.id, 901);
});

test('maps RelayDesk history and applies Chatwoot message cursors', async () => {
  const { client, requests } = createRelayDeskClient();
  const result = await readRelayDeskConversation(client, {
    workspaceChatwootId: 42,
    conversationChatwootId: 101,
    action: 'messages',
    before: 600,
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.payload.length, 1);
  assert.equal(result.body.payload[0].id, 501);
  assert.equal(result.body.payload[0].conversation_id, 101);
  const historyRequest = requests.find(
    request => request.table === 'messages' && request.params.has('chatwoot_id')
  );
  assert.equal(historyRequest?.params.get('chatwoot_id'), 'lt.600');
  assert.equal(historyRequest?.params.get('order'), 'chatwoot_id.desc');
});

test('rejects ambiguous RelayDesk display IDs when opening a conversation', async () => {
  const { client } = createRelayDeskClient({ duplicateDisplayId: true });
  const result = await readRelayDeskConversation(client, {
    workspaceChatwootId: 42,
    conversationChatwootId: 101,
    action: 'thread',
  });

  assert.equal(result.status, 409);
  assert.deepEqual(result.body, {
    error: 'conversation_display_id_is_ambiguous',
  });
});
