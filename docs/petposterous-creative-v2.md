# Petposterous Creative System V2

Petposterous pages now start with the pet/story controls, generate three concepts, and show LOOK after concept selection. The concept writer selects one of sixteen internal framework IDs. Customers select one of six visual systems; product compatibility determines the recommended and additional choices.

The existing assigned `pp-*` database style remains the pack-authorisation and model carrier. IDs, stored styles, non-Petposterous pages, private references and credit accounting remain compatible. Framework, look and product renderer are separate saved creative-brief fields. No database migration or destructive seed is required.

The server validates look/framework IDs before generation and derives the renderer from the resolved product, rather than trusting a client renderer. V2 prompt composition suppresses the carrier's legacy style/substyle direction, then composes the selected framework, look and product renderer. The renderer governs composition and edges. Apparel retains the existing GPT Image 2 transparency path; decor retains its existing model assignment.

Product families: apparel, wall art, pillow, tapestry and bedding. Bedding instructions explicitly use the physical bedding surface as the territory rather than printing an image of a bed onto a comforter.

Validation before staging deployment:

- 36 focused pack/V2 tests passed.
- 24 existing pack-flow/profile tests passed using a dummy local DATABASE_URL to satisfy module initialisation; no staging database credentials or writes were used.
- Full suite: 1,500 passing tests, eight more than the unmodified baseline; the same 23 setup-failing suites and no new failed assertions. Most setup failures require DATABASE_URL; one existing quote-options suite also fails on import.
- Type checker has the same 444 pre-existing errors after normalising shifted line numbers and worktree paths. No added type errors.
- The standard build runner cannot open its TSX IPC pipe in this execution environment. The equivalent build entry point is run via `node --import tsx script/build.ts`.

This is implementation validation, not creative sign-off. Browser QA Tests A–H, reference likeness, artwork/product inspection and saved-design restoration still require verification on the deployed staging service. Do not promote to production based solely on these tests.
