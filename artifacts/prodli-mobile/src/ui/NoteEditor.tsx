// Web preview: notes are shown as text. Rich editing needs the iOS or Android
// app (NoteEditor.native.tsx), so the preview can never rewrite a note's HTML.
import { ScrollView } from "react-native";
import { htmlToText } from "../lib/html";
import { Banner, P } from "./kit";

export interface NoteEditorProps {
  noteId: string;
  html: string;
  readOnly: string | null;
  dark: boolean;
  onChangeHtml: (html: string) => void;
  /** Lets the screen ask for the latest HTML before leaving. */
  registerFlush: (flush: () => Promise<void>) => void;
}

export function NoteEditor({ html }: NoteEditorProps) {
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Banner text="Editing notes works in the iOS and Android apps. This preview shows the text." />
      <P selectable>{htmlToText(html) || "Empty note"}</P>
    </ScrollView>
  );
}
