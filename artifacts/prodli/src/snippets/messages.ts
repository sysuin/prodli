// Messages between the snippet picker in the page (picker.ts) and the
// background (background.ts). Types only, so the injected picker stays self-contained.

export interface PickerSnippet {
  id: string;
  cue: string;
  /** Placeholders ({date}, {time}…) already filled in. */
  text: string;
}

/**
 * Which frame opens it: "focused" — only the frame with a focused text field
 * (sent to every frame); "frame" — the frame it was sent to (right-click);
 * "top" — the top frame, even without a field (the snippet is copied then).
 */
export type PickerMode = "focused" | "frame" | "top";

export type ToPicker = { target: "snippet-picker"; type: "open"; snippets: PickerSnippet[]; mode: PickerMode };

export interface PickerOpened {
  /** A text field had focus in this frame. */
  editable: boolean;
}
