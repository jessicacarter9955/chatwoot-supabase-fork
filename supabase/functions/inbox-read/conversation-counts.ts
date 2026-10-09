export async function resolveInboxProfileId(supabase: any, authUserId: string) {
  const profile = await supabase
    .from('profiles')
    .select('id')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (profile.error) return { data: null, error: profile.error };
  if (!profile.data) {
    return { data: null, error: new Error('authenticated_profile_not_found') };
  }
  return { data: profile.data.id, error: null };
}

export async function readConversationCounts(
  supabase: any,
  workspaceId: number,
  authUserId: string,
  status: string,
  resolvedProfileId?: number
) {
  const profile =
    resolvedProfileId === undefined
      ? await resolveInboxProfileId(supabase, authUserId)
      : { data: resolvedProfileId, error: null };
  if (profile.error) return { data: null, error: profile.error };

  const baseQuery = () => {
    let query = supabase
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId);
    if (status !== 'all') query = query.eq('status', status);
    return query;
  };

  const [all, mine, unassigned] = await Promise.all([
    baseQuery(),
    profile.data
      ? baseQuery().eq('assigned_to', profile.data)
      : Promise.resolve({ count: 0, error: null }),
    baseQuery().is('assigned_to', null),
  ]);
  const error = all.error ?? mine.error ?? unassigned.error;
  if (error) return { data: null, error };

  const allCount = all.count ?? 0;
  const unassignedCount = unassigned.count ?? 0;
  return {
    data: {
      mine_count: mine.count ?? 0,
      unassigned_count: unassignedCount,
      assigned_count: allCount - unassignedCount,
      all_count: allCount,
    },
    error: null,
  };
}

export function filterInboxConversations(
  query: any,
  assigneeType: string,
  profileId: number
) {
  switch (assigneeType) {
    case 'me':
      return query.eq('assigned_to', profileId);
    case 'unassigned':
      return query.is('assigned_to', null);
    case 'assigned':
      return query.not('assigned_to', 'is', null);
    default:
      return query;
  }
}
