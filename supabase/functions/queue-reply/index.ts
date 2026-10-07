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

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) {
    return jsonResponse({ error: 'supabase_environment_not_configured' }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const conversationId = body.conversationId;
  const content = body.content;
  const clientRequestId = body.clientRequestId;
  const scheduledAt = body.scheduledAt;
  const positiveIntegerPattern = /^[1-9]\d*$/;
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (
    typeof conversationId !== 'string' ||
    typeof content !== 'string' ||
    typeof clientRequestId !== 'string'
  ) {
    return jsonResponse({ error: 'conversationId, content, and clientRequestId are required' }, 400);
  }
  if (
    !positiveIntegerPattern.test(conversationId) ||
    !Number.isSafeInteger(Number(conversationId)) ||
    !uuidPattern.test(clientRequestId)
  ) {
    return jsonResponse({ error: 'conversationId must be a positive integer and clientRequestId must be a UUID' }, 422);
  }
  if (content.trim().length === 0 || content.length > 50_000) {
    return jsonResponse({ error: 'content_must_be_between_1_and_50000_characters' }, 422);
  }
  if (scheduledAt !== undefined && scheduledAt !== null && typeof scheduledAt !== 'string') {
    return jsonResponse({ error: 'scheduledAt_must_be_an_iso_timestamp' }, 422);
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  const { data, error } = await supabase.rpc('enqueue_reply', {
    p_conversation_id: conversationId,
    p_content: content,
    p_client_request_id: clientRequestId,
    p_scheduled_at: scheduledAt ?? null,
  });

  if (error) {
    const status = error.code === 'P0002' ? 404 : error.code === '28000' ? 401 : 422;
    return jsonResponse({ error: error.message, code: error.code }, status);
  }

  return jsonResponse({ message: data }, 202);
});
