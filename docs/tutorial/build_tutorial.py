"""Editable source for the English FITA tutorial. Requires reportlab and Pillow.
Run from any folder: python docs/tutorial/build_tutorial.py
Assets are read from ../media; output is ../FITA-Tutorial.pdf.
"""
from pathlib import Path
from html import escape
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image, Table, TableStyle, PageBreak, HRFlowable

DOCS = Path(__file__).resolve().parent.parent
MEDIA = DOCS / 'media'
OUTPUT = DOCS / 'FITA-Tutorial.pdf'
REPO = 'https://github.com/catmart-xlvl/FITA'
BLUE = colors.HexColor('#1582BE')
NAVY = colors.HexColor('#101C30')
GRAY = colors.HexColor('#58677A')
WIDTH = A4[0] - 88
styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='FTitle', fontName='Helvetica-Bold', fontSize=29, leading=34, textColor=NAVY, spaceAfter=13))
styles.add(ParagraphStyle(name='FHead', fontName='Helvetica-Bold', fontSize=13, leading=17, textColor=BLUE, spaceBefore=10, spaceAfter=7))
styles.add(ParagraphStyle(name='FBody', fontName='Helvetica', fontSize=10.3, leading=14.5, textColor=colors.HexColor('#253449'), spaceAfter=8))
styles.add(ParagraphStyle(name='FCaption', fontName='Helvetica', fontSize=8.2, leading=11, textColor=GRAY, spaceBefore=5, spaceAfter=9))
styles.add(ParagraphStyle(name='FCell', fontName='Helvetica', fontSize=9, leading=12.5, textColor=NAVY))
styles.add(ParagraphStyle(name='FCellHead', fontName='Helvetica-Bold', fontSize=9, leading=12.5, textColor=colors.white))

def p(text, style='FBody'):
    return Paragraph(text, styles[style])

def table(rows, widths=None):
    data = [[p(str(value), 'FCellHead' if i == 0 else 'FCell') for value in row] for i, row in enumerate(rows)]
    t = Table(data, colWidths=widths or [WIDTH / len(rows[0])] * len(rows[0]), hAlign='LEFT')
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), NAVY), ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor('#F0F6FA')),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LEFTPADDING', (0, 0), (-1, -1), 9),
        ('RIGHTPADDING', (0, 0), (-1, -1), 9), ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8), ('LINEBELOW', (0, 0), (-1, -1), .4, colors.HexColor('#D4E2EB'))
    ]))
    return t

def figure(name, caption, height=235, width=WIDTH):
    image = Image(str(MEDIA / name))
    scale = min(width / image.imageWidth, height / image.imageHeight)
    image.drawWidth = image.imageWidth * scale
    image.drawHeight = image.imageHeight * scale
    image.hAlign = 'CENTER'
    return [Spacer(1, 5), image] + ([p(caption, 'FCaption')] if caption else [])

def steps(items):
    return [p('<b>%s.</b> %s' % (i + 1, item)) for i, item in enumerate(items)]

def checkpoint(text):
    box = Table([[p('<b>Checkpoint</b><br/>' + text)]], colWidths=[WIDTH])
    box.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#EAF6FD')), ('BOX', (0, 0), (-1, -1), .6, colors.HexColor('#98CCE8')), ('LEFTPADDING', (0, 0), (-1, -1), 12), ('RIGHTPADDING', (0, 0), (-1, -1), 12), ('TOPPADDING', (0, 0), (-1, -1), 10), ('BOTTOMPADDING', (0, 0), (-1, -1), 6)]))
    return [Spacer(1, 8), box]

def link(label, url):
    return '<link href="%s" color="#1582BE">%s</link>' % (escape(url, quote=True), escape(label))

PAGES = []
def page(anchor, title, body):
    PAGES.append((anchor, title, body))

contents = [
    ('Install, open and close', 'install', 3), ('Install the browser extension', 'extension', 4),
    ('Pair the browser and connect a tab', 'pair', 5), ('Concept and the local agent', 'concept', 6),
    ('Review the returned views', 'views', 7), ('Generate and compare 3D models', 'models', 8),
    ('Analyze texture groups', 'analysis', 9), ('UV, textures and finishing', 'textures', 10),
    ('Placement and mesh edits', 'placement', 11), ('Body rigging', 'bodyrig', 12),
    ('Review facial expressions', 'face', 13), ('Export and VRChat checks', 'export', 14),
    ('Projects, backups, Trash and updates', 'projects', 15), ('Troubleshooting and final checklist', 'help', 16)
]
page('contents', 'FITA tutorial / Start here', [
    p('Follow the Windows setup, connect Tripo, then work through one character project with your local agent. You choose the design, approve costs and review each checkpoint. This guide describes FITA 0.1.0 and bridge 0.2.77.'),
    table([['Read in order', 'Page']] + [[link(label, '#' + anchor), str(number - 1)] for label, anchor, number in contents], [WIDTH - 48, 48]),
    p('What you need', 'FHead'),
    p('<b>To open FITA:</b> Windows x64, a writable local folder and internet for first-run components. The launcher prepares its Node.js/npm components.'),
    p('<b>For production:</b> a supported Chromium browser and Tripo account; a local coding agent for package work; Blender and the stage-specific Python/tools it requests. Unity and VRChat tools are later requirements, not prerequisites just to open the app.'),
    p('External services use your accounts and their own fees. Approve the price shown for the actual operation, not a price from a screenshot or this guide.')
])

page('install', '01 / Install, open and close', steps([
    'Download <b>FITA-Windows-x64.zip</b> from the Release assets. This is the ready-to-launch Windows layout, distinct from GitHub\'s automatic Source code archives.',
    'Extract it completely and open the inner <b>FITA</b> folder. Choose a permanent writable local location before the first launch.',
    'Double-click <b>Open FITA.cmd</b>. Keep the setup window open while components download and locked dependencies install. Later launches reuse them.',
    'When FITA opens, use <b>Create project</b> or <b>Open project</b>. If browser opening fails, use the local URL displayed by the launcher: <b>http://127.0.0.1:4317</b>.'
]) + figure('project-dashboard.webp', 'Actual dashboard crop. Cards can show user reference images; the procedural demo is separately labeled.', 220) + [
    p('<b>Close FITA.cmd</b> stops this installation\'s local server. Closing only the browser tab leaves it running. Finish active work before closing.'),
    p(link('Download the Windows package', REPO + '/releases/latest/download/FITA-Windows-x64.zip'))
] + checkpoint('Keep Open/Close/Update FITA.cmd and the root FITA Extension folder together. Moving an installed folder later is not a project migration.'))

page('extension', '02 / Install the extension once', [
    p('Install in the browser where you use Tripo. FITA may be open in another browser. The included bridge supports current desktop Chrome, Edge and Brave on Chromium 120 or newer.'),
] + steps([
    'Open <b>chrome://extensions</b>, <b>edge://extensions</b> or <b>brave://extensions</b> in that browser\'s address bar.',
    'Enable <b>Developer mode</b>, then click <b>Load unpacked</b>.',
    'Select <b>FITA Extension</b> beside <b>Open FITA.cmd</b> in the extracted portable root. Do not select a folder inside versions.',
    'Confirm <b>FITA - Tripo Studio Bridge</b> is installed and enabled. Open its popup from the toolbar\'s Extensions menu.'
]) + figure('extensions-english.webp', None, 280) + checkpoint('Use Load unpacked, not Pack extension. Keep the selected FITA Extension folder in place; do not remove and reinstall it for routine updates.'))

page('pair', '03 / Pair, then connect a tab', [
    p('<b>A. Pair the browser:</b> copy the Extension ID from popup step 1 into <b>FITA - Connections - Extension ID</b>. Click <b>Create pairing code</b>. Enter the eight-digit code in popup step 2 and click <b>Pair</b>. The code expires after two minutes.'),
] + figure('screenshots/pairing-form.png', 'Enter your Extension ID to enable Create pairing code.', 84) + [
    p('<b>B. Connect the tab:</b> open Tripo Studio in this browser and sign in. Choose that tab in popup step 3. For the project workflow, enable <b>Allow explicit project commands on this tab</b>, then click <b>Connect selected tab</b>.'),
] + figure('screenshots/bridge-popup.png', 'Actual English popup before connection: code empty and permission unchecked. Use your own ID; the sample ID is not a pairing code.', 300) + [
    p('A remembered browser can reconnect while its stored credentials remain valid. Routine reopening does not normally require a new code. Revocation, cleared extension data or an invalid credential can require pairing again.'),
] + checkpoint('Paired, read-only and project-command access are different states. Command permission does not approve every paid operation.'))

page('concept', '04 / Concept and your local agent', steps([
    'Create a project and choose your reference in <b>Concept</b>. Use a clear image and add design notes for details you want preserved.',
    'Confirm the reference in the current stage, then use <b>Download concept package</b> in the Codex card.',
    'Attach that ZIP to your local agent and ask it to follow the instructions. The package identifies the exact workspace, resources and return helper.',
    'Let the agent complete the package work and check the delivery receipt. FITA validates the returned views before you review them.'
]) + figure('screenshots/concept.png', 'Original Concept capture from a later project revision: Stage completed makes it read-only here. It is not the initial upload state.', 230) + [
    p('<b>Local access matters:</b> automatic return requires the agent to access the same workspace on this computer. A cloud-only chat cannot be assumed to have that access. Use the stage\'s manual import alternative when appropriate.'),
] + checkpoint('Downloading an instruction ZIP does not finish a stage. Wait for a validated delivery, then make your own visual decision.'))

page('views', '05 / Review the returned views', steps([
    'Open <b>Views</b>. Inspect <b>Head</b> and <b>Body</b> separately.',
    'Select the front, back and profile thumbnails. Compare the same face, hair, clothing and proportions across the set.',
    'Keep the intended views selected with <b>Use this view</b>. If the design drifts, ask the agent for a targeted correction using the current package.',
    'Use <b>Approve and continue</b> when the relevant set is ready. Complete the required head/body review before 3D generation.'
]) + figure('screenshots/views.png', 'Actual Body/front review with four loaded view thumbnails and Approve and continue.', 255) + checkpoint('Technical validation checks files and contracts. You still decide whether the views match the design.'))

page('models', '06 / Generate and compare 3D models', [
    p('Before generating, check that Tripo is connected with project commands and the required views are approved. FITA prepares the requested profile and reads the current displayed cost.'),
] + steps([
    'Use the head generation control and review its actual quote. Confirm only the operation and price you intend to pay for.',
    'Wait for the existing head tasks and candidate transfers. Use the body generation control when FITA enables the next required batch.',
    'Compare local previews by rotating the model and using the candidate eye controls or lower strip. A preview alone is not a saved choice.',
    'Click <b>Use this model</b> for the intended head and body. The chosen state is distinct from Preview only. You can change the choice while the stage remains editable; later dependent work can require returning to edit the stage.'
]) + figure('workflow-stages.webp', None, 220) + checkpoint('If a task needs attention, inspect/recover that task. Do not start another paid batch just because the response or download is late.'))

page('analysis', '07 / Analyze texture groups', steps([
    'In <b>Textures</b>, start with <b>Texture group analysis</b> and <b>Download analysis ZIP</b>.',
    'Give that package to your local agent. FITA waits for valid results; downloading the ZIP alone does not validate the analysis.',
    'After a current valid result arrives, review <b>Head</b> and <b>Body</b> groups separately. Use <b>Isolate group</b> and compare the geometry and intended material regions.',
    'Correct an invalid or stale analysis before approving later work. <b>Import manually</b> remains an alternative delivery path.'
]) + figure('screenshots/texture-groups.png', 'Actual Body geometry and listed clothing/hand groups before final textures. Stored group names may be in another language.', 240) + [
    p('<b>Cancel waiting in Textures</b> dismisses the local wait. It does not cancel an external agent, erase the project or approve a result. Invalid deliveries remain invalid.'),
] + checkpoint('Review which faces belong to each part. Do not approve an obsolete analysis or treat the reference ZIP as a finished segmentation.'))

page('textures', '08 / UV, textures and finishing', [
    p('The texture workflow uses the current validated groups and a complete plan. Review both head and body, their UV work, texture resolutions and total cost before approving <b>Generate textures</b>.'),
] + steps([
    'Inspect each group\'s <b>Texture settings</b> and the displayed cost explanation. Do not accept an unknown or incomplete total.',
    'Follow the current package for reference preparation. The agent creates/reviews references; FITA validates them before dependent work.',
    'Once the required references and consent are valid, let FITA and its bridge coordinate approved Smart UV, permitted free retries, saving UVs, texturing and transfer. Monitor the displayed task/group progress.',
    'If the UI reports attention, preserve the existing result and use the appropriate <b>Recover and continue</b> or task check when offered. Do not manually repeat a paid UV or texture click in Studio.',
    'After all required pieces are transferred, let the agent perform the local finishing package: texture cleanup, facial detail and hair-normal work as specified. Verify its return receipt and inspect the result.'
]) + [
    p('Visual review', 'FHead'),
    p('Check the front, both profiles and back. Look for texture projection from another region, seams, skin-tone differences, inconsistent patterns, and unwanted bright outlines. A completed download is not proof that the art is finished.'),
    table([['What you see', 'What it means'], ['A wait or progress estimate', 'The operation still needs its result/receipt. An elapsed estimate is not a confirmed failure.'], ['Head/Body groups available', 'The current analysis passed its delivery checks. You still review the grouping.'], ['Continue to placement enabled', 'The applicable current texture/refinement requirements have been satisfied.']]),
] + checkpoint('Review the combined character and the actual returned files before continuing. Keep existing task IDs and receipts when recovering.'))

page('placement', '09 / Placement and mesh edits', [
    p('When the required textured parts are ready, open <b>Placement</b>. FITA estimates an initial placement the first time. Treat its confidence note as a guide; inspect the front and both profiles.'),
] + steps([
    'Adjust <b>Uniform head scale</b>, <b>Head position</b> and <b>Character height (cm)</b>. If regions or orientation are uncertain, use <b>Proportions, orientation and anchors</b> to define the relevant axes and landmarks.',
    'If needed, open <b>Edit mesh</b> inside the viewport. Use <b>Add point</b>, move its arrows and adjust <b>Influence radius</b>. <b>Connected geometry only</b> restricts the influence; turning it off affects meshes within range.',
    'Use <b>Compact view - small points, no radius</b> when controls obscure the model. Delete a selected point to remove that point and its deformation; use Undo/Redo as appropriate.',
    'Click <b>Done: save model</b>. After the model is saved, download <b>Download ZIP for Codex</b> for the local model-finish work.',
    'While that handoff waits, placement/height/mesh edits are locked. Let the agent return the validated result, review it, then use <b>Continue to rigging</b> when available.'
]) + [
    p('Two different cancellation behaviors', 'FHead'),
    table([['Where', 'Effect'], ['Textures - Cancel waiting', 'Dismisses only the local wait; it does not approve or cancel external work.'], ['Placement - Cancel waiting and edit again', 'After confirmation, invalidates that downloaded handoff. Points remain, but old results are rejected; save again and download a new ZIP.']]),
] + checkpoint('Approve the intended placement and height, not just the camera view. The local finish package must respect that saved state.'))

page('bodyrig', '10 / Prepare the body rig', [
    p('Open <b>Rigging - Body rig</b> after the placement handoff has been imported. This workflow uses a Tripo rig donor as a reference and refines the original character.'),
] + steps([
    'Use <b>Send character to Tripo</b> with the authorized connection. Let the bridge prepare the rig settings and read the quote.',
    'Review <b>Confirm rigging - [displayed credits]</b> and approve only that price. If the job needs attention, use its <b>Check existing rig job</b> or <b>Resume upload and rig setup</b> option as appropriate.',
    'When the donor is received, use <b>Download refinement ZIP</b>. Give the package to your local agent to transfer/refine weights on the original character.',
    'Use <b>Load refined result</b> when the package work is complete. Compare <b>Original character</b>, <b>Rig donor - reference only</b> and <b>Refined original</b>.',
    'Inspect the available motion preview and the shoulders, neck, elbows, hips and knees. Read the rigging review notes. Download the editable Blender result if you need external inspection.'
]) + [
    p('Optional advanced work', 'FHead'),
    p('Manual weight editing and previous attempts are available when their source is eligible. Keep the current source/version clear and review a manual result in motion before using it for the next stage.'),
    p('If you already have the appropriate Tripo rig result for this character, use <b>Import an existing Tripo result - Import donor GLB</b>. Check that it belongs to the current project before continuing.'),
] + checkpoint('Review the original character with the refined weights. A donor rig or a valid file alone does not prove good deformation.'))

page('face', '11 / Review facial expressions', [
    p('Open <b>Rigging - Facial expressions</b> after refining and reviewing the body rig. The facial workflow prepares coordinated shape keys while preserving the body bones and weights.'),
] + steps([
    'Confirm <b>I reviewed the body weights and deformation</b>, then use <b>Prepare facial handoff</b>.',
    'Download <b>Download facial instructions ZIP</b> and give it to your local agent. Follow the exact workspace and helper in that package.',
    'Use <b>Load facial result</b> after the agent returns the result. Read review notes and limitations.',
    'Use the expression sliders and <b>Reset expressions</b>. Check blinks, gaze, brows and visemes from several angles, including intermediate strengths and combinations.',
    'Only after review, confirm <b>I reviewed blinks, gaze, brows, visemes and their combinations from several angles</b>, then click <b>Approve facial expressions</b>. Use <b>Continue to Export</b> when ready.'
]) + [
    p('Practical review checklist', 'FHead'),
    table([['Check', 'Look for'], ['Blink and half-blink', 'Lid/lash contact, sclera coverage and no sudden intersections.'], ['Gaze and brows', 'Coordinated motion with the intended anime face and no floating details.'], ['Visemes', 'Readable lip shapes without clipping or unintended mesh changes.'], ['Combinations', 'Blink plus gaze or mouth motion should remain coherent.']]),
] + checkpoint('Structural checks do not replace the visual expression review. Do not approve a result merely because its ZIP imported.'))

page('export', '12 / Export and validate the target', [
    p('The current guided export is <b>VRChat - PC</b>. Review and approve facial expressions in Rigging first.'),
] + steps([
    'In <b>Export</b>, use <b>Prepare VRChat export</b>. Download <b>Download VRChat instructions ZIP</b>.',
    'Give it to your local agent. The package directs local Unity/avatar preparation, materials, facial controls and physics, with the applicable SDK checks.',
    'Use <b>Load delivery report</b> to inspect the reported milestones. Pending checks remain pending.',
    'Follow the agent\'s guided <b>Build &amp; Test</b> and actual VRChat-client review. Inspect appearance, expressions, deformation and the intended avatar behavior.',
    'Publish to your account only when you authorize that separate action. A downloaded instruction ZIP is not a published avatar.'
]) + figure('vrchat-example.jpg', 'An authentic supplied VRChat demonstration frame of one configured character. It is an example, not a universal compatibility guarantee.', 220) + checkpoint('Distinguish local file validation, SDK/build results and an actual client test. Record which checks were really completed.'))

page('projects', '13 / Projects, backups and updates', [
    p('Your library and backups', 'FHead'),
    p('Projects remain on this computer. Use a project card\'s <b>Save as .fita</b> action to create a portable project archive. Use <b>Open project</b> to import it. Large models/textures can make archives much larger than the app ZIP and imports can take time.'),
    p('Importing a backup of an existing project can create a separate copy. Check the imported project in your library and keep the original backup until its files and progress are confirmed.'),
    p('Trash', 'FHead'),
    p('Moving a project to Trash is separate from permanent deletion. Use <b>Restore project</b> to recover an entry. <b>Delete permanently</b> requires an explicit confirmation and cannot be undone through Trash. Verify the exact project in the dialog first.'),
    p('Update the app', 'FHead'),
] + steps([
    'Finish all active generation, transfers and agent work. Export important project backups.',
    'Use <b>Close FITA.cmd</b>, then <b>Update FITA.cmd</b>. The updater checks this repository\'s stable Release and verifies the package/files before activation.',
    'Open FITA after completion. When idle, reload the existing browser extension to load its updated files. Keep the same root folder and extension installation.'
]) + [
    p('Projects live in <b>user-data</b>, outside versioned app files. Previous app versions are retained, but an application rollback is not an automatic rollback of project data.'),
] + checkpoint('To change installation location, export .fita backups, install a fresh copy there, import and verify them. Do not simply move or rename the populated installation.'))

page('help', '14 / Troubleshooting and next steps', [
    table([['Symptom', 'Action'], ['First launch is slow or fails', 'Read the setup progress/error. Check internet and a writable extracted folder. Keep project data.'], ['No Studio tab or commands', 'Use the browser/profile with the extension; select the correct tab and command permission. Pairing alone is not tab authorization.'], ['Response lost after a paid action', 'Preserve task IDs, receipts and files. Inspect/recover the same operation before approving another payment.'], ['Invalid or stale return', 'Open the correct project and ask your agent to use the current package. Import the result that matches it.'], ['Placement result rejected after editing', 'Saving changed geometry or canceling that handoff can invalidate its old ZIP. Prepare a current handoff.'], ['Installed folder moved', 'Restore the original location to open/export; migrate using a fresh installation and verified backups.']]),
    p('Before calling a project finished', 'FHead'),
    p('Confirm the design and views; the selected head/body; texture projection and skin-tone consistency; saved placement/height; body deformation; facial combinations; export checks and target-client behavior. Keep technical receipts separate from your artistic approval.'),
    p('Useful links', 'FHead'),
    p(link('Visual onboarding and browser guide', REPO + '/blob/main/docs/GETTING_STARTED.md') + '<br/>' + link('Latest release and checksums', REPO + '/releases/latest') + '<br/>' + link('Detailed installation and storage notes', REPO + '/blob/main/INSTALL.md') + '<br/>' + link('FITA Usage License', REPO + '/blob/main/LICENSE') + ' | ' + link('Third-party notices', REPO + '/blob/main/THIRD_PARTY_NOTICES.md')),
    p('Official unmodified FITA software may be used personally and commercially under its license. Modification/redistribution rights have their own conditions; your projects and outputs are not restricted by that software license. External services/tools retain their own terms and fees.', 'FCaption'),
])

class TutorialDoc(SimpleDocTemplate):
    def afterFlowable(self, flowable):
        anchor = getattr(flowable, 'anchor', None)
        if anchor:
            self.canv.bookmarkPage(anchor)
            self.canv.addOutlineEntry(flowable.getPlainText(), anchor, level=0, closed=False)

def frame(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(NAVY)
    canvas.rect(0, A4[1] - 30, A4[0], 30, fill=1, stroke=0)
    canvas.setFont('Helvetica-Bold', 9)
    canvas.setFillColor(colors.white)
    canvas.drawString(44, A4[1] - 19, 'FITA  /  ENGLISH TUTORIAL')
    canvas.setFont('Helvetica', 8)
    canvas.drawRightString(A4[0] - 44, A4[1] - 19, '0.1.0  |  22 OCT 2026')
    canvas.setFillColor(GRAY)
    canvas.setFont('Helvetica', 8)
    canvas.drawString(44, 24, 'Made by Catmart  |  Local character workbench')
    canvas.drawRightString(A4[0] - 44, 24, str(doc.page))
    canvas.linkURL(REPO, (44, 15, 270, 34), relative=0, thickness=0)
    canvas.restoreState()

def build():
    story = []
    for i, (anchor, title, body) in enumerate(PAGES):
        if i:
            story.append(PageBreak())
        heading = p(title, 'FTitle')
        heading.anchor = anchor
        story += [heading, HRFlowable(width='100%', thickness=1.3, color=BLUE), Spacer(1, 12)] + body
    doc = TutorialDoc(str(OUTPUT), pagesize=A4, rightMargin=44, leftMargin=44, topMargin=48, bottomMargin=44,
                      title='FITA Tutorial - English', author='Catmart', subject='Install and use FITA 0.1.0',
                      pageCompression=1, allowSplitting=0)
    doc.build(story, onFirstPage=frame, onLaterPages=frame)
    print(OUTPUT)

if __name__ == '__main__':
    build()
