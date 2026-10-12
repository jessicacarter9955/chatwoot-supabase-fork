import { createClient } from '@supabase/supabase-js';

let supabaseClient;

export const isSupabaseAuthEnabled = () =>
  window.globalConfig?.SUPABASE_AUTH_ENABLED === true;

export const isRelayDeskSchema = () =>
  window.globalConfig?.SUPABASE_SCHEMA === 'relaydesk';

export const toChatwootId = value => {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error('RelayDesk record is missing a valid Chatwoot ID');
  }
  return id;
};

export const getSupabaseClient = () => {
  if (supabaseClient) return supabaseClient;

  const { SUPABASE_URL: url, SUPABASE_ANON_KEY: anonKey } =
    window.globalConfig || {};
  if (!url || !anonKey) {
    throw new Error('Supabase URL and anon key are not configured');
  }

  // The anon key is public by design; access is restricted by Supabase Auth and RLS.
  supabaseClient = createClient(url, anonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  });

  return supabaseClient;
};

export const getSupabaseCurrentUser = async () => {
  const client = getSupabaseClient();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError) throw new Error(userError.message);
  if (!userData.user) return null;

  const relayDesk = isRelayDeskSchema();
  const profileQuery = client
    .from('profiles')
    .select(
      relayDesk
        ? 'id, full_name, avatar_url, chatwoot_id'
        : 'id, full_name, avatar_url'
    )
    .eq(relayDesk ? 'id' : 'auth_user_id', userData.user.id);
  const { data: profile, error: profileError } = await profileQuery.single();
  if (profileError) throw new Error(profileError.message);
  const chatwootUserId = relayDesk
    ? toChatwootId(profile.chatwoot_id)
    : profile.id;

  const { data: memberships, error: membershipsError } = await client
    .from('workspace_members')
    .select('workspace_id, role')
    .eq('user_id', profile.id);
  if (membershipsError) throw new Error(membershipsError.message);

  const workspaceIds = (memberships || []).map(item => item.workspace_id);
  const { data: workspaces, error: workspacesError } = workspaceIds.length
    ? await client
        .from('workspaces')
        .select(
          relayDesk
            ? 'id, name, created_at, chatwoot_id'
            : 'id, name, created_at'
        )
        .in('id', workspaceIds)
    : { data: [], error: null };
  if (workspacesError) throw new Error(workspacesError.message);
  const roleByWorkspace = new Map(
    memberships.map(item => [item.workspace_id, item.role])
  );
  const accounts = (workspaces || []).map(workspace => {
    const role = roleByWorkspace.get(workspace.id);
    return {
      id: relayDesk ? toChatwootId(workspace.chatwoot_id) : workspace.id,
      ...(relayDesk ? { supabase_id: workspace.id } : {}),
      name: workspace.name,
      role: role === 'owner' || role === 'admin' ? 'administrator' : 'agent',
      status: 'active',
      locale: 'en',
      created_at: workspace.created_at,
      features: {},
    };
  });

  return {
    id: chatwootUserId,
    ...(relayDesk ? { supabase_id: profile.id } : {}),
    auth_user_id: userData.user.id,
    name: profile.full_name || userData.user.email,
    email: userData.user.email,
    avatar_url: profile.avatar_url,
    account_id: accounts[0]?.id ?? null,
    accounts,
    ui_settings: {},
    pubsub_token: null,
  };
};
