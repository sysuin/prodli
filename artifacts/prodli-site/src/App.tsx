import { Switch, Route, Router as WouterRouter } from "wouter";
import { Landing } from "@/pages/Landing";
import { Privacy, Terms } from "@/pages/Privacy";
import { Download } from "@/pages/Download";
import { Goodbye } from "@/pages/Goodbye";
import { MeetingNotesHub, MeetingNotesTopic } from "@/pages/MeetingNotes";

export function NotFound() {
  return (
    <div style={{ fontFamily: "var(--font)", background: "var(--bg)", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 64, fontWeight: 700, marginBottom: 16 }}>404</div>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 24 }}>Page not found</div>
        <a href="/" style={{ display: "inline-block", border: "2px solid #000", padding: "10px 24px", fontWeight: 800, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", background: "#FFD700", boxShadow: "3px 3px 0 #000" }}>← Back home</a>
      </div>
    </div>
  );
}

function Routes() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/ai-meeting-notes" component={MeetingNotesHub} />
      <Route path="/ai-meeting-notes/google-meet">{() => <MeetingNotesTopic kind="google-meet" />}</Route>
      <Route path="/ai-meeting-notes/zoom">{() => <MeetingNotesTopic kind="zoom" />}</Route>
      <Route path="/ai-meeting-notes/teams">{() => <MeetingNotesTopic kind="teams" />}</Route>
      <Route path="/ai-meeting-notes/in-person">{() => <MeetingNotesTopic kind="in-person" />}</Route>
      <Route path="/privacy" component={Privacy} />
      <Route path="/terms" component={Terms} />
      <Route path="/download" component={Download} />
      <Route path="/goodbye" component={Goodbye} />
      <Route component={NotFound} />
    </Switch>
  );
}

/** ssrPath: the page being pre-rendered at build time (src/entry-server.tsx). */
export default function App({ ssrPath }: { ssrPath?: string }) {
  return (
    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")} ssrPath={ssrPath}>
      <Routes />
    </WouterRouter>
  );
}
