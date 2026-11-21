import { Switch, Route, Router as WouterRouter } from "wouter";
import { Landing } from "@/pages/Landing";
import { Privacy, Terms } from "@/pages/Privacy";
import { Download } from "@/pages/Download";

function NotFound() {
  return (
    <div style={{ fontFamily: "var(--font)", background: "var(--bg)", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 64, fontWeight: 700, marginBottom: 16 }}>404</div>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 24 }}>Page not found</div>
        <a href="./" style={{ display: "inline-block", border: "2px solid #000", padding: "10px 24px", fontWeight: 800, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", background: "#FFD700", boxShadow: "3px 3px 0 #000" }}>← Back home</a>
      </div>
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/terms" component={Terms} />
      <Route path="/download" component={Download} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <Router />
    </WouterRouter>
  );
}
