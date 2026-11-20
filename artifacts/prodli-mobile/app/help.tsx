import { H2, P, Screen } from "@/ui/kit";

const QA: [string, string][] = [
  ["What syncs?", "Notes, to-dos, lists, habits, your daily focus, brief and reflection, meeting transcripts and summaries, Pomodoro history and Time Tracker history — the same as the extension and app.prodli.com. Settings like the theme stay on each device."],
  ["Does it work offline?", "Yes. Everything is saved on the phone first and syncs when you're back online. If the same item is edited in two places, the newest edit wins."],
  ["Smart add", "Type naturally: “Pay rent tomorrow !high”, “Gym every monday and thursday at 7am”, “Call Sam #Work @calls”. Dates, times, priority, lists, labels and repeats are picked up."],
  ["Meetings", "Record Google Meet, Zoom, Teams and other calls with the ProdLi extension on your computer. Transcripts and summaries appear here; audio never leaves the computer. You can summarize, share and turn action items into to-dos on the phone."],
  ["Notes with tables", "The phone edits notes with the same editor engine as the extension. Notes with tables open read-only so nothing is lost; edit those on your computer."],
  ["Ask ProdLi and the daily brief", "Use ProdLi's AI with your account (monthly allowances, shown in Account). Your question, today's tasks and habits, and the few notes or meetings that match are sent to ProdLi's server and Anthropic's Claude to write the answer; nothing is kept there."],
  ["Deleting", "Deleting a note, to-do, habit or meeting deletes it on all your devices."],
];

export default function HelpScreen() {
  return (
    <Screen edges={[]}>
      {QA.map(([q, a]) => (
        <>
          <H2 key={`${q}-h`}>{q}</H2>
          <P key={`${q}-p`}>{a}</P>
        </>
      ))}
    </Screen>
  );
}
