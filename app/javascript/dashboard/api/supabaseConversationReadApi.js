import {
  getSupabaseClient,
  getSupabaseCurrentUser,
  isRelayDeskSchema,
  toChatwootId,
} from './supabaseClient';

const unixSeconds = value => Math.floor(new Date(value).getTime() / 1000);
const earliestCursor = '1970-01-01T00:00:00.000Z';

const resolveConversation = async (client, workspaceId, conversationId) => {
  const relayDesk = isRelayDeskSchema();
  const chatwootWorkspaceId = toChatwootId(workspaceId);
  const supabaseWorkspace = relayDesk
    ? await client
        .from('workspaces')
        .select('id')
        .eq('chatwoot_id', chatwootWorkspaceId)
        .single()
    : { data: { id: chatwootWorkspaceId }, error: null };
  if (supabaseWorkspace.error) throw new Error(supabaseWorkspace.error.message);
  if (!supabaseWorkspace.data?.id) {
    throw new Error('Workspace was not found for the current Supabase schema');
  }

  const apiConversationId = toChatwootId(conversationId);
  const { data: matches, error } = await client
    .from('conversations')
    .select(relayDesk ? 'id, display_id' : 'id')
    .eq('workspace_id', supabaseWorkspace.data.id)
    .eq(relayDesk ? 'display_id' : 'id', apiConversationId)
    .limit(2);
  if (error) throw new Error(error.message);
  if (!matches?.length) throw new Error('Conversation was not found');
  if (matches.length !== 1) {
    throw new Error('Conversation display ID is ambiguous in this workspace');
  }

  return {
    relayDesk,
    apiConversationId,
    workspaceId: supabaseWorkspace.data.id,
    conversationId: matches[0].id,
  };
};

const updateCursor = async ({ workspaceId, conversationId, markUnread }) => {
  const client = getSupabaseClient();
  const currentUser = await getSupabaseCurrentUser();
  if (!currentUser) throw new Error('A Supabase session is required');

  const resolved = await resolveConversation(
    client,
    workspaceId,
    conversationId
  );
  const userId = resolved.relayDesk ? currentUser.auth_user_id : currentUser.id;
  if (!userId) throw new Error('The current user has no schema-mapped ID');

  const lastReadAt = markUnread ? earliestCursor : new Date().toISOString();
  const { error: upsertError } = await client.from('conversation_reads').upsert(
    {
      workspace_id: resolved.workspaceId,
      conversation_id: resolved.conversationId,
      user_id: userId,
      last_read_at: lastReadAt,
      last_read_message_id: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'conversation_id,user_id' }
  );
  if (upsertError) throw new Error(upsertError.message);

  let unreadCount;
  if (markUnread) {
    let countQuery = client
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', resolved.workspaceId)
      .eq('conversation_id', resolved.conversationId)
      .eq('direction', resolved.relayDesk ? 'incoming' : 'inbound')
      .gt('created_at', earliestCursor);
    if (resolved.relayDesk) countQuery = countQuery.eq('private', false);
    const { count, error: countError } = await countQuery;
    if (countError) throw new Error(countError.message);
    unreadCount = count ?? 0;
  }

  return {
    data: {
      id: resolved.apiConversationId,
      agent_last_seen_at: markUnread ? null : unixSeconds(lastReadAt),
      ...(markUnread ? { unread_count: unreadCount } : {}),
    },
  };
};

export default {
  markRead: params => updateCursor({ ...params, markUnread: false }),
  markUnread: params => updateCursor({ ...params, markUnread: true }),
};
