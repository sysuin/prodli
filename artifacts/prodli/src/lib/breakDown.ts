// Today's Now card: "✨ Break it down" asks ProdLi's AI for a few small steps
// for a task (a writing-help use).
import { accountRequest } from "./prodliAccount";

/** Steps from ProdLi's AI for a task (needs an account; counts as a writing-help use). */
export async function breakDown(task: string, context = ""): Promise<string[]> {
  const r = await accountRequest<{ steps: string[] }>("/api/ai/breakdown", { method: "POST", body: JSON.stringify({ task: task.slice(0, 300), context: context.slice(0, 1500) }) }, { write_quota_exceeded: "You've used this month's writing help. It resets on the 1st (or go Pro)." });
  return r.steps;
}
