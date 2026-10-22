# FITA: facial configuration for VRChat PC

Also follow `VRCHAT_PC_SKIN_SETUP.md`: every PC avatar includes the independent Skin Brightness and Skin Reflection radial controls. Preserve these alongside facial controls, use the same resolved menu language, include alternate blink renderers in skin-only bindings, and keep the approved face albedo. Never drive iris, eyelashes or Eye Shadow materials with skin controls.

Revision: 2026-10-17-facial-v1. Required destination-authoring instructions, after approval of Rigging and Facial Expressions. Read the `facial` section of `VRCHAT_PC_REFERENCE_PROFILE.json` with this guide. These resources describe work Codex must implement and verify in the character's Unity project; downloading them does not configure an avatar. Never copy a pilot character, blueprint, absolute path or fixed blendshape index.

## Menu language: English by default

All avatar-facing expression controls, submenus and puppet-axis labels default to English, regardless of the FITA interface language, operating system or conversation language. Examples: **Camera Blink**, **Mood**, **Mouth**, **Brows**, **Smile**, **Frown**, **Angry**, **Sad**, **Raised Brows**, **Gaze**, **Blink**, **Reset**. This policy applies to generated avatar labels; it does not change the FITA web interface language.

Before generating the menu, reuse any explicit avatar-menu language preference the user has already supplied for this character. Otherwise ask once, in the user's conversation language: “Which language would you like for the avatar's expression buttons? English is the default.” Offer English, Spanish and a custom language. Continue independent preparation while awaiting an optional answer; if the user leaves the choice unspecified, use English. Do not infer Spanish merely from a Spanish conversation or ask again after an explicit selection. An explicit request for another language overrides the default.

Use the profile's label catalog for English/Spanish; translate every displayed label consistently for other requested languages, including submenu and puppet-axis labels. Keep parameter IDs, expression IDs, blendshape names and animation binding paths stable across languages. Do not translate `FITA_BlinkCamera`, `Viseme`, or `VRCFaceBlendH/V`. Rename display labels in place on an existing character; do not rebuild its rig to change language.

Persist the resolved language, provenance (`explicit-user` or `default`), display-label map and this guide's revision in the character-owned Unity configuration record. Include them in the facial evidence. Reuse that record in later revisions unless the user changes the choice.

## Preserve the approved face

Inventory the approved bindings, renderer paths, eye parts, neutral transforms, mesh units, visemes and morph POSITION/NORMAL deltas before authoring. Keep source GLB/BLEND files and their hashes intact. Derived Unity meshes may combine or adapt approved data, preserving neutral world-space geometry, UVs, material assignments, weights/bindposes and every expression. Keep face-mask normals across skin, eyelids, lashes, brows, sclera, iris, pupils and glints, including the chin and each expression's NORMAL deltas. Do not recalculate these as generic triangle normals on import.

Keep the approved smooth iris surface and subtle concavity. Iris, pupil and glints form one rigid assembly per eye. Never shrink, flatten or deform that assembly for a blink. Eyelids and lashes close around it. Any previously approved tiny inward blink correction must be identical across all eye layers and return exactly to neutral; do not introduce a new correction unless protrusion is actually observed.

## Native gaze and Selfie Expression

1. Configure native Avatar Descriptor Eye Look, enable it, and bind the actual left/right eye control transforms. Shape-key gaze or a manual menu alone is not native camera eye tracking. Verify the current SDK/client's supported tracking path; the pilot used VRChat's native Selfie Expression webcam feature, without VRCFaceTracking.
2. Calibrate straight/up/down/left/right in the avatar's own frame. Neutral rotations must be valid unit quaternions, not all-zero values. In Editor tooling use the SDK's supported API or verified `SerializedObject` properties for private serialized eye-rotation fields, then read them back after saving/reopening. Public-field reflection missed these fields in the pilot. Its +/-30-degree calibration is a fitted example, not a universal requirement.
3. For a planar anime iris, use a bounded translation adapter rather than rotating the visible iris disc through the eyelids. The profile's initial travel radius is **0.0065 world metres (6.5 mm)**. Fit it to the actual eye aperture and scale; reduce it if a side or diagonal gaze protrudes. Record the chosen radius and measured result. Never interpret 6.5 as local units or multiply by inherited scale twice.
4. The tested adapter uses an eye pivot behind the neutral iris centre by that radius, an aim tip at the centre, and a head-relative frame aligned to the avatar's forward direction. Sample the aim tip with a world-space VRC Position Constraint, then drive an eye carrier's local X/Y with another VRC Position Constraint, with local Z disabled. A lever whose length equals the radius bounds arbitrary rotation input; nominal calibration angles alone did not bound native tracking. Confirm constraint axes/spaces against the installed SDK. Bind all iris/pupil/glint vertices to the carrier and correct bindposes without moving neutral geometry.
5. Remove competing reachable FX gaze writers when native gaze is active. Preserve the approved morphs for authoring. Do not leave a manual gaze clip resetting the same carrier every frame. Verify actual constraint evaluation in Play mode and the client, including diagonal limits and reopening after a blink.

## Native eyelids and Camera Blink toggle

**Camera Blink starts ON and can be turned OFF.** OFF selects the stable timed automatic blink; it does not disable gaze. Record this meaning in the selected menu language so the user understands the fallback.

Bind native eyelids to a coordinated renderer. If face and sclera are separate, create a derived skinned mesh containing the necessary approved face/sclera parts, copying all geometry, materials and morph POSITION/NORMAL deltas. Sum coordinated left/right blink deltas into a full native blink target if required. Resolve indices by names after construction. Set the descriptor's eyelid mode to Blendshapes, assign that renderer and set the Blink slot to the full blink target. Leave Looking Up/Looking Down eyelid slots unassigned unless a separately fitted, safe target is proved; never put the full blink target there. Resting blink weights must be zero.

Use one Boolean parameter, `FITA_BlinkCamera`, with these consistent defaults:

- FX Animator Boolean default: **true**.
- Expression Parameters default: **1**, `saved=false`, network sync enabled so the mode agrees for other players; test both local and remote behaviour.
- Expressions Menu: Toggle, label **Camera Blink** in English, ON value **1**.
- Default FX state: **Camera**. Saved scene/prefab renderer flags must already match that state.

`saved=false` deliberately restores camera mode when loading the avatar instead of resurrecting an old cached OFF choice. A different persistence policy requires an explicit user request and corresponding reload tests.

The verified fallback uses two coordinated face renderers, with mutually exclusive renderer `enabled` flags:

| Mode | Camera renderer | Stable renderer | Visible eyelid driver |
| --- | --- | --- | --- |
| Camera / ON (default) | enabled | disabled | Native linear blink input |
| Automatic / OFF | disabled | enabled | Timed FX automatic blink |

Both variants retain identical neutral geometry, materials, UVs, bones and facial expression targets. The descriptor always targets the camera renderer. Its native blink retains the original full POSITION/NORMAL deltas. The stable variant's corresponding native blink target has zero deltas; a separate stable-blink target contains the approved full deltas and is driven only by the automatic clip. Mirror every reachable facial curve, including visemes and brows, to the camera renderer path, and cover nested state machines/blend trees. Keep stable-blink weight zero in camera mode. Explicitly reset outgoing blink weights on transitions in both directions. Exactly one face renderer must be visible, including first load and mode transitions; never draw two faces together.

The initial automatic cycle is 4.2 seconds, with a short closure near the end: open at 3.75s, closed at 3.84s and 3.89s, open at 4.02s, open at 4.2s. Fit the timing if needed. Check interpolation, full closure and reopening. If a simpler supported implementation proves the same isolation and behaviour, document it with equivalent evidence. Do not use object-reference `m_Mesh` animation as an assumed working swap; it failed in the pilot. Account for the duplicate renderer's geometry/memory in actual SDK performance statistics even while hidden.

Do not disable `Eyes & Eyelids` with a Tracking Control merely to turn off camera blinking: that also disables native gaze. Do not let FX and native input write the same visible blink target concurrently. No arbitrary runtime C# scripts may be required on the uploaded avatar; author with Editor tooling and supported VRChat components.

### Known camera limitation and rejected filter

The pilot's native Selfie input sometimes reported closure while the user looked downward with eyes open. A 0–35% deadzone worsened the result and was removed. Keep the camera blink's original linear response; do not ship that failed filter as a fix. Native automatic eye-movement excitement is not webcam blink-detection sensitivity. Through the tested avatar-authoring path, a false full closure cannot reliably be distinguished from an intentional full blink. Do not claim the camera detector was repaired by adding the fallback. Camera mode still needs a real user test; OFF supplies stable automatic blinking if false closures persist. Do not silently remove genuine blink tracking or advertise automatic blinking as detection of the user's blink.

## Speech and expression controls

Preserve the approved anime lip shapes and stable jaw silhouette. For coordinated multi-renderer speech, configure **Viseme Parameter Only** and reachable FX states/clips for all 15 `Viseme` values: `sil, pp, ff, th, dd, kk, ch, ss, nn, rr, aa, e, i, o, u`. A native single-renderer viseme route is also valid if it demonstrably drives all required parts. Test return to silence and speech combined with expressions in both blink modes.

Expose the approved moods, mouth and brow controls with the resolved display labels. A two-axis Mood puppet can use fitted `VRCFaceBlendH/V` clips (pilot examples: positive H smile with mild raised brows; negative H frown with sad brows; negative V angry brows; positive V raised brows). Check axis orientation and reset behaviour. Manual mood controls and these parameter aliases do not prove that a webcam recognizes smiles or sadness. Inspect the installed tracking system's real capabilities; report camera-driven, menu-driven and speech-driven controls separately.

## Verification and handback

Before testing, snapshot the character's transform TRS (including all humanoid bones), renderer flags, mesh assignments, blendshape weights and other modified scene state. Use `try/finally` to restore it, even after failures. `AnimationClip.SampleAnimation` changed unrelated humanoid/finger transforms in the pilot. Do not save a test pose or accidentally overwrite approved body/wrist corrections. Save/reopen the configured scene/prefab and read back the final defaults.

The `facial-bindings` evidence must identify renderer paths/target names and indices, controller/parameter/menu assets, resolved menu language and labels, defaults, gaze calibration and world-space travel bounds, supported tracking route, adapted settings and test outcomes. Save this as a structured JSON record under `output/review` and cite it in the existing delivery report. Keep the approved manifest unchanged. Minimum tests:

1. Fresh avatar load starts Camera Blink ON. Toggle OFF/ON works in both directions, remains consistent through expression/speech changes, and reload restores ON.
2. Camera mode retains original full linear blink POSITION/NORMAL deltas. Stable mode remains visually open when a full native blink is forced on the hidden camera renderer; its timed blink closes fully and returns to neutral.
3. Native gaze remains active in both modes. Test left/right/up/down and diagonals at fitted extremes, with no eye-layer misalignment or iris escape through the eyelids. Check no iris/pupil/glint shrinkage and preserved smooth normals at intermediate blink values.
4. All visemes, brows and moods remain coordinated on both face variants. Check combinations and reset; no stale weights or simultaneous visible faces.
5. In actual VRChat Selfie Expression, ask the user to look downward with eyes open, blink deliberately, hold eyes closed, reopen and look diagonally. Record false closures honestly. A build or simulated Animator test alone does not pass the `in-game-test` gate.
6. Check selected-language labels throughout all submenus/puppets; English must not accidentally retain Spanish labels. Recheck SDK validation/performance and source/body preservation after authoring.

Keep Unity configuration, SDK validation, Build & Test, actual client acceptance and publication separate in the existing report. Pending camera/user tests remain pending; adding these instructions is not proof that a character passes them. Publication still requires explicit authorization.

## Maintained sources

- [VRChat Avatars: native Eye Look and eyelid states](https://creators.vrchat.com/avatars/)
- [Expressions Menu and Controls: parameter defaults, Saved, labels and toggles](https://creators.vrchat.com/avatars/expression-menu-and-controls/)
- [Animator Parameters](https://creators.vrchat.com/avatars/animator-parameters/)
- [State Behaviors and Tracking Control](https://creators.vrchat.com/avatars/state-behaviors/)
- [Constraints](https://creators.vrchat.com/common-components/constraints/)
- [Selfie Expression](https://wiki.vrchat.com/wiki/Selfie_Expression)

Verify APIs against the installed supported SDK; pilot adapter and fallback details are measured project experience, not guarantees made by these documentation pages.
