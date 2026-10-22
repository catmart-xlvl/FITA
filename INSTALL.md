# Install, open, close and update FITA

Official, unmodified FITA versions may be installed and used under the FITA Usage License in `LICENSE`. Permission is required to modify or redistribute FITA's own software except where law or third-party rights permit it. This does not restrict your projects or outputs. Third-party licenses and notices remain applicable. No account activation or license-enforcement mechanism is added by this document.

## Requirements and first launch

Windows x64, a writable local folder, a modern Chromium browser for the Tripo bridge, and internet for initial setup and online services. The launcher uses Windows PowerShell 5.1. It accepts an installed Node.js 24+ with npm, or downloads the pinned official Node.js 24.22.1 x64 archive and checks its SHA-256 checksum. Components are installed with `npm ci` from `package-lock.json`, with lifecycle scripts disabled. Blender/Unity and external services are separate; they are not silently installed or licensed by FITA.

Double-click **Open FITA.cmd**. During setup keep the console open until FITA opens. On later launches, installed components are reused. If the port is occupied by another installation, FITA stops with a message instead of closing or using that installation. Keep your development installation closed when opening the public candidate on port 4317.

The browser tab may be closed without stopping the server. To stop it, finish all active tasks and double-click **Close FITA.cmd**. Only the recorded FITA process with the expected executable and entry path is stopped. Never use this to interrupt uncertain paid operations. Remembered bridge connections resume after restart while their credentials are valid; expired or revoked credentials require pairing again.

The launcher reads Windows' actual argument list, so installation paths work with or without spaces and quotation marks. It does not accept a different executable, a partial script-path match or an unrelated process. Browser-open requests are checked and recorded in `runtime/browser-open.json`. If opening the browser fails, FITA displays its local URL and leaves the server running so you can open that address manually. Do not erase `runtime` or project folders to fix a launch message.

## Browser bridge

1. In the browser used for Tripo (Brave, Chrome or Edge), open Extensions and enable Developer mode. FITA itself may be open in a different browser.
2. Choose Load unpacked and select **FITA Extension** beside **Open FITA.cmd**. This is a real folder at a stable path; do not select a folder inside `versions`. Both ZIPs include it; a Git source checkout creates it on first launch.
3. Open Tripo Studio and the FITA Connections panel. Pair the tab and explicitly grant the intended project commands.
4. After updating FITA, click Reload for the existing extension when no operation is in progress. Keep the folder in place and do not remove/reinstall the extension. Do not repeat paid actions just because a response was lost.

The Connections panel displays the exact root folder path, a copy button and the included extension version. This version describes the files shipped with FITA, not proof that a browser has reloaded them. Browser installation state is not inferred from pairing status.

Updates verify the current extension inventory before replacement; local edits or unexpected files block replacement. They stage the new files, keep the old folder under `runtime`, and restore it if application activation fails. Startup reconciles an interrupted swap against the active application version. Browser profiles, extension storage and server remembered-device records are not rewritten. The path is stable and is not a junction. Browser-specific extension identity across updates still requires a real browser acceptance test; this release does not claim that filesystem tests prove browser behavior.

The browser intentionally controls extension installation. FITA does not install an unsigned extension silently. The supported bridge endpoint is port 4317; other ports are only for isolated local tests.

## Update

Close FITA after all tasks have finished, then double-click **Update FITA.cmd**. The update origin is **catmart-xlvl/FITA**. The installer owner may override it in `settings.json` at the portable root with `{"repository":"OWNER/REPOSITORY"}`. That file is preserved; do not add secrets to it.

Only stable GitHub releases are selected. Dependencies are installed in a new folder, checksums are checked, then `active.json` switches versions. Network errors, damaged files, dependency errors or local edits leave the old pointer in place. Failed staging folders are retained for diagnosis; no project folder is deleted. Repeated updates may use extra disk space because old versions are preserved.

For a rollback, close FITA and retain a copy of `active.json`; set its `version` to the recorded `previous` value, then open FITA. Application rollback does not undo future project schema migrations. Back up `user-data` before installing a new release; this preview does not claim an automatic data rollback.

## Files

- `user-data/data`: project records and assets.
- `user-data/projects`: assistant workspaces and outputs.
- `runtime`: logs, launcher lock, process record, bridge pairing and optional Node runtime.
- `runtime/install-location.json`: the original installation root, registered after the first successful setup. This local file is never included in release ZIPs.
- `versions`: installed application builds and their dependency folders.
- `FITA Extension`: stable, real unpacked extension folder selected once in the browser. Its `.fita-extension.json` inventory detects local file changes. Do not edit or move it.
- `active.json`: active application pointer.
- `settings.json`: optional repository configuration, no tokens.

Choose any writable folder or drive before first launch, including paths with spaces or non-ASCII characters. After the first successful setup, FITA remembers that installation root. Open FITA and Update FITA compare it before downloads or changes. Moving or renaming the installation blocks both commands with an English message showing the original and current folders. Switching application versions inside the same root does not trigger this warning.

To recover, move the entire folder back to its original location, open FITA and export projects as `.fita`. To use a different destination, extract a fresh FITA copy there and import those backups. Keep the old folder and `user-data` until your projects are backed up; do not delete the location marker to bypass the check. FITA does not delete projects, rewrite saved paths or migrate moved installations automatically. Windows data junctions and assistant handoffs can contain absolute paths, so moving a folder is not a supported project migration. The location marker records only a folder path, not a hardware or personal identifier.

Do not copy private data into a GitHub source tree. A launcher crash can leave `runtime/manager.lock`; close all launcher windows and verify no setup/update is running before removing only that lock file.

## Project archive limits

Export and import share explicit limits: a `project.json` state record up to 32 MiB, a `fita-project.json` index up to 16 MiB, at most 50,000 physical/restored files within the archive checks, and up to 64 GiB of expanded asset/workspace data. The separate 16 MiB text-rewrite budget for workspace files is unchanged. The exporter writes compact JSON and checks the same record/index limits before creating or replacing an archive. Oversized state produces a specific size-limit message rather than being labeled as damage. Existing project files are not overwritten by an import.

The 32 MiB record budget accommodates older formatted records that crossed the former shared 16 MiB threshold while remaining small enough for bounded in-memory JSON parsing on the supported desktop runtime. Record reading uses one size-checked buffer; model and texture files still stream to disk. This is not unlimited JSON or asset loading. ZIP path/type, version, file-count, copy-reference and expanded-size checks remain in force.
