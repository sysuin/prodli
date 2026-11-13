import { useEffect, useRef, useState } from "react";
import { exportData, importData } from "../lib/backupRestore";

interface BackupModalProps {
  onClose?: () => void;
  /** Inside Settings: just the content, no window around it. */
  embedded?: boolean;
}

type ImportState =
  | { stage: "idle" }
  | { stage: "confirming"; file: File }
  | { stage: "restoring" }
  | { stage: "error"; message: string };

export function BackupModal({ onClose = () => {}, embedded = false }: BackupModalProps) {
  const [exportStatus, setExportStatus] = useState<"idle" | "exporting" | "done">("idle");
  const [importState, setImportState] = useState<ImportState>({ stage: "idle" });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isMidConfirm = importState.stage === "confirming" || importState.stage === "restoring";

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isMidConfirm && !embedded) onClose();
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onClose, isMidConfirm, embedded]);

  const handleExport = async () => {
    setExportStatus("exporting");
    try {
      await exportData();
      setExportStatus("done");
      setTimeout(() => setExportStatus("idle"), 2500);
    } catch {
      setExportStatus("idle");
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportState({ stage: "confirming", file });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleConfirmImport = async () => {
    if (importState.stage !== "confirming") return;
    const { file } = importState;
    setImportState({ stage: "restoring" });
    const result = await importData(file);
    if (!result.ok) {
      setImportState({ stage: "error", message: result.error ?? "Import failed." });
      return;
    }
    setImportState({ stage: "restoring" });
    setTimeout(() => {
      window.location.reload();
    }, 1200);
  };

  const handleCancelImport = () => {
    setImportState({ stage: "idle" });
  };

  const navBtnStyle: React.CSSProperties = {
    border: "var(--nb-border)",
    padding: "9px 18px",
    fontWeight: 800,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "box-shadow 0.1s",
  };

  const content = (
    <>
        {/* Body */}
        <div style={{ padding: "24px" }}>

          {/* Confirmation / Restoring overlay — replaces cards */}
          {importState.stage === "confirming" && (
            <div style={{
              border: "3px solid #FF6B6B",
              background: "hsl(var(--card))",
              padding: "20px 22px",
              marginBottom: 0,
            }}>
              <div style={{ fontWeight: 900, fontSize: 14, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, color: "#FF6B6B" }}>
                ⚠ Replace all data?
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 4 }}>
                Restoring from <strong style={{ fontFamily: "Space Mono, monospace" }}>{importState.file.name}</strong> will overwrite your current notes, to-dos, habits, Pomodoro data, time-tracking history and meetings.
              </div>
              <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", marginBottom: 18 }}>
                This cannot be undone. Make sure you export your current data first if you want to keep it.
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  onClick={handleConfirmImport}
                  style={{
                    ...navBtnStyle,
                    background: "#FF6B6B", color: "#fff",
                    boxShadow: "3px 3px 0 #000",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.boxShadow = "1px 1px 0 #000")}
                  onMouseLeave={e => (e.currentTarget.style.boxShadow = "3px 3px 0 #000")}
                >
                  Restore
                </button>
                <button
                  onClick={handleCancelImport}
                  style={{
                    ...navBtnStyle,
                    background: "hsl(var(--card))", color: "hsl(var(--foreground))",
                    boxShadow: "3px 3px 0 #000",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.boxShadow = "1px 1px 0 #000")}
                  onMouseLeave={e => (e.currentTarget.style.boxShadow = "3px 3px 0 #000")}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {importState.stage === "restoring" && (
            <div style={{
              border: "var(--nb-border)",
              background: "#FFD700",
              padding: "20px 22px",
              display: "flex", alignItems: "center", gap: 14,
            }}>
              <span style={{ fontSize: 22 }}>⏳</span>
              <div>
                <div style={{ fontWeight: 900, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.06em", color: "#000" }}>Restoring…</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#333", marginTop: 3 }}>Writing data and reloading the extension.</div>
              </div>
            </div>
          )}

          {importState.stage !== "confirming" && importState.stage !== "restoring" && (
            <>
              {/* Export card */}
              <div style={{
                border: "var(--nb-border)",
                background: "hsl(var(--card))",
                padding: "18px 20px",
                marginBottom: 14,
                position: "relative",
                overflow: "hidden",
              }}>
                <div style={{
                  position: "absolute", top: 0, left: 0, right: 0,
                  height: 3, background: "#FFD700",
                }} />
                <div style={{ marginTop: 4, marginBottom: 6, fontWeight: 900, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  💾 Export Data
                </div>
                <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", lineHeight: 1.6, marginBottom: 14 }}>
                  Download your notes, to-dos, habits, Pomodoro data, time-tracking history and meeting notes as a JSON file. Meeting audio is not included. Store it somewhere safe as a backup.
                </div>
                <button
                  onClick={handleExport}
                  disabled={exportStatus === "exporting"}
                  style={{
                    ...navBtnStyle,
                    background: exportStatus === "done" ? "#66BB6A" : "#FFD700",
                    color: "#000",
                    boxShadow: "3px 3px 0 #000",
                    opacity: exportStatus === "exporting" ? 0.7 : 1,
                    cursor: exportStatus === "exporting" ? "default" : "pointer",
                  }}
                  onMouseEnter={e => { if (exportStatus !== "exporting") e.currentTarget.style.boxShadow = "1px 1px 0 #000"; }}
                  onMouseLeave={e => { e.currentTarget.style.boxShadow = "3px 3px 0 #000"; }}
                >
                  {exportStatus === "exporting" ? "Exporting…" : exportStatus === "done" ? "✓ Downloaded!" : "Export Data →"}
                </button>
              </div>

              {/* Import card */}
              <div style={{
                border: "var(--nb-border)",
                background: "hsl(var(--card))",
                padding: "18px 20px",
                position: "relative",
                overflow: "hidden",
              }}>
                <div style={{
                  position: "absolute", top: 0, left: 0, right: 0,
                  height: 3, background: "#00BCD4",
                }} />
                <div style={{ marginTop: 4, marginBottom: 6, fontWeight: 900, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  ↑ Import Backup
                </div>
                <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", lineHeight: 1.6, marginBottom: 14 }}>
                  Restore from a previously exported ProdLi JSON file. You will be asked to confirm before any data is replaced.
                </div>

                {importState.stage === "error" && (
                  <div style={{
                    border: "2px solid #FF6B6B",
                    background: "hsl(var(--background))",
                    padding: "8px 12px",
                    marginBottom: 12,
                    fontSize: 12,
                    color: "#FF6B6B",
                    fontWeight: 700,
                  }}>
                    ✕ {importState.message}
                  </div>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  style={{ display: "none" }}
                  onChange={handleFileChange}
                />
                <button
                  onClick={() => { setImportState({ stage: "idle" }); fileInputRef.current?.click(); }}
                  style={{
                    ...navBtnStyle,
                    background: "hsl(var(--card))",
                    color: "hsl(var(--foreground))",
                    boxShadow: "3px 3px 0 #000",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.boxShadow = "1px 1px 0 #000")}
                  onMouseLeave={e => (e.currentTarget.style.boxShadow = "3px 3px 0 #000")}
                >
                  Import Backup
                </button>
              </div>
            </>
          )}
        </div>

        {/* Footer note */}
        {importState.stage !== "confirming" && importState.stage !== "restoring" && (
          <div style={{
            padding: "12px 24px",
            borderTop: "var(--nb-border)",
            background: "hsl(var(--muted))",
            fontSize: 11,
            color: "hsl(var(--muted-foreground))",
            fontWeight: 600,
          }}>
            All data is stored locally on your device. Exports contain no passwords or personal identifiers.
          </div>
        )}
    </>
  );

  if (embedded) return <div style={{ margin: "-24px -24px 0" }}>{content}</div>;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Backup and restore"
      tabIndex={-1}
      autoFocus
      onClick={(e) => { if (e.target === e.currentTarget && !isMidConfirm) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 10001,
        background: "rgba(0,0,0,0.90)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24,
      }}
    >
      <div style={{
        background: "hsl(var(--background))",
        border: "var(--nb-border)",
        boxShadow: "8px 8px 0 #FFD700",
        width: "100%",
        maxWidth: 560,
        overflow: "hidden",
      }}>

        {/* Header */}
        <div style={{
          background: "#000",
          padding: "16px 24px",
          borderBottom: "var(--nb-border)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{
              background: "#FFD700", color: "#000", fontWeight: 900,
              fontSize: 13, padding: "2px 10px",
            }}>ProdLi</span>
            <span style={{
              color: "#aaa", fontWeight: 700, fontSize: 12,
              textTransform: "uppercase", letterSpacing: "0.08em",
            }}>Backup & Restore</span>
          </div>
          {!isMidConfirm && (
            <button
              onClick={onClose}
              title="Close (Esc)"
              style={{
                border: "2px solid #444", background: "transparent", color: "#888",
                width: 32, height: 32, cursor: "pointer", fontSize: 18, fontWeight: 900,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: "inherit",
              }}
            >×</button>
          )}
        </div>

        {content}
      </div>
    </div>
  );
}
