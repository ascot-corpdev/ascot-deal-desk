// Local settings. The GitHub Pages workflow overwrites this file from repository variables,
// so you only edit it to run the site on your own machine. The publishable key (sb_publishable_...) is public by design:
// row-level security in Supabase decides what each login can read and write.
window.DEALDESK_CONFIG = {
  supabaseUrl: "",
  supabaseAnonKey: "",   // paste the publishable key here
  usernameDomain: "deal-desk.local"
};
