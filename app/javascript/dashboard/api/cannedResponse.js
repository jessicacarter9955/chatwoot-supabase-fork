import CacheEnabledApiClient from './CacheEnabledApiClient';
import {
  getSupabaseClient,
  getSupabaseCurrentUser,
  isSupabaseAuthEnabled,
} from './supabaseClient';

const mapQuickReply = (quickReply, workspaceId) => ({
  id: quickReply.id,
  account_id: workspaceId,
  short_code: quickReply.shortcut,
  content: quickReply.body,
  created_at: quickReply.created_at,
  updated_at: quickReply.updated_at,
});

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

    const workspaceId = Number(this.accountIdFromRoute);
    const { data, error } = await getSupabaseClient()
      .from('quick_replies')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('shortcut', { ascending: true });
    if (error) throw new Error(error.message);
    return { data: (data || []).map(reply => mapQuickReply(reply, workspaceId)) };
  }

  async create({ short_code: shortcut, content: body }) {
    if (!isSupabaseAuthEnabled()) {
      return super.create({ short_code: shortcut, content: body });
    }

    const workspaceId = Number(this.accountIdFromRoute);
    const currentUser = await getSupabaseCurrentUser();
    const { data, error } = await getSupabaseClient()
      .from('quick_replies')
      .insert({
        workspace_id: workspaceId,
        shortcut,
        title: shortcut,
        body,
        created_by: currentUser.id,
      })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return { data: mapQuickReply(data, workspaceId) };
  }

  async update(id, { short_code: shortcut, content: body }) {
    if (!isSupabaseAuthEnabled()) {
      return super.update(id, { short_code: shortcut, content: body });
    }

    const workspaceId = Number(this.accountIdFromRoute);
    const { data, error } = await getSupabaseClient()
      .from('quick_replies')
      .update({ shortcut, title: shortcut, body })
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return { data: mapQuickReply(data, workspaceId) };
  }

  async delete(id) {
    if (!isSupabaseAuthEnabled()) return super.delete(id);

    const { error } = await getSupabaseClient()
      .from('quick_replies')
      .delete()
      .eq('workspace_id', Number(this.accountIdFromRoute))
      .eq('id', id);
    if (error) throw new Error(error.message);
    return { data: { id: Number(id) } };
  }
}

export default new CannedResponse();
