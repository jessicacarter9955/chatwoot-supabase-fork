const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getSupabaseClient: vi.fn(),
  getSupabaseCurrentUser: vi.fn(),
  isRelayDeskSchema: vi.fn(),
  isSupabaseAuthEnabled: vi.fn(),
}));

vi.mock('../supabaseClient', () => ({
  getSupabaseClient: (...args) => mocks.getSupabaseClient(...args),
  getSupabaseCurrentUser: (...args) => mocks.getSupabaseCurrentUser(...args),
  isRelayDeskSchema: (...args) => mocks.isRelayDeskSchema(...args),
  isSupabaseAuthEnabled: (...args) => mocks.isSupabaseAuthEnabled(...args),
}));

import CannedResponse from '../cannedResponse';

const query = result => {
  const calls = [];
  const builder = {};
  ['delete', 'eq', 'insert', 'order', 'select', 'update'].forEach(method => {
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

describe('Supabase canned responses', () => {
  let previousPath;

  beforeEach(() => {
    previousPath = window.location.pathname;
    window.history.replaceState(
      {},
      '',
      '/app/accounts/42/settings/canned-responses'
    );
    vi.clearAllMocks();
    mocks.isSupabaseAuthEnabled.mockReturnValue(true);
    mocks.isRelayDeskSchema.mockReturnValue(true);
    mocks.getSupabaseClient.mockReturnValue({
      from: (...args) => mocks.from(...args),
    });
    mocks.getSupabaseCurrentUser.mockResolvedValue({
      id: 900,
      auth_user_id: 'auth-user-uuid',
    });
  });

  afterEach(() => {
    window.history.replaceState({}, '', previousPath);
  });

  it('reads RelayDesk canned responses using the mapped workspace UUID', async () => {
    const workspace = query({ data: { id: 'workspace-uuid' }, error: null });
    const replies = query({
      data: [
        {
          chatwoot_id: 71,
          short_code: 'hello',
          content: 'Hello there',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ],
      error: null,
    });
    mocks.from
      .mockReturnValueOnce(workspace.builder)
      .mockReturnValueOnce(replies.builder);

    await expect(CannedResponse.get()).resolves.toEqual({
      data: [
        {
          id: 71,
          account_id: 42,
          short_code: 'hello',
          content: 'Hello there',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ],
    });
    expect(mocks.from.mock.calls).toEqual([
      ['workspaces'],
      ['canned_responses'],
    ]);
    expect(workspace.calls).toContainEqual(['eq', 'chatwoot_id', 42]);
    expect(replies.calls).toContainEqual([
      'eq',
      'workspace_id',
      'workspace-uuid',
    ]);
    expect(replies.calls).toContainEqual([
      'order',
      'short_code',
      { ascending: true },
    ]);
  });

  it('creates a RelayDesk canned response with the authenticated UUID author', async () => {
    const workspace = query({ data: { id: 'workspace-uuid' }, error: null });
    const created = query({
      data: {
        chatwoot_id: 72,
        short_code: 'thanks',
        content: 'Thanks!',
      },
      error: null,
    });
    mocks.from
      .mockReturnValueOnce(workspace.builder)
      .mockReturnValueOnce(created.builder);

    await expect(
      CannedResponse.create({ short_code: 'thanks', content: 'Thanks!' })
    ).resolves.toMatchObject({
      data: {
        id: 72,
        account_id: 42,
        short_code: 'thanks',
        content: 'Thanks!',
      },
    });
    expect(created.calls).toContainEqual([
      'insert',
      {
        workspace_id: 'workspace-uuid',
        short_code: 'thanks',
        content: 'Thanks!',
        created_by: 'auth-user-uuid',
      },
    ]);
  });

  it('updates and deletes RelayDesk records by their Chatwoot ID', async () => {
    const workspaceForUpdate = query({
      data: { id: 'workspace-uuid' },
      error: null,
    });
    const updated = query({
      data: { chatwoot_id: 73, short_code: 'welcome', content: 'Welcome!' },
      error: null,
    });
    const workspaceForDelete = query({
      data: { id: 'workspace-uuid' },
      error: null,
    });
    const deleted = query({ data: null, error: null });
    mocks.from
      .mockReturnValueOnce(workspaceForUpdate.builder)
      .mockReturnValueOnce(updated.builder)
      .mockReturnValueOnce(workspaceForDelete.builder)
      .mockReturnValueOnce(deleted.builder);

    await expect(
      CannedResponse.update(73, { short_code: 'welcome', content: 'Welcome!' })
    ).resolves.toMatchObject({ data: { id: 73, content: 'Welcome!' } });
    await expect(CannedResponse.delete(73)).resolves.toEqual({
      data: { id: 73 },
    });

    expect(updated.calls).toContainEqual(['eq', 'chatwoot_id', 73]);
    expect(deleted.calls).toContainEqual(['eq', 'chatwoot_id', 73]);
    expect(deleted.calls).toContainEqual([
      'eq',
      'workspace_id',
      'workspace-uuid',
    ]);
  });
});
