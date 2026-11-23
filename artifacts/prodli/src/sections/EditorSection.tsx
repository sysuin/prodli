import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, useEditorState, EditorContent, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { EditorState } from "@tiptap/pm/state";
import { ListOrdered } from "lucide-react";
import "@fontsource/inter/400.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "@fontsource/space-mono/400.css";
import "@fontsource/space-mono/700.css";
import "@fontsource/merriweather/400.css";
import "@fontsource/merriweather/700.css";
import { storageGet, storageSet } from "../lib/storage";
import { useSyncedList } from "../lib/syncedList";
import { generateId } from "../lib/utils";
import type { Note } from "../types";
import { looksLikeMarkdown, MAX_NOTE_BYTES } from "../lib/markdownDetect";
import { fitsInNote, imageFileToDataUrl, INSERT_IMAGE_EVENT, isNoteImage } from "../lib/noteImages";
import { LinkBox, linkBoxFor, type LinkBoxState } from "./editor/LinkBox";

// Loaded on demand so the Editor opens faster: Markdown conversion
// (marked + DOMPurify) for paste/import, and turndown for export.
const loadMarkdownImport = () => import("../lib/editorHtml");
const loadMarkdownExport = () => import("../lib/markdownExport");
import { buildExtensions } from "./editor/extensions";
import { detectSlash, filterSlashItems, SlashMenu, type SlashItem, type SlashState } from "./editor/SlashMenu";
import { isBlankNote, NoteList, sortNotes, type NoteSort } from "./editor/NoteList";
import { isImprovable, useImprove } from "./editor/ImproveMenu";
import { IMPROVE_EVENT, type RewriteAction } from "../lib/write";
import { DAILY_NOTE_EVENT, newNoteFromTemplate, PENDING_DAILY_KEY, prepareDailyNote } from "../lib/noteTemplates";
import { OPEN_ITEM_EVENT } from "../lib/askOpen";
import { BlockHandle } from "./editor/BlockHandle";
import { OPEN_NOTE_LINK_EVENT, setNoteTitles } from "./editor/blocks";
import { detectNotePick, filterNotesForLink, NotePicker, type NotePickState } from "./editor/NotePicker";
import { PageHead } from "./editor/PageHead";
import { ColorButton } from "./editor/ColorButton";
import { FindBar, type FindBarHandle } from "./editor/FindBar";
import { findStatus, selectionQuery } from "./editor/findReplace";
import { ReadAloudBar, useReadAloud } from "../components/ReadAloud";
import { htmlToSpeechText } from "../lib/readAloud";

type EditorFont = "system" | "inter" | "space-mono" | "merriweather";
type SaveStatus = "idle" | "saving" | "saved" | "error";

const FONT_OPTIONS: { value: EditorFont; label: string; family: string }[] = [
  { value: "system", label: "System", family: "var(--app-font-sans)" },
  { value: "inter", label: "Inter", family: "'Inter', sans-serif" },
  { value: "space-mono", label: "Space Mono", family: "'Space Mono', monospace" },
  { value: "merriweather", label: "Merriweather", family: "'Merriweather', serif" },
];

const EDIT_DEBOUNCE_MS = 500;

function getWordCount(text: string): number {
  return text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
}
function getReadingTime(words: number): string {
  if (words < 50) return "< 1 min read";
  return `~${Math.ceil(words / 238)} min read`;
}

/** Title for notes the user hasn't named: the first line of text. */
function deriveTitle(editor: Editor): string {
  let title = "";
  editor.state.doc.descendants((node) => {
    if (title) return false;
    if (node.isTextblock && node.textContent.trim()) {
      title = node.textContent.trim();
      return false;
    }
    return true;
  });
  return title.length > 60 ? `${title.slice(0, 57).trimEnd()}…` : title || "Untitled";
}

function newNote(partial: Partial<Note> = {}): Note {
  const now = new Date().toISOString();
  return { id: generateId(), title: "Untitled", content: "", createdAt: now, updatedAt: now, autoTitle: true, ...partial };
}

interface ToolbarButtonProps {
  /** Hidden on phones (index.css .tb-optional). */
  optional?: boolean;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}
function ToolbarButton({ onClick, active, disabled, title, children, wide, optional }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      className={optional ? "tb-optional" : undefined}
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} // keep the editor's selection
      style={{
        border: "var(--nb-border)",
        background: active ? "#FFD700" : "hsl(var(--card))",
        color: active ? "#000" : "hsl(var(--foreground))",
        minWidth: 32,
        height: 32,
        padding: wide ? "0 10px" : 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        fontWeight: 700,
        fontSize: wide ? 11 : 13,
        textTransform: wide ? "uppercase" : undefined,
        boxShadow: active ? "none" : "var(--nb-shadow-sm)",
        transition: "all 0.1s",
        flexShrink: 0,
        fontFamily: "inherit",
      }}
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
}

const Divider = () => <div className="tb-optional" style={{ width: 1, height: 24, background: "var(--nb-section-border)", margin: "0 4px" }} />;

export function EditorSection() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editorFont, setEditorFont] = useState<EditorFont>("system");
  const [sort, setSort] = useState<NoteSort>("updated");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showOutline, setShowOutline] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [notePick, setNotePick] = useState<NotePickState | null>(null);
  const [notePickIndex, setNotePickIndex] = useState(0);
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  const activeIdRef = useRef<string | null>(null);
  const pendingEdit = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const loadingContent = useRef(false);
  const slashRef = useRef<{ state: SlashState | null; items: SlashItem[]; index: number; dismissedAt: number | null }>({ state: null, items: [], index: 0, dismissedAt: null });
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const createLinkedNoteRef = useRef<(query: string) => void>(() => {});
  const notePickRef = useRef<{ state: NotePickState | null; items: Note[]; index: number; canCreate: boolean; dismissedAt: number | null }>({ state: null, items: [], index: 0, canCreate: false, dismissedAt: null });
  const importInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const improveRef = useRef<ReturnType<typeof useImprove> | null>(null);

  const showToast = useCallback((text: string, undo?: () => void) => {
    clearTimeout(toastTimer.current);
    setToast({ text, undo });
    toastTimer.current = setTimeout(() => setToast(null), undo ? 7000 : 2500);
  }, []);

  // ── Notes (synced across tabs) ──────────────────────────────────────────────
  const notesList = useSyncedList<Note>("notes", {
    onExternalChange: (merged) => {
      // Another tab changed notes. If the open note changed there and we
      // have no unsaved typing here, show the new version.
      const ed = editorRef.current;
      const id = activeIdRef.current;
      const current = merged.find((n) => n.id === id);
      if (!current) {
        if (merged.length) selectNote(sortNotes(merged, sort)[0].id);
        return;
      }
      if (ed && !pendingEdit.current && current.content !== ed.getHTML()) loadIntoEditor(current.content, true);
    },
  });
  const { items: notes, setItems: setNotes, loaded: notesLoaded, saveError } = notesList;
  const notesRef = useRef(notes);
  notesRef.current = notes;

  useEffect(() => {
    if (saveError) setSaveStatus("error");
  }, [saveError]);

  // ── Editor ──────────────────────────────────────────────────────────────────
  /** Push the editor's current content into the notes list (and storage). */
  const commitEdit = useCallback(() => {
    clearTimeout(pendingEdit.current);
    pendingEdit.current = undefined;
    const ed = editorRef.current;
    const id = activeIdRef.current;
    if (!ed || !id) return;
    const html = ed.getHTML();
    const before = notesRef.current.find((n) => n.id === id);
    if (!before || before.content === html) {
      setSaveStatus((s) => (s === "saving" ? "saved" : s));
      return;
    }
    const title = before.autoTitle ? deriveTitle(ed) : before.title;
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, content: html, title } : n)));
    void notesList.flush().then(() => {
      setSaveStatus("saved");
      setLastSavedAt(new Date());
    });
  }, [setNotes, notesList]);

  const updateNotePick = useCallback((ed: Editor) => {
    const p = detectNotePick(ed);
    const ref = notePickRef.current;
    if (p && ref.dismissedAt === p.from) return;
    if (!p) ref.dismissedAt = null;
    const items = p ? filterNotesForLink(notesRef.current, p.query, activeIdRef.current) : [];
    const canCreate = !!p && p.query.trim().length > 0 && !items.some((n) => n.title.trim().toLowerCase() === p.query.trim().toLowerCase());
    const count = items.length + (canCreate ? 1 : 0);
    const index = p && ref.state && ref.state.from === p.from ? Math.min(ref.index, Math.max(0, count - 1)) : 0;
    notePickRef.current = { ...ref, state: p, items, index, canCreate };
    setNotePick(p);
    setNotePickIndex(index);
  }, []);

  const closeNotePick = useCallback(() => {
    notePickRef.current = { ...notePickRef.current, state: null, dismissedAt: notePickRef.current.state?.from ?? null };
    setNotePick(null);
  }, []);

  const pickNoteLink = useCallback((target: { id: string; title: string }) => {
    const ed = editorRef.current;
    const p = notePickRef.current.state;
    if (!ed || !p) return;
    ed.chain().focus().deleteRange({ from: p.from, to: p.to }).insertNoteLink({ id: target.id, title: target.title || "Untitled" }).run();
    notePickRef.current = { ...notePickRef.current, state: null, dismissedAt: null };
    setNotePick(null);
  }, []);

  const updateSlash = useCallback((ed: Editor) => {
    updateNotePick(ed);
    const s = detectSlash(ed);
    const ref = slashRef.current;
    if (s && ref.dismissedAt === s.from) return;
    if (!s) ref.dismissedAt = null;
    const items = s ? filterSlashItems(s.query) : [];
    const index = s && ref.state && ref.state.from === s.from ? Math.min(ref.index, Math.max(0, items.length - 1)) : 0;
    slashRef.current = { ...ref, state: s, items, index };
    setSlash(s);
    setSlashIndex(index);
  }, []);

  const closeSlash = useCallback(() => {
    slashRef.current = { ...slashRef.current, state: null, dismissedAt: slashRef.current.state?.from ?? null };
    setSlash(null);
  }, []);

  const pickSlash = useCallback((item: SlashItem) => {
    const ed = editorRef.current;
    const s = slashRef.current.state;
    if (!ed || !s) return;
    ed.chain().focus().deleteRange({ from: s.from, to: s.to }).run();
    item.run(ed);
    slashRef.current = { ...slashRef.current, state: null, dismissedAt: null };
    setSlash(null);
  }, []);

  // Ctrl/⌘+K, 🔗 and "Edit" open the link box next to the text (editor/LinkBox.tsx).
  const [linkBox, setLinkBox] = useState<LinkBoxState | null>(null);
  const setLink = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) return;
    if (ed.isActive("link")) ed.chain().extendMarkRange("link").run();
    setLinkBox(linkBoxFor(ed));
  }, []);
  const closeLinkBox = useCallback(() => setLinkBox(null), []);

  // 🔍 Find & replace in this note: Ctrl/⌘+F, Ctrl/⌘+Shift+F (Replace shown), or ⋯ → Find and replace.
  const [find, setFind] = useState<{ query: string; replace: boolean } | null>(null);
  const findOpenRef = useRef(false);
  findOpenRef.current = !!find;
  const findBarRef = useRef<FindBarHandle>(null);
  const lastFindQuery = useRef("");
  const openFind = useCallback((replace: boolean) => {
    const ed = editorRef.current;
    if (!ed) return;
    const picked = selectionQuery(ed.state);
    if (findOpenRef.current) findBarRef.current?.focus({ query: picked || undefined, replace });
    else setFind({ query: picked || lastFindQuery.current, replace });
  }, []);
  const closeFind = useCallback(() => {
    const ed = editorRef.current;
    if (ed && !ed.isDestroyed) lastFindQuery.current = findStatus(ed).query;
    setFind(null);
    // Back to the note with the current match selected.
    ed?.chain().focus().scrollIntoView().run();
  }, []);

  const editor = useEditor(
    {
      extensions: buildExtensions(),
      content: "",
      editorProps: {
        attributes: { "aria-label": "Note editor", spellcheck: "true" },
        handleKeyDown: (_view, event) => {
          const np = notePickRef.current;
          if (np.state) {
            const count = np.items.length + (np.canCreate ? 1 : 0);
            if ((event.key === "ArrowDown" || event.key === "ArrowUp") && count) {
              const index = (np.index + (event.key === "ArrowDown" ? 1 : -1) + count) % count;
              notePickRef.current = { ...np, index };
              setNotePickIndex(index);
              return true;
            }
            if ((event.key === "Enter" || event.key === "Tab") && count) {
              if (np.index < np.items.length) pickNoteLink(np.items[np.index]);
              else createLinkedNoteRef.current(np.state.query);
              return true;
            }
            if (event.key === "Escape") {
              closeNotePick();
              return true;
            }
          }
          const s = slashRef.current;
          if (s.state) {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              const n = s.items.length || 1;
              const index = (s.index + (event.key === "ArrowDown" ? 1 : -1) + n) % n;
              slashRef.current = { ...s, index };
              setSlashIndex(index);
              return true;
            }
            if ((event.key === "Enter" || event.key === "Tab") && s.items[s.index]) {
              pickSlash(s.items[s.index]);
              return true;
            }
            if (event.key === "Escape") {
              closeSlash();
              return true;
            }
          }
          if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "j") {
            void improveRef.current?.open({ keyboard: true });
            return true;
          }
          if (event.key === "Escape" && improveRef.current?.openRef.current) {
            improveRef.current.close();
            return true;
          }
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
            event.preventDefault();
            setLink();
            return true;
          }
          return false;
        },
        handleClick: (_view, _pos, event) => {
          // Ctrl/⌘ + click opens links; a plain click just places the cursor.
          const a = (event.target as HTMLElement | null)?.closest("a");
          if (a?.href && (event.metaKey || event.ctrlKey)) {
            window.open(a.href, "_blank", "noopener,noreferrer");
            return true;
          }
          return false;
        },
        handleDrop: (view, event, _slice, moved) => {
          if (moved) return false;
          const files = Array.from(event.dataTransfer?.files ?? []).filter(isNoteImage);
          if (!files.length) return false;
          event.preventDefault();
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
          void insertImagesRef.current(files, at?.pos);
          return true;
        },
        handlePaste: (_view, event) => {
          // A pasted screenshot or copied picture.
          const pics = Array.from(event.clipboardData?.files ?? []).filter(isNoteImage);
          if (pics.length) {
            event.preventDefault();
            void insertImagesRef.current(pics);
            return true;
          }
          const text = event.clipboardData?.getData("text/plain") ?? "";
          const html = event.clipboardData?.getData("text/html") ?? "";
          const ed = editorRef.current;
          if (!ed || html || !text || ed.isActive("codeBlock") || !looksLikeMarkdown(text)) return false;
          event.preventDefault();
          void loadMarkdownImport().then((m) => ed.chain().focus().insertContent(m.markdownToNoteHtml(text)).run());
          return true;
        },
      },
      onUpdate: ({ editor: ed }) => {
        updateSlash(ed);
        if (loadingContent.current) return;
        setSaveStatus("saving");
        clearTimeout(pendingEdit.current);
        pendingEdit.current = setTimeout(commitEdit, EDIT_DEBOUNCE_MS);
      },
      onSelectionUpdate: ({ editor: ed }) => updateSlash(ed),
      onBlur: () => {
        if (pendingEdit.current) commitEdit();
      },
    },
    [],
  );
  editorRef.current = editor;

  // Pictures: shrink on this device and put them in the note (lib/noteImages.ts).
  const imageInputRef = useRef<HTMLInputElement>(null);
  const insertImagesRef = useRef<(files: File[], pos?: number) => Promise<void>>(async () => {});
  insertImagesRef.current = async (files, pos) => {
    const ed = editorRef.current;
    if (!ed) return;
    for (const f of files.slice(0, 6)) {
      try {
        const src = await imageFileToDataUrl(f);
        if (!fitsInNote(ed.getHTML().length, src.length)) {
          showToast("This note holds as many pictures as it can (about 1.3 MB). Put more in a new note.");
          return;
        }
        const node = { type: "image", attrs: { src, alt: f.name.replace(/\.[^.]+$/, "").slice(0, 120) } };
        if (pos !== undefined) ed.chain().focus().insertContentAt(pos, node).run();
        else ed.chain().focus().insertContent(node).run();
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Couldn't add the picture.");
      }
    }
  };
  useEffect(() => {
    const open = () => imageInputRef.current?.click();
    window.addEventListener(INSERT_IMAGE_EVENT, open);
    return () => window.removeEventListener(INSERT_IMAGE_EVENT, open);
  }, []);

  // ✨ Improve (writing help) for the selection: bubble button, Ctrl/⌘+J, command palette.
  const improve = useImprove(editor, pageRef, showToast);
  improveRef.current = improve;
  const closeImprove = improve.close;
  useEffect(() => closeImprove(), [activeId, closeImprove]);
  useEffect(() => {
    const onImprove = (e: Event) => void improveRef.current?.open({ keyboard: true, action: (e as CustomEvent<{ action?: RewriteAction }>).detail?.action });
    window.addEventListener(IMPROVE_EVENT, onImprove);
    return () => window.removeEventListener(IMPROVE_EVENT, onImprove);
  }, []);

  /** Show a note's content with a fresh undo history (undo never crosses notes). */
  const loadIntoEditor = useCallback((html: string, keepSelection = false) => {
    const ed = editorRef.current;
    if (!ed) return;
    const { from } = ed.state.selection;
    loadingContent.current = true;
    ed.commands.setContent(html || "", { emitUpdate: false });
    const fresh = EditorState.create({ doc: ed.state.doc, plugins: ed.state.plugins, schema: ed.schema });
    ed.view.updateState(fresh);
    if (keepSelection) ed.commands.setTextSelection(Math.min(from, ed.state.doc.content.size));
    loadingContent.current = false;
    slashRef.current = { state: null, items: [], index: 0, dismissedAt: null };
    setSlash(null);
    notePickRef.current = { state: null, items: [], index: 0, canCreate: false, dismissedAt: null };
    setNotePick(null);
  }, []);

  const toolbar = useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      if (!ed || ed.isDestroyed || !ed.state?.doc) return null;
      const doc = ed.state.doc;
      const text = doc.textContent;
      const fullText = doc.textBetween(0, doc.content.size, "\n", " ");
      const { from, to, empty } = ed.state.selection;
      const headings: { level: number; text: string; pos: number }[] = [];
      ed.state.doc.descendants((node, pos) => {
        if (node.type.name === "heading" && node.textContent.trim()) headings.push({ level: node.attrs.level as number, text: node.textContent.trim(), pos });
        return node.type.name !== "heading";
      });
      return {
        bold: ed.isActive("bold"),
        italic: ed.isActive("italic"),
        underline: ed.isActive("underline"),
        strike: ed.isActive("strike"),
        highlight: ed.isActive("highlight"),
        code: ed.isActive("code"),
        link: ed.isActive("link"),
        bullet: ed.isActive("bulletList"),
        ordered: ed.isActive("orderedList"),
        task: ed.isActive("taskList"),
        quote: ed.isActive("blockquote"),
        codeBlock: ed.isActive("codeBlock"),
        inTable: ed.isActive("table"),
        block: ed.isActive("heading", { level: 1 }) ? "h1" : ed.isActive("heading", { level: 2 }) ? "h2" : ed.isActive("heading", { level: 3 }) ? "h3" : "p",
        canUndo: ed.can().undo(),
        canRedo: ed.can().redo(),
        words: getWordCount(fullText),
        chars: text.length,
        selectedWords: empty ? 0 : getWordCount(ed.state.doc.textBetween(from, to, " ")),
        headings,
      };
    },
  });

  // ── Loading ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    void Promise.all([storageGet<string | null>("activeNoteId", null), storageGet<string>("editorFont", "system"), storageGet<NoteSort>("notesSort", "updated")]).then(
      ([savedActive, savedFont, savedSort]) => {
        setEditorFont(FONT_OPTIONS.some((f) => f.value === savedFont) ? (savedFont as EditorFont) : "system");
        setSort(["updated", "created", "title"].includes(savedSort) ? savedSort : "updated");
        activeIdRef.current = savedActive;
        setActiveId(savedActive);
        setPrefsLoaded(true);
      },
    );
  }, []);

  // First run: create a welcome note. Make sure the open note exists.
  useEffect(() => {
    if (!notesLoaded || !prefsLoaded) return;
    if (notes.length === 0) {
      const welcome = newNote({
        // The same id on every device, so after signing in to sync there's one welcome note, not one per computer.
        id: "welcome",
        title: "Welcome to ProdLi",
        autoTitle: false,
        content:
          "<h1>Welcome to ProdLi</h1><p>Your notes save automatically and stay on this device.</p><ul data-type=\"taskList\"><li data-type=\"taskItem\" data-checked=\"false\"><p>Type <code>/</code> to insert checklists, tables, headings and more</p></li><li data-type=\"taskItem\" data-checked=\"false\"><p>Select text to format it, or paste Markdown</p></li><li data-type=\"taskItem\" data-checked=\"false\"><p>Pin, duplicate or export notes from the <strong>⋯</strong> menu</p></li></ul>",
      });
      setNotes([welcome]);
      selectNote(welcome.id);
      return;
    }
    const real = notes.filter((n) => !n.template);
    if (!activeIdRef.current || !notes.some((n) => n.id === activeIdRef.current)) {
      if (real.length) selectNote(sortNotes(real, sort)[0].id);
      else {
        const blank = newNote();
        setNotes((prev) => [blank, ...prev]);
        selectNote(blank.id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesLoaded, prefsLoaded, notes.length]);

  // Show the active note in the editor when it changes.
  useEffect(() => {
    if (!editor || !activeId) return;
    const note = notesRef.current.find((n) => n.id === activeId);
    if (note) loadIntoEditor(note.content);
  }, [editor, activeId, notesLoaded, loadIntoEditor]);

  // Save typing before the tab is hidden or closed.
  useEffect(() => {
    const flush = () => {
      if (pendingEdit.current) commitEdit();
    };
    const onVis = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVis);
      flush();
    };
  }, [commitEdit]);

  // ── Actions ─────────────────────────────────────────────────────────────────
  // Phones show the note list or the open note, not both.
  const [mobilePane, setMobilePane] = useState<"list" | "note">("note");
  const openNote = (id: string) => {
    selectNote(id);
    setMobilePane("note");
  };

  function selectNote(id: string) {
    if (pendingEdit.current) commitEdit();
    // Leaving a note you never wrote in: tidy it away instead of keeping an empty "Untitled".
    const leaving = activeIdRef.current;
    const doc = editorRef.current?.state.doc;
    if (leaving && leaving !== id && doc && doc.textContent.trim() === "") {
      let hasContent = false;
      doc.descendants((node) => {
        if (node.isAtom && !node.isText) hasContent = true;
        return !hasContent;
      });
      const note = notesRef.current.find((n) => n.id === leaving);
      if (!hasContent && note && isBlankNote({ ...note, content: "" })) setNotes((prev) => prev.filter((n) => n.id !== leaving));
    }
    activeIdRef.current = id;
    setActiveId(id);
    void storageSet("activeNoteId", id).catch(() => {});
  }

  const createNote = useCallback(() => {
    // Already on an empty note (or one is waiting): use it rather than adding another "Untitled".
    const current = notesRef.current.find((n) => n.id === activeIdRef.current);
    const blank = current && isBlankNote(current) && editorRef.current?.state.doc.textContent.trim() === "" ? current : notesRef.current.find((n) => n.id !== activeIdRef.current && isBlankNote(n));
    if (blank) {
      if (blank.id !== activeIdRef.current) selectNote(blank.id);
      setMobilePane("note");
      setTimeout(() => {
        const ed = editorRef.current;
        if (!ed) return;
        // Older empty notes have no title line yet: give them one.
        if (ed.state.doc.firstChild?.type.name !== "heading") ed.commands.setContent("<h1></h1>", { emitUpdate: true });
        ed.commands.focus("start");
      }, 0);
      return;
    }
    // New notes start with a title line (shown as “Untitled” until you type).
    const note = newNote({ content: "<h1></h1>" });
    setNotes((prev) => [note, ...prev]);
    selectNote(note.id);
    setMobilePane("note");
    setTimeout(() => editorRef.current?.commands.focus("start"), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setNotes]);

  const createFromTemplate = (html: string, name: string) => {
    if (pendingEdit.current) commitEdit();
    const note = newNoteFromTemplate(html, name);
    setNotes((prev) => [note, ...prev]);
    selectNote(note.id);
    setMobilePane("note");
    showToast(`New note from “${name}”`);
  };
  const saveAsTemplate = (id: string) => {
    if (pendingEdit.current) commitEdit();
    const src = notesRef.current.find((n) => n.id === id);
    if (!src) return;
    const tpl = newNote({ title: src.title || "Untitled template", content: src.content, autoTitle: false, template: true });
    setNotes((prev) => [tpl, ...prev]);
    showToast(`Saved “${tpl.title}” as a template (▾ menu)`);
  };
  const deleteTemplate = (id: string) => {
    const t = notesRef.current.find((n) => n.id === id);
    if (!t || !window.confirm(`Delete the template “${t.title}”? Notes made from it stay.`)) return;
    const remaining = notesRef.current.filter((n) => n.id !== id);
    setNotes(remaining);
    if (activeIdRef.current === id) {
      const next = sortNotes(remaining.filter((n) => !n.template), sort)[0];
      if (next) selectNote(next.id);
    }
  };
  const dailyBusy = useRef(false);
  const openDailyNote = useCallback(async () => {
    if (dailyBusy.current) return;
    dailyBusy.current = true;
    try {
      await storageSet(PENDING_DAILY_KEY, false).catch(() => {});
      if (pendingEdit.current) commitEdit();
      const r = await prepareDailyNote(notesRef.current);
      if (r.note) setNotes((prev) => [r.note!, ...prev]);
      selectNote(r.id);
      setMobilePane("note");
    } finally {
      dailyBusy.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setNotes]);

  // [[ → "New note …": make the note (titled by its first heading) and link to it, staying here.
  createLinkedNoteRef.current = (query: string) => {
    const title = query.trim().slice(0, 120);
    if (!title) return;
    const esc = title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const note = newNote({ title, content: `<h1>${esc}</h1><p></p>` });
    setNotes((prev) => [note, ...prev]);
    pickNoteLink({ id: note.id, title });
    showToast(`Created “${title}”`);
  };

  // Note links show current titles; clicking one opens that note.
  useEffect(() => {
    setNoteTitles(notes.filter((n) => !n.template));
  }, [notes]);
  useEffect(() => {
    const onOpenLink = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      if (id && notesRef.current.some((n) => n.id === id)) openNote(id);
    };
    window.addEventListener(OPEN_NOTE_LINK_EVENT, onOpenLink);
    return () => window.removeEventListener(OPEN_NOTE_LINK_EVENT, onOpenLink);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ask ProdLi → a source note: open it (Notes was already showing).
  useEffect(() => {
    const onOpen = (e: Event) => {
      const src = (e as CustomEvent<{ kind: string; id: string }>).detail;
      if (src?.kind === "note" && notesRef.current.some((n) => n.id === src.id)) selectNote(src.id);
    };
    window.addEventListener(OPEN_ITEM_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_ITEM_EVENT, onOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ⌘K → "Open today's daily note": a flag (if Notes wasn't open yet) or an event (if it was).
  useEffect(() => {
    if (!notesLoaded || !prefsLoaded) return;
    void storageGet<boolean>(PENDING_DAILY_KEY, false).then((pending) => pending && void openDailyNote());
    const onEvent = () => void openDailyNote();
    window.addEventListener(DAILY_NOTE_EVENT, onEvent);
    return () => window.removeEventListener(DAILY_NOTE_EVENT, onEvent);
  }, [notesLoaded, prefsLoaded, openDailyNote]);

  const renameNote = (id: string, title: string) =>
    setNotes((prev) =>
      prev.map((n) => {
        if (n.id !== id) return n;
        if (title) return { ...n, title, autoTitle: false };
        const ed = editorRef.current;
        return { ...n, autoTitle: true, title: id === activeIdRef.current && ed ? deriveTitle(ed) : n.title || "Untitled" };
      }),
    );

  const togglePin = (id: string) => setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, pinned: !n.pinned } : n)));

  const duplicateNote = (id: string) => {
    if (pendingEdit.current) commitEdit();
    const src = notesRef.current.find((n) => n.id === id);
    if (!src) return;
    const copy = newNote({ title: `${src.title || "Untitled"} (copy)`, content: src.content, autoTitle: false });
    setNotes((prev) => [copy, ...prev]);
    selectNote(copy.id);
    showToast("Note duplicated");
  };

  const deleteNote = (id: string) => {
    if (pendingEdit.current) commitEdit();
    const removed = notesRef.current.find((n) => n.id === id);
    if (!removed) return;
    const remaining = notesRef.current.filter((n) => n.id !== id);
    const real = remaining.filter((n) => !n.template);
    if (real.length === 0) {
      const blank = newNote();
      setNotes([blank, ...remaining]);
      selectNote(blank.id);
    } else {
      setNotes(remaining);
      if (activeIdRef.current === id) selectNote(sortNotes(real, sort)[0].id);
    }
    showToast(`Deleted “${removed.title || "Untitled"}”`, () => {
      setNotes((prev) => [removed, ...prev.filter((n) => n.id !== removed.id && !(n.autoTitle && !n.content && prev.length === 1))]);
      selectNote(removed.id);
      setToast(null);
    });
  };

  const changeFont = (font: EditorFont) => {
    setEditorFont(font);
    void storageSet("editorFont", font).catch(() => {});
  };

  const changeSort = (s: NoteSort) => {
    setSort(s);
    void storageSet("notesSort", s).catch(() => {});
  };

  const activeNote = notes.find((n) => n.id === activeId) ?? null;

  // 🔊 Read aloud (⋯ → Listen). Stops when you open another note or leave Notes.
  const reader = useReadAloud();
  const stopReader = reader.stop;
  useEffect(() => stopReader(), [activeId]); // eslint-disable-line react-hooks/exhaustive-deps
  const listen = () => {
    const text = htmlToSpeechText(editorRef.current?.getHTML() ?? activeNote?.content ?? "");
    if (!reader.start(text)) showToast(text ? "Read aloud isn't available in this browser" : "Nothing to read in this note");
  };

  const currentMarkdown = async () => {
    const ed = editorRef.current;
    const { noteToMarkdown } = await loadMarkdownExport();
    return noteToMarkdown(activeNote?.title || "Untitled", ed?.getHTML() ?? activeNote?.content ?? "");
  };

  const exportMarkdown = async () => {
    if (!activeNote) return;
    const [{ downloadText, safeFileName }, md] = await Promise.all([loadMarkdownExport(), currentMarkdown()]);
    downloadText(safeFileName(activeNote.title || "note", "md"), md);
  };

  const copyMarkdown = async () => {
    await navigator.clipboard.writeText(await currentMarkdown());
    showToast("Copied as Markdown");
  };

  const importMarkdown = async (file: File) => {
    if (file.size > MAX_NOTE_BYTES) {
      showToast(`${file.name} is too large to import (max 1 MB)`);
      return;
    }
    const text = await file.text();
    const { markdownToNoteHtml } = await loadMarkdownImport();
    const note = newNote({ title: file.name.replace(/\.(md|markdown|txt)$/i, "") || "Imported note", content: markdownToNoteHtml(text), autoTitle: false });
    setNotes((prev) => [note, ...prev]);
    selectNote(note.id);
    showToast(`Imported ${file.name}`);
  };

  const printNote = () => {
    if (pendingEdit.current) commitEdit();
    document.documentElement.classList.add("printing-note");
    window.print();
    document.documentElement.classList.remove("printing-note");
  };

  // Close the More menu when clicking elsewhere.
  useEffect(() => {
    if (!showMore) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[aria-label="More note actions"], [title^="More: copy"]')) setShowMore(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [showMore]);

  // Ctrl/⌘+F finds in the note, Ctrl/⌘+Shift+F also shows Replace — while you're in Notes
  // (the browser's own find still works everywhere else, and over dialogs).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== "f") return;
      const t = e.target as HTMLElement | null;
      const inNotes = !!t?.closest?.(".editor-root") || ((t === document.body || t === document.documentElement) && !document.querySelector('[aria-modal="true"]'));
      if (!inNotes) return;
      e.preventDefault();
      openFind(e.shiftKey);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openFind]);

  // Escape leaves full screen; Alt+N makes a new note.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === "Escape" && isFullscreen && !slashRef.current.state && !improveRef.current?.openRef.current) setIsFullscreen(false);
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === "n" || e.key === "N" || e.code === "KeyN")) {
        e.preventDefault();
        createNote();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isFullscreen, createNote]);

  if (!notesLoaded || !prefsLoaded) {
    return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: 16, fontWeight: 700 }}>Loading...</div>;
  }

  const t = toolbar;
  const run = (fn: (e: Editor) => void) => () => editor && fn(editor);
  const saveLabel =
    saveStatus === "error"
      ? `⚠ Couldn't save${saveError ? ` — ${saveError}` : ""}`
      : saveStatus === "saving"
        ? "Saving…"
        : lastSavedAt
          ? `Saved ${lastSavedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
          : "All changes saved";

  return (
    <div
      className={`editor-root mobile-${mobilePane}`}
      style={{
        display: "flex",
        height: "100%",
        position: "relative",
        ...(isFullscreen ? { position: "fixed" as const, inset: 0, zIndex: 9999, background: "hsl(var(--card))" } : {}),
      }}
    >
      {!isFullscreen && (
        <NoteList
          notes={notes.filter((n) => !n.template)}
          templates={notes.filter((n) => n.template)}
          onFromTemplate={createFromTemplate}
          onEditTemplate={(id) => openNote(id)}
          onDeleteTemplate={deleteTemplate}
          onSaveAsTemplate={saveAsTemplate}
          onDailyNote={() => void openDailyNote()}
          activeId={activeId}
          sort={sort}
          onSortChange={changeSort}
          onSelect={openNote}
          onCreate={createNote}
          onRename={renameNote}
          onTogglePin={togglePin}
          onDuplicate={duplicateNote}
          onDelete={deleteNote}
        />
      )}

      <div className="editor-main" style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <button className="mobile-only editor-back" onClick={() => setMobilePane("list")} aria-label="Back to all notes">
          ← All notes <span style={{ opacity: 0.6, fontWeight: 600 }}>({notes.length})</span>
        </button>
        {activeNote?.template && (
          <div role="status" data-testid="template-banner" style={{ borderBottom: "var(--nb-border)", background: "#FFF3CD", color: "#000", padding: "6px 16px", fontSize: 12, fontWeight: 700 }}>
            ✎ Editing the template “{activeNote.title}”. New notes made from it use these changes.
          </div>
        )}
        {/* Toolbar */}
        <div role="toolbar" aria-label="Formatting" className="editor-toolbar-row" style={{ borderBottom: "var(--nb-border)", padding: "8px 16px", display: "flex", gap: 6, background: "hsl(var(--muted))", alignItems: "center" }}>
          {/* Formatting buttons scroll sideways when there's no room; the note actions on the right stay put. */}
          <div className="editor-toolbar-scroll" style={{ display: "flex", gap: 4, alignItems: "center", flex: "1 1 auto", minWidth: 0, overflowX: "auto", scrollbarWidth: "thin" }}>
          <ToolbarButton onClick={run((e) => e.chain().focus().undo().run())} disabled={!t?.canUndo} title="Undo (Ctrl/⌘+Z)">↩</ToolbarButton>
          <ToolbarButton onClick={run((e) => e.chain().focus().redo().run())} disabled={!t?.canRedo} optional title="Redo (Ctrl/⌘+Shift+Z)">↪</ToolbarButton>
          <Divider />
          <select
            aria-label="Text style"
            value={t?.block ?? "p"}
            onChange={(ev) => {
              const v = ev.target.value;
              if (!editor) return;
              if (v === "p") editor.chain().focus().setParagraph().run();
              else editor.chain().focus().setHeading({ level: Number(v[1]) as 1 | 2 | 3 }).run();
            }}
            style={{ border: "var(--nb-border)", background: "hsl(var(--card))", color: "hsl(var(--foreground))", fontWeight: 700, fontSize: 11, height: 32, padding: "0 6px", boxShadow: "var(--nb-shadow-sm)", fontFamily: "inherit", cursor: "pointer" }}
          >
            <option value="p">Text</option>
            <option value="h1">Heading 1</option>
            <option value="h2">Heading 2</option>
            <option value="h3">Heading 3</option>
          </select>
          <Divider />
          <ToolbarButton onClick={run((e) => e.chain().focus().toggleBold().run())} active={t?.bold} title="Bold (Ctrl/⌘+B)">B</ToolbarButton>
          <ToolbarButton onClick={run((e) => e.chain().focus().toggleItalic().run())} active={t?.italic} title="Italic (Ctrl/⌘+I)"><em>I</em></ToolbarButton>
          <ToolbarButton onClick={run((e) => e.chain().focus().toggleUnderline().run())} active={t?.underline} optional title="Underline (Ctrl/⌘+U)"><u>U</u></ToolbarButton>
          <ToolbarButton onClick={run((e) => e.chain().focus().toggleStrike().run())} active={t?.strike} optional title="Strikethrough (Ctrl/⌘+Shift+S)"><s>S</s></ToolbarButton>
          <ToolbarButton onClick={run((e) => e.chain().focus().toggleHighlight().run())} active={t?.highlight} optional title="Highlight (Ctrl/⌘+Shift+H)">🖍</ToolbarButton>
          <ToolbarButton onClick={run((e) => e.chain().focus().toggleCode().run())} active={t?.code} optional title="Inline code (Ctrl/⌘+E)">{"<>"}</ToolbarButton>
          <ToolbarButton onClick={setLink} active={t?.link} title="Link (Ctrl/⌘+K)">🔗</ToolbarButton>
          <Divider />
          <ToolbarButton onClick={run((e) => e.chain().focus().toggleBulletList().run())} active={t?.bullet} title="Bullet list">•</ToolbarButton>
          <ToolbarButton onClick={run((e) => e.chain().focus().toggleOrderedList().run())} active={t?.ordered} optional title="Numbered list">
            <ListOrdered size={16} strokeWidth={2.5} aria-hidden="true" />
          </ToolbarButton>
          <ToolbarButton onClick={run((e) => e.chain().focus().toggleTaskList().run())} active={t?.task} title="Checklist">☑</ToolbarButton>
          <ToolbarButton onClick={run((e) => e.chain().focus().toggleBlockquote().run())} active={t?.quote} optional title="Quote">❝</ToolbarButton>
          <ToolbarButton onClick={run((e) => e.chain().focus().toggleCodeBlock().run())} active={t?.codeBlock} optional title="Code block">{"{}"}</ToolbarButton>
          <ToolbarButton onClick={run((e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())} active={t?.inTable} optional title="Insert table">▦</ToolbarButton>
          <ToolbarButton onClick={run((e) => e.chain().focus().setHorizontalRule().run())} optional title="Divider line">—</ToolbarButton>

          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6, flex: "0 0 auto" }}>
            <ReadAloudBar reader={reader} />
            <ToolbarButton onClick={() => setShowOutline((v) => !v)} active={showOutline} optional title="Outline (headings in this note)">☰</ToolbarButton>
            <div style={{ position: "relative" }}>
              <ToolbarButton onClick={() => setShowMore((v) => !v)} active={showMore} title="More: find, font, copy, import, export, print">⋯</ToolbarButton>
              {showMore && (
                <div role="menu" aria-label="More note actions" style={{ position: "absolute", right: 0, top: 38, zIndex: 30, minWidth: 220, background: "hsl(var(--card))", color: "hsl(var(--foreground))", border: "var(--nb-border)", boxShadow: "var(--nb-shadow)", padding: 4 }}>
                  {[
                    { icon: "🔍", label: "Find and replace…", title: "Find and replace in this note (Ctrl/⌘+F)", run: () => openFind(true) },
                    { icon: "⧉", label: "Copy as Markdown", title: "Copy note as Markdown", run: () => void copyMarkdown() },
                    { icon: "⬆", label: "Import Markdown file…", title: "Import a Markdown file as a new note", run: () => importInputRef.current?.click() },
                    { icon: "⬇", label: "Export as Markdown (.md)", title: "Export this note as Markdown (.md)", run: exportMarkdown },
                    { icon: "🖨", label: "Print / save as PDF", title: "Print or save as PDF", run: printNote },
                    ...(reader.available ? [{ icon: "▶", label: "Listen (read aloud)", title: "Read this note aloud", run: listen }] : []),
                  ].map((item) => (
                    <button
                      key={item.label}
                      role="menuitem"
                      title={item.title}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setShowMore(false);
                        item.run();
                      }}
                      style={{ display: "flex", gap: 10, alignItems: "center", width: "100%", textAlign: "left", padding: "7px 10px", border: "none", background: "transparent", color: "inherit", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}
                    >
                      <span style={{ width: 18, textAlign: "center" }}>{item.icon}</span>
                      {item.label}
                    </button>
                  ))}
                  <div role="group" aria-label="Writing font" style={{ borderTop: "1px solid var(--nb-section-border)", marginTop: 4, paddingTop: 4 }}>
                    <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.7, padding: "4px 10px" }}>Font</div>
                    <div style={{ display: "flex", gap: 4, padding: "2px 6px 6px" }}>
                      {FONT_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          role="menuitemradio"
                          aria-checked={editorFont === opt.value}
                          title={opt.label}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => changeFont(opt.value)}
                          style={{ flex: 1, padding: "6px 4px", border: editorFont === opt.value ? "2px solid hsl(var(--foreground))" : "1px solid var(--nb-section-border)", background: editorFont === opt.value ? "#FFD700" : "transparent", color: editorFont === opt.value ? "#000" : "inherit", cursor: "pointer", fontFamily: opt.family, fontSize: 15, fontWeight: 700, lineHeight: 1.1 }}
                        >
                          Aa
                          <span style={{ display: "block", fontSize: 9, fontFamily: "var(--app-font-sans)", fontWeight: 700, marginTop: 2 }}>{opt.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp"
              multiple
              data-testid="note-image-input"
              style={{ display: "none" }}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (files.length) void insertImagesRef.current(files);
              }}
            />
            <input
              ref={importInputRef}
              type="file"
              accept=".md,.markdown,.txt,text/markdown,text/plain"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importMarkdown(f);
                e.target.value = "";
              }}
            />
            <ToolbarButton onClick={() => setIsFullscreen((f) => !f)} active={isFullscreen} optional title={isFullscreen ? "Exit full screen (Esc)" : "Full screen"}>⛶</ToolbarButton>
          </div>
        </div>

        {editor && find && <FindBar ref={findBarRef} editor={editor} initialQuery={find.query} initialReplace={find.replace} onClose={closeFind} />}

        {/* Table controls appear while the cursor is in a table */}
        {t?.inTable && (
          <div className="editor-toolbar" role="toolbar" aria-label="Table" style={{ borderBottom: "var(--nb-border)", padding: "6px 16px", display: "flex", gap: 4, flexWrap: "wrap", background: "hsl(var(--background))", alignItems: "center" }}>
            <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", marginRight: 6 }}>Table</span>
            <ToolbarButton wide onClick={run((e) => e.chain().focus().addRowBefore().run())} title="Add row above">+ Row ↑</ToolbarButton>
            <ToolbarButton wide onClick={run((e) => e.chain().focus().addRowAfter().run())} title="Add row below">+ Row ↓</ToolbarButton>
            <ToolbarButton wide onClick={run((e) => e.chain().focus().addColumnBefore().run())} title="Add column left">+ Col ←</ToolbarButton>
            <ToolbarButton wide onClick={run((e) => e.chain().focus().addColumnAfter().run())} title="Add column right">+ Col →</ToolbarButton>
            <ToolbarButton wide onClick={run((e) => e.chain().focus().deleteRow().run())} title="Delete row">− Row</ToolbarButton>
            <ToolbarButton wide onClick={run((e) => e.chain().focus().deleteColumn().run())} title="Delete column">− Col</ToolbarButton>
            <ToolbarButton wide onClick={run((e) => e.chain().focus().toggleHeaderRow().run())} title="Toggle header row">Header</ToolbarButton>
            <ToolbarButton wide onClick={run((e) => e.chain().focus().deleteTable().run())} title="Delete table">Delete table</ToolbarButton>
          </div>
        )}

        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          {/* Editor content */}
          <div
            className="editor-scroll"
            style={{ flex: 1, overflowY: "auto", padding: "24px 56px", background: "hsl(var(--card))", fontFamily: FONT_OPTIONS.find((f) => f.value === editorFont)?.family }}
            onClick={(e) => {
              // Clicking the empty space below the text focuses the end of the note.
              if (e.target === e.currentTarget) editor?.commands.focus("end");
            }}
          >
            <div ref={pageRef} className="editor-page" style={{ maxWidth: 820, margin: "0 auto", position: "relative" }}>
              {activeNote && <PageHead key={activeNote.id} note={activeNote} onChange={(patch) => setNotes((prev) => prev.map((n) => (n.id === activeNote.id ? { ...n, ...patch, updatedAt: new Date().toISOString() } : n)))} />}
              <EditorContent editor={editor} style={{ minHeight: "100%" }} />
              <BlockHandle editor={editor} pageRef={pageRef} />
              {improve.panel}
            </div>
          </div>

          {showOutline && (
            <nav className="editor-outline" aria-label="Outline" style={{ width: 220, borderLeft: "var(--nb-border)", background: "hsl(var(--background))", overflowY: "auto", padding: "12px 10px", flexShrink: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Outline</div>
              {t?.headings.length ? (
                t.headings.map((h, i) => (
                  <button
                    key={`${h.pos}-${i}`}
                    onClick={() => editor?.chain().focus().setTextSelection(h.pos + 1).scrollIntoView().run()}
                    style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "transparent", color: "inherit", cursor: "pointer", padding: `4px 4px 4px ${(h.level - 1) * 12 + 4}px`, fontSize: h.level === 1 ? 13 : 12, fontWeight: h.level === 1 ? 800 : 600, fontFamily: "inherit", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                  >
                    {h.text}
                  </button>
                ))
              ) : (
                <div style={{ fontSize: 12, opacity: 0.7 }}>Add headings (type “/” → Heading) to build an outline.</div>
              )}
            </nav>
          )}
        </div>

        {/* Status bar */}
        <div className="editor-status" style={{ borderTop: "var(--nb-border)", padding: "6px 16px", display: "flex", gap: 16, background: "hsl(var(--muted))", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", alignItems: "center", whiteSpace: "nowrap" }}>
          {t && t.selectedWords > 0 ? <span style={{ background: "#FFD700", color: "#000", padding: "0 4px" }}>{t.selectedWords} selected</span> : <span>{t?.words ?? 0} words</span>}
          <span>{t?.chars ?? 0} chars</span>
          <span>{getReadingTime(t?.words ?? 0)}</span>
          <span className="editor-hints" style={{ opacity: 0.7, textTransform: "none", letterSpacing: 0, flex: "1 1 0", minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title="Type / for commands · [[ links a note · Ctrl/⌘+J improves selected text · Ctrl/⌘+click opens links">Type / for commands · [[ links a note · Ctrl/⌘+J improves selected text · Ctrl/⌘+click opens links</span>
          <span role="status" aria-live="polite" style={{ marginLeft: "auto", color: saveStatus === "error" ? "#E53935" : "hsl(var(--muted-foreground))" }}>
            {saveLabel}
          </span>
        </div>
      </div>

      {editor && linkBox && <LinkBox editor={editor} state={linkBox} onClose={closeLinkBox} />}
      {/* Formatting bubble on text selection or inside a link */}
      {editor && (
        <BubbleMenu
          editor={editor}
          pluginKey="formatBubble"
          shouldShow={({ editor: ed, state }) => {
            if (findOpenRef.current && !ed.view.hasFocus()) return false; // matches selected from the find bar
            if (ed.isActive("codeBlock") || slashRef.current.state || notePickRef.current.state || improveRef.current?.openRef.current || document.querySelector('[data-testid="link-box"]')) return false;
            // A selected picture, divider or other block (not text): nothing to format.
            if ("node" in state.selection && (state.selection as { node?: { isText?: boolean; isInline?: boolean } }).node && !(state.selection as { node: { isInline: boolean } }).node.isInline) return false;
            return !state.selection.empty || ed.isActive("link");
          }}
          options={{ placement: "top" }}
        >
          <div className="bubble-menu" style={{ display: "flex", gap: 3, padding: 4, background: "hsl(var(--card))", border: "var(--nb-border)", boxShadow: "var(--nb-shadow-sm)" }}>
            {t?.link && (
              <>
                <ToolbarButton wide onClick={() => { const href = editor.getAttributes("link").href as string | undefined; if (href) window.open(href, "_blank", "noopener,noreferrer"); }} title="Open link">Open ↗</ToolbarButton>
                <ToolbarButton wide onClick={setLink} title="Edit link">Edit</ToolbarButton>
                <ToolbarButton wide onClick={() => editor.chain().focus().extendMarkRange("link").unsetLink().run()} title="Remove link">Unlink</ToolbarButton>
              </>
            )}
            {!editor.state.selection.empty && (
              <>
                {isImprovable(editor.state.selection) && (
                  <>
                    <ToolbarButton wide onClick={() => void improve.open()} title="Improve writing (Ctrl/⌘+J)">✨ Improve</ToolbarButton>
                    <Divider />
                  </>
                )}
                <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} active={t?.bold} title="Bold">B</ToolbarButton>
                <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} active={t?.italic} title="Italic"><em>I</em></ToolbarButton>
                <ToolbarButton onClick={() => editor.chain().focus().toggleUnderline().run()} active={t?.underline} title="Underline"><u>U</u></ToolbarButton>
                <ToolbarButton onClick={() => editor.chain().focus().toggleStrike().run()} active={t?.strike} title="Strikethrough"><s>S</s></ToolbarButton>
                <ToolbarButton onClick={() => editor.chain().focus().toggleHighlight().run()} active={t?.highlight} title="Highlight">🖍</ToolbarButton>
                <ColorButton editor={editor} />
                <ToolbarButton onClick={() => editor.chain().focus().toggleCode().run()} active={t?.code} title="Inline code">{"<>"}</ToolbarButton>
                {!t?.link && <ToolbarButton onClick={setLink} title="Add link">🔗</ToolbarButton>}
              </>
            )}
          </div>
        </BubbleMenu>
      )}

      {notePick && (
        <NotePicker
          state={notePick}
          items={notePickRef.current.items}
          index={notePickIndex}
          canCreate={notePickRef.current.canCreate}
          onPick={(n) => pickNoteLink(n)}
          onCreate={() => createLinkedNoteRef.current(notePick.query)}
          onHover={(i) => {
            notePickRef.current = { ...notePickRef.current, index: i };
            setNotePickIndex(i);
          }}
        />
      )}
      {slash && <SlashMenu state={slash} items={slashRef.current.items} index={slashIndex} onPick={pickSlash} onHover={(i) => { slashRef.current = { ...slashRef.current, index: i }; setSlashIndex(i); }} />}

      {toast && (
        <div role="status" style={{ position: "absolute", left: "50%", bottom: 48, transform: "translateX(-50%)", zIndex: 50, display: "flex", gap: 12, alignItems: "center", background: "#000", color: "#FFD700", border: "2px solid #000", boxShadow: "3px 3px 0 #FFD700", padding: "8px 14px", fontWeight: 800, fontSize: 13 }}>
          {toast.text}
          {toast.undo && (
            <button onClick={toast.undo} style={{ border: "2px solid #FFD700", background: "#FFD700", color: "#000", fontWeight: 900, fontSize: 12, padding: "2px 10px", cursor: "pointer", fontFamily: "inherit" }}>
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
