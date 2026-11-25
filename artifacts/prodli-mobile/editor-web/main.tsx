// The phone's note editor, as it runs inside the WebView: TenTap's start kit
// (the same source TenTap builds its own editor from) plus ProdLi's blocks
// (artifacts/prodli/src/sections/editor/phoneExtensions.ts), so the phone can
// edit tables, code blocks, toggles, callouts, pictures and note links without
// dropping them. Built into src/ui/noteEditorHtml.js by build.mjs.

import { createRoot } from "react-dom/client";
import { boot } from "@10play/tentap-editor/src/web/runtime.ts";
import { EditorContent, TenTapStartKit, useTenTap } from "@10play/tentap-editor/src/webEditorUtils/index.ts";
import { phoneEditorExtensions } from "../../prodli/src/sections/editor/phoneExtensions";

function NoteEditor() {
  const editor = useTenTap({ bridges: TenTapStartKit, tiptapOptions: { extensions: phoneEditorExtensions() } });
  const { dynamicHeight } = boot().requireConfig();
  return <EditorContent editor={editor} className={dynamicHeight ? "tentap-root dynamic-height" : "tentap-root"} />;
}

// The native side puts the boot config in the page before this runs (RichText).
const runtime = boot();
runtime.whenConfigured(() => {
  try {
    createRoot(document.getElementById("root")!).render(<NoteEditor />);
  } catch (error) {
    runtime.reportBootError(error);
    throw error;
  }
});
