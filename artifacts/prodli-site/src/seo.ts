// Title and description of every page on prodli.com. scripts/prerender.mjs
// writes them into each page's HTML (with its rendered content) at build time,
// so search engines and link previews see real pages; the pages also set the
// title when someone navigates in the browser.

export type PageMeta = { path: string; title: string; description: string; inSitemap: boolean };

export const PAGES: PageMeta[] = [
  {
    path: "/",
    title: "ProdLi: AI meeting notes without a bot, and your day planned",
    description:
      "ProdLi writes the transcript, summary, decisions and action items for Google Meet, Zoom, Teams and in-person meetings, with no bot in the call, then turns them into your plan for the day in every new tab. Free.",
    inSitemap: true,
  },
  {
    path: "/ai-meeting-notes",
    title: "AI meeting notes with no bot: Google Meet, Zoom, Teams and in person | ProdLi",
    description:
      "Get a transcript, summary, decisions and action items for every meeting without a bot joining the call. Works in Chrome for Google Meet, Zoom, Teams and more, and for meetings in the room. Free to start.",
    inSitemap: true,
  },
  {
    path: "/ai-meeting-notes/google-meet",
    title: "Google Meet transcript and AI notes, free and with no bot | ProdLi",
    description:
      "ProdLi turns Google Meet's own captions into a full transcript, summary and action items in your browser. No bot joins the call and no audio is uploaded. Free Chrome extension.",
    inSitemap: true,
  },
  {
    path: "/ai-meeting-notes/zoom",
    title: "Zoom meeting notes without a bot: AI transcript and summary | ProdLi",
    description:
      "Take AI notes for Zoom calls without adding a bot: ProdLi records the call in your browser (or the Zoom app with ProdLi for Mac and Windows) and writes the transcript, summary and action items.",
    inSitemap: true,
  },
  {
    path: "/ai-meeting-notes/teams",
    title: "Microsoft Teams meeting notes with AI, no bot needed | ProdLi",
    description:
      "AI notes for Microsoft Teams calls without inviting a bot: transcript, summary, decisions and action items, in Chrome or in the Teams app with ProdLi for Mac and Windows.",
    inSitemap: true,
  },
  {
    path: "/ai-meeting-notes/in-person",
    title: "AI notes for in-person meetings: record on your laptop or phone | ProdLi",
    description:
      "Record a meeting in the room on your laptop or phone and get a transcript, summary, decisions and action items. Works in the browser at app.prodli.com, with no app to install.",
    inSitemap: true,
  },
  {
    path: "/download",
    title: "ProdLi for Mac and Windows",
    description: "ProdLi's desktop app: AI notes for calls in any app (Zoom, Teams, Slack, FaceTime) without a bot, quick add from anywhere, and your daily brief in the menu bar or tray.",
    inSitemap: true,
  },
  { path: "/privacy", title: "Privacy Policy | ProdLi", description: "How ProdLi handles your data: what is stored, where, for how long, and how to download or delete it.", inSitemap: true },
  { path: "/terms", title: "Terms of Service | ProdLi", description: "The terms for using ProdLi and ProdLi Pro.", inSitemap: true },
  { path: "/goodbye", title: "Sorry to see you go | ProdLi", description: "Tell us why you removed ProdLi. It takes ten seconds and it's anonymous.", inSitemap: false },
];

export const NOT_FOUND: PageMeta = { path: "/404", title: "Page not found | ProdLi", description: "This page doesn't exist.", inSitemap: false };

export const metaFor = (path: string): PageMeta => PAGES.find((p) => p.path === path) ?? NOT_FOUND;
