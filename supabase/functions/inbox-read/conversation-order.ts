export function orderInboxConversations(query: any) {
  return query
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false });
}
