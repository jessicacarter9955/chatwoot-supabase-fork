import { getSupabaseClient } from './supabaseClient';

const functionErrorMessage = async error => {
  if (error?.context instanceof Response) {
    try {
      const body = await error.context.json();
      return body.error || error.message;
    } catch {
      return error.message;
    }
  }
  return error?.message || 'Supabase request failed';
};

const invokeFunction = async (name, body) => {
  const { data, error } = await getSupabaseClient().functions.invoke(name, {
    body,
  });
  if (error) throw new Error(await functionErrorMessage(error));
  return { data };
};

const invokeRead = async params => {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.getSession();
  if (error) throw new Error(error.message);
  if (!data.session?.access_token) {
    throw new Error('A Supabase session is required to read the inbox');
  }

  const { SUPABASE_URL: url, SUPABASE_ANON_KEY: anonKey } =
    window.globalConfig || {};
  const endpoint = new URL(`${url.replace(/\/$/, '')}/functions/v1/inbox-read`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      endpoint.searchParams.set(key, String(value));
    }
  });

  const response = await fetch(endpoint, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${data.session.access_token}`,
    },
  });
  const responseData = await response.json();
  if (!response.ok) {
    throw new Error(responseData.error || 'Unable to read the Supabase inbox');
  }
  return { data: responseData };
};

export default {
  list({ workspaceId, status = 'open', page = 1 }) {
    return invokeRead({
      action: 'list',
      workspaceId,
      status,
      page,
    });
  },

  show({ workspaceId, conversationId }) {
    return invokeRead({ action: 'thread', workspaceId, conversationId });
  },

  messages({ workspaceId, conversationId, before, after }) {
    return invokeRead({
      action: 'messages',
      workspaceId,
      conversationId,
      before,
      after,
    });
  },

  setStatus({ conversationId, status, snoozedUntil }) {
    const snoozedUntilIso =
      typeof snoozedUntil === 'number'
        ? new Date(snoozedUntil * 1000).toISOString()
        : snoozedUntil;
    return invokeFunction('update-conversation-status', {
      conversationId: String(conversationId),
      status,
      snoozedUntil: snoozedUntilIso,
    }).then(({ data }) => ({
      data: {
        payload: {
          success: true,
          conversation_id: data.conversation.id,
          current_status: data.conversation.status,
          snoozed_until: data.conversation.snoozed_until,
        },
      },
    }));
  },

  queueReply({ conversationId, content, scheduledAt, clientRequestId }) {
    return invokeFunction('queue-reply', {
      conversationId: String(conversationId),
      content,
      scheduledAt,
      clientRequestId: clientRequestId || crypto.randomUUID(),
    }).then(({ data }) => {
      const message = data.message;
      return {
        data: {
          ...message,
          echo_id: clientRequestId || message.id,
          message_type: 1,
          content_type: 'text',
          sender: {
            id: message.author_user_id,
            name: message.author_name,
          },
          status: message.delivery_status === 'queued' ? 'pending' : message.delivery_status,
          created_at: Math.floor(new Date(message.created_at).getTime() / 1000),
          private: false,
          attachments: [],
        },
      };
    });
  },
};
