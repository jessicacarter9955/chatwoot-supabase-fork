export async function readPerUserUnreadCounts(
  supabase: any,
  workspaceId: number,
  userId: number,
  conversations: Array<Record<string, any>>
) {
  const rows = conversations ?? [];
  if (!rows.length) return { data: new Map(), error: null };

  const { data: cursors, error: cursorError } = await supabase
    .from('conversation_reads')
    .select('conversation_id, last_read_at')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .in(
      'conversation_id',
      rows.map(conversation => conversation.id)
    );
  if (cursorError) return { data: null, error: cursorError };

  const cursorByConversationId = new Map(
    (cursors ?? []).map((cursor: Record<string, any>) => [
      cursor.conversation_id,
      cursor.last_read_at,
    ])
  );
  const counts = await Promise.all(
    rows.map(async conversation => {
      const lastReadAt = cursorByConversationId.get(conversation.id);
      if (!lastReadAt) {
        return {
          conversationId: conversation.id,
          count: conversation.unread_count ?? 0,
          error: null,
        };
      }

      const result = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('conversation_id', conversation.id)
        .eq('direction', 'inbound')
        .gt('created_at', lastReadAt);
      return {
        conversationId: conversation.id,
        count: result.count,
        error: result.error,
      };
    })
  );
  const error = counts.find(item => item.error)?.error;
  if (error) return { data: null, error };
  return {
    data: new Map(counts.map(item => [item.conversationId, item.count ?? 0])),
    error: null,
  };
}
