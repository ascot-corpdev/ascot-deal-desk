-- Optional clean-up after merging IOI into LOI and retiring Signed (deals that were Signed are Closed).
-- The page already reads IOI as LOI and Signed as Closed, so this only rewrites the stored values.
-- Run once in the Supabase SQL editor.
update public.deals set doc = jsonb_set(doc, '{stage}', '"LOI"')    where doc->>'stage' = 'IOI';
update public.deals set doc = jsonb_set(doc, '{stage}', '"Closed"') where doc->>'stage' = 'Signed';
