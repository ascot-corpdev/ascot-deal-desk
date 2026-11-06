-- CEO questions on deals. Until now only Corp Dev logins could write anything. This lets any login (the CEO
-- included) add one kind of note: a question on a deal, in their own name. Corp Dev answers with ordinary notes
-- (kind "Answer"), which the existing Corp Dev rules already allow. Nothing else changes: the CEO still can't
-- edit or delete deals, bankers or notes, including their own questions. Run once after 0001; safe to rerun.
-- (Columns of the new note are written notes.doc: inside the sub-queries a bare "doc" would mean the other table's.)

drop policy if exists "insert: questions from any login" on public.notes;
create policy "insert: questions from any login" on public.notes
  for insert to authenticated
  with check (
    public.app_role() is not null
    and notes.doc->>'kind' = 'Question'
    and notes.doc->>'authorId' = auth.uid()::text                  -- only in your own name
    and length(coalesce(notes.doc->>'text', '')) between 1 and 4000
    and not (notes.doc ? 'bankerId')                                -- deals only
    and exists (select 1 from public.deals d where d.id = notes.doc->>'dealId')
    and (not (notes.doc ? 'replyTo')                                -- a follow-up must belong to a question on the same deal
         or exists (select 1 from public.notes q where q.id = notes.doc->>'replyTo'
                    and q.doc->>'kind' = 'Question' and q.doc->>'dealId' = notes.doc->>'dealId'))
  );
