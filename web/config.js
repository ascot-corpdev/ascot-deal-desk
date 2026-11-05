// Local settings. The GitHub Pages workflow overwrites this file from repository variables,
// so you only edit it to run the site on your own machine. The publishable key (sb_publishable_...) is public by design:
// row-level security in Supabase decides what each login can read and write.
window.DEALDESK_CONFIG = {
  supabaseUrl: "",
  supabaseAnonKey: "",   // paste the publishable key here
  usernameDomain: "deal-desk.local",
  // Optional: Ask Copilot chat panel (README step 8). Both are IDs, not secrets. Leave blank to keep copy-and-open.
  copilotClientId: "",   // Entra app registration's Application (client) ID
  copilotTenantId: "",   // Ascot's Directory (tenant) ID
  // Optional: Teams group chat card on the Deals tab (README step 9). A chat ID (19:...@thread.v2) or its Teams link.
  teamsChatId: "",
  teamsChatName: "",     // optional heading, e.g. "The Strategizers"
  // Optional: Microsoft sign-in app for showing the chat's messages (Chat.Read only). Not needed for the Copilot panel.
  msClientId: "",
  msTenantId: ""
};
