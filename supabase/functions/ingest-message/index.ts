import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  const expectedSecret = Deno.env.get('INGEST_WEBHOOK_SECRET');
  const suppliedSecret = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!expectedSecret || suppliedSecret !== expectedSecret) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'supabase_environment_not_configured' }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const requiredStrings = [
    'providerConnectionId',
    'contactExternalId',
    'conversationExternalId',
    'content',
  ] as const;
  if (requiredStrings.some(key => typeof body[key] !== 'string')) {
    return jsonResponse({ error: 'providerConnectionId, contactExternalId, conversationExternalId, and content are required' }, 400);
  }
  if (!/^[1-9]\d*$/.test(String(body.providerConnectionId))) {
    return jsonResponse({ error: 'providerConnectionId_must_be_a_positive_integer' }, 422);
  }
  if (!['inbound', 'outbound'].includes(String(body.direction ?? 'inbound'))) {
    return jsonResponse({ error: 'direction_must_be_inbound_or_outbound' }, 422);
  }
  if (String(body.content).length > 50_000) {
    return jsonResponse({ error: 'content_exceeds_50000_characters' }, 422);
  }
  if (
    body.metadata !== undefined &&
    (body.metadata === null || typeof body.metadata !== 'object' || Array.isArray(body.metadata))
  ) {
    return jsonResponse({ error: 'metadata_must_be_an_object' }, 422);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc('ingest_provider_message', {
    p_provider_connection_id: body.providerConnectionId,
    p_contact_external_id: body.contactExternalId,
    p_contact_handle: typeof body.contactHandle === 'string' ? body.contactHandle : null,
    p_contact_name: typeof body.contactName === 'string' ? body.contactName : null,
    p_avatar_url: typeof body.avatarUrl === 'string' ? body.avatarUrl : null,
    p_conversation_external_id: body.conversationExternalId,
    p_subject: typeof body.subject === 'string' ? body.subject : null,
    p_message_external_id: typeof body.messageExternalId === 'string' ? body.messageExternalId : null,
    p_direction: body.direction ?? 'inbound',
    p_content: body.content,
    p_occurred_at: typeof body.occurredAt === 'string' ? body.occurredAt : null,
    p_metadata: body.metadata ?? {},
  });

  if (error) {
    const status = error.code === 'P0002' ? 404 : 422;
    return jsonResponse({ error: error.message, code: error.code }, status);
  }

  return jsonResponse(data, 200);
});
