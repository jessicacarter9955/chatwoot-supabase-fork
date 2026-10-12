import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { readPerUserUnreadCounts } from '../functions/inbox-read/unread-counts.ts';

test('uses the caller cursor for unread counts and legacy count when absent', async () => {
  const calls = [];
  const client = createClient(
    'https://example.supabase.co',
    'public-test-key',
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input, init) => {
          const url = new URL(input);
          calls.push({ url, method: init?.method });
          if (url.pathname.endsWith('/conversation_reads')) {
            assert.equal(url.searchParams.get('workspace_id'), 'eq.7');
            assert.equal(url.searchParams.get('user_id'), 'eq.11');
            assert.equal(url.searchParams.get('conversation_id'), 'in.(21,22)');
            return Response.json([
              { conversation_id: 21, last_read_at: '2026-10-12T12:00:00Z' },
            ]);
          }

          assert.equal(url.pathname.endsWith('/messages'), true);
          assert.equal(url.searchParams.get('conversation_id'), 'eq.21');
          assert.equal(url.searchParams.get('direction'), 'eq.inbound');
          assert.equal(
            url.searchParams.get('created_at'),
            'gt.2026-10-12T12:00:00Z'
          );
          assert.equal(init?.method, 'HEAD');
          return new Response(null, {
            status: 200,
            headers: { 'content-range': '*/2' },
          });
        },
      },
    }
  );

  const result = await readPerUserUnreadCounts(client, 7, 11, [
    { id: 21, unread_count: 9 },
    { id: 22, unread_count: 3 },
  ]);

  assert.equal(result.error, null);
  assert.deepEqual(
    [...result.data],
    [
      [21, 2],
      [22, 3],
    ]
  );
  assert.equal(calls.length, 2);
});

test('returns cursor lookup errors rather than stale conversation counts', async () => {
  const client = {
    from: table => {
      assert.equal(table, 'conversation_reads');
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: async () => ({ data: null, error: new Error('permission denied') }),
      };
      return builder;
    },
  };

  const result = await readPerUserUnreadCounts(client, 7, 11, [
    { id: 21, unread_count: 9 },
  ]);
  assert.equal(result.data, null);
  assert.equal(result.error.message, 'permission denied');
});

test('does not issue a cursor query for an empty conversation page', async () => {
  const client = { from: () => assert.fail('unexpected query') };
  const result = await readPerUserUnreadCounts(client, 7, 11, []);
  assert.equal(result.error, null);
  assert.deepEqual([...result.data], []);
});
