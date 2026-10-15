-- Une analyse vidéo peut être partagée avec un commentaire global ou avec au
-- moins un repère enregistré. Le statut reviewed reste l'unique indicateur de
-- publication et aucun repère n'est modifié par cette fonction.

alter table public.coaching_player_videos
  alter column review_text drop not null;

create or replace function public.review_player_video(
  p_group_id uuid,
  p_video_id uuid,
  p_review_text text
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_text text;
begin
  if auth.uid() is null or not private.is_group_coach(p_group_id) then
    raise exception 'Accès entraîneur refusé';
  end if;

  v_text := nullif(btrim(coalesce(p_review_text, '')), '');

  if char_length(v_text) > 5000 then
    raise exception 'Retour trop long';
  end if;

  if v_text is null then
    perform 1
    from public.coaching_player_video_notes n
    where n.video_id = p_video_id
      and n.group_id = p_group_id
    limit 1
    for key share;

    if not found then
      raise exception 'Analyse vide';
    end if;
  end if;

  update public.coaching_player_videos
  set status = 'reviewed',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_text = case
        when v_text is null and status = 'reviewed' then review_text
        else v_text
      end,
      feedback_synced_at = null,
      feedback_sync_error = null
  where id = p_video_id
    and group_id = p_group_id;

  if not found then
    raise exception 'Vidéo introuvable';
  end if;

  insert into public.coaching_player_video_reads(video_id, user_id)
  values(p_video_id, auth.uid())
  on conflict(video_id, user_id)
  do update set seen_at = now();
end
$function$;

-- CREATE OR REPLACE conserve le propriétaire et les privilèges EXECUTE de la
-- fonction déployée. SECURITY DEFINER reste nécessaire pour les écritures ; la
-- garde private.is_group_coach demeure l'autorité d'accès.
