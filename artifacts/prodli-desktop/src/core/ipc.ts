// IPC channel names shared by the main process and the preload script.
export const IPC = {
  storageGet: "prodli:storage:get",
  storageGetAll: "prodli:storage:getAll",
  storageSet: "prodli:storage:set",
  storageRemove: "prodli:storage:remove",
  storageChanged: "prodli:storage:changed",
  signIn: "prodli:account:signIn",
  cancelSignIn: "prodli:account:cancelSignIn",
  openExternal: "prodli:openExternal",
  systemAudio: "prodli:systemAudio",
  openSystemAudioSettings: "prodli:openSystemAudioSettings",
  closeWindow: "prodli:closeWindow",
  command: "prodli:command",
  setBadge: "prodli:setBadge",
  recordingState: "prodli:recordingState",
  prefsGet: "prodli:prefs:get",
  prefsSet: "prodli:prefs:set",
  filesAvailable: "prodli:files:available",
  filesTake: "prodli:files:take",
  filesOpenDialog: "prodli:files:openDialog",
  dictationControl: "prodli:dictation:control",
  dictationPaste: "prodli:dictation:paste",
  dictationDone: "prodli:dictation:done",
  dictationFinish: "prodli:dictation:finish",
  dictationCancel: "prodli:dictation:cancel",
  dictationStatus: "prodli:dictation:status",
  dictationReady: "prodli:dictation:ready",
  dictationAskToPaste: "prodli:dictation:askToPaste",
} as const;

/** Keys the store keeps encrypted with the OS keychain. */
export const SECRET_KEYS = ["prodliSession"];
