import CacheEnabledApiClient from './CacheEnabledApiClient';
import {
  getSupabaseClient,
  getSupabaseCurrentUser,
  isSupabaseAuthEnabled,
  isRelayDeskSchema,
} from './supabaseClient';

const mapQuickReply = (quickReply, workspaceId) => ({
  id: quickReply.chatwoot_id ?? quickReply.id,
  account_id: workspaceId,
  short_code: quickReply.short_code ?? quickReply.shortcut,
  content: quickReply.content ?? quickReply.body,
  created_at: quickReply.created_at,
  updated_at: quickReply.updated_at,
});

const resolveWorkspaceId = async (client, chatwootWorkspaceId) => {
  if (!isRelayDeskSchema()) return Number(chatwootWorkspaceId);

  const { data, error } = await client
    .from('workspaces')
    .select('id')
    .eq('chatwoot_id', Number(chatwootWorkspaceId))
    .single();
  if (error) throw new Error(error.message);
  return data.id;
};

class CannedResponse extends CacheEnabledApiClient {
  constructor() {
    super('canned_responses', { accountScoped: true });
  }

  // eslint-disable-next-line class-methods-use-this
  get cacheModelName() {
    return 'canned_response';
  }

  // The index endpoint returns a bare array instead of a payload wrapper
  // eslint-disable-next-line class-methods-use-this
  extractDataFromResponse(response) {
    return response.data;
  }

  // eslint-disable-next-line class-methods-use-this
  marshallData(dataToParse) {
    return { data: dataToParse };
  }

  async get(cache = false) {
    if (!isSupabaseAuthEnabled()) return super.get(cache);

    const client = getSupabaseClient();
    const relayDesk = isRelayDeskSchema();
    const apiWorkspaceId = Number(this.accountIdFromRoute);
    const workspaceId = await resolveWorkspaceId(client, apiWorkspaceId);
    const { data, error } = await client
      .from(relayDesk ? 'canned_responses' : 'quick_replies')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order(relayDesk ? 'short_code' : 'shortcut', { ascending: true });
    if (error) throw new Error(error.message);
    return {
      data: (data || []).map(reply => mapQuickReply(reply, apiWorkspaceId)),
    };
  }

  async create({ short_code: shortcut, content: body }) {
    if (!isSupabaseAuthEnabled()) {
      return super.create({ short_code: shortcut, content: body });
    }

    const client = getSupabaseClient();
    const relayDesk = isRelayDeskSchema();
    const apiWorkspaceId = Number(this.accountIdFromRoute);
    const workspaceId = await resolveWorkspaceId(client, apiWorkspaceId);
    const currentUser = await getSupabaseCurrentUser();
    const { data, error } = await client
      .from(relayDesk ? 'canned_responses' : 'quick_replies')
      .insert({
        workspace_id: workspaceId,
        [relayDesk ? 'short_code' : 'shortcut']: shortcut,
        ...(relayDesk ? {} : { title: shortcut }),
        [relayDesk ? 'content' : 'body']: body,
        created_by: relayDesk ? currentUser.auth_user_id : currentUser.id,
      })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return { data: mapQuickReply(data, apiWorkspaceId) };
  }

  async update(id, { short_code: shortcut, content: body }) {
    if (!isSupabaseAuthEnabled()) {
      return super.update(id, { short_code: shortcut, content: body });
    }

    const client = getSupabaseClient();
    const relayDesk = isRelayDeskSchema();
    const apiWorkspaceId = Number(this.accountIdFromRoute);
    const workspaceId = await resolveWorkspaceId(client, apiWorkspaceId);
    let query = client
      .from(relayDesk ? 'canned_responses' : 'quick_replies')
      .update({
        [relayDesk ? 'short_code' : 'shortcut']: shortcut,
        ...(relayDesk ? {} : { title: shortcut }),
        [relayDesk ? 'content' : 'body']: body,
      })
      .eq('workspace_id', workspaceId)
      .eq(relayDesk ? 'chatwoot_id' : 'id', relayDesk ? Number(id) : id)
      .select('*')
      .single();
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return { data: mapQuickReply(data, apiWorkspaceId) };
  }

  async delete(id) {
    if (!isSupabaseAuthEnabled()) return super.delete(id);

    const client = getSupabaseClient();
    const relayDesk = isRelayDeskSchema();
    const workspaceId = await resolveWorkspaceId(
      client,
      Number(this.accountIdFromRoute)
    );
    const { error } = await client
      .from(relayDesk ? 'canned_responses' : 'quick_replies')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq(relayDesk ? 'chatwoot_id' : 'id', relayDesk ? Number(id) : id);
    if (error) throw new Error(error.message);
    return { data: { id: Number(id) } };
  }
}

export default new CannedResponse();
