// Background: daily Google Drive backup while the user is signed in.
import { autoBackupIfDue, DRIVE_ALARM } from "./google";

async function run(): Promise<void> {
  try {
    await autoBackupIfDue();
  } catch {
    // Offline, token expired, Drive full… try again at the next alarm.
  }
}

export function registerDriveBackup(): void {
  chrome.alarms.get(DRIVE_ALARM).then((existing) => {
    if (!existing) void chrome.alarms.create(DRIVE_ALARM, { delayInMinutes: 5, periodInMinutes: 60 });
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === DRIVE_ALARM) void run();
  });
}
