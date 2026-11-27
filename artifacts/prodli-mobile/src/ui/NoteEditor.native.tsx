// The phone's note editor: TenTap, which is TipTap (the extension's editor
// engine) in a WebView, so notes keep the same HTML on every device. It runs
// ProdLi's own editor bundle (editor-web → noteEditorHtml.js) with the
// extension's blocks, so tables, code blocks, toggles, callouts, pictures and
// note links can be edited too. A note with anything else (lib/html.ts) is shown
// read-only in a script-free WebView instead.
import { RichText, Toolbar, useEditorBridge, useBridgeState, TenTapStartKit, CoreBridge, LinkBridge, PlaceholderBridge, darkEditorTheme, defaultEditorTheme, type BridgeExtension } from "@10play/tentap-editor";
import { useEffect, useRef } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { WebView } from "react-native-webview";
import { Banner } from "./kit";
import { DARK, LIGHT } from "./theme";
import type { NoteEditorProps } from "./NoteEditor";
import { editorHtml } from "./noteEditorHtml";
import { phoneBridgeList } from "../lib/editorConfig";

const css = (dark: boolean) => {
  const c = dark ? DARK : LIGHT;
  return `
  * { background-color: ${c.bg}; color: ${c.fg}; }
  body, .ProseMirror { font-family: -apple-system, Roboto, "Segoe UI", sans-serif; font-size: 17px; line-height: 1.6; padding: 4px 18px 120px; }
  /* Same shape as the computer's editor (artifacts/prodli index.css, "Writing surface"): the first line is the title. */
  p { margin: 0 0 0.7em; }
  h1 { font-size: 1.55em; font-weight: 800; line-height: 1.25; letter-spacing: -0.015em; margin: 1.4em 0 0.4em; }
  h2 { font-size: 1.28em; font-weight: 800; line-height: 1.3; margin: 1.3em 0 0.4em; border-left: 4px solid #FFD700; padding-left: 10px; }
  h3 { font-size: 1.1em; font-weight: 700; line-height: 1.35; margin: 1.2em 0 0.35em; }
  .ProseMirror > :first-child { margin-top: 0.3em; }
  .ProseMirror > h1:first-child { font-size: 1.9em; line-height: 1.18; letter-spacing: -0.025em; margin-bottom: 0.5em; }
  a { color: ${dark ? "#7AB4FF" : "#1a56db"}; text-decoration-thickness: 1px; text-underline-offset: 0.18em; }
  blockquote { border-left: 3px solid ${c.fg}; padding-left: 14px; margin: 1em 0; color: ${c.mutedFg}; }
  code { background-color: ${c.muted}; color: ${dark ? "#FFD54A" : "#B42318"}; border-radius: 4px; padding: 0.05em 0.35em; font-family: Menlo, monospace; font-size: 0.86em; }
  pre { background-color: ${c.muted}; padding: 10px 12px; border-radius: 4px; font-family: Menlo, monospace; font-size: 14px; }
  pre code { background-color: transparent; color: inherit; padding: 0; font-size: inherit; }
  mark { background-color: #FFD70088; color: inherit; }
  ul, ol { padding-left: 1.5em; }
  li::marker { color: ${c.mutedFg}; }
  ul[data-type="taskList"] { padding-left: 2px; }
  ul[data-type="taskList"] li { display: flex; gap: 10px; align-items: flex-start; }
  ul[data-type="taskList"] li > label { height: 1.6em; display: flex; align-items: center; }
  ul[data-type="taskList"] li[data-checked="true"] > div { text-decoration: line-through; color: ${c.mutedFg}; }
  table { border-collapse: collapse; width: 100%; font-size: 0.94em; }
  td, th { border: 1px solid ${c.border}; padding: 7px 8px; vertical-align: top; }
  th { font-weight: 700; text-align: left; border-bottom-width: 2px; }
  /* Notion-style blocks (editable here too, through editor-web): callouts, toggles, pictures, dividers. */
  [data-type="callout"] { display: flex; gap: 10px; padding: 10px 12px; margin: 12px 0; border: 1px solid ${c.border}; border-radius: 4px; background-color: ${c.muted}; }
  [data-type="callout"]::before { content: attr(data-emoji); background-color: transparent; }
  [data-type="callout"] * { background-color: transparent; }
  [data-type="callout"] > * { margin: 0; }
  details { border-left: 3px solid ${c.border}; padding-left: 10px; margin: 12px 0; }
  summary { font-weight: 700; }
  figure { margin: 12px 0; }
  img { max-width: 100%; height: auto; }
  figcaption { color: ${c.mutedFg}; font-size: 14px; }
  hr { border: none; border-top: 1px solid ${c.border}; margin: 1.6em 0; }
  pre { white-space: pre-wrap; }
  `;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBridge = BridgeExtension<any, any, any>;
// TenTap's start kit without its image bridge (ProdLi's picture node is in the bundle) and with links like the computer's.
const bridges = (dark: boolean): AnyBridge[] => [...phoneBridgeList(TenTapStartKit as AnyBridge[], LinkBridge as never), CoreBridge.configureCSS(css(dark)) as AnyBridge, PlaceholderBridge.configureExtension({ placeholder: "Start writing…" }) as AnyBridge];

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
    customSource: editorHtml,
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
