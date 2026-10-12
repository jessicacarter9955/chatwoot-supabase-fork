const ALLOWED_STATUSES = ['open', 'pending', 'resolved', 'snoozed'];

function fail(message: string, status = 422) {
  return { body: { error: message }, status };
}

function positiveInteger(value: unknown) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function updateRelayDeskConversationStatus(
  supabase: any,
  {
    workspaceChatwootId,
    conversationChatwootId,
    status,
    snoozedUntil,
  }: {
    workspaceChatwootId: number;
    conversationChatwootId: number;
    status: string;
    snoozedUntil?: string | null;
  }
) {
  const workspaceId = positiveInteger(workspaceChatwootId);
  const conversationId = positiveInteger(conversationChatwootId);
  if (!workspaceId) return fail('workspaceId_must_be_a_positive_integer');
  if (!conversationId) return fail('conversationId_must_be_a_positive_integer');
  if (!ALLOWED_STATUSES.includes(status)) {
    return fail('status_must_be_open_pending_resolved_or_snoozed');
  }
  if (
    status === 'snoozed' &&
    (!snoozedUntil || !Number.isFinite(Date.parse(snoozedUntil)))
  ) {
    return fail('snoozedUntil_must_be_a_valid_future_timestamp');
  }
  if (
    status === 'snoozed' &&
    Date.parse(snoozedUntil as string) <= Date.now()
  ) {
    return fail('snoozedUntil_must_be_a_valid_future_timestamp');
  }

  const { data: workspace, error: workspaceError } = await supabase
    .from('workspaces')
    .select('id')
    .eq('chatwoot_id', workspaceId)
    .maybeSingle();
  if (workspaceError) return fail(workspaceError.message);
  if (!workspace) return fail('workspace_not_found', 404);

  const { data: candidates, error: conversationError } = await supabase
    .from('conversations')
    .select('id, display_id')
    .eq('workspace_id', workspace.id)
    .eq('display_id', conversationId)
    .limit(2);
  if (conversationError) return fail(conversationError.message);
  if ((candidates ?? []).length > 1) {
    return fail('conversation_display_id_is_ambiguous', 409);
  }
  const candidate = candidates?.[0];
  if (!candidate) return fail('conversation_not_found', 404);

  const { data: conversation, error } = await supabase
    .from('conversations')
    .update({
      status,
      snoozed_until: status === 'snoozed' ? snoozedUntil : null,
      resolved_at: status === 'resolved' ? new Date().toISOString() : null,
    })
    .eq('workspace_id', workspace.id)
    .eq('id', candidate.id)
    .select('id, display_id, status, snoozed_until, updated_at')
    .maybeSingle();
  if (error) {
    return fail(error.message, error.code === '42501' ? 403 : 422);
  }
  if (!conversation) return fail('conversation_not_found', 404);
  return {
    status: 200,
    body: {
      conversation: {
        id: conversation.display_id,
        status: conversation.status,
        snoozed_until: conversation.snoozed_until,
      },
    },
  };
}
