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
import { downloadText, noteToMarkdown, safeFileName } from "../lib/markdownExport";
import { MAX_NOTE_BYTES } from "../lib/filePreview";
import { looksLikeMarkdown, markdownToNoteHtml } from "../lib/editorHtml";
import { buildExtensions } from "./editor/extensions";
import { detectSlash, filterSlashItems, SlashMenu, type SlashItem, type SlashState } from "./editor/SlashMenu";
import { NoteList, sortNotes, type NoteSort } from "./editor/NoteList";

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
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}
function ToolbarButton({ onClick, active, disabled, title, children, wide }: ToolbarButtonProps) {
  return (
    <button
      type="button"
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

const Divider = () => <div style={{ width: 1, height: 24, background: "var(--nb-section-border)", margin: "0 4px" }} />;

export function EditorSection() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editorFont, setEditorFont] = useState<EditorFont>("system");
  const [sort, setSort] = useState<NoteSort>("updated");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showOutline, setShowOutline] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  const activeIdRef = useRef<string | null>(null);
  const pendingEdit = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const loadingContent = useRef(false);
  const slashRef = useRef<{ state: SlashState | null; items: SlashItem[]; index: number; dismissedAt: number | null }>({ state: null, items: [], index: 0, dismissedAt: null });
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const importInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<Editor | null>(null);

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

  const updateSlash = useCallback((ed: Editor) => {
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

  const setLink = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const previous = (ed.getAttributes("link").href as string | undefined) ?? "";
    const input = window.prompt("Link URL (leave empty to remove the link):", previous || "https://");
    if (input === null) return;
    const url = input.trim();
    if (!url || url === "https://") {
      ed.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    const href = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
    if (/^javascript:/i.test(href)) return;
    if (ed.state.selection.empty && !ed.isActive("link")) {
      ed.chain().focus().insertContent({ type: "text", text: url, marks: [{ type: "link", attrs: { href } }] }).run();
    } else {
      ed.chain().focus().extendMarkRange("link").setLink({ href }).run();
    }
  }, []);

  const editor = useEditor(
    {
      extensions: buildExtensions(),
      content: "",
      editorProps: {
        attributes: { "aria-label": "Note editor", spellcheck: "true" },
        handleKeyDown: (_view, event) => {
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
        handlePaste: (_view, event) => {
          const text = event.clipboardData?.getData("text/plain") ?? "";
          const html = event.clipboardData?.getData("text/html") ?? "";
          const ed = editorRef.current;
          if (!ed || html || !text || ed.isActive("codeBlock") || !looksLikeMarkdown(text)) return false;
          ed.chain().focus().insertContent(markdownToNoteHtml(text)).run();
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
        title: "Welcome to ProdLi",
        autoTitle: false,
        content:
          "<h1>Welcome to ProdLi</h1><p>Your notes save automatically and stay on this device.</p><ul data-type=\"taskList\"><li data-type=\"taskItem\" data-checked=\"false\"><p>Type <code>/</code> to insert checklists, tables, headings and more</p></li><li data-type=\"taskItem\" data-checked=\"false\"><p>Select text to format it, or paste Markdown</p></li><li data-type=\"taskItem\" data-checked=\"false\"><p>Pin, duplicate or export notes from the <strong>⋯</strong> menu</p></li></ul>",
      });
      setNotes([welcome]);
      selectNote(welcome.id);
      return;
    }
    if (!activeIdRef.current || !notes.some((n) => n.id === activeIdRef.current)) selectNote(sortNotes(notes, sort)[0].id);
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
  function selectNote(id: string) {
    if (pendingEdit.current) commitEdit();
    activeIdRef.current = id;
    setActiveId(id);
    void storageSet("activeNoteId", id).catch(() => {});
  }

  const createNote = useCallback(() => {
    const note = newNote();
    setNotes((prev) => [note, ...prev]);
    selectNote(note.id);
    setTimeout(() => editorRef.current?.commands.focus("start"), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setNotes]);

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
    if (remaining.length === 0) {
      const blank = newNote();
      setNotes([blank]);
      selectNote(blank.id);
    } else {
      setNotes(remaining);
      if (activeIdRef.current === id) selectNote(sortNotes(remaining, sort)[0].id);
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

  const currentMarkdown = () => {
    const ed = editorRef.current;
    return noteToMarkdown(activeNote?.title || "Untitled", ed?.getHTML() ?? activeNote?.content ?? "");
  };

  const exportMarkdown = () => {
    if (!activeNote) return;
    downloadText(safeFileName(activeNote.title || "note", "md"), currentMarkdown());
  };

  const copyMarkdown = async () => {
    await navigator.clipboard.writeText(currentMarkdown());
    showToast("Copied as Markdown");
  };

  const importMarkdown = async (file: File) => {
    if (file.size > MAX_NOTE_BYTES) {
      showToast(`${file.name} is too large to import (max 1 MB)`);
      return;
    }
    const text = await file.text();
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

  // Escape leaves full screen; Alt+N makes a new note.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isFullscreen && !slashRef.current.state) setIsFullscreen(false);
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
      className="editor-root"
      style={{
        display: "flex",
        height: "100%",
        position: "relative",
        ...(isFullscreen ? { position: "fixed" as const, inset: 0, zIndex: 9999, background: "hsl(var(--card))" } : {}),
      }}
    >
      {!isFullscreen && (
        <NoteList
          notes={notes}
          activeId={activeId}
          sort={sort}
          onSortChange={changeSort}
          onSelect={selectNote}
          onCreate={createNote}
          onRename={renameNote}
          onTogglePin={togglePin}
          onDuplicate={duplicateNote}
          onDelete={deleteNote}
        />
      )}

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Toolbar */}
        <div className="editor-toolbar" role="toolbar" aria-label="Formatting" style={{ borderBottom: "var(--nb-border)", padding: "8px 16px", display: "flex", gap: 4, flexWrap: "wrap", background: "hsl(var(--muted))", alignItems: "center" }}>
          <ToolbarButton onClick={run((e) => e.chain().focus().undo().run())} disabled={!t?.canUndo} title="Undo (Ctrl/⌘+Z)">↩</ToolbarButton>
          <ToolbarButton onClick={run((e) => e.chain().focus().redo().run())} disabled={!t?.canRedo} title="Redo (Ctrl/⌘+Shift+Z)">↪</ToolbarButton>
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
          <ToolbarButton onClick={run((e) => e.chain().focus().toggleUnderline().run())} active={t?.underline} title="Underline (Ctrl/⌘+U)"><u>U</u></ToolbarButton>
          <ToolbarButton onClick={run((e) => e.chain().focus().toggleStrike().run())} active={t?.strike} title="Strikethrough (Ctrl/⌘+Shift+S)"><s>S</s></ToolbarButton>
          <ToolbarButton onClick={run((e) => e.chain().focus().toggleHighlight().run())} active={t?.highlight} title="Highlight (Ctrl/⌘+Shift+H)">🖍</ToolbarButton>
          <ToolbarButton onClick={run((e) => e.chain().focus().toggleCode().run())} active={t?.code} title="Inline code (Ctrl/⌘+E)">{"<>"}</ToolbarButton>
          <ToolbarButton onClick={setLink} active={t?.link} title="Link (Ctrl/⌘+K)">🔗</ToolbarButton>
          <Divider />
          <ToolbarButton onClick={run((e) => e.chain().focus().toggleBulletList().run())} active={t?.bullet} title="Bullet list">•</ToolbarButton>
          <ToolbarButton onClick={run((e) => e.chain().focus().toggleOrderedList().run())} active={t?.ordered} title="Numbered list">
            <ListOrdered size={16} strokeWidth={2.5} aria-hidden="true" />
          </ToolbarButton>
          <ToolbarButton onClick={run((e) => e.chain().focus().toggleTaskList().run())} active={t?.task} title="Checklist">☑</ToolbarButton>
          <ToolbarButton onClick={run((e) => e.chain().focus().toggleBlockquote().run())} active={t?.quote} title="Quote">❝</ToolbarButton>
          <ToolbarButton onClick={run((e) => e.chain().focus().toggleCodeBlock().run())} active={t?.codeBlock} title="Code block">{"{}"}</ToolbarButton>
          <ToolbarButton onClick={run((e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())} active={t?.inTable} title="Insert table">▦</ToolbarButton>
          <ToolbarButton onClick={run((e) => e.chain().focus().setHorizontalRule().run())} title="Divider line">—</ToolbarButton>
          <Divider />
          <select
            value={editorFont}
            onChange={(e) => changeFont(e.target.value as EditorFont)}
            aria-label="Writing font"
            title="Writing font"
            style={{ border: "var(--nb-border)", background: "hsl(var(--card))", color: "hsl(var(--foreground))", fontFamily: "var(--app-font-sans)", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", padding: "0 6px", height: 32, cursor: "pointer", outline: "none", boxShadow: "var(--nb-shadow-sm)" }}
          >
            {FONT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <ToolbarButton onClick={() => setShowOutline((v) => !v)} active={showOutline} title="Outline (headings in this note)">☰</ToolbarButton>
            <ToolbarButton onClick={() => void copyMarkdown()} title="Copy note as Markdown">⧉</ToolbarButton>
            <ToolbarButton onClick={() => importInputRef.current?.click()} title="Import a Markdown file as a new note">⬆</ToolbarButton>
            <ToolbarButton onClick={exportMarkdown} title="Export this note as Markdown (.md)">⬇</ToolbarButton>
            <ToolbarButton onClick={printNote} title="Print or save as PDF">🖨</ToolbarButton>
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
            <ToolbarButton onClick={() => setIsFullscreen((f) => !f)} active={isFullscreen} title={isFullscreen ? "Exit full screen (Esc)" : "Full screen"}>⛶</ToolbarButton>
          </div>
        </div>

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
            style={{ flex: 1, overflowY: "auto", padding: "24px 32px", background: "hsl(var(--card))", fontFamily: FONT_OPTIONS.find((f) => f.value === editorFont)?.family }}
            onClick={(e) => {
              // Clicking the empty space below the text focuses the end of the note.
              if (e.target === e.currentTarget) editor?.commands.focus("end");
            }}
          >
            <div className="editor-page" style={{ maxWidth: 820, margin: "0 auto" }}>
              <EditorContent editor={editor} style={{ minHeight: "100%" }} />
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
        <div className="editor-status" style={{ borderTop: "var(--nb-border)", padding: "6px 16px", display: "flex", gap: 16, background: "hsl(var(--muted))", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", flexWrap: "wrap" }}>
          {t && t.selectedWords > 0 ? <span style={{ color: "#c07000" }}>{t.selectedWords} selected</span> : <span>{t?.words ?? 0} words</span>}
          <span>{t?.chars ?? 0} chars</span>
          <span>{getReadingTime(t?.words ?? 0)}</span>
          <span style={{ opacity: 0.7, textTransform: "none", letterSpacing: 0 }}>Type / for commands · Ctrl/⌘+click opens links</span>
          <span role="status" aria-live="polite" style={{ marginLeft: "auto", color: saveStatus === "error" ? "#E53935" : "hsl(var(--muted-foreground))" }}>
            {saveLabel}
          </span>
        </div>
      </div>

      {/* Formatting bubble on text selection or inside a link */}
      {editor && (
        <BubbleMenu
          editor={editor}
          pluginKey="formatBubble"
          shouldShow={({ editor: ed, state }) => {
            if (ed.isActive("codeBlock") || slashRef.current.state) return false;
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
                <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} active={t?.bold} title="Bold">B</ToolbarButton>
                <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} active={t?.italic} title="Italic"><em>I</em></ToolbarButton>
                <ToolbarButton onClick={() => editor.chain().focus().toggleUnderline().run()} active={t?.underline} title="Underline"><u>U</u></ToolbarButton>
                <ToolbarButton onClick={() => editor.chain().focus().toggleStrike().run()} active={t?.strike} title="Strikethrough"><s>S</s></ToolbarButton>
                <ToolbarButton onClick={() => editor.chain().focus().toggleHighlight().run()} active={t?.highlight} title="Highlight">🖍</ToolbarButton>
                <ToolbarButton onClick={() => editor.chain().focus().toggleCode().run()} active={t?.code} title="Inline code">{"<>"}</ToolbarButton>
                {!t?.link && <ToolbarButton onClick={setLink} title="Add link">🔗</ToolbarButton>}
              </>
            )}
          </div>
        </BubbleMenu>
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
