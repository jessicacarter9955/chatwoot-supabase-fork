const SIGNED_URL_TTL_SECONDS = 60 * 60;

export function mapInboxAttachment(
  attachment: Record<string, any>,
  signedUrl: string,
  workspaceId: number
) {
  const mimeType = String(attachment.content_type ?? '').toLowerCase();
  const fileType = mimeType.startsWith('image/')
    ? 'image'
    : mimeType.startsWith('audio/')
      ? 'audio'
      : mimeType.startsWith('video/')
        ? 'video'
        : 'file';
  const extension = attachment.file_name?.includes('.')
    ? attachment.file_name.split('.').pop()?.toLowerCase()
    : null;

  return {
    id: attachment.id,
    message_id: attachment.message_id,
    file_type: fileType,
    account_id: workspaceId,
    extension: extension || null,
    content_type: attachment.content_type ?? null,
    data_url: signedUrl,
    thumb_url: fileType === 'image' ? signedUrl : '',
    file_size: attachment.byte_size ?? null,
    width: attachment.width ?? null,
    height: attachment.height ?? null,
  };
}

export async function readInboxAttachments(
  supabase: any,
  messages: Array<Record<string, any>>,
  workspaceId: number
) {
  const messageIds = [...new Set(messages.map(message => message.id))];
  if (!messageIds.length) return { data: new Map(), error: null };

  const result = await supabase
    .from('message_attachments')
    .select(
      'id, message_id, storage_path, file_name, content_type, byte_size, width, height'
    )
    .in('message_id', messageIds)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (result.error) return { data: null, error: result.error };

  const rows = result.data ?? [];
  if (!rows.length) return { data: new Map(), error: null };

  const signedResult = await supabase.storage
    .from('message-attachments')
    .createSignedUrls(
      rows.map(row => row.storage_path),
      SIGNED_URL_TTL_SECONDS
    );
  if (signedResult.error) return { data: null, error: signedResult.error };

  const urlsByPath = new Map(
    (signedResult.data ?? [])
      .filter((row: Record<string, any>) => row.signedUrl)
      .map((row: Record<string, any>) => [row.path, row.signedUrl])
  );
  const missingUrl = rows.some(row => !urlsByPath.has(row.storage_path));
  if (missingUrl) {
    return {
      data: null,
      error: new Error('attachment_signed_url_unavailable'),
    };
  }

  const byMessage = new Map();
  for (const row of rows) {
    const files = byMessage.get(row.message_id) ?? [];
    files.push(
      mapInboxAttachment(row, urlsByPath.get(row.storage_path), workspaceId)
    );
    byMessage.set(row.message_id, files);
  }
  return { data: byMessage, error: null };
}
