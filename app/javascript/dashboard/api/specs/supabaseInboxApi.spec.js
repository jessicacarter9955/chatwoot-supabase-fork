import SupabaseInboxApi from '../supabaseInboxApi';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock('../supabaseClient', () => ({
  getSupabaseClient: () => ({
    auth: { getSession: mocks.getSession },
    functions: { invoke: mocks.invoke },
  }),
}));

describe('Supabase inbox API', () => {
  let previousConfig;

  beforeEach(() => {
    previousConfig = window.globalConfig;
    vi.clearAllMocks();
    window.globalConfig = {
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'public-anon-key',
    };
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: 'user-access-token' } },
      error: null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.globalConfig = previousConfig;
  });

  it('reads the inbox with the authenticated user JWT', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { meta: { all_count: 0 }, payload: [] } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      SupabaseInboxApi.list({
        workspaceId: '1',
        inboxId: '7',
        status: 'open',
        assigneeType: 'me',
      })
    ).resolves.toEqual({
      data: { data: { meta: { all_count: 0 }, payload: [] } },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      new URL(
        'https://example.supabase.co/functions/v1/inbox-read?action=list&workspaceId=1&inboxId=7&status=open&assigneeType=me&page=1'
      ),
      {
        headers: {
          apikey: 'public-anon-key',
          Authorization: 'Bearer user-access-token',
        },
      }
    );
  });

  it('does not request inbox data without a user session', async () => {
    mocks.getSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(SupabaseInboxApi.list({ workspaceId: '1' })).rejects.toThrow(
      'A Supabase session is required to read the inbox'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('converts Chatwoot snooze seconds to an ISO timestamp', async () => {
    mocks.invoke.mockResolvedValue({
      data: {
        conversation: {
          id: '2',
          status: 'snoozed',
          snoozed_until: '2026-01-01T00:00:00.000Z',
        },
      },
      error: null,
    });

    await SupabaseInboxApi.setStatus({
      conversationId: '2',
      status: 'snoozed',
      snoozedUntil: 1767225600,
    });

    expect(mocks.invoke).toHaveBeenCalledWith('update-conversation-status', {
      body: {
        conversationId: '2',
        status: 'snoozed',
        snoozedUntil: '2026-01-01T00:00:00.000Z',
      },
    });
  });

  it('maps a queued reply into a Chatwoot message response', async () => {
    mocks.invoke.mockResolvedValue({
      data: {
        message: {
          id: 'message-id',
          author_user_id: 'user-id',
          author_name: 'Agent',
          delivery_status: 'queued',
          created_at: '2026-01-01T00:00:00.000Z',
        },
      },
      error: null,
    });

    const result = await SupabaseInboxApi.queueReply({
      conversationId: '2',
      content: 'Hello',
      clientRequestId: 'request-id',
    });

    expect(result.data).toMatchObject({
      id: 'message-id',
      echo_id: 'request-id',
      message_type: 1,
      status: 'pending',
      sender: { id: 'user-id', name: 'Agent' },
      created_at: 1767225600,
    });
    expect(mocks.invoke).toHaveBeenCalledWith('queue-reply', {
      body: {
        conversationId: '2',
        content: 'Hello',
        scheduledAt: undefined,
        clientRequestId: 'request-id',
      },
    });
  });
});
