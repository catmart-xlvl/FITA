# Third-party notices

The FITA Usage License in `LICENSE` applies only to FITA-owned software and assets. It does not restrict rights granted for third-party components. Dependency and asset licenses remain those of their respective authors. `THIRD_PARTY_LICENSES.txt` contains the locally installed dependency license texts used to prepare this candidate; preserve component notices as well.

- **Quaternius Universal Animation Library Standard**: CC0 1.0. Only the animation library is bundled, with `public/animations/quaternius/License.txt` and provenance. Official source: https://quaternius.com/packs/universalanimationlibrary.html .
- **Node.js**: obtained from https://nodejs.org/ if a suitable runtime is absent. The downloaded distribution contains its LICENSE, which must remain with the runtime. Node includes components with separate notices.
- **npm dependencies**: exact versions and registry integrity values are in `package-lock.json`. Runtime and transitive dependencies retain their installed license files. Do not remove `LICENSE`, `NOTICE` or package attribution files from installed modules.
- **Procedural fixtures and templates**: included FITA resources generated from application scripts; no private test character is included. Project-specific study profiles are empty in this candidate.
- **Creator branding**: retained as FITA creator attribution. FITA-specific copyright is identified by the public account catmart-xlvl; no civil identity is asserted.

The optional local motion-capture dance and historical character/render study assets are excluded. No absence-of-permission finding is asserted; the user requested that the dance remain outside this release.

## Native libraries and copyleft

The 181-entry locked npm inventory in `distribution/dependency-licenses.json` includes LGPL-3.0-or-later native packages. On Windows x64, `@img/sharp-win32-x64` 0.35.5 declares `Apache-2.0 AND LGPL-3.0-or-later`. Its own README identifies additional licenses inside the native distribution, including LGPLv3 components and cairo under MPL 1.1. This is not an all-permissive dependency tree. Package-level metadata alone does not enumerate every native library obligation.

The current FITA ZIPs do not bundle `node_modules`, native DLLs or a Node runtime. First setup obtains those components directly from npm and the official Node download site; their own notices remain with the downloaded packages. The already-built browser frontend uses separate JavaScript components whose notices are included here. No LGPL native library is embedded into the frontend.

FITA's restrictions explicitly exclude third-party components and preserve modification, replacement/relinking and debugging rights required by their licenses. No blanket permission to relicense those components as proprietary is claimed. If a later offline package, mirror or installer redistributes native binaries, its publisher must separately satisfy the applicable LGPL/MPL notice, corresponding-source, build/relinking and other conditions for those exact binaries. The installed sharp-native README and version manifest are recorded in `distribution/native-library-licenses.json`; this review does not establish that a future binary bundle is compliant.

This check found no package-level GPL-only/AGPL dependency in the locked npm list; LGPL native packages and the upstream-reported MPL component still require the treatment above. This is a scoped packaging review, not a legal clearance for every transitive native component or every future release.
