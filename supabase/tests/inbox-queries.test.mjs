import { orderInboxConversations } from '../functions/inbox-read/conversation-order.ts';
import { readConversationCounts } from '../functions/inbox-read/conversation-counts.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { readMessagePage } from '../functions/inbox-read/message-page.ts';

// Exercise the real PostgREST query builder; HTTP is replaced, no database is used.
for (const scenario of [
  {
    name: 'initial load requests latest 20, presented oldest first',
    before: null,
    after: null,
    order: 'desc',
    limit: '20',
    filters: [],
    rows: [45, 44, 43],
    expected: [43, 44, 45],
  },
  {
    name: 'older page excludes its cursor and reverses descending results',
    before: 26,
    after: null,
    order: 'desc',
    limit: '20',
    filters: ['lt.26'],
    rows: [25, 24],
    expected: [24, 25],
  },
  {
    name: 'newer page requests next 100 without reversing',
    before: null,
    after: 25,
    order: 'asc',
    limit: '100',
    filters: ['gt.25'],
    rows: [26, 27],
    expected: [26, 27],
  },
  {
    name: 'between includes after cursor and excludes before cursor',
    before: 40,
    after: 20,
    order: 'asc',
    limit: '1000',
    filters: ['gte.20', 'lt.40'],
    rows: [20, 21, 39],
    expected: [20, 21, 39],
  },
  {
    name: 'empty history returns an empty page',
    before: null,
    after: null,
    order: 'desc',
    limit: '20',
    filters: [],
    rows: [],
    expected: [],
  },
]) {
  test(scenario.name, async () => {
    const client = createClient(
      'https://example.supabase.co',
      'public-test-key',
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          fetch: async url => {
            const params = new URL(url).searchParams;
            assert.equal(params.get('conversation_id'), 'eq.7');
            assert.equal(
              params.get('order'),
              `created_at.${scenario.order},id.${scenario.order}`
            );
            assert.equal(params.get('limit'), scenario.limit);
            assert.deepEqual(params.getAll('id'), scenario.filters);
            return new Response(
              JSON.stringify(scenario.rows.map(id => ({ id }))),
              {
                headers: { 'Content-Type': 'application/json' },
              }
            );
          },
        },
      }
    );
    const result = await readMessagePage(
      client.from('messages').select('*').eq('conversation_id', 7),
      scenario.before,
      scenario.after
    );
    assert.equal(result.error, null);
    assert.deepEqual(
      result.data.map(row => row.id),
      scenario.expected
    );
  });
}

test('database errors are preserved for the HTTP handler', async () => {
  const client = createClient(
    'https://example.supabase.co',
    'public-test-key',
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async () =>
          new Response(
            JSON.stringify({ message: 'permission denied', code: '42501' }),
            {
              status: 403,
              headers: { 'Content-Type': 'application/json' },
            }
          ),
      },
    }
  );
  const result = await readMessagePage(
    client.from('messages').select('*'),
    null,
    null
  );
  assert.equal(result.error.code, '42501');
  assert.deepEqual(result.data, []);
});

test('inbox order puts empty threads last and breaks timestamp ties by id', async () => {
  const client = createClient(
    'https://example.supabase.co',
    'public-test-key',
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async url => {
          const params = new URL(url).searchParams;
          assert.equal(
            params.get('order'),
            'last_message_at.desc.nullslast,id.desc'
          );
          return new Response(JSON.stringify([]), {
            headers: { 'Content-Type': 'application/json' },
          });
        },
      },
    }
  );
  const { error } = await orderInboxConversations(
    client.from('conversations').select('*')
  );
  assert.equal(error, null);
});

test('conversation counts stay independent of the selected status', async () => {
  const requests = [];
  const client = createClient(
    'https://example.supabase.co',
    'public-test-key',
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async url => {
          const params = new URL(url).searchParams;
          requests.push(params);
          if (params.has('auth_user_id')) {
            assert.equal(params.get('auth_user_id'), 'eq.user-auth-1');
            return new Response(JSON.stringify([{ id: 44 }]), {
              headers: { 'Content-Type': 'application/json' },
            });
          }
          assert.equal(params.get('workspace_id'), 'eq.9');
          assert.equal(params.get('select'), 'id');
          assert.equal(params.get('status'), null);
          const assignedTo = params.get('assigned_to');
          const count = assignedTo === 'eq.44' ? 4 : assignedTo === 'is.null' ? 3 : 7;
          return new Response(null, {
            headers: { 'Content-Range': `0-0/${count}` },
          });
        },
      },
    }
  );

  const result = await readConversationCounts(client, 9, 'user-auth-1');
  assert.equal(requests.length, 4);
  assert.deepEqual(result, {
    data: {
      mine_count: 4,
      unassigned_count: 3,
      assigned_count: 4,
      all_count: 7,
    },
    error: null,
  });
});
