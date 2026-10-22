![FITA: From image to avatar, with Malfoid and blue light trails](https://raw.githubusercontent.com/catmart-xlvl/FITA/main/docs/media/fita-cover.webp)

# FITA

**From image to avatar.** A local character workbench with review checkpoints, a Tripo browser bridge and instruction packages for your local agent.

### [Download for Windows](https://github.com/catmart-xlvl/FITA/releases/latest/download/FITA-Windows-x64.zip) · [Tutorial (PDF)](https://github.com/catmart-xlvl/FITA/raw/refs/heads/main/docs/FITA-Tutorial.pdf)

Windows x64 · English / Español / 日本語 · [Visual setup guide](https://github.com/catmart-xlvl/FITA/blob/main/docs/GETTING_STARTED.md) · [Releases](https://github.com/catmart-xlvl/FITA/releases)

## Meet FITA

A 45-second tour of the workspace and character stages. Press Play here in the README.

https://github.com/user-attachments/assets/60c32410-f5bf-4897-973d-6c922531c4d0

[Original 1080p video](https://github.com/catmart-xlvl/FITA/releases/download/v0.1.0/FITA-introduction.mp4) · 34.9 MB. Inline playback keeps the full duration and audio at 720p.

## Quick start

1. **Download `FITA-Windows-x64.zip`** using the button above. Choose this Release asset for the ready-to-launch layout; GitHub's automatic Source code archives are for source checkout.
2. **Extract the ZIP completely.** Open its inner **FITA** folder in a writable local location you intend to keep. Choose the location before first launch.
3. **Double-click `Open FITA.cmd`.** First launch downloads components and installs locked dependencies. Keep the setup window open until FITA opens in your browser. Later starts reuse the installed components.
4. **Create or open a project.** Use **Create project** for your reference or **Open project** for a `.fita` backup. Connect the Tripo bridge before using provider operations.

**Open FITA.cmd** starts the app. **Close FITA.cmd** stops its server after active work is finished. With FITA closed, **Update FITA.cmd** checks this repository's stable releases. Closing the browser alone leaves the server running.

**[Tutorial - download the illustrated PDF](https://github.com/catmart-xlvl/FITA/raw/refs/heads/main/docs/FITA-Tutorial.pdf)** · 15 pages · English · 4.64 MB. It starts with orientation and an index, then follows installation through export. [Editable source](https://github.com/catmart-xlvl/FITA/tree/main/docs/tutorial).

<details>
<summary>See the project dashboard</summary>

![Real project dashboard with Create project, Open project and saved project cards](https://raw.githubusercontent.com/catmart-xlvl/FITA/main/docs/media/project-dashboard.webp)

Cards may contain user-imported references; procedural demos are labeled separately. A thumbnail is not proof of a finished avatar.

</details>

## Connect Tripo in three steps

Install the bridge in the browser you use for Tripo. FITA itself may be open in another browser.

![Illustrated setup: Install once, Pair with FITA, Connect a Tripo tab](https://raw.githubusercontent.com/catmart-xlvl/FITA/main/docs/media/bridge-setup.webp)

*ImageGen composition from real captures, including an English-localized browser screenshot. Empty fields and the unchecked permission illustrate setup before connection.*

1. **Install once.** Open `chrome://extensions`, `edge://extensions` or `brave://extensions`. Enable **Developer mode**, choose **Load unpacked**, and select the root **FITA Extension** folder beside **Open FITA.cmd**. Keep that folder in place.
2. **Pair with FITA.** Open **FITA · Tripo Studio Bridge** from the browser's Extensions menu. Copy its **Extension ID** into **FITA → Connections → Extension ID**, then click **Create pairing code**. Enter the eight-digit code in the popup and click **Pair**. The code lasts two minutes; use your own ID and code.
3. **Connect a Tripo tab.** Open Studio and sign in. Select its tab in the popup. For the project workflow, enable **Allow explicit project commands on this tab**, then click **Connect selected tab**. Read-only access and project-command access are different states; paid work still requires its applicable approvals.

A remembered browser can reconnect while its credentials remain valid; a new code is not normally needed each opening. Revocation, cleared extension data or invalid credentials can require pairing again.

[Read the visual guide with enlarged control screenshots →](https://github.com/catmart-xlvl/FITA/blob/main/docs/GETTING_STARTED.md#connect-the-browser-bridge)

## You review; FITA and your agent do the work

![Illustrated workflow: Reference, Review views and Generate 3D models](https://raw.githubusercontent.com/catmart-xlvl/FITA/main/docs/media/workflow-stages.webp)

*Illustrated overview composed with ImageGen. [Original Concept capture](https://raw.githubusercontent.com/catmart-xlvl/FITA/main/docs/media/screenshots/concept.png) · [Original Views capture](https://raw.githubusercontent.com/catmart-xlvl/FITA/main/docs/media/screenshots/views.png). Small UI details in the collage are not an exact native-screen reproduction.*

**Concept → Views → 3D form → Textures → Placement → Rigging → Export**

You approve the design, views, candidate choices, budgets and visual results. FITA coordinates approved operations and validates returns. Download the current stage's instruction ZIP, give it to your local agent and ask it to follow the instructions. Automatic return needs access to the same local workspace; manual import remains an alternative. Downloading a ZIP alone does not finish the stage.

The [Tutorial PDF](https://github.com/catmart-xlvl/FITA/raw/refs/heads/main/docs/FITA-Tutorial.pdf) covers candidate selection, texture groups, UV/finishing, placement edits, body/facial rigging and the export checks.

## A character in VRChat

One configured character in an actual in-game demonstration. Results depend on the model, its setup and the checks performed in the target client.

https://github.com/user-attachments/assets/1af8c86d-0cf4-4e2e-b898-bad6259286d7

[Original 1080p video](https://github.com/catmart-xlvl/FITA/releases/download/v0.1.0/FITA-VRChat-demo.mp4) · 25.1 MB. Inline playback keeps the full duration and audio at 720p.

<details>
<summary>Requirements and external costs</summary>

To open FITA: **Windows x64**, a writable local folder and internet for first-run components. The launcher uses Windows PowerShell and prepares Node.js/npm as needed.

For production: a current Chromium browser (120+), your signed-in Tripo account, and a local coding agent with the capabilities/access requested by the stage. Blender and stage-specific Python tools are separate requirements for local 3D work. Unity/VRChat tools are needed later for that target, not just to open the app.

External services use your accounts and fees. Review the actual operation's displayed cost before approval. The small app ZIP does not contain installed dependencies, all production tools or your projects; models and textures can use much more disk space.

</details>

<details>
<summary>Projects, updates and troubleshooting</summary>

Projects live in **user-data**, outside versioned app files. Export `.fita` backups from the library. Finish active work, run **Close FITA.cmd**, then **Update FITA.cmd**. Reload the existing extension when idle after updating; keep its folder and installation. Updates verify files and retain the previous app version, but do not provide an automatic project-data rollback.

Choose a permanent location before first launch. To change it later, export backups, install a fresh copy there and import the `.fita` files. Moving or renaming a populated installation blocks Open/Update because local workspaces can contain absolute paths.

If a paid task needs attention, preserve its IDs, receipts and files. A missing response is not proof that nothing was charged or generated. Inspect/recover that operation before approving another payment.

See the [Tutorial PDF](https://github.com/catmart-xlvl/FITA/raw/refs/heads/main/docs/FITA-Tutorial.pdf), [visual setup guide](https://github.com/catmart-xlvl/FITA/blob/main/docs/GETTING_STARTED.md) and [INSTALL.md](INSTALL.md) for details. Source checkout uses Windows x64 and Node.js 24 LTS/npm; the launcher builds the frontend and prepares the extension folder. Source checkouts do not use automatic portable-release replacement.

</details>

## License and scope

Official unmodified FITA versions may be used personally and commercially under the [FITA Usage License](LICENSE). Modification/redistribution rights have their own conditions; your projects and outputs are not restricted by that software license. FITA is not open source. [Third-party notices](THIRD_PARTY_NOTICES.md) · [License texts](THIRD_PARTY_LICENSES.txt).

English is the default UI, with Spanish and Japanese available. Some internal assistant resources retain legacy names/languages. This is an independent Tripo integration. Technical delivery does not establish artistic approval or universal VRChat compatibility. [Release notes](RELEASE_NOTES.md).
