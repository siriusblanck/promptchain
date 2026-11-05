-- Run with execute_sql. Every change is rolled back by the final RAISE.
-- Success = error text 'ALL_CHECKS_PASSED'; any other message names the failed assertion.
do $$
declare c uuid; s1 uuid; s2 uuid; s3 uuid; s4 uuid; m uuid; r uuid; j jsonb;
begin
  select id into m from public.llm_models where model_identifier = 'gemini-3.5-flash-lite';
  insert into public.prompt_chains (name) values ('zz check chain') returning id into c;
  s1 := public.append_prompt_chain_step(c, 'A', 'a', m);
  s2 := public.append_prompt_chain_step(c, 'B', 'b', m);
  s3 := public.append_prompt_chain_step(c, 'C', 'c', m);
  assert (select step_order from public.prompt_chain_steps where id = s3) = 3, 'append numbers 1..n';

  perform public.reorder_prompt_chain_steps(c, array[s2, s1, s3]);
  assert (select step_order from public.prompt_chain_steps where id = s2) = 1, 'reorder moves B to 1';
  assert (select step_order from public.prompt_chain_steps where id = s1) = 2, 'reorder moves A to 2';
  begin
    perform public.reorder_prompt_chain_steps(c, array[s1, s2]);
    raise exception 'reorder accepted a partial list';
  exception when sqlstate '22023' then null;
  end;

  perform public.delete_prompt_chain_step(s1);
  assert (select array_agg(step_order order by step_order) from public.prompt_chain_steps where prompt_chain_id = c)
         = array[1, 2]::smallint[], 'delete renumbers to 1,2';

  r := gen_random_uuid();
  perform public.create_prompt_chain_run(r, c, null, 'hello', null, null, null);
  j := public.claim_next_run_step(r);
  assert j->>'state' = 'claimed' and (j->'step'->>'stepOrder')::int = 1, 'first claim is step 1';
  assert j->'previous' = 'null'::jsonb and j->'runInput'->>'text' = 'hello', 'step 1 gets the run input';
  assert public.claim_next_run_step(r)->>'state' = 'busy', 'a running step is busy';
  update public.prompt_chain_run_steps set status = 'succeeded', output_text = 'out1' where run_id = r and step_order = 1;
  j := public.claim_next_run_step(r);
  assert j->'previous'->>'text' = 'out1' and (j->>'isLast')::boolean, 'step 2 gets step 1 output and is last';
  update public.prompt_chain_run_steps set status = 'succeeded' where run_id = r and step_order = 2;
  assert public.claim_next_run_step(r)->>'state' = 'succeeded', 'run completes';
  assert (select status from public.prompt_chain_runs where id = r) = 'succeeded', 'run row marked succeeded';

  s4 := public.append_prompt_chain_step(c, 'D', 'd', null);
  begin
    perform public.create_prompt_chain_run(gen_random_uuid(), c, null, 'x', null, null, null);
    raise exception 'run started with a model-less step';
  exception when others then
    assert sqlerrm = 'step_3_has_no_active_model', 'model-less step blocks the run, got ' || sqlerrm;
  end;

  raise exception 'ALL_CHECKS_PASSED';
end $$;
