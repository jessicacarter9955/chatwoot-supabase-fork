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
  const status = body.status;
  const snoozedUntil = body.snoozedUntil;
  if (typeof conversationId !== 'string' || typeof status !== 'string') {
    return jsonResponse({ error: 'conversationId and status are required' }, 400);
  }
  if (!/^[1-9]\d*$/.test(conversationId) || !Number.isSafeInteger(Number(conversationId))) {
    return jsonResponse({ error: 'conversationId_must_be_a_positive_integer' }, 422);
  }
  if (!['open', 'pending', 'resolved', 'snoozed'].includes(status)) {
    return jsonResponse({ error: 'status_must_be_open_pending_resolved_or_snoozed' }, 422);
  }
  if (
    snoozedUntil !== undefined &&
    snoozedUntil !== null &&
    (typeof snoozedUntil !== 'string' || !Number.isFinite(Date.parse(snoozedUntil)))
  ) {
    return jsonResponse({ error: 'snoozedUntil_must_be_an_iso_timestamp' }, 422);
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  const { data, error } = await supabase.rpc('set_conversation_status', {
    p_conversation_id: conversationId,
    p_status: status,
    p_snoozed_until: snoozedUntil ?? null,
  });
  if (error) {
    const httpStatus = error.code === 'P0002' ? 404 : error.code === '28000' ? 401 : 422;
    return jsonResponse({ error: error.message, code: error.code }, httpStatus);
  }

  return jsonResponse({ conversation: data }, 200);
});
