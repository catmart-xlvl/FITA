# FITA — local character workbench

FITA is a browser interface with a local Windows server and a Tripo Studio browser extension. It guides character references, model candidates, segmentation, textures, placement and avatar preparation. Some stages require an AI coding assistant, Blender, third-party services or manual review. A technical import does not establish artistic approval or VRChat client compatibility.

Download the Windows package from [FITA Releases](https://github.com/catmart-xlvl/FITA/releases/latest). FITA's own code is covered by the [FITA Usage License](LICENSE): use of official unmodified versions is allowed, including personal and commercial use; modifying or redistributing FITA-specific software requires permission except where law or third-party rights permit it. FITA is not open source. This license adds no restrictions to users' projects or outputs.

## Windows portable installation

1. Extract `FITA-Windows-x64.zip` to a writable local folder. Do not run it inside the ZIP, Program Files or a synced project folder.
2. Double-click **Open FITA.cmd**. First launch needs internet to obtain Node.js if necessary and install locked npm components. A console displays setup progress; FITA then opens in your default browser.
3. In the browser used for Tripo, open Extensions, enable Developer mode, choose Load unpacked and select **FITA Extension**, beside **Open FITA.cmd**. Open FITA Connections to pair once. See [INSTALL.md](INSTALL.md).
4. Use **Close FITA.cmd** only after all generation, transfers and assistant operations are idle. Closing the browser alone leaves the local server running.
5. Use **Update FITA.cmd** after closing FITA. It checks stable releases from **catmart-xlvl/FITA** and keeps the installed version when no newer release is available.

The launcher is a small Windows script, not an Electron application. The interface remains a web application served at `http://127.0.0.1:4317`. Hosting static files on GitHub Pages would not provide the local API or the Tripo bridge.

## Data and updates

Portable installs keep projects in `user-data/`, outside versioned application files. Runtime logs and bridge pairing records live in `runtime/`. Updates verify the published asset digest and every application file, prepare dependencies in a new version folder and switch the active pointer only after successful validation. Older versions are retained. Modified application files block automatic replacement. This is integrity checking over HTTPS, not independent publisher signing.

The updater requires an explicitly configured repository and a public stable Release containing `FITA-update.zip` and GitHub's SHA-256 asset digest. The configured update origin is **catmart-xlvl/FITA**. Do not put a personal GitHub token into the public package. Choose your installation folder before first launch; moving a populated folder is not supported. Use `.fita` export/import to migrate projects.

Updates maintain the real **FITA Extension** folder at the same root path. When idle, click Reload for the existing extension in the browser; do not remove it or load a version-specific path. Remembered connections resume automatically while their credentials remain valid. Installation and permission approval remain manual. The launcher does not change browser profiles or security policy, or perform paid Tripo actions.

## Source checkout

Requires Windows x64, Node.js 24 LTS and npm. `Open FITA.cmd` installs dependencies, builds the frontend and prepares the ignored **FITA Extension** folder on first launch. Source ZIPs already include this folder. For a manual server start: `npm ci`, `npm run build`, then use the launcher once to prepare the extension folder before `npm start`. Source checkouts do not use automatic release replacement; download a portable release for that feature.

`npm test` runs the application's test suite; `node --test tests/distribution.test.js` isolates updater checks. Tests do not authorize paid operations. Development caches, installed dependencies, personal projects, study captures, keys and local motion captures are excluded by a positive packaging allowlist, not merely by `.gitignore`.

## Language and compatibility

English is the default first-use UI and the language of these distribution instructions and launchers. Existing Spanish/Japanese UI translations remain available. Legacy schema fields, helper filenames, Spanish skill paths and some assistant handoff text remain unchanged for compatibility. Concepts and analysis downloads include an English `INSTRUCTIONS.txt` entry point; not every internal assistant resource is translated.

## Validation limits

This initial release includes tested import, candidate-selection, analysis-delivery and launcher safeguards. A complete live update round trip and browser-specific extension identity across upgrades are not established by these checks. The existing extension and character pipeline retain their own validation limits; passing distribution tests does not prove every Tripo workflow reliable. No character projects or private source assets are supplied. The optional local dance clip is intentionally not included or offered; the bundled Quaternius animation library retains its CC0 notices.

The public repository's code can be viewed and GitHub's terms allow repository forks on GitHub. The license is not a patent or a technical way to prevent copying. See [GitHub's licensing guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository). Third-party modification and redistribution rights remain intact; see the notices for the native-library licensing review and limits.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), [INSTALL.md](INSTALL.md) and [RELEASE_NOTES.md](RELEASE_NOTES.md).
