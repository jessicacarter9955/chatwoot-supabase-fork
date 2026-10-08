// Preserve Chatwoot MessageFinder's latest, before, after, and between semantics.
export async function readMessagePage(
  query: any,
  before: number | null,
  after: number | null
) {
  const ascending = after !== null;
  if (before !== null && after !== null) {
    query = query.gte('id', after).lt('id', before);
  } else if (before !== null) {
    query = query.lt('id', before);
  } else if (after !== null) {
    query = query.gt('id', after);
  }
  const limit = before !== null && after !== null ? 1000 : ascending ? 100 : 20;
  const { data, error } = await query
    .order('created_at', { ascending })
    .order('id', { ascending })
    .limit(limit);
  return {
    data: ascending ? (data ?? []) : [...(data ?? [])].reverse(),
    error,
  };
}
