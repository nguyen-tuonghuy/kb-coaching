create function private.can_read_training_session_row(p_group_id uuid, p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.coaching_group_coaches c
    where c.group_id = p_group_id and c.user_id = auth.uid()
  ) or exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id and wm.user_id = auth.uid()
      and wm.role in ('owner', 'admin', 'coach')
  );
$$;

revoke all on function private.can_read_training_session_row(uuid, uuid) from public, anon, authenticated;
grant execute on function private.can_read_training_session_row(uuid, uuid) to authenticated;

alter policy training_sessions_raw_staff_only on public.training_sessions
using (private.can_read_training_session_row(group_id, workspace_id));
