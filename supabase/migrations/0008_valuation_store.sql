-- Lets the valuation function (Valuation tab) save its last Kensho fetch to public.kensho_store as row
-- "valuation:latest", alongside the comps and league rows. Same rules as 0007: only the functions write (service
-- role), every login reads. Run once after 0007. Ascot's own valuation figures are never stored: they're typed into
-- the page and stay in the browser tab.

alter table public.kensho_store drop constraint if exists kensho_store_id_check;
alter table public.kensho_store add constraint kensho_store_id_check check (id ~ '^(comps|league|valuation):[a-z0-9]{1,16}$');
