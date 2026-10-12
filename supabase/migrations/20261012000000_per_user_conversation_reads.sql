create table public.conversation_reads (
  workspace_id bigint not null references public.workspaces(id) on delete cascade,
  conversation_id bigint not null,
  user_id bigint not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  last_read_message_id bigint references public.messages(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id),
  foreign key (conversation_id, workspace_id)
    references public.conversations(id, workspace_id) on delete cascade
);

alter table public.conversation_reads enable row level security;

create policy conversation_reads_select_own on public.conversation_reads
  for select to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and user_id = (
      select p.id from public.profiles p where p.auth_user_id = auth.uid()
    )
  );
create policy conversation_reads_insert_own on public.conversation_reads
  for insert to authenticated
  with check (
    public.is_workspace_member(workspace_id)
    and user_id = (
      select p.id from public.profiles p where p.auth_user_id = auth.uid()
    )
  );
create policy conversation_reads_update_own on public.conversation_reads
  for update to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and user_id = (
      select p.id from public.profiles p where p.auth_user_id = auth.uid()
    )
  )
  with check (
    public.is_workspace_member(workspace_id)
    and user_id = (
      select p.id from public.profiles p where p.auth_user_id = auth.uid()
    )
  );
create policy conversation_reads_delete_own on public.conversation_reads
  for delete to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and user_id = (
      select p.id from public.profiles p where p.auth_user_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.conversation_reads to authenticated;
