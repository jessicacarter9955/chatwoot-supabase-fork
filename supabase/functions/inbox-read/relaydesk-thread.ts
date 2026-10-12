import { readInboxAttachments } from './attachment-mapping.ts';
import { mapInboxMessage } from './message-mapping.ts';

const DEFAULT_PAGE_SIZE = 20;
const EARLIEST_READ_CURSOR = '1970-01-01T00:00:00.000Z';

function fail(message: string, status = 422) {
  return { body: { error: message }, status };
}

function chatwootId(value: unknown) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function mapContact(contact: Record<string, any> | null) {
  if (!contact) return null;
  return {
    id: chatwootId(contact.chatwoot_id),
    name: contact.name || contact.email || contact.phone || 'Unknown contact',
    email: contact.email ?? null,
    phone_number: contact.phone ?? null,
    thumbnail: contact.avatar_url ?? null,
    identifier: contact.identifier ?? null,
    custom_attributes: contact.custom_attributes ?? {},
    additional_attributes: {},
    blocked: contact.blocked ?? false,
  };
}

async function resolveConversation(
  supabase: any,
  workspaceChatwootId: number,
  conversationChatwootId: number
) {
  const { data: workspace, error: workspaceError } = await supabase
    .from('workspaces')
    .select('id')
    .eq('chatwoot_id', workspaceChatwootId)
    .maybeSingle();
  if (workspaceError) return { error: workspaceError };
  if (!workspace)
    return { error: new Error('workspace_not_found'), status: 404 };

  const { data: rows, error } = await supabase
    .from('conversations')
    .select(
      'id, display_id, workspace_id, inbox_id, contact_id, assignee_id, status, snoozed_until, priority, additional_attributes, custom_attributes, last_activity_at, created_at, updated_at'
    )
    .eq('workspace_id', workspace.id)
    .eq('display_id', conversationChatwootId)
    .limit(2);
  if (error) return { error };
  if ((rows ?? []).length > 1) {
    return {
      error: new Error('conversation_display_id_is_ambiguous'),
      status: 409,
    };
  }
  if (!rows?.length) {
    return { error: new Error('conversation_not_found'), status: 404 };
  }
  return { workspace, conversation: rows[0] };
}

function mapMessage(
  row: Record<string, any>,
  conversationChatwootId: number,
  inboxChatwootId: number,
  contact: Record<string, any> | null,
  author: Record<string, any> | null,
  attachments: Array<Record<string, any>>
) {
  const authorId = chatwootId(author?.chatwoot_id);
  return mapInboxMessage(
    {
      ...row,
      id: chatwootId(row.chatwoot_id) ?? row.id,
      conversation_id: conversationChatwootId,
      sender_user_id: authorId,
      author_user_id: authorId,
      author_name: author?.full_name,
    },
    inboxChatwootId,
    contact,
    author,
    attachments
  );
}

async function readMessagePage(
  supabase: any,
  workspaceId: string,
  conversationId: string,
  before: number | null,
  after: number | null
) {
  let query = supabase
    .from('messages')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('conversation_id', conversationId);
  if (before !== null && after !== null) {
    query = query.gte('chatwoot_id', after).lt('chatwoot_id', before);
  } else if (before !== null) {
    query = query.lt('chatwoot_id', before);
  } else if (after !== null) {
    query = query.gt('chatwoot_id', after);
  }
  const ascending = after !== null;
  const limit =
    before !== null && after !== null
      ? 1000
      : ascending
        ? 100
        : DEFAULT_PAGE_SIZE;
  const { data, error } = await query
    .order('chatwoot_id', { ascending })
    .limit(limit);
  return {
    data: ascending ? (data ?? []) : [...(data ?? [])].reverse(),
    error,
  };
}

export async function readRelayDeskConversation(
  supabase: any,
  {
    workspaceChatwootId,
    conversationChatwootId,
    authUserId,
    action,
    before = null,
    after = null,
  }: {
    workspaceChatwootId: number;
    conversationChatwootId: number;
    authUserId: string;
    action: 'thread' | 'messages';
    before?: number | null;
    after?: number | null;
  }
) {
  const workspaceId = chatwootId(workspaceChatwootId);
  const conversationId = chatwootId(conversationChatwootId);
  if (!workspaceId) return fail('workspaceId_must_be_a_positive_integer');
  if (!conversationId) return fail('conversationId_must_be_a_positive_integer');
  if (before !== null && !chatwootId(before))
    return fail('before_must_be_a_positive_integer');
  if (after !== null && !chatwootId(after))
    return fail('after_must_be_a_positive_integer');

  const resolved = await resolveConversation(
    supabase,
    workspaceId,
    conversationId
  );
  if (resolved.error)
    return fail(resolved.error.message, resolved.status ?? 422);
  const { workspace, conversation } = resolved;
  const unreadCountPromise =
    action === 'thread'
      ? (async () => {
          const { data: cursor, error: cursorError } = await supabase
            .from('conversation_reads')
            .select('last_read_at')
            .eq('workspace_id', workspace.id)
            .eq('conversation_id', conversation.id)
            .eq('user_id', authUserId)
            .maybeSingle();
          if (cursorError) return { count: null, error: cursorError };
          const { count, error } = await supabase
            .from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', workspace.id)
            .eq('conversation_id', conversation.id)
            .eq('direction', 'incoming')
            .eq('private', false)
            .gt('created_at', cursor?.last_read_at ?? EARLIEST_READ_CURSOR);
          return { count, error };
        })()
      : Promise.resolve({ count: 0, error: null });
  const [contactResult, inboxResult, assigneeResult, messagesResult] =
    await Promise.all([
      supabase
        .from('contacts')
        .select('*')
        .eq('workspace_id', workspace.id)
        .eq('id', conversation.contact_id)
        .maybeSingle(),
      supabase
        .from('inboxes')
        .select('id, chatwoot_id, channel, enabled')
        .eq('workspace_id', workspace.id)
        .eq('id', conversation.inbox_id)
        .maybeSingle(),
      conversation.assignee_id
        ? supabase
            .from('profiles')
            .select('id, chatwoot_id, full_name, avatar_url')
            .eq('id', conversation.assignee_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      action === 'thread'
        ? supabase
            .from('messages')
            .select('*')
            .eq('workspace_id', workspace.id)
            .eq('conversation_id', conversation.id)
            .order('chatwoot_id', { ascending: false })
            .limit(1)
        : readMessagePage(
            supabase,
            workspace.id,
            conversation.id,
            before,
            after
          ),
    ]);
  const queryError =
    contactResult.error ??
    inboxResult.error ??
    assigneeResult.error ??
    messagesResult.error;
  if (queryError) return fail(queryError.message);
  const unreadCount = await unreadCountPromise;
  if (unreadCount.error) return fail(unreadCount.error.message);

  const contact = mapContact(contactResult.data);
  const inboxChatwootId = chatwootId(inboxResult.data?.chatwoot_id);
  if (!inboxChatwootId) return fail('inbox_chatwoot_id_is_invalid');
  const messageRows = messagesResult.data ?? [];
  const profileIds = [
    ...new Set(
      messageRows
        .map((message: Record<string, any>) => message.sender_user_id)
        .filter(Boolean)
    ),
  ];
  const missingProfileIds = profileIds.filter(
    id => id !== conversation.assignee_id
  );
  const authorsResult = missingProfileIds.length
    ? await supabase
        .from('profiles')
        .select('id, chatwoot_id, full_name, avatar_url')
        .in('id', missingProfileIds)
    : { data: [], error: null };
  if (authorsResult.error) return fail(authorsResult.error.message);

  const attachmentResult = await readInboxAttachments(
    supabase,
    messageRows,
    workspaceId
  );
  if (attachmentResult.error) return fail(attachmentResult.error.message);
  const profiles = [assigneeResult.data, ...(authorsResult.data ?? [])].filter(
    Boolean
  );
  const profileById = new Map(profiles.map(profile => [profile.id, profile]));
  const mappedMessages = messageRows.map((message: Record<string, any>) =>
    mapMessage(
      message,
      conversationId,
      inboxChatwootId,
      contact,
      profileById.get(message.sender_user_id) ?? null,
      attachmentResult.data.get(message.id) ?? []
    )
  );

  if (action === 'messages') {
    return {
      status: 200,
      body: {
        meta: {
          labels: [],
          additional_attributes: conversation.additional_attributes ?? {},
        },
        payload: mappedMessages,
      },
    };
  }

  const lastMessage = mappedMessages.at(-1) ?? null;
  const assignee = assigneeResult.data;
  const assigneeChatwootId = chatwootId(assignee?.chatwoot_id);
  return {
    status: 200,
    body: {
      id: conversationId,
      account_id: workspaceId,
      inbox_id: inboxChatwootId,
      status: conversation.status,
      snoozed_until: conversation.snoozed_until,
      created_at: Math.floor(
        new Date(conversation.created_at).getTime() / 1000
      ),
      updated_at: Math.floor(
        new Date(conversation.updated_at).getTime() / 1000
      ),
      timestamp: conversation.last_activity_at
        ? Math.floor(new Date(conversation.last_activity_at).getTime() / 1000)
        : null,
      last_activity_at: conversation.last_activity_at
        ? Math.floor(new Date(conversation.last_activity_at).getTime() / 1000)
        : null,
      can_reply: inboxResult.data.enabled === true,
      unread_count: unreadCount.count ?? 0,
      muted: false,
      labels: [],
      priority: conversation.priority === 'none' ? null : conversation.priority,
      additional_attributes: conversation.additional_attributes ?? {},
      custom_attributes: conversation.custom_attributes ?? {},
      messages: lastMessage ? [lastMessage] : [],
      last_non_activity_message: lastMessage,
      meta: {
        sender: contact,
        contact,
        channel: inboxResult.data.channel,
        labels: [],
        additional_attributes: conversation.additional_attributes ?? {},
        ...(assignee && assigneeChatwootId
          ? {
              assignee: {
                id: assigneeChatwootId,
                name: assignee.full_name,
                thumbnail: assignee.avatar_url,
              },
              assignee_type: 'User',
            }
          : {}),
      },
    },
  };
}
