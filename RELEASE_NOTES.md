# 0.1.0 — initial Windows release

Official update origin: **catmart-xlvl/FITA**. The FITA Usage License and third-party notices are included.

- Branded Windows open, close and update launchers.
- A visible, real FITA Extension folder beside the launchers, with a stable path across application updates. Manual browser setup is explained directly in Connections, with the exact path, a copy button and included version. Updating preserves browser storage and checks local extension changes; failed activation restores the previous folder. No installation wizard or agent ZIP is included.
- Versioned portable layout with isolated persistent user data.
- Pinned Node bootstrap and locked dependency installation.
- Staged release updates with archive/path/hash validation and previous-version retention.
- A local installation-location marker blocks opening and updating after the installed folder is moved, with recovery instructions that preserve project data.
- Proprietary FITA usage terms grant use of official unmodified versions, reserve modification/redistribution of FITA's own software, and preserve third-party rights and user-output freedoms.
- Fixed startup/reopen/close ownership checks for installation paths without spaces by comparing the actual Windows argument list and executable, rather than assuming quotation marks.
- Browser-open requests are now awaited and recorded. A launch failure keeps the server running and shows the local URL instead of silently hiding the failure.
- Fixed an export/import mismatch for large project-state records. Compact exports and matching bounded JSON budgets allow legacy records over 16 MiB while retaining a 16 MiB index limit and a 32 MiB state-record limit. Exceeding a budget reports a specific size error without replacing a destination archive or project.
- Positive source/package allowlists; private projects, signing keys, studies and the optional local dance excluded.
- Existing English UI default and application translations retained.

Additional changes in this release:

- Import after moving a project to Trash reserves existing asset/workspace identities and rolls back partial publication safely.
- Compact Head/Body candidate lists, automatic local preview, and reversible explicit model selection.
- Per-project permanent deletion in Trash requires confirmation and preserves active projects.
- Textures starts with group analysis; downloading an analysis ZIP starts a cancelable local wait. Only validated results unlock Head/Body, with per-group settings preserved and rejected deliveries shown inline.
- Concepts and analysis packages have an English INSTRUCTIONS.txt entry point.

Validation included 729 sequential application tests, 43 final focused checks, production builds, isolated archive tests and a real-path synthetic analysis-delivery UI simulation. No paid generation or live old-to-new GitHub update round trip was performed for this release. Distribution testing does not establish full Tripo or character-pipeline readiness.
