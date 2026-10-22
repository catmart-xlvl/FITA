# FITA

![FITA: From image to avatar, made by Catmart](https://raw.githubusercontent.com/catmart-xlvl/FITA/main/docs/media/fita-brand.jpg)

**A local character workbench, from reference image to a reviewed avatar workflow.**

### [Download FITA for Windows](https://github.com/catmart-xlvl/FITA/releases/latest/download/FITA-Windows-x64.zip)

Windows x64 · Local web app · Tripo browser extension · English / Español / 日本語

[Quick start](#quick-start) · [Connect Tripo](#connect-tripo-in-three-steps) · [The workflow](#you-review-fita-and-your-agent-do-the-work) · [Visual setup guide](https://github.com/catmart-xlvl/FITA/blob/main/docs/GETTING_STARTED.md) · [Releases](https://github.com/catmart-xlvl/FITA/releases)

## Meet FITA

Explore the workspace and the character stages in this 45-second introduction. Press Play here in the README.

https://github.com/user-attachments/assets/60c32410-f5bf-4897-973d-6c922531c4d0

[Original 1080p video](https://github.com/catmart-xlvl/FITA/releases/download/v0.1.0/FITA-introduction.mp4) · 34.9 MB. The inline copy is 720p with the complete duration and audio.

## Quick start

1. **Download `FITA-Windows-x64.zip`** from the link above. Choose this asset for the ready-to-launch Windows layout; GitHub's automatic Source code archives are for source checkout.
2. **Extract the ZIP completely.** Open the inner `FITA` folder in a writable local location you intend to keep. Choose that location before the first launch.
3. **Double-click `Open FITA.cmd`.** The first launch downloads required components and installs locked dependencies. Keep the setup window open until FITA opens in your browser. Setup progress is expected; later launches reuse the installed components.
4. **Create or open a project.** Use **Create project** for your own reference image, or **Open project** for a saved `.fita` file. Set up the browser bridge below before using Tripo operations.

| File | What it does |
| --- | --- |
| **Open FITA.cmd** | Prepares components if needed, starts the local server and opens FITA. |
| **Close FITA.cmd** | Stops this installation's server. Finish active operations first. Closing the browser alone leaves it running. |
| **Update FITA.cmd** | With FITA closed and idle, checks stable releases from this repository and installs a verified newer version if available. |

<details>
<summary>See the project dashboard</summary>

![FITA project dashboard with Create project, Open project and saved project cards](https://raw.githubusercontent.com/catmart-xlvl/FITA/main/docs/media/project-dashboard.webp)

A real project library. Card images may be imported references; the optional procedural demo is labeled separately. They are not a gallery of automatically generated final avatars.

</details>

## Connect Tripo in three steps

Install the extension in the browser where you use Tripo. FITA itself can be open in a different browser.

![Illustrated setup: install the browser extension, pair its ID with FITA, then connect one Tripo tab](https://raw.githubusercontent.com/catmart-xlvl/FITA/main/docs/media/bridge-setup.webp)

*Illustrated setup composed from real captures; the browser screenshot is English-localized. The empty fields and unchecked permission are examples before connection.*

1. **Install once.** Open `chrome://extensions`, `edge://extensions` or `brave://extensions`. Enable **Developer mode**, choose **Load unpacked**, and select the **FITA Extension** folder beside **Open FITA.cmd**. Keep that folder in place.
2. **Pair the browser with FITA.** Open **FITA · Tripo Studio Bridge** from the browser's Extensions menu. Copy its **Extension ID** into **FITA → Connections → Extension ID**. Click **Create pairing code** in FITA, then enter that eight-digit code in the popup and click **Pair**. The code expires after two minutes. Use your own ID and code.
3. **Connect a Tripo tab.** Open Tripo Studio and sign in. In the popup, select that tab. For the project workflow, enable **Allow explicit project commands on this tab**, then click **Connect selected tab**. Read-only connection and project-command authorization are different states. FITA still requires the applicable cost and operation approvals.

**You do not normally enter a new code every time you open FITA.** A remembered browser can reconnect while its stored credentials remain valid. Revoking access, clearing extension data or an invalid credential can require pairing again. Keep the same extension installation and folder.

[Open the illustrated guide with readable control screenshots →](https://github.com/catmart-xlvl/FITA/blob/main/docs/GETTING_STARTED.md#connect-the-browser-bridge)

## You review; FITA and your agent do the work

You choose the design and approve checkpoints. FITA organizes files, validates returns and coordinates approved Tripo operations. A local coding agent handles the instruction packages and the supported local production steps.

![Illustrated FITA workflow: Reference, Review views and Generate 3D models, with real source-derived character and candidate previews](https://raw.githubusercontent.com/catmart-xlvl/FITA/main/docs/media/workflow-stages.webp)

*An illustrated overview, not a single native screenshot or proof of a complete automatic run. [Original Concept capture](https://raw.githubusercontent.com/catmart-xlvl/FITA/main/docs/media/screenshots/concept.png) · [Original Views capture](https://raw.githubusercontent.com/catmart-xlvl/FITA/main/docs/media/screenshots/views.png)*

| Stage in FITA | Your checkpoint | Work around that checkpoint |
| --- | --- | --- |
| **Concept** | Choose and confirm the reference and design notes. | Download the concept instruction package for your agent. |
| **Views** | Review the returned head/body views and approve the set. | The agent prepares views; FITA validates the returned files. |
| **3D form** | Approve the displayed generation cost; compare and choose head/body candidates. | The bridge prepares approved views in Tripo and transfers completed candidates. |
| **Textures** | Review texture groups and the complete UV/texturing budget before approval. | Analysis, references, UV, textures and local finishing follow the current package and validated results. |
| **Placement** | Review the initial head/body placement, adjust it and save the height. | FITA provides the initial placement and manual controls; further local work follows its instructions. |
| **Rigging** | Review the rig and supported motion checks. | Stage-specific tools and agent work prepare the model for its target. |
| **Export** | Review the intended output and target requirements. | Export the supported result; validate it in the destination application. |

**How the agent handoff works:** download the instruction ZIP offered by the current stage, attach it to your local agent and ask it to follow the instructions. Automatic return needs an agent with access to the same local workspace. FITA validates the returned delivery before unlocking the next work. Manual import remains available when automatic return is unavailable. Downloading a ZIP alone does not complete the stage.

<details>
<summary>What does texture-group review look like?</summary>

![Body geometry preview in Textures, with separately listed clothing and hand groups](https://raw.githubusercontent.com/catmart-xlvl/FITA/main/docs/media/screenshots/texture-groups.png)

This capture shows geometry and texture-group controls, before final texturing. Project notes and segment names inside screenshots are user-authored and may use another language.

</details>

## A character in VRChat

A short in-game demonstration of one configured character. Compatibility and results depend on the model, its setup and the checks performed in the target client.

https://github.com/user-attachments/assets/1af8c86d-0cf4-4e2e-b898-bad6259286d7

[Original 1080p video](https://github.com/catmart-xlvl/FITA/releases/download/v0.1.0/FITA-VRChat-demo.mp4) · 25.1 MB. The inline copy is 720p with the complete duration and audio.

## What you need

| When | Requirement |
| --- | --- |
| **To open FITA** | Windows x64, a writable local folder and internet for initial setup. The launcher uses Windows PowerShell and prepares Node.js/npm components as needed. |
| **For the Tripo bridge** | A current desktop Chromium browser (Chrome, Edge or Brave; Chromium 120+), the included extension and your signed-in Tripo account. |
| **For agent stages** | A local coding agent with access to FITA's project workspace and the capabilities requested in that stage's instructions. Image generation is needed for the corresponding reference steps. |
| **For local 3D work** | Blender and any Python packages required by the delivered stage. Let the agent check the package requirements before starting. These tools are separate from the Windows app download. |
| **For VRChat work** | The relevant Unity/VRChat tools, account and target-client validation when you reach that stage. They are not required just to open FITA. |

External services use your accounts and their own fees. FITA's small ZIP does not include your projects, installed dependencies or every production tool. Models and textures can require much more disk space than the app itself.

<details>
<summary>Updates, saved projects and moving installations</summary>

Projects live in **user-data**, outside versioned application files. Export `.fita` backups from the project library. Finish active work, run **Close FITA.cmd**, then **Update FITA.cmd**. After updating, reload the existing browser extension when idle; keep its folder and do not remove it.

Updates verify the published asset digest and application files, prepare the new version and retain the previous version. Local edits or failed checks block replacement. This is HTTPS/integrity verification, not independent publisher signing or an automatic project-data rollback.

Choose a permanent installation folder before first launch. Moving or renaming an installed folder blocks Open/Update because local workspaces can contain absolute paths. To move to another location, export your projects, install a fresh copy there and import the `.fita` backups. Keep the old data until the backups are verified.

</details>

<details>
<summary>Troubleshooting and source checkout</summary>

- **The setup window is busy:** first launch can be downloading components. Read its progress or error before closing it. If browser opening fails, use the local URL displayed by the launcher.
- **Paired, but no commands:** choose the correct Studio tab and the intended permission in the popup. Opening Tripo alone does not connect it. [Connection guide](https://github.com/catmart-xlvl/FITA/blob/main/docs/GETTING_STARTED.md#check-the-connection).
- **A generation or transfer needs attention:** keep the existing operation and its files. Do not submit a paid generation again just because a response was lost; inspect/recover the existing task.
- **Installed folder moved:** restore its original location to export projects, then migrate through `.fita` backups.

For source checkout, use Windows x64 and Node.js 24 LTS/npm. `Open FITA.cmd` installs dependencies, builds the frontend and prepares the ignored root extension folder on first launch. For manual server startup: `npm ci`, `npm run build`, then use the launcher once before `npm start`. Source checkouts do not use automatic portable-release replacement.

See [INSTALL.md](INSTALL.md) for launcher, storage and archive-limit details. `npm test` runs application tests; `node --test tests/distribution.test.js` isolates updater checks. No test command authorizes paid operations.

</details>

## License and scope

FITA's own software uses the [FITA Usage License](LICENSE). Official unmodified versions may be used personally and commercially; modification and redistribution rights are reserved except where permission, law or third-party terms allow them. FITA is not open source. This license adds no restrictions to your projects or outputs. See [third-party notices](THIRD_PARTY_NOTICES.md) and [license texts](THIRD_PARTY_LICENSES.txt).

English is the default UI; Spanish and Japanese remain available. Some internal assistant resources retain legacy names or another language. The integration is independent of Tripo. Technical imports and automated checks do not establish artistic approval or universal VRChat compatibility. [Release notes and validation limits](RELEASE_NOTES.md).
