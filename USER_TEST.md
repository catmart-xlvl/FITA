# Try FITA as a new user

Use the Windows preview ZIP in a new folder, separate from development. This checks a clean application folder, not a clean computer: existing Node, Python, Blender and browser installations can affect results. A fresh Windows VM is still needed to prove setup on a machine with none of those tools.

1. Close the development server only when its tasks are idle. Do not close an uncertain paid Tripo operation. Extract the preview ZIP into a writable folder.
2. Double-click **Open FITA.cmd**. Confirm setup progress is understandable and the browser opens FITA in English. Switch to Spanish and Japanese, then back to English.
3. Create a disposable project named `Installation test`. Do not connect paid providers for this check. Close the tab, double-click Open again and confirm the project persists.
4. With all work idle, double-click **Close FITA.cmd**. Confirm only this installation closes. Open FITA again and confirm the project remains.
5. In the lobby, open **Updates** and check for updates. Until a public Release exists, an unavailable-release message is expected. Nothing should be overwritten.
6. Close FITA and double-click **Update FITA.cmd**. It must explain an unavailable/private release instead of reporting success. After a real Release exists, repeat with an older portable build and verify the new version and the same project.
7. For a fault test, disconnect the network before checking for updates. Confirm an error appears and the old version still opens. Restore the network. Never disconnect a paid task to test the installer.
8. Leave a harmless edit in a disposable version's README and try an actual newer update. The updater should refuse to replace locally changed application files. Use a fresh copy after this test.
9. Close a disposable test installation, then move its entire folder. Open FITA and Update FITA must show the English moved-installation message, list the original/current locations and stop without downloads or project changes. Move it back to its original folder to reopen and export; do not delete `user-data` or the location marker. Choosing a folder before the first launch remains unrestricted.

Report the FITA version, Windows version, browser, action, expected result and actual result. Keep logs private because later real projects may add local paths. No credits are needed for these checks.
