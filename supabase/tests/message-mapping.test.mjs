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

test('RelayDesk direction enum maps incoming and outgoing to public messages', () => {
  const incoming = mapInboxMessage(
    { direction: 'incoming', content: 'Hi' },
    17,
    { id: 'contact-1' }
  );
  const outgoing = mapInboxMessage(
    { direction: 'outgoing', content: 'Hello' },
    17,
    null
  );

  assert.equal(incoming.message_type, 0);
  assert.equal(incoming.private, false);
  assert.deepEqual(incoming.sender, { id: 'contact-1' });
  assert.equal(outgoing.message_type, 1);
  assert.equal(outgoing.private, false);
});

test('RelayDesk inbound HTML messages use Chatwoot email content attributes', () => {
  const mapped = mapInboxMessage(
    {
      id: 'message-html',
      direction: 'incoming',
      kind: 'html',
      content: 'A plain text version',
      content_html: '<p>A <strong>formatted</strong> email</p>',
      metadata: { email: { subject: 'Hello' } },
    },
    3,
    null
  );

  assert.equal(mapped.content_type, 'incoming_email');
  assert.equal(mapped.content, 'A plain text version');
  assert.deepEqual(mapped.content_attributes, {
    email: {
      subject: 'Hello',
      html_content: { full: '<p>A <strong>formatted</strong> email</p>' },
      text_content: { full: 'A plain text version' },
    },
  });
});

test('HTML email mapping keeps provider email bodies already in metadata', () => {
  const mapped = mapInboxMessage(
    {
      direction: 'incoming',
      kind: 'html',
      content: 'Fallback text',
      content_html: '<p>Stored html</p>',
      metadata: {
        email: {
          html_content: {
            full: '<p>Provider html</p>',
            quoted: '<blockquote />',
          },
          text_content: { full: 'Provider text' },
        },
      },
    },
    3,
    null
  );

  assert.equal(
    mapped.content_attributes.email.html_content.full,
    '<p>Provider html</p>'
  );
  assert.equal(
    mapped.content_attributes.email.html_content.quoted,
    '<blockquote />'
  );
  assert.equal(
    mapped.content_attributes.email.text_content.full,
    'Provider text'
  );
});

test('RelayDesk internal direction is private and delivery timestamps map status', () => {
  const internal = mapInboxMessage(
    { direction: 'internal', content: 'Team note' },
    17,
    null
  );
  const read = mapInboxMessage(
    { direction: 'outgoing', read_at: '2026-10-11T08:00:00.000Z' },
    17,
    null
  );
  const failed = mapInboxMessage(
    { direction: 'outgoing', failed_at: '2026-10-11T08:00:00.000Z' },
    17,
    null
  );

  assert.equal(internal.private, true);
  assert.equal(internal.message_type, 2);
  assert.equal(read.status, 'read');
  assert.equal(failed.status, 'failed');
});
