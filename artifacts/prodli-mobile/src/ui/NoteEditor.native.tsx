// The phone's note editor: TenTap, which is TipTap (the extension's editor
// engine) in a WebView, so notes keep the same HTML on every device. A note
// the phone can't edit safely (tables, code blocks, toggles, callouts…; see
// lib/html.ts) is shown read-only in a script-free WebView instead.
import { RichText, Toolbar, useEditorBridge, useBridgeState, TenTapStartKit, CoreBridge, PlaceholderBridge, darkEditorTheme, defaultEditorTheme, type BridgeExtension } from "@10play/tentap-editor";
import { useEffect, useRef } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { WebView } from "react-native-webview";
import { Banner } from "./kit";
import { DARK, LIGHT } from "./theme";
import type { NoteEditorProps } from "./NoteEditor";

const css = (dark: boolean) => {
  const c = dark ? DARK : LIGHT;
  return `
  * { background-color: ${c.bg}; color: ${c.fg}; }
  body, .ProseMirror { font-family: -apple-system, Roboto, "Segoe UI", sans-serif; font-size: 17px; line-height: 1.55; padding: 4px 16px 120px; }
  h1, h2, h3 { font-weight: 900; letter-spacing: -0.01em; }
  a { color: ${dark ? "#33BBFF" : "#0060A8"}; }
  blockquote { border-left: 4px solid ${c.border}; padding-left: 12px; margin-left: 0; color: ${c.mutedFg}; }
  code, pre { background-color: ${c.muted}; font-family: Menlo, monospace; }
  pre { padding: 10px; border: 2px solid ${c.border}; }
  mark { background-color: #FFD70088; color: inherit; }
  ul[data-type="taskList"] { padding-left: 4px; }
  ul[data-type="taskList"] li { display: flex; gap: 8px; align-items: flex-start; }
  ul[data-type="taskList"] li[data-checked="true"] > div { text-decoration: line-through; opacity: 0.6; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid ${c.border}; padding: 6px; vertical-align: top; }
  /* Shown read-only (lib/html.ts unsupportedFormatting): callouts, toggles, pictures, dividers. */
  [data-type="callout"] { display: flex; gap: 10px; padding: 10px 12px; margin: 12px 0; border: 2px solid ${c.border}; border-radius: 6px; background-color: ${c.muted}; }
  [data-type="callout"]::before { content: attr(data-emoji); background-color: transparent; }
  [data-type="callout"] * { background-color: transparent; }
  [data-type="callout"] > * { margin: 0; }
  details { border-left: 3px solid ${c.border}; padding-left: 10px; margin: 12px 0; }
  summary { font-weight: 700; }
  figure { margin: 12px 0; }
  img { max-width: 100%; height: auto; }
  figcaption { color: ${c.mutedFg}; font-size: 14px; }
  hr { border: none; border-top: 2px solid ${c.border}; }
  pre { white-space: pre-wrap; }
  `;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBridge = BridgeExtension<any, any, any>;
const bridges = (dark: boolean): AnyBridge[] => [...(TenTapStartKit as AnyBridge[]), CoreBridge.configureCSS(css(dark)) as AnyBridge, PlaceholderBridge.configureExtension({ placeholder: "Start writing…" }) as AnyBridge];

function ReadOnly({ html, dark, reason }: { html: string; dark: boolean; reason: string }) {
  const doc = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css(dark)}</style></head><body>${html}</body></html>`;
  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: 12 }}>
        <Banner text={reason} />
      </View>
      {/* No scripts, no navigation: the note's HTML is only displayed. */}
      <WebView originWhitelist={["about:blank"]} source={{ html: doc }} javaScriptEnabled={false} style={{ flex: 1, backgroundColor: "transparent" }} onShouldStartLoadWithRequest={(r) => r.url === "about:blank"} />
    </View>
  );
}

function Editable({ html, dark, onChangeHtml, registerFlush }: NoteEditorProps) {
  const baseline = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editor = useEditorBridge({
    initialContent: html,
    autofocus: false,
    avoidIosKeyboard: true,
    // The built-in themes are full themes; the option takes a deep-partial one (cast: TS gives up on the deep type).
    theme: (dark ? darkEditorTheme : defaultEditorTheme) as unknown as undefined,
    bridgeExtensions: bridges(dark),
    onChange: () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(), 500);
    },
  });
  const state = useBridgeState(editor);

  // What the editor shows right after loading the note: saving only when the
  // content differs from it means opening a note never rewrites it.
  useEffect(() => {
    if (state.isReady && baseline.current === null) void editor.getHTML().then((h) => (baseline.current = h));
  }, [state.isReady, editor]);

  const save = async () => {
    timer.current = null;
    if (baseline.current === null) return;
    const now = await editor.getHTML();
    if (now === baseline.current) return;
    baseline.current = now;
    onChangeHtml(now);
  };

  useEffect(() => {
    registerFlush(async () => {
      if (timer.current) {
        clearTimeout(timer.current);
        await save();
      }
    });
  });

  // An edit from another device while this note is open (and nothing typed here): show it.
  const lastProp = useRef(html);
  useEffect(() => {
    if (html === lastProp.current) return;
    lastProp.current = html;
    if (timer.current || baseline.current === null) return;
    editor.setContent(html);
    void editor.getHTML().then((h) => (baseline.current = h));
  }, [html, editor]);

  return (
    <View style={{ flex: 1 }}>
      <RichText editor={editor} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ position: "absolute", width: "100%", bottom: 0 }}>
        <Toolbar editor={editor} />
      </KeyboardAvoidingView>
    </View>
  );
}

export function NoteEditor(props: NoteEditorProps) {
  return props.readOnly ? <ReadOnly html={props.html} dark={props.dark} reason={props.readOnly} /> : <Editable {...props} />;
}
