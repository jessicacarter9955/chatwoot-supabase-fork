import { mapInboxMessage } from './message-mapping.ts';
import { readInboxAttachments } from './attachment-mapping.ts';

const PAGE_SIZE = 25;
const EARLIEST_READ_CURSOR = '1970-01-01T00:00:00.000Z';

function validChatwootId(value: unknown) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function fail(message: string, status = 422) {
  return { body: { error: message }, status };
}

function mapContact(contact: Record<string, any> | undefined) {
  if (!contact) return null;
  return {
    id: validChatwootId(contact.chatwoot_id),
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

async function readUnreadCounts(
  supabase: any,
  workspaceId: string,
  userId: string,
  conversations: Array<Record<string, any>>
) {
  if (!conversations.length) return { data: new Map(), error: null };
  const { data: cursors, error } = await supabase
    .from('conversation_reads')
    .select('conversation_id, last_read_at')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .in(
      'conversation_id',
      conversations.map(conversation => conversation.id)
    );
  if (error) return { data: null, error };
  const cursorByConversation = new Map(
    (cursors ?? []).map((cursor: Record<string, any>) => [
      cursor.conversation_id,
      cursor.last_read_at,
    ])
  );
  const counts = await Promise.all(
    conversations.map(async conversation => {
      const cursor =
        cursorByConversation.get(conversation.id) ?? EARLIEST_READ_CURSOR;
      const result = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('conversation_id', conversation.id)
        .eq('direction', 'incoming')
        .eq('private', false)
        .gt('created_at', cursor);
      return { id: conversation.id, count: result.count, error: result.error };
    })
  );
  const countError = counts.find(item => item.error)?.error;
  if (countError) return { data: null, error: countError };
  return {
    data: new Map(counts.map(item => [item.id, item.count ?? 0])),
    error: null,
  };
}

export async function readRelayDeskConversationList(
  supabase: any,
  {
    workspaceChatwootId,
    inboxChatwootId,
    authUserId,
    status = 'open',
    assigneeType = 'all',
    page = 1,
  }: {
    workspaceChatwootId: number;
    inboxChatwootId?: number | null;
    authUserId: string;
    status?: string;
    assigneeType?: string;
    page?: number;
  }
) {
  const workspaceId = validChatwootId(workspaceChatwootId);
  if (!workspaceId) return fail('workspaceId_must_be_a_positive_integer');
  if (!['open', 'pending', 'resolved', 'snoozed', 'all'].includes(status)) {
    return fail('status_must_be_open_pending_resolved_snoozed_or_all');
  }
  if (!['all', 'me', 'unassigned', 'assigned'].includes(assigneeType)) {
    return fail('assigneeType_must_be_all_me_unassigned_or_assigned');
  }
  const safeInboxId = inboxChatwootId ? validChatwootId(inboxChatwootId) : null;
  if (inboxChatwootId && !safeInboxId) {
    return fail('inboxId_must_be_a_positive_integer');
  }
  const safePage = Number.isSafeInteger(page) && page > 0 ? page : 1;

  const [workspaceResult, profileResult] = await Promise.all([
    supabase
      .from('workspaces')
      .select('id')
      .eq('chatwoot_id', workspaceId)
      .maybeSingle(),
    supabase
      .from('profiles')
      .select('id, chatwoot_id, full_name, avatar_url')
      .eq('id', authUserId)
      .maybeSingle(),
  ]);
  const lookupError = workspaceResult.error ?? profileResult.error;
  if (lookupError) return fail(lookupError.message);
  if (!workspaceResult.data) return fail('workspace_not_found', 404);
  if (!profileResult.data) return fail('authenticated_profile_not_found', 404);
  const profile = profileResult.data;
  const profileChatwootId = validChatwootId(profile.chatwoot_id);
  if (!profileChatwootId) return fail('profile_chatwoot_id_is_invalid');
  const supabaseWorkspaceId = workspaceResult.data.id as string;

  let supabaseInboxId: string | null = null;
  if (safeInboxId) {
    const inboxResult = await supabase
      .from('inboxes')
      .select('id')
      .eq('workspace_id', supabaseWorkspaceId)
      .eq('chatwoot_id', safeInboxId)
      .maybeSingle();
    if (inboxResult.error) return fail(inboxResult.error.message);
    if (!inboxResult.data) return fail('inbox_not_found', 404);
    supabaseInboxId = inboxResult.data.id;
  }

  const countQuery = () => {
    let query = supabase
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', supabaseWorkspaceId);
    if (status !== 'all') query = query.eq('status', status);
    if (supabaseInboxId) query = query.eq('inbox_id', supabaseInboxId);
    return query;
  };
  const [allCount, mineCount, unassignedCount] = await Promise.all([
    countQuery(),
    countQuery().eq('assignee_id', profile.id),
    countQuery().is('assignee_id', null),
  ]);
  const countsError =
    allCount.error ?? mineCount.error ?? unassignedCount.error;
  if (countsError) return fail(countsError.message);
  const all = allCount.count ?? 0;
  const unassigned = unassignedCount.count ?? 0;
  const meta = {
    mine_count: mineCount.count ?? 0,
    unassigned_count: unassigned,
    assigned_count: all - unassigned,
    all_count: all,
  };

  let conversationQuery = supabase
    .from('conversations')
    .select(
      'id, display_id, workspace_id, inbox_id, contact_id, assignee_id, status, snoozed_until, priority, additional_attributes, custom_attributes, last_activity_at, created_at, updated_at'
    )
    .eq('workspace_id', supabaseWorkspaceId);
  if (status !== 'all')
    conversationQuery = conversationQuery.eq('status', status);
  if (supabaseInboxId) {
    conversationQuery = conversationQuery.eq('inbox_id', supabaseInboxId);
  }
  if (assigneeType === 'me') {
    conversationQuery = conversationQuery.eq('assignee_id', profile.id);
  } else if (assigneeType === 'unassigned') {
    conversationQuery = conversationQuery.is('assignee_id', null);
  } else if (assigneeType === 'assigned') {
    conversationQuery = conversationQuery.not('assignee_id', 'is', null);
  }
  const { data: rows, error: listError } = await conversationQuery
    .order('last_activity_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })
    .range((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE - 1);
  if (listError) return fail(listError.message);
  const conversations = rows ?? [];
  const displayIds = conversations.map(row => validChatwootId(row.display_id));
  if (displayIds.some(id => !id))
    return fail('conversation_display_id_is_invalid');

  if (displayIds.length) {
    const collisionResult = await supabase
      .from('conversations')
      .select('id, display_id')
      .eq('workspace_id', supabaseWorkspaceId)
      .in('display_id', displayIds);
    if (collisionResult.error) return fail(collisionResult.error.message);
    const occurrences = new Map<number, number>();
    for (const row of collisionResult.data ?? []) {
      const id = validChatwootId(row.display_id);
      if (id) occurrences.set(id, (occurrences.get(id) ?? 0) + 1);
    }
    if ([...occurrences.values()].some(count => count > 1)) {
      return fail('conversation_display_id_is_ambiguous', 409);
    }
  }

  const conversationIds = conversations.map(row => row.id);
  const contactIds = [...new Set(conversations.map(row => row.contact_id))];
  const inboxIds = [...new Set(conversations.map(row => row.inbox_id))];
  const assigneeIds = [
    ...new Set(conversations.map(row => row.assignee_id).filter(Boolean)),
  ];
  const [
    contactsResult,
    inboxesResult,
    profilesResult,
    latestMessages,
    unread,
  ] = await Promise.all([
    contactIds.length
      ? supabase
          .from('contacts')
          .select('*')
          .eq('workspace_id', supabaseWorkspaceId)
          .in('id', contactIds)
      : Promise.resolve({ data: [], error: null }),
    inboxIds.length
      ? supabase
          .from('inboxes')
          .select('id, chatwoot_id, channel, enabled')
          .eq('workspace_id', supabaseWorkspaceId)
          .in('id', inboxIds)
      : Promise.resolve({ data: [], error: null }),
    assigneeIds.length
      ? supabase
          .from('profiles')
          .select('id, chatwoot_id, full_name, avatar_url')
          .in('id', assigneeIds)
      : Promise.resolve({ data: [], error: null }),
    Promise.all(
      conversations.map(async conversation => {
        const result = await supabase
          .from('messages')
          .select('*')
          .eq('workspace_id', supabaseWorkspaceId)
          .eq('conversation_id', conversation.id)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(1)
          .maybeSingle();
        return { conversationId: conversation.id, ...result };
      })
    ),
    readUnreadCounts(supabase, supabaseWorkspaceId, profile.id, conversations),
  ]);
  const relatedError =
    contactsResult.error ??
    inboxesResult.error ??
    profilesResult.error ??
    latestMessages.find((item: any) => item.error)?.error ??
    unread.error;
  if (relatedError) return fail(relatedError.message);

  const missingAuthorIds = [
    ...new Set(
      latestMessages
        .map((item: any) => item.data?.sender_user_id)
        .filter(
          (id: string | null | undefined) => id && !assigneeIds.includes(id)
        )
    ),
  ];
  const messageAuthorsResult = missingAuthorIds.length
    ? await supabase
        .from('profiles')
        .select('id, chatwoot_id, full_name, avatar_url')
        .in('id', missingAuthorIds)
    : { data: [], error: null };
  if (messageAuthorsResult.error)
    return fail(messageAuthorsResult.error.message);

  const messageRows = latestMessages
    .map((item: any) => item.data)
    .filter(Boolean);
  const attachmentResult = await readInboxAttachments(
    supabase,
    messageRows,
    workspaceId
  );
  if (attachmentResult.error) return fail(attachmentResult.error.message);

  const contactsById = new Map(
    (contactsResult.data ?? []).map((item: any) => [item.id, mapContact(item)])
  );
  const inboxesById = new Map(
    (inboxesResult.data ?? []).map((item: any) => [item.id, item])
  );
  const profilesById = new Map(
    [...(profilesResult.data ?? []), ...(messageAuthorsResult.data ?? [])].map(
      (item: any) => [item.id, item]
    )
  );
  const messageByConversationId = new Map(
    latestMessages.map((item: any) => [item.conversationId, item.data])
  );
  const payload = conversations.map((conversation, index) => {
    const displayId = displayIds[index] as number;
    const contact = contactsById.get(conversation.contact_id);
    const inbox = inboxesById.get(conversation.inbox_id);
    const inboxChatwootId = validChatwootId(inbox?.chatwoot_id);
    const assignee = profilesById.get(conversation.assignee_id);
    const assigneeChatwootId = validChatwootId(assignee?.chatwoot_id);
    const lastMessage = messageByConversationId.get(conversation.id);
    let mappedLastMessage = null;
    if (lastMessage && inboxChatwootId) {
      const author = profilesById.get(lastMessage.sender_user_id);
      const authorChatwootId = validChatwootId(author?.chatwoot_id);
      mappedLastMessage = mapInboxMessage(
        {
          ...lastMessage,
          id: validChatwootId(lastMessage.chatwoot_id) ?? lastMessage.id,
          conversation_id: displayId,
          sender_user_id: authorChatwootId,
          author_user_id: authorChatwootId,
          author_name: author?.full_name,
        },
        inboxChatwootId,
        contact,
        author,
        attachmentResult.data.get(lastMessage.id) ?? []
      );
    }
    const activityAt = conversation.last_activity_at;
    const priority =
      conversation.priority === 'none' ? null : conversation.priority;
    return {
      id: displayId,
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
      timestamp: activityAt
        ? Math.floor(new Date(activityAt).getTime() / 1000)
        : null,
      last_activity_at: activityAt
        ? Math.floor(new Date(activityAt).getTime() / 1000)
        : null,
      unread_count: unread.data.get(conversation.id) ?? 0,
      can_reply: inbox?.enabled === true,
      muted: false,
      labels: [],
      priority,
      additional_attributes: conversation.additional_attributes ?? {},
      custom_attributes: conversation.custom_attributes ?? {},
      messages: mappedLastMessage ? [mappedLastMessage] : [],
      last_non_activity_message: mappedLastMessage,
      meta: {
        sender: contact,
        channel: inbox?.channel,
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
    };
  });

  return { status: 200, body: { data: { meta, payload } } };
}
