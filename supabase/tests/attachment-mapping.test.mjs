import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mapInboxAttachment,
  readInboxAttachments,
} from '../functions/inbox-read/attachment-mapping.ts';
import { mapInboxMessage } from '../functions/inbox-read/message-mapping.ts';

test('attachment metadata maps to a Chatwoot image with a signed URL', () => {
  const mapped = mapInboxAttachment(
    {
      id: 'attachment-1',
      message_id: 'message-1',
      storage_path: 'workspace-1/photo.PNG',
      file_name: 'photo.PNG',
      content_type: 'image/png',
      byte_size: 128,
      width: 16,
      height: 8,
    },
    'https://example.supabase.co/storage/v1/object/sign/photo?token=secret',
    7
  );

  assert.deepEqual(mapped, {
    id: 'attachment-1',
    message_id: 'message-1',
    file_type: 'image',
    account_id: 7,
    extension: 'png',
    content_type: 'image/png',
    data_url:
      'https://example.supabase.co/storage/v1/object/sign/photo?token=secret',
    thumb_url:
      'https://example.supabase.co/storage/v1/object/sign/photo?token=secret',
    file_size: 128,
    width: 16,
    height: 8,
  });
});

test('message mapper includes supplied attachments', () => {
  const attachment = { id: 'attachment-1', file_type: 'file' };
  const mapped = mapInboxMessage(
    { id: 'message-1', direction: 'incoming' },
    17,
    null,
    undefined,
    [attachment]
  );

  assert.deepEqual(mapped.attachments, [attachment]);
});

test('attachment reader groups rows and signs paths with the user-scoped client', async () => {
  const attachmentRows = [
    {
      id: 'attachment-1',
      message_id: 'message-1',
      storage_path: 'workspace-1/one.pdf',
      file_name: 'one.pdf',
      content_type: 'application/pdf',
    },
    {
      id: 'attachment-2',
      message_id: 'message-2',
      storage_path: 'workspace-1/two.mp3',
      file_name: 'two.mp3',
      content_type: 'audio/mpeg',
    },
  ];
  let selectedTable;
  let requestedMessageIds;
  let signedBucket;
  let signedPaths;
  let signedTtl;
  const supabase = {
    from(table) {
      selectedTable = table;
      const query = {
        select() {
          return this;
        },
        in(column, ids) {
          assert.equal(column, 'message_id');
          requestedMessageIds = ids;
          return this;
        },
        order() {
          return this;
        },
        then(resolve) {
          resolve({ data: attachmentRows, error: null });
        },
      };
      return query;
    },
    storage: {
      from(bucket) {
        signedBucket = bucket;
        return {
          async createSignedUrls(paths, ttl) {
            signedPaths = paths;
            signedTtl = ttl;
            return {
              data: paths.map(path => ({ path, signedUrl: `signed:${path}` })),
              error: null,
            };
          },
        };
      },
    },
  };

  const result = await readInboxAttachments(
    supabase,
    [{ id: 'message-1' }, { id: 'message-2' }, { id: 'message-1' }],
    7
  );

  assert.equal(result.error, null);
  assert.equal(selectedTable, 'message_attachments');
  assert.deepEqual(requestedMessageIds, ['message-1', 'message-2']);
  assert.equal(signedBucket, 'message-attachments');
  assert.deepEqual(signedPaths, ['workspace-1/one.pdf', 'workspace-1/two.mp3']);
  assert.equal(signedTtl, 3600);
  assert.equal(
    result.data.get('message-1')[0].data_url,
    'signed:workspace-1/one.pdf'
  );
  assert.equal(result.data.get('message-2')[0].file_type, 'audio');
});

test('attachment reader preserves RLS errors instead of hiding attachments', async () => {
  const error = { code: '42501', message: 'permission denied' };
  const supabase = {
    from() {
      const query = {
        select() {
          return this;
        },
        in() {
          return this;
        },
        order() {
          return this;
        },
        then(resolve) {
          resolve({ data: null, error });
        },
      };
      return query;
    },
  };

  const result = await readInboxAttachments(supabase, [{ id: 'message-1' }], 7);

  assert.equal(result.data, null);
  assert.equal(result.error, error);
});

test('attachment reader reports missing signatures instead of returning raw paths', async () => {
  const supabase = {
    from() {
      const query = {
        select() {
          return this;
        },
        in() {
          return this;
        },
        order() {
          return this;
        },
        then(resolve) {
          resolve({
            data: [
              {
                id: 'attachment-1',
                message_id: 'message-1',
                storage_path: 'private/path.pdf',
              },
            ],
            error: null,
          });
        },
      };
      return query;
    },
    storage: {
      from() {
        return {
          async createSignedUrls() {
            return {
              data: [{ path: 'private/path.pdf', signedUrl: null }],
              error: null,
            };
          },
        };
      },
    },
  };

  const result = await readInboxAttachments(supabase, [{ id: 'message-1' }], 7);

  assert.equal(result.data, null);
  assert.equal(result.error.message, 'attachment_signed_url_unavailable');
});
