const mocks = vi.hoisted(() => ({
  authGetUser: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: (...args) => mocks.authGetUser(...args) },
    from: (...args) => mocks.from(...args),
  }),
}));

import { getSupabaseCurrentUser } from '../supabaseClient';

const query = result => {
  const calls = [];
  const builder = {};
  ['eq', 'in', 'select'].forEach(method => {
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

describe('RelayDesk Supabase user bootstrap', () => {
  let previousConfig;

  beforeEach(() => {
    previousConfig = window.globalConfig;
    window.globalConfig = {
      SUPABASE_URL: 'https://relaydesk.example.co',
      SUPABASE_ANON_KEY: 'public-key',
      SUPABASE_SCHEMA: 'relaydesk',
    };
    vi.clearAllMocks();
    mocks.authGetUser.mockResolvedValue({
      data: { user: { id: 'auth-user-uuid', email: 'agent@example.com' } },
      error: null,
    });
  });

  afterEach(() => {
    window.globalConfig = previousConfig;
  });

  it('maps UUID auth/profile/workspace identities to Chatwoot IDs for the UI', async () => {
    const profile = query({
      data: {
        id: 'auth-user-uuid',
        chatwoot_id: 900,
        full_name: 'RelayDesk Agent',
        avatar_url: 'https://example.co/avatar.png',
      },
      error: null,
    });
    const memberships = query({
      data: [{ workspace_id: 'workspace-uuid', role: 'owner' }],
      error: null,
    });
    const workspaces = query({
      data: [
        {
          id: 'workspace-uuid',
          chatwoot_id: 42,
          name: 'RelayDesk',
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
      error: null,
    });
    mocks.from
      .mockReturnValueOnce(profile.builder)
      .mockReturnValueOnce(memberships.builder)
      .mockReturnValueOnce(workspaces.builder);

    await expect(getSupabaseCurrentUser()).resolves.toMatchObject({
      id: 900,
      supabase_id: 'auth-user-uuid',
      auth_user_id: 'auth-user-uuid',
      name: 'RelayDesk Agent',
      email: 'agent@example.com',
      account_id: 42,
      accounts: [
        {
          id: 42,
          supabase_id: 'workspace-uuid',
          name: 'RelayDesk',
          role: 'administrator',
        },
      ],
    });

    expect(mocks.from.mock.calls).toEqual([
      ['profiles'],
      ['workspace_members'],
      ['workspaces'],
    ]);
    expect(profile.calls).toContainEqual(['eq', 'id', 'auth-user-uuid']);
    expect(workspaces.calls).toContainEqual(['in', 'id', ['workspace-uuid']]);
  });
});
