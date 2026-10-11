-- Fresh-schema attachment metadata only. Never apply this prototype migration
-- to RelayDesk; its existing UUID-first schema needs a reviewed adapter plan.
create table public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id bigint not null references public.messages(id) on delete cascade,
  storage_path text not null,
  file_name text,
  content_type text,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  width integer check (width is null or width >= 0),
  height integer check (height is null or height >= 0),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index message_attachments_message_idx
  on public.message_attachments (message_id, created_at, id);

comment on table public.message_attachments is
  'Attachment metadata. Files live in the private message-attachments Storage bucket; storage_path is never a public URL.';

alter table public.message_attachments enable row level security;

create policy message_attachments_select_member on public.message_attachments
  for select to authenticated using (
    exists (
      select 1 from public.messages m
      where m.id = message_attachments.message_id
        and public.is_workspace_member(m.workspace_id)
    )
  );

grant select on public.message_attachments to authenticated;
grant all on public.message_attachments to service_role;

insert into storage.buckets (id, name, public)
values ('message-attachments', 'message-attachments', false)
on conflict (id) do update set public = false;

create policy message_attachments_storage_select_member on storage.objects
  for select to authenticated using (
    bucket_id = 'message-attachments'
    and case
      when (storage.foldername(name))[1] ~ '^[0-9]+$'
        then public.is_workspace_member(((storage.foldername(name))[1])::bigint)
      else false
    end
  );
