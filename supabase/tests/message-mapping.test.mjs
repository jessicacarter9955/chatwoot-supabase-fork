import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapInboxMessage } from '../functions/inbox-read/message-mapping.ts';

test('explicit private messages are mapped as Chatwoot notes', () => {
  const mapped = mapInboxMessage(
    {
      id: 'message-1',
      conversation_id: 'conversation-1',
      direction: 'outbound',
      private: true,
      content: 'Internal note',
      created_at: '2026-10-11T08:00:00.000Z',
    },
    17,
    null
  );

  assert.equal(mapped.private, true);
  assert.equal(mapped.message_type, 2);
  assert.equal(mapped.inbox_id, 17);
  assert.equal(mapped.content, 'Internal note');
});

test('prototype note direction remains private without a private column', () => {
  const mapped = mapInboxMessage(
    { direction: 'note', content: 'Note' },
    17,
    null
  );

  assert.equal(mapped.private, true);
  assert.equal(mapped.message_type, 2);
});

test('inbound and outbound public messages preserve Chatwoot message types', () => {
  const inbound = mapInboxMessage({ direction: 'inbound', content: 'Hi' }, 17, {
    id: 'contact-1',
  });
  const outbound = mapInboxMessage(
    {
      direction: 'outbound',
      sender_user_id: 'user-1',
      content: 'Hello',
    },
    17,
    null,
    { full_name: 'Alex' }
  );

  assert.equal(inbound.message_type, 0);
  assert.equal(inbound.private, false);
  assert.deepEqual(inbound.sender, { id: 'contact-1' });
  assert.equal(outbound.message_type, 1);
  assert.equal(outbound.private, false);
  assert.deepEqual(outbound.sender, {
    id: 'user-1',
    name: 'Alex',
    thumbnail: undefined,
  });
});
