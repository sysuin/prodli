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
} as const;

/** Keys the store keeps encrypted with the OS keychain. */
export const SECRET_KEYS = ["prodliSession"];
