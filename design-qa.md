# New Vehicle Flow Design QA

- Source visual truth: `/Users/wenshihuang/.codex/generated_images/01a0e65d-512b-7c30-a470-80d5ff03b390/exec-bb3326c9-59e4-41ef-b93f-e5f5fc8978f9.png`
- Implementation screenshot: `apps/web/qa-artifacts/implementation-new-vehicle-template.png`
- Full-view comparison: `apps/web/qa-artifacts/new-vehicle-template-comparison.png`
- Focused comparison: `apps/web/qa-artifacts/new-vehicle-template-focus-comparison.png`
- State: new vehicle, VIN source recognized, Macan template loaded, one part deselected
- Browser viewport: 1680 x 945 CSS px (16:9)
- Device scale factor: 1
- Source pixels: 1672 x 941
- Implementation pixels: 1680 x 945
- Density normalization: full views were normalized to 836 x 470 before the side-by-side comparison. The suggested-record region was cropped at matching coordinates for focused review.

## Findings

No actionable P0, P1, or P2 differences remain.

- Layout hierarchy: passed. Both views use the same source-first structure: compact heading, three source modes, recognition result on the left, suggested record on the right, and persistent confirmation actions at the bottom.
- Typography and spacing: passed. The implementation keeps the existing Dashboard type stack and compact enterprise-data density while preserving the reference's navy hierarchy, pale surfaces, and restrained borders.
- Information architecture: passed. Vehicle identity, template differences, and part-import preview remain separate review stages. Required production fields are grouped in a quieter second row rather than interrupting the main identity scan.
- Product state fidelity: passed. The browser screenshot uses the existing vehicle fixture returned through the real vehicle service boundary. It does not add fabricated stock, pricing, packages, or part records to make the page resemble the reference.
- Image fidelity: passed. Persisted vehicle imagery is shown without stretching. A missing persisted image produces an explicit empty state rather than a demo-image fallback.
- Interaction and accessibility: passed. Source tabs, VIN recognition, EPC parsing, template copying, editable fields, row selection, save-only, and create-and-import actions have accessible names and keyboard-reachable controls.

## Comparison History

### Pass 1 - P2

The initial identity section allowed required database metadata to wrap irregularly among the user-facing vehicle fields. This made the right panel denser and reduced the visual rhythm established by the selected reference.

Fix made:

- Kept the eight reference-facing identity fields in one primary row.
- Moved vehicle version code, brand, series, and VIN sample into a consistent secondary metadata row.
- Preserved all backend-required values without hiding or inventing data.

### Pass 2 - passed

The post-fix full-view and focused comparisons align on the selected 16:9 composition, source/review split, card heights, table hierarchy, and footer action placement. The secondary metadata row is an intentional production requirement and does not create a remaining P2 mismatch.

## Focused Region Review

The focused comparison covers the suggested-record header, editable vehicle identity, and the beginning of the difference panel. These are the densest and most fidelity-sensitive parts of the screen. The implementation is intentionally sharper and slightly more compact than the generated reference, while preserving its scan order and emphasis.

## Primary Interactions Tested

- Enter a valid VIN and load a matching existing vehicle through the vehicle service.
- Review recognized vehicle identity, source, part requirements, and service packages.
- Deselect one part requirement and confirm the import count updates.
- Create a new vehicle with the selected requirements and mapped package references.
- Keep existing vehicle editing on the previous editor so this change only affects new creation.
- Build the server bundle and run browser coverage for the full Dashboard and the new creation flow.

## Intentional Product Differences

- The selected reference contains 24 parts and 3 packages. The tested fixture contains 6 parts and 1 package, so the implementation displays the real returned counts.
- Four extra metadata fields are visible because the current API requires them to create a valid vehicle record.
- VIN recognition currently resolves against the existing vehicle service. A future external VIN/EPC provider can replace that lookup without changing the review and save flow.

final result: passed
