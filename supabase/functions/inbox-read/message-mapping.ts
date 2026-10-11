function unixSeconds(value: string | null | undefined) {
  return value ? Math.floor(new Date(value).getTime() / 1000) : null;
}

export function mapInboxMessage(
  message: Record<string, any>,
  inboxId: number,
  contact: Record<string, any> | null,
  profile?: Record<string, any>,
  attachments: Array<Record<string, any>> = []
) {
  const isInbound =
    message.direction === 'inbound' || message.direction === 'incoming';
  const isOutbound =
    message.direction === 'outbound' || message.direction === 'outgoing';
  // RelayDesk stores privacy as a boolean; the fresh prototype schema stores
  // notes as a direction. Its direction enum also uses incoming/outgoing and
  // internal, while the prototype uses inbound/outbound/note.
  const isPrivate =
    message.private === true ||
    message.direction === 'note' ||
    message.direction === 'internal';
  const authorUserId = message.author_user_id ?? message.sender_user_id;
  const status =
    message.delivery_status ??
    (message.failed_at
      ? 'failed'
      : message.read_at
        ? 'read'
        : message.delivered_at
          ? 'delivered'
          : 'sent');

  return {
    id: message.id,
    content: message.content,
    inbox_id: inboxId,
    conversation_id: message.conversation_id,
    message_type: isPrivate ? 2 : isInbound ? 0 : isOutbound ? 1 : 2,
    content_type: 'text',
    status: status === 'queued' ? 'pending' : status,
    content_attributes: message.metadata ?? {},
    created_at: unixSeconds(message.created_at),
    private: isPrivate,
    sender: authorUserId
      ? {
          id: authorUserId,
          name: profile?.full_name ?? message.author_name,
          thumbnail: profile?.avatar_url,
        }
      : isInbound
        ? contact
        : { id: null, name: message.author_name },
    attachments,
  };
}
