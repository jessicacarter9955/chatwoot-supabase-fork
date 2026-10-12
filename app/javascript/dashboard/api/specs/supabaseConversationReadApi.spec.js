const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getSupabaseClient: vi.fn(),
  getSupabaseCurrentUser: vi.fn(),
  isRelayDeskSchema: vi.fn(),
  toChatwootId: value => {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new Error('RelayDesk record is missing a valid Chatwoot ID');
    }
    return id;
  },
}));

vi.mock('../supabaseClient', () => ({
  getSupabaseClient: (...args) => mocks.getSupabaseClient(...args),
  getSupabaseCurrentUser: (...args) => mocks.getSupabaseCurrentUser(...args),
  isRelayDeskSchema: (...args) => mocks.isRelayDeskSchema(...args),
  toChatwootId: (...args) => mocks.toChatwootId(...args),
}));

import SupabaseConversationReadApi from '../supabaseConversationReadApi';

const query = result => {
  const calls = [];
  const builder = {};
  ['eq', 'gt', 'limit', 'select', 'upsert'].forEach(method => {
    builder[method] = (...args) => {
      calls.push([method, ...args]);
      return builder;
    };
  });
  builder.single = vi.fn(async () => result);
  builder.then = (resolve, reject) =>
    Promise.resolve(result).then(resolve, reject);
  return { builder, calls };
};

describe('Supabase conversation read cursors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSupabaseClient.mockReturnValue({
      from: (...args) => mocks.from(...args),
    });
    mocks.getSupabaseCurrentUser.mockResolvedValue({
      id: 900,
      auth_user_id: 'auth-user-uuid',
    });
  });

  it('maps RelayDesk workspace and display IDs and counts non-private inbound messages', async () => {
    mocks.isRelayDeskSchema.mockReturnValue(true);
    const workspace = query({ data: { id: 'workspace-uuid' }, error: null });
    const conversation = query({
      data: [{ id: 'conversation-uuid', display_id: 34 }],
      error: null,
    });
    const cursor = query({ data: null, error: null });
    const unread = query({ count: 2, error: null });
    mocks.from
      .mockReturnValueOnce(workspace.builder)
      .mockReturnValueOnce(conversation.builder)
      .mockReturnValueOnce(cursor.builder)
      .mockReturnValueOnce(unread.builder);

    await expect(
      SupabaseConversationReadApi.markUnread({
        workspaceId: 8,
        conversationId: 34,
      })
    ).resolves.toEqual({
      data: { id: 34, agent_last_seen_at: null, unread_count: 2 },
    });

    expect(mocks.from.mock.calls).toEqual([
      ['workspaces'],
      ['conversations'],
      ['conversation_reads'],
      ['messages'],
    ]);
    expect(conversation.calls).toContainEqual(['eq', 'display_id', 34]);
    expect(cursor.calls).toContainEqual([
      'upsert',
      expect.objectContaining({
        workspace_id: 'workspace-uuid',
        conversation_id: 'conversation-uuid',
        user_id: 'auth-user-uuid',
        last_read_at: '1970-01-01T00:00:00.000Z',
      }),
      { onConflict: 'conversation_id,user_id' },
    ]);
    expect(unread.calls).toContainEqual(['eq', 'direction', 'incoming']);
    expect(unread.calls).toContainEqual(['eq', 'private', false]);
  });

  it('writes the prototype cursor with the numeric Chatwoot profile ID', async () => {
    mocks.isRelayDeskSchema.mockReturnValue(false);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-12T13:00:00.000Z'));
    const conversation = query({ data: [{ id: 34 }], error: null });
    const cursor = query({ data: null, error: null });
    mocks.from
      .mockReturnValueOnce(conversation.builder)
      .mockReturnValueOnce(cursor.builder);

    await expect(
      SupabaseConversationReadApi.markRead({
        workspaceId: 8,
        conversationId: 34,
      })
    ).resolves.toEqual({
      data: { id: 34, agent_last_seen_at: 1791810000 },
    });

    expect(mocks.from.mock.calls).toEqual([
      ['conversations'],
      ['conversation_reads'],
    ]);
    expect(conversation.calls).toContainEqual(['eq', 'workspace_id', 8]);
    expect(cursor.calls).toContainEqual([
      'upsert',
      expect.objectContaining({ workspace_id: 8, user_id: 900 }),
      { onConflict: 'conversation_id,user_id' },
    ]);
    vi.useRealTimers();
  });
});
