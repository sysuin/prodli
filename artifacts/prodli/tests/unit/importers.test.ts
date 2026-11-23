import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { detectDelimiter, findHeaderRow, parseCsv } from "../../src/lib/importers/csv";
import { instantToLocal, parseDateText, parseOneDate, parseTime, rruleToRepeat } from "../../src/lib/importers/dates";
import { buildImport, hashString, importIds, splitLabels, summarize, type ParsedImport } from "../../src/lib/importers/core";
import { looksReversed, parseTodoistFiles, parseTodoistProject, parseTodoistZip, projectNameFromFile } from "../../src/lib/importers/todoist";
import { parseTickTickCsv, splitChecklist } from "../../src/lib/importers/ticktick";
import { parseGoogleTasksJson, parseGoogleTasksZip } from "../../src/lib/importers/googleTasks";
import { guessMapping, parseDone, parseGenericRows, parsePriority, readCsvTable } from "../../src/lib/importers/genericCsv";
import { parseMarkdownTasks } from "../../src/lib/importers/markdown";
import { readImportFile } from "../../src/lib/importers";
import { applyImport, undoImport } from "../../src/lib/importers/apply";
import { readZip, zipFiles, crc32 } from "../../src/lib/zip";
import { storageGet, storageSet } from "../../src/lib/storage";
import { mergeSnapshots } from "../../src/lib/syncMerge";
import type { ListItem, Todo } from "../../src/types";

// Monday 23 November 2026, 10:00 local time.
const NOW = new Date(2026, 10, 23, 10, 0);
const enc = new TextEncoder();

/** A .zip with deflated entries (like Todoist and Takeout write), built here so the reader is tested against real deflate data. */
function deflatedZip(files: { name: string; text: string }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const raw = enc.encode(f.text);
    const data = new Uint8Array(deflateRawSync(raw));
    const crc = crc32(raw);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(8, 8, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(10, 8, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, raw.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

describe("importers: CSV reader", () => {
  it("handles quotes, commas and new lines inside cells, CRLF and a BOM", () => {
    const rows = parseCsv('﻿a,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\n\r\n1,2,3');
    expect(rows).toEqual([["a", "b", "c"], ["x, y", 'say "hi"', "line1\nline2"], [""], ["1", "2", "3"]]);
  });
  it("detects ; and tab separators", () => {
    expect(detectDelimiter("title;due;list\nA;B;C")).toBe(";");
    expect(detectDelimiter("title\tdue\nA\tB")).toBe("\t");
    expect(detectDelimiter('title,notes\n"a;b;c",x')).toBe(",");
  });
  it("finds a header row below other lines", () => {
    expect(findHeaderRow([["Date: x"], ["Version: 7"], ["Folder Name", "List Name", "Title"]], ["title", "list name"])).toBe(2);
    expect(findHeaderRow([["a"]], ["title"])).toBe(-1);
  });
});

describe("importers: zip reader", () => {
  it("reads deflated entries (DecompressionStream) and stored ones (ProdLi's own writer)", async () => {
    const z = deflatedZip([{ name: "Work [123].csv", text: "TYPE,CONTENT\ntask,Hello ünïcode" }, { name: "folder/", text: "" }]);
    const entries = await readZip(z);
    expect(entries.map((e) => [e.name, new TextDecoder().decode(e.bytes)])).toEqual([["Work [123].csv", "TYPE,CONTENT\ntask,Hello ünïcode"]]);
    const stored = new Uint8Array(await zipFiles([{ name: "a.md", text: "- [ ] x" }, { name: "b.txt", text: "y" }]).arrayBuffer());
    expect((await readZip(stored, (n) => n.endsWith(".md"))).map((e) => e.name)).toEqual(["a.md"]);
  });
  it("rejects files that aren't zips", async () => {
    await expect(readZip(enc.encode("not a zip at all, just some text here"))).rejects.toThrow(/isn't a \.zip/);
  });
});

describe("importers: dates", () => {
  it("reads times", () => {
    expect(parseTime("3pm")).toBe("15:00");
    expect(parseTime("at 9:30 am")).toBe("09:30");
    expect(parseTime("15:05:00")).toBe("15:05");
    expect(parseTime("25:00")).toBeUndefined();
  });
  it("reads one-off dates in common formats", () => {
    expect(parseOneDate("2026-12-01", NOW)).toEqual({ dueDate: "2026-12-01" });
    expect(parseOneDate("2026-12-01 15:30", NOW)).toEqual({ dueDate: "2026-12-01", dueTime: "15:30" });
    expect(parseOneDate("2026-12-01T00:00:00", NOW)).toEqual({ dueDate: "2026-12-01" });
    expect(parseOneDate("12/25/2026", NOW)).toEqual({ dueDate: "2026-12-25" });
    expect(parseOneDate("25/12/2026", NOW)).toEqual({ dueDate: "2026-12-25" });
    expect(parseOneDate("05.12.2026", NOW)).toEqual({ dueDate: "2026-12-05" });
    expect(parseOneDate("Nov 30 2026 3pm", NOW)).toEqual({ dueDate: "2026-11-30", dueTime: "15:00" });
    expect(parseOneDate("30 Nov 2026 15:00", NOW)).toEqual({ dueDate: "2026-11-30", dueTime: "15:00" });
    expect(parseOneDate("Mon 30 Nov", NOW)).toEqual({ dueDate: "2026-11-30" });
    expect(parseOneDate("November 2, 2027", NOW)).toEqual({ dueDate: "2027-11-02" });
    expect(parseOneDate("tomorrow at 5pm", NOW)).toEqual({ dueDate: "2026-11-24", dueTime: "17:00" });
    expect(parseOneDate("2026-02-30", NOW)).toBeNull();
    expect(parseOneDate("someday", NOW)).toBeNull();
  });
  it("picks the nearest year when there's none, so overdue stays overdue", () => {
    expect(parseOneDate("Nov 20", NOW)?.dueDate).toBe("2026-11-20");
    expect(parseOneDate("Jan 5", NOW)?.dueDate).toBe("2027-01-05");
    expect(parseOneDate("Jul 1", NOW)?.dueDate).toBe("2026-07-01");
  });
  it("converts instants to the task's own time zone", () => {
    expect(instantToLocal("2024-01-14T16:00:00+0000", "Asia/Shanghai")).toEqual({ date: "2024-01-15", time: "00:00" });
    expect(instantToLocal("2024-01-15T14:30:00+0000", "America/New_York")).toEqual({ date: "2024-01-15", time: "09:30" });
    expect(instantToLocal("nonsense")).toBeNull();
  });
  it("maps repeating dates to Repeat, and keeps the ones that don't fit", () => {
    expect(parseDateText("every monday", NOW)).toEqual({ repeat: { unit: "week", every: 1, weekdays: [1] }, dueDate: "2026-11-23" });
    expect(parseDateText("every day at 9am", NOW)).toMatchObject({ repeat: { unit: "day", every: 1 }, dueTime: "09:00" });
    expect(parseDateText("every 2 weeks starting Dec 4", NOW)).toEqual({ repeat: { unit: "week", every: 2 }, dueDate: "2026-12-04" });
    expect(parseDateText("every month starting 2026-12-15", NOW)).toEqual({ repeat: { unit: "month", every: 1, monthDay: 15 }, dueDate: "2026-12-15" });
    expect(parseDateText("every weekday", NOW).repeat).toEqual({ unit: "week", every: 1, weekdays: [1, 2, 3, 4, 5] });
    expect(parseDateText("every! 3 days", NOW)).toEqual({ unmappedRepeat: "every! 3 days" });
    expect(parseDateText("every 2nd tuesday", NOW)).toEqual({ unmappedRepeat: "every 2nd tuesday" });
    expect(parseDateText("every day until Dec 31", NOW)).toEqual({ unmappedRepeat: "every day until Dec 31" });
    expect(parseDateText("quand tu veux", NOW)).toEqual({ unparsed: "quand tu veux" });
    expect(parseDateText("", NOW)).toEqual({});
  });
  it("maps RRULEs", () => {
    expect(rruleToRepeat("RRULE:FREQ=DAILY;INTERVAL=1")).toEqual({ unit: "day", every: 1 });
    expect(rruleToRepeat("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=WE,MO")).toEqual({ unit: "week", every: 2, weekdays: [1, 3] });
    expect(rruleToRepeat("FREQ=MONTHLY;BYMONTHDAY=31")).toEqual({ unit: "month", every: 1, monthDay: 31 });
    expect(rruleToRepeat("FREQ=MONTHLY", "2026-11-15")).toEqual({ unit: "month", every: 1, monthDay: 15 });
    expect(rruleToRepeat("FREQ=YEARLY;INTERVAL=1", "2026-03-02")).toEqual({ unit: "year", every: 1, monthDay: 2 });
    expect(rruleToRepeat("FREQ=WEEKLY;COUNT=5")).toEqual({ unit: "week", every: 1 });
    expect(rruleToRepeat("FREQ=MONTHLY;BYDAY=2TU")).toBeNull();
    expect(rruleToRepeat("FREQ=HOURLY")).toBeNull();
    expect(rruleToRepeat("FREQ=DAILY;TT_SKIP=HOLIDAY")).toBeNull();
  });
});

const TODOIST = [
  "TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE,DURATION,DURATION_UNIT,DEADLINE,DEADLINE_LANG",
  "task,Pay rent @home,Landlord's account,1,1,Sam (1),,every month starting 2026-12-01,en,Europe/London,,None,,",
  "task,Plan trip,,2,1,Sam (1),,Nov 30,en,Europe/London,45,minute,,",
  "task,Book flights,,4,2,Sam (1),,Nov 28,en,Europe/London,,None,,",
  "task,Pick seats,,4,3,Sam (1),,,en,Europe/London,,None,,",
  "note,Ask about legroom,,,,Sam (1),,,,,,,,",
  "",
  "section,Errands,,,,,,,,,,,,",
  "task,Water plants,,3,1,Sam (1),Alex (2),every! 3 days,en,Europe/London,,None,,",
  "task,Buy milk @errands,,4,1,Sam (1),,every monday,en,Europe/London,,None,2026-11-25,en",
  "task,* Weekend,,4,1,Sam (1),,,en,Europe/London,,None,2026-11-28,en",
].join("\n");

describe("importers: Todoist", () => {
  it("names lists after the project file", () => {
    expect(projectNameFromFile("Work [2203306141].csv")).toBe("Work");
    expect(projectNameFromFile("backup/Home Stuff.csv")).toBe("Home Stuff");
  });
  it("reads tasks, subtasks, comments, sections, labels, priorities and dates", () => {
    const { tasks, flags } = parseTodoistProject(TODOIST, "Home", NOW);
    expect(tasks.map((t) => t.title)).toEqual(["Pay rent", "Plan trip", "Water plants", "Buy milk", "Weekend"]);
    const [rent, trip, plants, milk, weekend] = tasks;
    expect(rent).toMatchObject({ list: "Home", priority: "high", labels: ["home"], dueDate: "2026-12-01", repeat: { unit: "month", every: 1, monthDay: 1 }, notes: ["Landlord's account"] });
    expect(trip).toMatchObject({ priority: "medium", dueDate: "2026-11-30", estimateMin: 45 });
    // INDENT 2 and 3 both become subtasks of the top task; the comment goes on the top task.
    expect(trip.subtasks).toEqual([{ title: "Book flights", completed: false }, { title: "Pick seats", completed: false }]);
    expect(trip.notes).toEqual(["💬 Ask about legroom"]);
    expect(plants).toMatchObject({ priority: "low", labels: ["Errands"], repeatNote: "every! 3 days" });
    expect(plants.repeat).toBeUndefined();
    expect(milk).toMatchObject({ labels: ["errands", "Errands"], repeat: { unit: "week", every: 1, weekdays: [1] }, dueDate: "2026-11-23", notes: ["⏳ Deadline: 2026-11-25"] });
    expect(milk.priority).toBeUndefined(); // p4 = no priority
    expect(weekend).toMatchObject({ title: "Weekend", dueDate: "2026-11-28" }); // deadline used when there's no date
    expect(flags).toMatchObject({ assignees: true, deepNesting: true, subtaskDetails: true, reversed: false });
  });
  it("reads priorities in Todoist's API order when most tasks are 1", () => {
    expect(looksReversed([1, 1, 1, 4, 2])).toBe(true);
    expect(looksReversed([4, 4, 4, 1, 2])).toBe(false);
    expect(looksReversed([1, 1])).toBe(false); // too few to tell
    const csv = ["TYPE,CONTENT,PRIORITY,INDENT,DATE", "task,A,1,1,", "task,B,1,1,", "task,C,1,1,", "task,Urgent,4,1,", "task,Soon,3,1,"].join("\n");
    const parsed = parseTodoistFiles([{ name: "P.csv", text: csv }], NOW);
    expect(parsed.tasks.map((t) => t.priority)).toEqual([undefined, undefined, undefined, "high", "medium"]);
    expect(parsed.info.join(" ")).toMatch(/API order/);
  });
  it("reads a backup .zip as one list per project; Inbox goes to the Inbox", async () => {
    const zip = deflatedZip([
      { name: "Inbox [1].csv", text: "TYPE,CONTENT,PRIORITY,INDENT,DATE\ntask,Call Sam,4,1," },
      { name: "Work [2].csv", text: "TYPE,CONTENT,PRIORITY,INDENT,DATE\ntask,Send invoice,1,1,2026-11-30\ntask,Review PR,4,1," },
      { name: "__MACOSX/._Work [2].csv", text: "junk" },
    ]);
    const parsed = await parseTodoistZip(zip, NOW);
    expect(parsed.tasks.map((t) => [t.list, t.title])).toEqual([["Inbox", "Call Sam"], ["Work", "Send invoice"], ["Work", "Review PR"]]);
    const s = summarize(parsed, [], false);
    expect(s).toMatchObject({ total: 3, toAdd: 3, lists: ["Work"] }); // Inbox isn't a new list
    expect(parsed.dropped.join(" ")).toMatch(/Completed tasks/);
  });
  it("says when a file isn't a Todoist export", () => {
    expect(() => parseTodoistFiles([{ name: "x.csv", text: "a,b\n1,2" }])).toThrow(/doesn't look like a Todoist export/);
  });
});

const TICKTICK = [
  '"Date: 2026-11-23+0000"',
  '"Version: 7.1"',
  '"Status: \n0 Normal\n1 Completed\n2 Archived"',
  '"Folder Name","List Name","Title","Kind","Tags","Content","Is Check list","Start Date","Due Date","Reminder","Repeat","Priority","Status","Created Time","Completed Time","Order","Timezone","Is All Day","Is Floating","Column Name","Column Order","View Mode","taskId","parentId"',
  '"Life","Home","Clean kitchen","TEXT","chores, weekly","Use the new spray","N","","2026-11-24T16:00:00+0000","","RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=TU","5","0","2026-11-01T10:00:00+0000","","1","Asia/Shanghai","true","false","","","list","t1",""',
  '"","Work","Ship release","CHECKLIST","","▫Write notes\n▪Tag build\nRemember QA","Y","","2026-11-25T14:30:00+0000","0","","3","0","","","2","America/New_York","false","false","","","list","t2",""',
  '"","Work","Draft email","TEXT","","","N","","","","","1","0","","","3","America/New_York","","false","","","list","t3","t2"',
  '"","Work","Reply to Ana","TEXT","","","N","","","","","1","0","","","4","America/New_York","","false","","","list","t4","t3"',
  '"","Work","Old thing","TEXT","","","N","","","","RRULE:FREQ=MONTHLY;BYDAY=2TU","0","2","2026-10-01T10:00:00+0000","2026-10-05T09:00:00+0000","5","UTC","","false","","","list","t5",""',
  '"","Notes","Idea for a book","NOTE","","Long text","N","","","","","0","0","","","6","UTC","","false","","","list","t6",""',
].join("\n");

describe("importers: TickTick", () => {
  it("skips the lines before the header and reads tasks", () => {
    const parsed = parseTickTickCsv(TICKTICK);
    expect(parsed.tasks.map((t) => t.title)).toEqual(["Clean kitchen", "Ship release", "Old thing"]);
    const [clean, ship, old] = parsed.tasks;
    // All-day: midnight in Shanghai, stored as 16:00 UTC the day before.
    expect(clean).toMatchObject({ sourceId: "t1", list: "Home", priority: "high", dueDate: "2026-11-25", labels: ["chores", "weekly"], repeat: { unit: "week", every: 1, weekdays: [2] }, notes: ["Use the new spray"], createdAt: "2026-11-01T10:00:00.000Z" });
    expect(clean.dueTime).toBeUndefined();
    expect(ship).toMatchObject({ list: "Work", priority: "medium", dueDate: "2026-11-25", dueTime: "09:30", notes: ["Remember QA"] });
    // Checklist items, then child tasks (grandchildren flatten into the top task).
    expect(ship.subtasks).toEqual([
      { title: "Write notes", completed: false },
      { title: "Tag build", completed: true },
      { title: "Draft email", completed: false },
      { title: "Reply to Ana", completed: false },
    ]);
    expect(old).toMatchObject({ completed: true, completedAt: "2026-10-05T09:00:00.000Z", repeatNote: "FREQ=MONTHLY;BYDAY=2TU" });
    expect(parsed.dropped.join(" | ")).toMatch(/1 note \(TickTick notes aren't tasks\)/);
    expect(parsed.dropped.join(" | ")).toMatch(/Folders/);
    expect(parsed.dropped.join(" | ")).toMatch(/Sub-subtasks/);
  });
  it("splits checklist content", () => {
    expect(splitChecklist("▫a\n✓ b\n- [ ] c\nplain")).toEqual({ items: [{ title: "a", completed: false }, { title: "b", completed: true }, { title: "c", completed: false }], note: "plain" });
  });
  it("says when a file isn't a TickTick backup", () => {
    expect(() => parseTickTickCsv("a,b\n1,2")).toThrow(/TickTick backup/);
  });
});

const GOOGLE = JSON.stringify({
  kind: "tasks#taskLists",
  items: [
    {
      kind: "tasks#taskList",
      id: "L1",
      title: "My Tasks",
      items: [
        { kind: "tasks#task", id: "a", title: "Renew passport", notes: "Bring photos", status: "needsAction", due: "2026-12-10T00:00:00.000Z", created: "2026-11-01T08:00:00.000Z" },
        { kind: "tasks#task", id: "b", title: "Fill form", status: "completed", completed: "2026-11-20T09:00:00.000Z", parent: "a" },
        { kind: "tasks#task", id: "c", title: "Old", status: "completed", completed: "2026-11-02T09:00:00.000Z", deleted: true },
        { kind: "tasks#task", id: "d", title: "Filed taxes", status: "completed", completed: "2026-04-10T09:00:00.000Z", links: [{ type: "email" }] },
      ],
    },
    { kind: "tasks#taskList", id: "L2", title: "Groceries", items: [{ kind: "tasks#task", id: "e", title: "Eggs", status: "needsAction" }] },
  ],
});

describe("importers: Google Tasks", () => {
  it("reads lists, tasks, subtasks and done tasks; skips deleted ones", () => {
    const parsed = parseGoogleTasksJson(GOOGLE);
    expect(parsed.tasks.map((t) => [t.list, t.title, t.completed])).toEqual([["My Tasks", "Renew passport", false], ["My Tasks", "Filed taxes", true], ["Groceries", "Eggs", false]]);
    expect(parsed.tasks[0]).toMatchObject({ sourceId: "a", dueDate: "2026-12-10", notes: ["Bring photos"], subtasks: [{ title: "Fill form", completed: true }], createdAt: "2026-11-01T08:00:00.000Z" });
    expect(parsed.tasks[1].completedAt).toBe("2026-04-10T09:00:00.000Z");
    expect(parsed.dropped.join(" ")).toMatch(/Links to Gmail/);
  });
  it("finds Tasks.json inside a Takeout .zip", async () => {
    const parsed = await parseGoogleTasksZip(deflatedZip([{ name: "Takeout/Mail/x.json", text: "{}" }, { name: "Takeout/Tasks/Tasks.json", text: GOOGLE }]));
    expect(parsed.tasks).toHaveLength(3);
  });
  it("rejects other JSON", () => {
    expect(() => parseGoogleTasksJson('{"notes":[]}')).toThrow(/Google Tasks/);
    expect(() => parseGoogleTasksJson("not json")).toThrow(/valid JSON/);
  });
});

describe("importers: generic CSV", () => {
  const csv = ["Task;Due;Priority;Project;Status;Description;Tags", "Call bank;12/01/2026;High;Admin;;Ask about fees;money, calls", "Gym;every monday;;;;;", "Old report;2026-10-01;low;Work;Done;;", ";2026-10-01;;;;;"].join("\n");
  it("guesses columns from the headers", () => {
    const t = readCsvTable(csv);
    expect(t.headers).toEqual(["Task", "Due", "Priority", "Project", "Status", "Description", "Tags"]);
    expect(guessMapping(t.headers)).toEqual({ title: 0, due: 1, priority: 2, list: 3, done: 4, notes: 5, labels: 6 });
    expect(guessMapping(["Foo", "Bar"]).title).toBe(0);
  });
  it("reads rows with the chosen columns", () => {
    const t = readCsvTable(csv);
    const parsed = parseGenericRows(t, guessMapping(t.headers), NOW);
    expect(parsed.tasks).toHaveLength(3); // the row with no title is skipped
    expect(parsed.tasks[0]).toEqual({ title: "Call bank", completed: false, list: "Admin", priority: "high", dueDate: "2026-12-01", notes: ["Ask about fees"], labels: ["money", "calls"] });
    expect(parsed.tasks[1]).toMatchObject({ title: "Gym", repeat: { unit: "week", every: 1, weekdays: [1] } });
    expect(parsed.tasks[2]).toMatchObject({ completed: true, priority: "low", list: "Work" });
    const titleOnly = parseGenericRows(t, { title: 0, due: -1, priority: -1, list: -1, done: -1, notes: -1, labels: -1 }, NOW);
    expect(titleOnly.tasks[0]).toEqual({ title: "Call bank", completed: false });
    expect(titleOnly.dropped[0]).toMatch(/Columns not picked: Due, Priority/);
    expect(() => parseGenericRows(t, { ...guessMapping(t.headers), title: -1 })).toThrow(/title/);
  });
  it("reads priority and done values", () => {
    expect(["urgent", "P2", "3", "none", ""].map(parsePriority)).toEqual(["high", "medium", "low", undefined, undefined]);
    expect(["TRUE", "x", "Completed", "no", ""].map(parseDone)).toEqual([true, true, true, false, false]);
  });
});

describe("importers: Markdown and plain text", () => {
  it("reads checklists, bullets, plain lines, headings and indentation", () => {
    const md = [
      "---",
      "title: notes",
      "---",
      "Loose task",
      "# Home",
      "- [ ] Fix sink tomorrow !high",
      "  - [x] Buy washer",
      "    - Find wrench",
      "- [x] Paint fence",
      "## Work stuff",
      "* Email Ana @calls",
      "1. Prep slides #Talks",
      "```",
      "- [ ] not a task (code)",
      "```",
      "---",
      "☐ Water plants every monday",
      "☑ Done thing",
    ].join("\n");
    const parsed = parseMarkdownTasks(md, NOW);
    expect(parsed.tasks.map((t) => [t.list, t.title, t.completed])).toEqual([
      [undefined, "Loose task", false],
      ["Home", "Fix sink", false],
      ["Home", "Paint fence", true],
      ["Work stuff", "Email Ana", false],
      ["Talks", "Prep slides", false],
      ["Work stuff", "Water plants", false],
      ["Work stuff", "Done thing", true],
    ]);
    expect(parsed.tasks[1]).toMatchObject({ priority: "high", dueDate: "2026-11-24", subtasks: [{ title: "Buy washer", completed: true }, { title: "Find wrench", completed: false }] });
    expect(parsed.tasks[3].labels).toEqual(["calls"]);
    expect(parsed.tasks[5].repeat).toEqual({ unit: "week", every: 1, weekdays: [1] });
  });
  it("says when there's nothing to import", () => {
    expect(() => parseMarkdownTasks("\n\n---\n")).toThrow(/No tasks/);
  });
});

describe("importers: building to-dos", () => {
  const parsed: ParsedImport = {
    app: "todoist",
    dropped: [],
    info: [],
    tasks: [
      { title: "Pay rent", list: "home", completed: false, priority: "high", dueDate: "2026-12-01", repeat: { unit: "month", every: 1, monthDay: 1 }, labels: ["Bills", "bills"], notes: ["Landlord"], subtasks: [{ title: "Check amount", completed: false }] },
      { title: "Buy milk", list: "Inbox", completed: false },
      { title: "Buy milk", list: "Inbox", completed: false },
      { title: "Old task", list: "Archive", completed: true, repeat: { unit: "day", every: 1 }, completedAt: "2026-10-01T00:00:00.000Z", repeatNote: "every! 2 days", dateNote: "someday" },
    ],
  };
  const existingLists: ListItem[] = [{ id: "home1", kind: "list", name: "Home", createdAt: "2026-01-01T00:00:00.000Z" }];

  it("hashes stably and numbers repeats of the same task", () => {
    expect(hashString("abc")).toBe(hashString("abc"));
    expect(hashString("abc")).not.toBe(hashString("abd"));
    const ids = importIds(parsed.tasks);
    expect(ids[1]).not.toBe(ids[2]);
    expect(ids[2]).toBe(`${ids[1]}#2`);
    expect(importIds([{ title: "x", completed: false, sourceId: "42" }])).toEqual(["42"]);
  });
  it("makes to-dos, reuses lists by name and creates the rest", () => {
    const built = buildImport(parsed, { includeDone: true, existingTodos: [], existingLists, now: NOW });
    expect(built.todos).toHaveLength(4);
    expect(built.newLists.map((l) => l.name)).toEqual(["Archive"]);
    const [rent, milk, , old] = built.todos;
    expect(rent).toMatchObject({ title: "Pay rent", listId: "home1", priority: "high", dueDate: "2026-12-01", repeat: { unit: "month", every: 1, monthDay: 1 }, labels: ["bills"], completed: false, importedFrom: { app: "todoist" } });
    expect(rent.subtasks?.map((s) => s.title)).toEqual(["Check amount", "📝 Landlord"]);
    expect(milk.listId).toBeUndefined(); // Inbox
    expect(old).toMatchObject({ completed: true, completedAt: "2026-10-01T00:00:00.000Z", listId: built.newLists[0].id });
    expect(old.repeat).toBeUndefined(); // a done task doesn't repeat
    expect(old.subtasks?.map((s) => s.title)).toEqual(["🔁 Repeats: every! 2 days", "📅 Due: someday"]);
  });
  it("leaves done tasks out unless asked, and skips what was imported before", () => {
    const first = buildImport(parsed, { includeDone: false, existingTodos: [], existingLists, now: NOW });
    expect(first.todos.map((t) => t.title)).toEqual(["Pay rent", "Buy milk", "Buy milk"]);
    expect(first.newLists).toEqual([]);
    const again = buildImport(parsed, { includeDone: true, existingTodos: first.todos, existingLists, now: NOW });
    expect(again.todos.map((t) => t.title)).toEqual(["Old task"]);
    expect(again.skipped).toBe(3);
    expect(summarize(parsed, first.todos, false)).toMatchObject({ total: 4, toAdd: 0, duplicates: 3, done: 1, repeating: 2, repeatNotes: 1, dateNotes: 1, lists: ["home", "Archive"] });
    // Another app with the same ids isn't a duplicate.
    expect(buildImport({ ...parsed, app: "markdown" }, { includeDone: false, existingTodos: first.todos, existingLists, now: NOW }).todos).toHaveLength(3);
  });
  it("pulls @labels out of titles", () => {
    expect(splitLabels("Buy milk @errands @home.")).toEqual({ title: "Buy milk", labels: ["errands", "home"] });
    expect(splitLabels("Email sam@example.com")).toEqual({ title: "Email sam@example.com", labels: [] });
  });
});

describe("importers: saving and Undo", () => {
  it("adds to-dos and lists, skips them on re-import, and Undo removes exactly what was added", async () => {
    const mine: Todo = { id: "mine", title: "My own task", completed: false, createdAt: "2026-11-01T00:00:00.000Z" };
    await storageSet("todos", [mine]);
    await storageSet("lists", [{ id: "home1", kind: "list", name: "Home", createdAt: "x" }]);
    const parsed = parseTodoistFiles([{ name: "Work.csv", text: "TYPE,CONTENT,PRIORITY,INDENT,DATE\ntask,Send invoice,1,1,2026-11-30\ntask,Review PR,4,1," }], NOW);
    const out = await applyImport(parsed, false, NOW);
    expect(out).toMatchObject({ added: 2, skipped: 0, newLists: 1 });
    let todos = await storageGet<Todo[]>("todos", []);
    const lists = await storageGet<ListItem[]>("lists", []);
    expect(todos.map((t) => t.title)).toEqual(["Send invoice", "Review PR", "My own task"]);
    expect(lists.map((l) => l.name)).toEqual(["Home", "Work"]);
    expect(todos[0]).toMatchObject({ priority: "high", dueDate: "2026-11-30", listId: lists[1].id, importedFrom: { app: "todoist" } });

    const again = await applyImport(parsed, false, NOW);
    expect(again).toMatchObject({ added: 0, skipped: 2, newLists: 0 });
    expect((await storageGet<Todo[]>("todos", [])).length).toBe(3);

    // A task of the user's moved into the imported list goes back to the Inbox on Undo.
    todos = await storageGet<Todo[]>("todos", []);
    await storageSet("todos", todos.map((t) => (t.id === "mine" ? { ...t, listId: lists[1].id } : t)));
    await undoImport(out.undo);
    const after = await storageGet<Todo[]>("todos", []);
    expect(after.map((t) => t.title)).toEqual(["My own task"]);
    expect(after[0].listId).toBeUndefined();
    expect((await storageGet<ListItem[]>("lists", [])).map((l) => l.name)).toEqual(["Home"]);
    const tomb = await storageGet<Record<string, Record<string, string>>>("syncTombstones", {});
    expect(Object.keys(tomb.todos ?? {}).sort()).toEqual([...out.undo.todoIds].sort());
    expect(Object.keys(tomb.lists ?? {})).toEqual(out.undo.listIds);
  });
  it("keeps importedFrom through sync merges", () => {
    const t: Todo = { id: "a", title: "x", completed: false, createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-02T00:00:00.000Z", importedFrom: { app: "ticktick", id: "t1" } };
    const merged = mergeSnapshots({ version: "1.1", exportedAt: "", data: { todos: [] } }, { version: "1.1", exportedAt: "", data: { todos: [t] } });
    expect((merged.data.todos as Todo[])[0].importedFrom).toEqual({ app: "ticktick", id: "t1" });
  });
});

describe("importers: reading a file for the picked app", () => {
  it("reads a TickTick backup even when Todoist was picked, and says so", async () => {
    const r = await readImportFile("todoist", "TickTick-backup.csv", enc.encode(TICKTICK), NOW);
    expect(r.kind).toBe("parsed");
    if (r.kind === "parsed") {
      expect(r.parsed.app).toBe("ticktick");
      expect(r.parsed.info[0]).toMatch(/TickTick export/);
    }
  });
  it("returns the table for a generic CSV and parses Markdown", async () => {
    const t = await readImportFile("csv", "a.csv", enc.encode("Name,When\nA,2026-12-01"), NOW);
    expect(t.kind === "table" && t.table.headers).toEqual(["Name", "When"]);
    const m = await readImportFile("markdown", "a.md", enc.encode("- [ ] One\n- [x] Two"), NOW);
    expect(m.kind === "parsed" && m.parsed.tasks.length).toBe(2);
    const z = await readImportFile("todoist", "b.zip", deflatedZip([{ name: "P.csv", text: "TYPE,CONTENT,PRIORITY\ntask,A,4" }]), NOW);
    expect(z.kind === "parsed" && z.parsed.tasks[0].list).toBe("P");
    await expect(readImportFile("markdown", "e.md", enc.encode("  "))).rejects.toThrow(/empty/);
  });
});
