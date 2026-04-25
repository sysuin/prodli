import { useEffect, useRef, useState, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import "@fontsource/inter/400.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "@fontsource/space-mono/400.css";
import "@fontsource/space-mono/700.css";
import "@fontsource/merriweather/400.css";
import "@fontsource/merriweather/700.css";
import { storageGet, storageSet } from "../lib/storage";
import { generateId } from "../lib/utils";
import type { Note } from "../types";

type EditorFont = "system" | "inter" | "space-mono" | "merriweather";

const FONT_OPTIONS: { value: EditorFont; label: string; family: string }[] = [
  { value: "system",      label: "System",      family: "var(--app-font-sans)" },
  { value: "inter",       label: "Inter",        family: "'Inter', sans-serif" },
  { value: "space-mono",  label: "Space Mono",   family: "'Space Mono', monospace" },
  { value: "merriweather",label: "Merriweather", family: "'Merriweather', serif" },
];

function getWordCount(text: string): number {
  return text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
}
function getCharCount(text: string): number {
  return text.length;
}
function getLineCount(text: string): number {
  if (text.trim() === "") return 0;
  return text.split("\n").filter(l => l.trim() !== "").length;
}
function getReadingTime(words: number): string {
  if (words < 50) return "< 1 min read";
  const mins = Math.ceil(words / 238);
  return `~${mins} min read`;
}
function formatSavedTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

interface ToolbarButtonProps {
  onClick: () => void;
  active?: boolean;
  title: string;
  children: React.ReactNode;
}
function ToolbarButton({ onClick, active, title, children }: ToolbarButtonProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        border: "var(--nb-border)",
        background: active ? "#FFD700" : "hsl(var(--card))",
        color: active ? "#000" : "hsl(var(--foreground))",
        width: 32,
        height: 32,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        fontWeight: 700,
        fontSize: 13,
        boxShadow: active ? "none" : "var(--nb-shadow-sm)",
        transition: "all 0.1s",
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

export function EditorSection() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const [tempTitle, setTempTitle] = useState("");
  const [editorFont, setEditorFont] = useState<EditorFont>("system");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [selectedWords, setSelectedWords] = useState(0);
  const [noteSearch, setNoteSearch] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const changeFont = useCallback(async (font: EditorFont) => {
    setEditorFont(font);
    await storageSet("editorFont", font);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    Promise.all([
      storageGet<Note[]>("notes", []),
      storageGet<string | null>("activeNoteId", null),
      storageGet<string>("editorFont", "system"),
    ]).then(([savedNotes, savedActiveId, savedFont]) => {
      const validFont = FONT_OPTIONS.some(f => f.value === savedFont) ? (savedFont as EditorFont) : "system";
      setEditorFont(validFont);
      let noteList = savedNotes;
      if (noteList.length === 0) {
        const first: Note = {
          id: generateId(),
          title: "Welcome to ProdLi",
          content: `<h1>Welcome to ProdLi</h1><p>Your new distraction-free productivity hub. Start writing...</p>`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        noteList = [first];
      }
      setNotes(noteList);
      setActiveId(savedActiveId && noteList.find(n => n.id === savedActiveId) ? savedActiveId : noteList[0].id);
      setLoaded(true);
    });
  }, []);

  const activeNote = notes.find(n => n.id === activeId) ?? null;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        link: false,
        underline: false,
      }),
      Underline,
      Placeholder.configure({ placeholder: "Start writing anything..." }),
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" } }),
    ],
    content: activeNote?.content ?? "",
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      if (!activeId) return;
      setNotes(prev => prev.map(n => n.id === activeId ? { ...n, content: html, updatedAt: new Date().toISOString() } : n));
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        setNotes(prev => {
          storageSet("notes", prev);
          return prev;
        });
        setLastSavedAt(new Date());
      }, 800);
    },
    onSelectionUpdate: ({ editor }) => {
      const { from, to } = editor.state.selection;
      if (from === to) {
        setSelectedWords(0);
      } else {
        const text = editor.state.doc.textBetween(from, to, " ");
        setSelectedWords(getWordCount(text));
      }
    },
  });

  useEffect(() => {
    if (!editor || !loaded) return;
    const content = activeNote?.content ?? "";
    if (editor.getHTML() !== content) {
      editor.commands.setContent(content);
    }
  }, [activeId, loaded]);

  const createNote = useCallback(async () => {
    const note: Note = {
      id: generateId(),
      title: "Untitled Note",
      content: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const updated = [note, ...notes];
    setNotes(updated);
    setActiveId(note.id);
    setNoteSearch("");
    await storageSet("notes", updated);
    await storageSet("activeNoteId", note.id);
  }, [notes]);

  const deleteNote = useCallback(async (id: string) => {
    if (notes.length <= 1) return;
    const updated = notes.filter(n => n.id !== id);
    setNotes(updated);
    if (activeId === id) {
      setActiveId(updated[0].id);
      await storageSet("activeNoteId", updated[0].id);
    }
    await storageSet("notes", updated);
  }, [notes, activeId]);

  const selectNote = useCallback(async (id: string) => {
    setActiveId(id);
    setNoteSearch("");
    await storageSet("activeNoteId", id);
  }, []);

  const _q = noteSearch.trim().toLowerCase();
  const noteSnippets: Record<string, string | null> = {};
  const filteredNotes = _q
    ? notes.filter(n => {
        const titleHit = n.title.toLowerCase().includes(_q);
        if (titleHit) { noteSnippets[n.id] = null; return true; }
        const text = n.content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        const ci = text.toLowerCase().indexOf(_q);
        if (ci === -1) return false;
        const s = Math.max(0, ci - 25);
        const e = Math.min(text.length, ci + _q.length + 55);
        let snip = text.slice(s, e).trim();
        if (s > 0) snip = "\u2026" + snip;
        if (e < text.length) snip += "\u2026";
        noteSnippets[n.id] = snip;
        return true;
      })
    : notes;

  const plainText = editor?.getText() ?? "";
  const wordCount = getWordCount(plainText);
  const charCount = getCharCount(plainText);
  const lineCount = getLineCount(plainText);
  const readingTime = getReadingTime(wordCount);
  const blockCount = editor
    ? (() => { let c = 0; editor.state.doc.forEach(n => { if (n.textContent.trim() !== "") c++; }); return c; })()
    : 0;

  const handleLinkClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const link = target.closest("a") as HTMLAnchorElement | null;
    if (!link?.href) return;
    e.preventDefault();
    e.stopPropagation();
    const opened = window.open(link.href, "_blank", "noopener,noreferrer");
    if (!opened) window.location.href = link.href;
  }, []);

  const setLink = () => {
    let url = window.prompt("Enter URL:");
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    editor?.chain().focus().setLink({ href: url }).run();
  };

  if (!loaded) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: 16, fontWeight: 700 }}>
      Loading...
    </div>
  );

  return (
    <div style={{
      display: "flex",
      height: "100%",
      gap: 0,
      transition: "opacity 0.15s ease",
      ...(isFullscreen ? {
        position: "fixed" as const,
        inset: 0,
        zIndex: 9999,
        background: "hsl(var(--card))",
      } : {}),
    }}>
      {/* Sidebar — hidden in full-screen */}
      {!isFullscreen && <div style={{
        width: 220,
        borderRight: "var(--nb-border)",
        display: "flex",
        flexDirection: "column",
        background: "hsl(var(--background))",
        flexShrink: 0,
      }}>
        <div style={{ padding: "12px 12px 8px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "var(--nb-border)" }}>
          <span style={{ fontWeight: 800, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em" }}>Notes</span>
          <button onClick={createNote} style={{ border: "var(--nb-border)", background: "#FFD700", width: 26, height: 26, cursor: "pointer", fontWeight: 900, fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "var(--nb-shadow-sm)", color: "#000" }}>+</button>
        </div>
        <div style={{ padding: "5px 10px", borderBottom: "1px solid var(--nb-section-border)" }}>
          <input
            type="text"
            placeholder="Search..."
            value={noteSearch}
            onChange={e => setNoteSearch(e.target.value)}
            style={{ width: "100%", border: "var(--nb-border)", padding: "4px 7px", fontSize: 11, fontFamily: "inherit", background: "hsl(var(--card))", color: "hsl(var(--foreground))", boxSizing: "border-box" as const }}
          />
        </div>
        <div style={{ overflowY: "auto", flex: 1 }}>
          {filteredNotes.length === 0 ? (
            <div style={{ padding: 14, fontSize: 11, color: "hsl(var(--muted-foreground))", fontWeight: 600, textAlign: "center" }}>No matches</div>
          ) : filteredNotes.map(note => (
            <div
              key={note.id}
              onClick={() => selectNote(note.id)}
              style={{
                padding: "10px 12px",
                borderBottom: "1px solid var(--nb-section-border)",
                background: note.id === activeId ? "#FFD700" : "transparent",
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 6,
                color: note.id === activeId ? "#000" : "hsl(var(--foreground))",
              }}
            >
              {editingTitle === note.id ? (
                <input
                  autoFocus
                  value={tempTitle}
                  onChange={e => setTempTitle(e.target.value)}
                  onBlur={async () => {
                    const updated = notes.map(n => n.id === note.id ? { ...n, title: tempTitle || "Untitled" } : n);
                    setNotes(updated);
                    await storageSet("notes", updated);
                    setEditingTitle(null);
                  }}
                  onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
                  onClick={e => e.stopPropagation()}
                  style={{ border: "var(--nb-border)", padding: "2px 4px", fontSize: 12, fontWeight: 700, width: "100%", background: "hsl(var(--card))", color: "hsl(var(--foreground))" }}
                />
              ) : (
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{note.title}</div>
                  <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 2 }}>{new Date(note.updatedAt).toLocaleDateString()}</div>
                  {noteSnippets[note.id] && (
                    <div style={{ fontSize: 10, fontStyle: "italic", color: "hsl(var(--muted-foreground))", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {noteSnippets[note.id]}
                    </div>
                  )}
                </div>
              )}
              <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                <button
                  onClick={e => { e.stopPropagation(); setEditingTitle(note.id); setTempTitle(note.title); }}
                  style={{ border: "var(--nb-border)", background: "hsl(var(--card))", color: "hsl(var(--foreground))", width: 20, height: 20, cursor: "pointer", fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center" }}
                  title="Rename"
                >✎</button>
                {notes.length > 1 && (
                  <button
                    onClick={e => { e.stopPropagation(); deleteNote(note.id); }}
                    style={{ border: "1px solid #ff4444", background: "#ff4444", color: "white", width: 20, height: 20, cursor: "pointer", fontSize: 10, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center" }}
                    title="Delete"
                  >×</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>}

      {/* Editor Area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Toolbar */}
        <div style={{ borderBottom: "var(--nb-border)", padding: "8px 16px", display: "flex", gap: 4, flexWrap: "wrap", background: "hsl(var(--muted))", alignItems: "center" }}>
          <ToolbarButton onClick={() => editor?.chain().focus().toggleBold().run()} active={editor?.isActive("bold")} title="Bold">B</ToolbarButton>
          <ToolbarButton onClick={() => editor?.chain().focus().toggleItalic().run()} active={editor?.isActive("italic")} title="Italic"><em>I</em></ToolbarButton>
          <ToolbarButton onClick={() => editor?.chain().focus().toggleUnderline().run()} active={editor?.isActive("underline")} title="Underline"><u>U</u></ToolbarButton>
          <ToolbarButton onClick={() => editor?.chain().focus().toggleStrike().run()} active={editor?.isActive("strike")} title="Strike"><s>S</s></ToolbarButton>
          <div style={{ width: 1, height: 24, background: "var(--nb-section-border)", margin: "0 4px" }} />
          <ToolbarButton onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()} active={editor?.isActive("heading", { level: 1 })} title="H1">H1</ToolbarButton>
          <ToolbarButton onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} active={editor?.isActive("heading", { level: 2 })} title="H2">H2</ToolbarButton>
          <ToolbarButton onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()} active={editor?.isActive("heading", { level: 3 })} title="H3">H3</ToolbarButton>
          <div style={{ width: 1, height: 24, background: "var(--nb-section-border)", margin: "0 4px" }} />
          <ToolbarButton onClick={() => editor?.chain().focus().toggleBulletList().run()} active={editor?.isActive("bulletList")} title="Bullet List">≡</ToolbarButton>
          <ToolbarButton onClick={() => editor?.chain().focus().toggleOrderedList().run()} active={editor?.isActive("orderedList")} title="Numbered List">①</ToolbarButton>
          <ToolbarButton onClick={() => editor?.chain().focus().toggleCode().run()} active={editor?.isActive("code")} title="Inline Code">{"<>"}</ToolbarButton>
          <ToolbarButton onClick={setLink} active={editor?.isActive("link")} title="Link">🔗</ToolbarButton>
          <div style={{ width: 1, height: 24, background: "var(--nb-section-border)", margin: "0 4px" }} />
          <ToolbarButton onClick={() => editor?.chain().focus().undo().run()} title="Undo">↩</ToolbarButton>
          <ToolbarButton onClick={() => editor?.chain().focus().redo().run()} title="Redo">↪</ToolbarButton>
          <div style={{ width: 1, height: 24, background: "var(--nb-section-border)", margin: "0 4px" }} />
          <select
            value={editorFont}
            onChange={e => changeFont(e.target.value as EditorFont)}
            title="Writing font"
            style={{
              border: "var(--nb-border)",
              background: "hsl(var(--card))",
              color: "hsl(var(--foreground))",
              fontFamily: "var(--app-font-sans)",
              fontWeight: 700,
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              padding: "0 6px",
              height: 32,
              cursor: "pointer",
              outline: "none",
              boxShadow: "var(--nb-shadow-sm)",
            }}
          >
            {FONT_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <div style={{ marginLeft: "auto" }}>
            <ToolbarButton onClick={() => setIsFullscreen(f => !f)} active={false} title={isFullscreen ? "Exit full screen" : "Full screen"}>⛶</ToolbarButton>
          </div>
        </div>

        {/* Editor Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 32px", background: "hsl(var(--card))", fontFamily: FONT_OPTIONS.find(f => f.value === editorFont)?.family }} onClickCapture={handleLinkClick}>
          <EditorContent editor={editor} style={{ minHeight: "100%" }} />
        </div>

        {/* Status Bar */}
        <div style={{ borderTop: "var(--nb-border)", padding: "6px 16px", display: "flex", gap: 16, background: "hsl(var(--muted))", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", flexWrap: "wrap" }}>
          {selectedWords > 0
            ? <span style={{ color: "#c07000" }}>{selectedWords} selected</span>
            : <span>{wordCount} words</span>
          }
          <span>{charCount} chars</span>
          <span>{lineCount} lines</span>
          <span>{blockCount} blocks</span>
          <span>{readingTime}</span>
          <span style={{ marginLeft: "auto", color: "hsl(var(--muted-foreground))" }}>
            {lastSavedAt ? `Saved ${formatSavedTime(lastSavedAt)}` : "Auto-saved"}
          </span>
        </div>
      </div>
    </div>
  );
}
