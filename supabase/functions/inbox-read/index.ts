import { orderInboxConversations } from './conversation-order.ts';
import { readMessagePage } from './message-page.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};
const PAGE_SIZE = 25;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function parseId(value: string | null) {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function unixSeconds(value: string | null) {
  return value ? Math.floor(new Date(value).getTime() / 1000) : null;
}

function mapContact(contact: Record<string, any> | undefined) {
  if (!contact) return null;
  const metadata = contact.metadata ?? {};
  return {
    id: contact.id,
    name: contact.display_name ?? contact.handle,
    email: metadata.email ?? null,
    phone_number: metadata.phone_number ?? null,
    thumbnail: contact.avatar_url,
    identifier: contact.handle,
    custom_attributes: metadata.custom_attributes ?? {},
    additional_attributes: metadata.additional_attributes ?? {},
    blocked: false,
  };
}

function mapMessage(
  message: Record<string, any>,
  inboxId: number,
  contact: Record<string, any> | null,
  profile?: Record<string, any>
) {
  const isInbound = message.direction === 'inbound';
  return {
    id: message.id,
    content: message.content,
    inbox_id: inboxId,
    conversation_id: message.conversation_id,
    message_type: isInbound ? 0 : message.direction === 'outbound' ? 1 : 2,
    content_type: 'text',
    status: message.delivery_status === 'queued' ? 'pending' : message.delivery_status ?? 'sent',
    content_attributes: message.metadata ?? {},
    created_at: unixSeconds(message.created_at),
    private: message.direction === 'note',
    sender: message.author_user_id
      ? { id: message.author_user_id, name: profile?.full_name ?? message.author_name, thumbnail: profile?.avatar_url }
      : isInbound ? contact : { id: null, name: message.author_name },
    attachments: [],
  };
}

function mapConversation(
  conversation: Record<string, any>,
  contact: Record<string, any> | undefined,
  connection: Record<string, any> | undefined,
  lastMessage: Record<string, any> | null,
  assignee: Record<string, any> | undefined
) {
  const sender = mapContact(contact);
  return {
    id: conversation.id,
    account_id: conversation.workspace_id,
    inbox_id: conversation.provider_connection_id,
    status: conversation.status,
    snoozed_until: conversation.snoozed_until,
    created_at: unixSeconds(conversation.created_at),
    updated_at: new Date(conversation.updated_at).getTime() / 1000,
    timestamp: unixSeconds(conversation.last_message_at),
    last_activity_at: unixSeconds(conversation.last_message_at),
    unread_count: conversation.unread_count,
    can_reply: connection?.status === 'connected',
    muted: false,
    labels: [],
    priority: null,
    additional_attributes: conversation.metadata ?? {},
    custom_attributes: {},
    messages: lastMessage ? [mapMessage(lastMessage, conversation.provider_connection_id, sender)] : [],
    last_non_activity_message: lastMessage
      ? mapMessage(lastMessage, conversation.provider_connection_id, sender)
      : null,
    meta: {
      sender,
      channel: conversation.provider,
      ...(assignee ? { assignee, assignee_type: 'User' } : {}),
    },
  };
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) {
    return jsonResponse({ error: 'supabase_environment_not_configured' }, 500);
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  const url = new URL(request.url);
  const workspaceId = parseId(url.searchParams.get('workspaceId'));
  const action = url.searchParams.get('action');
  if (!workspaceId) {
    return jsonResponse({ error: 'workspaceId_must_be_a_positive_integer' }, 422);
  }

  if (action === 'list') {
    const requestedPage = Number(url.searchParams.get('page') ?? 1);
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const status = url.searchParams.get('status') ?? 'open';
    if (!['open', 'pending', 'resolved', 'snoozed', 'all'].includes(status)) {
      return jsonResponse({ error: 'status_must_be_open_pending_resolved_snoozed_or_all' }, 422);
    }

    let conversationQuery = supabase
      .from('conversations')
      .select('id, workspace_id, provider_connection_id, provider, contact_id, assigned_to, status, snoozed_until, unread_count, last_message_at, created_at, updated_at, metadata', { count: 'exact' })
      .eq('workspace_id', workspaceId);
    if (status !== 'all') conversationQuery = conversationQuery.eq('status', status);
    const { data: conversations, count, error } = await orderInboxConversations(
      conversationQuery
    ).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
    if (error) return jsonResponse({ error: error.message }, 422);

    const rows = conversations ?? [];
    const contactIds = [...new Set(rows.map(row => row.contact_id))];
    const connectionIds = [...new Set(rows.map(row => row.provider_connection_id))];
    const assigneeIds = [...new Set(rows.map(row => row.assigned_to).filter(Boolean))];
    const [contactsResult, connectionsResult, profilesResult, latestMessages] = await Promise.all([
      contactIds.length
        ? supabase.from('contacts').select('*').in('id', contactIds)
        : Promise.resolve({ data: [], error: null }),
      connectionIds.length
        ? supabase.from('provider_connections').select('id, status').in('id', connectionIds)
        : Promise.resolve({ data: [], error: null }),
      assigneeIds.length
        ? supabase.from('profiles').select('id, full_name, avatar_url').in('id', assigneeIds)
        : Promise.resolve({ data: [], error: null }),
      Promise.all(rows.map(async row => {
        const result = await supabase
          .from('messages')
          .select('*')
          .eq('conversation_id', row.id)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(1)
          .maybeSingle();
        return { conversationId: row.id, message: result.data, error: result.error };
      })),
    ]);
    const queryError = contactsResult.error ?? connectionsResult.error ?? profilesResult.error ?? latestMessages.find(item => item.error)?.error;
    if (queryError) return jsonResponse({ error: queryError.message }, 422);

    const contactsById = new Map((contactsResult.data ?? []).map(item => [item.id, item]));
    const connectionsById = new Map((connectionsResult.data ?? []).map(item => [item.id, item]));
    const profilesById = new Map((profilesResult.data ?? []).map(item => [item.id, {
      id: item.id,
      name: item.full_name,
      thumbnail: item.avatar_url,
    }]));
    const messagesByConversationId = new Map(latestMessages.map(item => [item.conversationId, item.message]));
    const payload = rows.map(row => mapConversation(
      row,
      contactsById.get(row.contact_id),
      connectionsById.get(row.provider_connection_id),
      messagesByConversationId.get(row.id) ?? null,
      profilesById.get(row.assigned_to)
    ));

    return jsonResponse({ data: { meta: { all_count: count ?? payload.length }, payload } });
  }

  const conversationId = parseId(url.searchParams.get('conversationId'));
  if (!conversationId) {
    return jsonResponse({ error: 'conversationId_must_be_a_positive_integer' }, 422);
  }

  const { data: conversation, error: conversationError } = await supabase
    .from('conversations')
    .select('id, workspace_id, provider_connection_id, provider, contact_id, assigned_to, status, snoozed_until, unread_count, last_message_at, created_at, updated_at, metadata')
    .eq('workspace_id', workspaceId)
    .eq('id', conversationId)
    .maybeSingle();
  if (conversationError) return jsonResponse({ error: conversationError.message }, 422);
  if (!conversation) return jsonResponse({ error: 'conversation_not_found' }, 404);

  if (action === 'thread') {
    const [contactResult, connectionResult, latestMessageResult, assigneeResult] = await Promise.all([
      supabase.from('contacts').select('*').eq('id', conversation.contact_id).maybeSingle(),
      supabase.from('provider_connections').select('id, status').eq('id', conversation.provider_connection_id).maybeSingle(),
      supabase.from('messages').select('*').eq('conversation_id', conversation.id)
        .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1).maybeSingle(),
      conversation.assigned_to
        ? supabase.from('profiles').select('id, full_name, avatar_url').eq('id', conversation.assigned_to).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    const queryError = contactResult.error ?? connectionResult.error ?? latestMessageResult.error ?? assigneeResult.error;
    if (queryError) return jsonResponse({ error: queryError.message }, 422);
    const sender = mapContact(contactResult.data);
    const assignee = assigneeResult.data
      ? { id: assigneeResult.data.id, name: assigneeResult.data.full_name, thumbnail: assigneeResult.data.avatar_url }
      : undefined;
    const result = mapConversation(conversation, contactResult.data, connectionResult.data, latestMessageResult.data, assignee);
    return jsonResponse({ ...result, meta: { ...result.meta, contact: sender, labels: [], additional_attributes: conversation.metadata ?? {} } });
  }

  if (action === 'messages') {
    const beforeId = url.searchParams.get('before') ? parseId(url.searchParams.get('before')) : null;
    const afterId = url.searchParams.get('after') ? parseId(url.searchParams.get('after')) : null;
    if (url.searchParams.has('before') && !beforeId) {
      return jsonResponse({ error: 'before_must_be_a_positive_integer' }, 422);
    }
    if (url.searchParams.has('after') && !afterId) {
      return jsonResponse({ error: 'after_must_be_a_positive_integer' }, 422);
    }

    const { data: orderedMessages, error } = await readMessagePage(
      supabase.from('messages').select('*').eq('conversation_id', conversation.id),
      beforeId,
      afterId
    );
    if (error) return jsonResponse({ error: error.message }, 422);
    const authorIds = [...new Set(orderedMessages.map(message => message.author_user_id).filter(Boolean))];
    const [contactResult, authorsResult] = await Promise.all([
      supabase.from('contacts').select('*').eq('id', conversation.contact_id).maybeSingle(),
      authorIds.length
        ? supabase.from('profiles').select('id, full_name, avatar_url').in('id', authorIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const detailError = contactResult.error ?? authorsResult.error;
    if (detailError) return jsonResponse({ error: detailError.message }, 422);
    const contact = mapContact(contactResult.data);
    const authorsById = new Map((authorsResult.data ?? []).map(author => [author.id, author]));
    return jsonResponse({
      meta: { labels: [], additional_attributes: conversation.metadata ?? {} },
      payload: orderedMessages.map(message => mapMessage(
        message,
        conversation.provider_connection_id,
        contact,
        authorsById.get(message.author_user_id)
      )),
    });
  }

  return jsonResponse({ error: 'action_must_be_list_thread_or_messages' }, 422);
});
