export async function readConversationCounts(
  supabase: any,
  workspaceId: number,
  authUserId: string
) {
  const profile = await supabase
    .from('profiles')
    .select('id')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (profile.error) return { data: null, error: profile.error };

  const baseQuery = () =>
    supabase
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId);

  const [all, mine, unassigned] = await Promise.all([
    baseQuery(),
    profile.data
      ? baseQuery().eq('assigned_to', profile.data.id)
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
