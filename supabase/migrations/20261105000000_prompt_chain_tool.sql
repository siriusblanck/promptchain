-- MoPC prompt chain tool: step-by-step run history, atomic step append/reorder/delete,
-- a private bucket for run images, and the assignment's example chain. Additive: the only
-- change to an existing object makes the step-order unique constraint DEFERRABLE, which
-- leaves single-row writes from the other apps unchanged.
--
-- Same house rule as the admin catalog: RLS on with no policies, anon/authenticated
-- revoked, functions executable by service_role only (used after requireAdmin()).

-- 1. Step order: checked at end of statement so one UPDATE can renumber a chain.
alter table public.prompt_chain_steps
  drop constraint prompt_chain_steps_prompt_chain_id_step_order_key;
alter table public.prompt_chain_steps
  add constraint prompt_chain_steps_prompt_chain_id_step_order_key
  unique (prompt_chain_id, step_order) deferrable initially immediate;

-- 2. Runs ------------------------------------------------------------------------------
create table public.prompt_chain_runs (
  id uuid primary key default gen_random_uuid(),
  prompt_chain_id uuid not null references public.prompt_chains(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  input_text text check (input_text is null or char_length(btrim(input_text)) between 1 and 2000),
  input_image_path text check (input_image_path is null or char_length(input_image_path) <= 300),
  input_image_width integer check (input_image_width is null or input_image_width > 0),
  input_image_height integer check (input_image_height is null or input_image_height > 0),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  error_message text check (error_message is null or char_length(error_message) <= 600),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint prompt_chain_runs_has_input check (input_text is not null or input_image_path is not null)
);
create index prompt_chain_runs_chain_created_idx on public.prompt_chain_runs (prompt_chain_id, created_at desc);
create index prompt_chain_runs_requester_created_idx on public.prompt_chain_runs (requested_by, created_at desc);
alter table public.prompt_chain_runs enable row level security;
revoke all on public.prompt_chain_runs from anon, authenticated;
comment on table public.prompt_chain_runs is 'Prompt chain tool only: service role access, no RLS policies.';

-- 3. Run steps: snapshot of each step at run start, plus its output ----------------------
create table public.prompt_chain_run_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.prompt_chain_runs(id) on delete cascade,
  prompt_chain_step_id uuid references public.prompt_chain_steps(id) on delete set null,
  step_order smallint not null check (step_order between 1 and 20),
  title text not null,
  instructions text not null,
  llm_model_id uuid references public.llm_models(id) on delete set null,
  model_identifier text not null,
  modality text not null check (modality in ('text', 'image')),
  status text not null default 'pending' check (status in ('pending', 'running', 'succeeded', 'failed')),
  output_text text check (output_text is null or char_length(output_text) <= 20000),
  output_image_path text check (output_image_path is null or char_length(output_image_path) <= 300),
  error_message text check (error_message is null or char_length(error_message) <= 600),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  unique (run_id, step_order)
);
create index prompt_chain_run_steps_latest_idx
  on public.prompt_chain_run_steps (prompt_chain_step_id, completed_at desc) where status = 'succeeded';
alter table public.prompt_chain_run_steps enable row level security;
revoke all on public.prompt_chain_run_steps from anon, authenticated;
comment on table public.prompt_chain_run_steps is 'Prompt chain tool only: service role access, no RLS policies.';

-- 4. Step helpers -------------------------------------------------------------------------
create function public.append_prompt_chain_step(p_chain_id uuid, p_title text, p_instructions text, p_model_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_next smallint; v_id uuid;
begin
  select coalesce(max(step_order), 0) + 1 into v_next from public.prompt_chain_steps where prompt_chain_id = p_chain_id;
  if v_next > 20 then raise exception 'chain_step_limit' using errcode = 'P0001'; end if;
  insert into public.prompt_chain_steps (prompt_chain_id, step_order, title, instructions, llm_model_id)
  values (p_chain_id, v_next, p_title, p_instructions, p_model_id) returning id into v_id;
  return v_id;
end $$;

create function public.reorder_prompt_chain_steps(p_chain_id uuid, p_step_ids uuid[])
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_step_ids is null
     or cardinality(p_step_ids) <> (select count(*) from public.prompt_chain_steps where prompt_chain_id = p_chain_id)
     or cardinality(p_step_ids) <> (select count(distinct x) from unnest(p_step_ids) as t(x))
     or exists (select 1 from unnest(p_step_ids) as t(x) where not exists (
          select 1 from public.prompt_chain_steps s where s.id = t.x and s.prompt_chain_id = p_chain_id))
  then
    raise exception 'step_ids_must_match_chain' using errcode = '22023';
  end if;
  update public.prompt_chain_steps s set step_order = o.ord
    from unnest(p_step_ids) with ordinality as o(id, ord)
   where s.id = o.id and s.prompt_chain_id = p_chain_id and s.step_order <> o.ord;
end $$;

create function public.delete_prompt_chain_step(p_step_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_chain uuid;
begin
  delete from public.prompt_chain_steps where id = p_step_id returning prompt_chain_id into v_chain;
  if v_chain is null then raise exception 'step_not_found' using errcode = 'P0002'; end if;
  update public.prompt_chain_steps s set step_order = r.rn
    from (select id, row_number() over (order by step_order) as rn
            from public.prompt_chain_steps where prompt_chain_id = v_chain) r
   where s.id = r.id and s.step_order <> r.rn;
end $$;

-- 5. Run helpers --------------------------------------------------------------------------
create function public.create_prompt_chain_run(
  p_run_id uuid, p_chain_id uuid, p_requested_by uuid, p_input_text text,
  p_input_image_path text, p_input_image_width integer, p_input_image_height integer)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_missing smallint;
begin
  if p_requested_by is not null and (select count(*) from public.prompt_chain_runs
       where requested_by = p_requested_by and created_at > now() - interval '10 minutes') >= 20 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.prompt_chain_steps where prompt_chain_id = p_chain_id) then
    raise exception 'chain_has_no_steps' using errcode = 'P0001';
  end if;
  select s.step_order into v_missing
    from public.prompt_chain_steps s left join public.llm_models m on m.id = s.llm_model_id
   where s.prompt_chain_id = p_chain_id and (m.id is null or not m.is_active)
   order by s.step_order limit 1;
  if v_missing is not null then
    raise exception 'step_%_has_no_active_model', v_missing using errcode = 'P0001';
  end if;
  insert into public.prompt_chain_runs
    (id, prompt_chain_id, requested_by, input_text, input_image_path, input_image_width, input_image_height)
  values (p_run_id, p_chain_id, p_requested_by, nullif(btrim(p_input_text), ''), p_input_image_path,
          p_input_image_width, p_input_image_height);
  insert into public.prompt_chain_run_steps
    (run_id, prompt_chain_step_id, step_order, title, instructions, llm_model_id, model_identifier, modality)
  select p_run_id, s.id, s.step_order, s.title, s.instructions, m.id, m.model_identifier, m.modality
    from public.prompt_chain_steps s join public.llm_models m on m.id = s.llm_model_id
   where s.prompt_chain_id = p_chain_id order by s.step_order;
  return p_run_id;
end $$;

create function public.claim_next_run_step(p_run_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_run public.prompt_chain_runs%rowtype;
  v_step public.prompt_chain_run_steps%rowtype;
  v_prev public.prompt_chain_run_steps%rowtype;
begin
  select * into v_run from public.prompt_chain_runs where id = p_run_id for update;
  if not found then raise exception 'run_not_found' using errcode = 'P0002'; end if;
  if v_run.status <> 'running' then return jsonb_build_object('state', v_run.status); end if;

  select * into v_step from public.prompt_chain_run_steps
   where run_id = p_run_id and status <> 'succeeded' order by step_order limit 1;
  if not found then
    update public.prompt_chain_runs set status = 'succeeded', completed_at = now() where id = p_run_id;
    return jsonb_build_object('state', 'succeeded');
  end if;
  if v_step.status = 'running' then return jsonb_build_object('state', 'busy'); end if;
  if v_step.status = 'failed' then return jsonb_build_object('state', 'failed'); end if;

  update public.prompt_chain_run_steps set status = 'running', started_at = now() where id = v_step.id;
  select * into v_prev from public.prompt_chain_run_steps
   where run_id = p_run_id and step_order < v_step.step_order order by step_order desc limit 1;

  return jsonb_build_object(
    'state', 'claimed',
    'step', jsonb_build_object('id', v_step.id, 'stepOrder', v_step.step_order, 'title', v_step.title,
      'instructions', v_step.instructions, 'modelIdentifier', v_step.model_identifier, 'modality', v_step.modality),
    'runInput', jsonb_build_object('text', v_run.input_text, 'imagePath', v_run.input_image_path),
    'previous', case when v_prev.id is null then null
      else jsonb_build_object('text', v_prev.output_text, 'imagePath', v_prev.output_image_path) end,
    'isLast', not exists (select 1 from public.prompt_chain_run_steps
                          where run_id = p_run_id and step_order > v_step.step_order));
end $$;

-- 6. Execute grants: service role only ------------------------------------------------------
revoke execute on function public.append_prompt_chain_step(uuid, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.reorder_prompt_chain_steps(uuid, uuid[]) from public, anon, authenticated;
revoke execute on function public.delete_prompt_chain_step(uuid) from public, anon, authenticated;
revoke execute on function public.create_prompt_chain_run(uuid, uuid, uuid, text, text, integer, integer) from public, anon, authenticated;
revoke execute on function public.claim_next_run_step(uuid) from public, anon, authenticated;
grant execute on function public.append_prompt_chain_step(uuid, text, text, uuid) to service_role;
grant execute on function public.reorder_prompt_chain_steps(uuid, uuid[]) to service_role;
grant execute on function public.delete_prompt_chain_step(uuid) to service_role;
grant execute on function public.create_prompt_chain_run(uuid, uuid, uuid, text, text, integer, integer) to service_role;
grant execute on function public.claim_next_run_step(uuid) to service_role;

-- 7. Private bucket for run inputs and image outputs (no storage policies: service role only).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chain-runs', 'chain-runs', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- 8. The assignment's example chain: image → description → what's funny → five captions.
with chain as (
  insert into public.prompt_chains (name, description, is_active)
  values ('Five Captions From a Photo',
          'Turns any photo into five short, funny captions: describe it, find the joke, then write the captions.', true)
  returning id
), model as (
  select id from public.llm_models where model_identifier = 'gemini-3.5-flash-lite'
)
insert into public.prompt_chain_steps (prompt_chain_id, step_order, title, llm_model_id, instructions)
select chain.id, v.step_order, v.title, model.id, v.instructions
from chain, model, (values
  (1::smallint, 'Describe the image', 'Describe this image in plain, literal language: who or what is in it, what is happening, the setting and notable details. 3-5 sentences. No jokes yet.'),
  (2::smallint, 'Find the funny', 'You will receive a description of an image. In 2-3 sentences, explain what is absurd, ironic or funny about the scene. Be specific to the details given.'),
  (3::smallint, 'Five captions', 'You will receive a note on what is funny about an image. Write exactly five short, funny captions for it, each under 15 words, numbered 1-5, one per line. No other text.')
) as v(step_order, title, instructions);
