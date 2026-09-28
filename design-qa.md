# SKU Editor Design QA

- Source visual truth: `apps/web/public/references/08-sku-editor-epc-combined.png`
- Implementation screenshot: `apps/web/qa-artifacts/implementation-sku-editor-1920.png`
- Combined comparison evidence: `apps/web/qa-artifacts/sku-editor-design-comparison.png`
- State: SKU `95B-867-288-OM8` edit page, `基本信息` tab active, unresolved EPC replacement-chain conflict
- Browser viewport: 1920 × 1080 CSS px
- Device scale factor: 1
- Source pixels: 1672 × 941 (16:9 ImageGen output), normalized with Lanczos to 1920 × 1080 for comparison
- Implementation pixels: 1920 × 1080

## Findings

No actionable P0, P1, or P2 differences remain.

- Typography: passed. The implementation uses the existing Inter / PingFang SC / Microsoft YaHei stack and preserves the source hierarchy, readable 14–16 px equivalent body scale at 1920 × 1080, compact table text, weights, line height, and truncation behavior.
- Spacing and layout rhythm: passed. The header, title actions, horizontal section tabs, 64/36 editor/evidence split, identity form, relation tables, and sticky evidence pane reproduce the source composition without horizontal overflow or clipped controls.
- Colors and visual tokens: passed. Shared navy, blue `#075cf6`, cool-gray borders and surfaces, green validation, and amber conflict colors match the selected direction and the existing Dashboard system.
- Image quality and asset fidelity: passed. The higher-resolution existing product asset and EPC diagram are used directly; both preserve aspect ratio and have functional zoom affordances. No raster content is approximated with CSS drawings.
- Copy and content: passed. SKU identity, OE replacement chain, Porsche EPC source metadata, fitment, OEM reference price, comparison states, and publish-check content match the source visual and product requirements.
- Interaction and accessibility: passed. Section tabs, editable inputs, dictionary pickers, add/remove rows, image upload, EPC zoom, conflict resolution, cancel, draft save, and final save are keyboard-reachable and expose names to assistive technology.

## Comparison History

### Pass 1 — blocked

- P2: The product image used the 48 × 42 list thumbnail and visibly blurred at editor scale.
- P2: Success icons in the field-comparison list inherited the warning color because of an overly broad selector.

Fixes made:

- Replaced the list thumbnail with the existing 112 × 82 selected-product asset and changed the frame to contain the image without stretching.
- Scoped amber icon color to `.warning-row`, restoring green success indicators.

### Pass 2 — passed

Post-fix evidence: `apps/web/qa-artifacts/sku-editor-design-comparison.png` places the normalized source on the left and the revised implementation on the right. The corrected image treatment and semantic colors are visible, and no further P0/P1/P2 mismatch remains.

## Focused Region Comparison

Focused review covered the product identity/form region and the complete EPC evidence pane. These were the fidelity-critical areas because they contain dense typography, real raster assets, dictionary controls, validation states, source metadata, and conflict actions. Both regions pass after the second comparison.

## Primary Interactions Tested

- Open existing SKU editor from the SKU table and open the new-SKU route.
- Search and select shared brand/category dictionary values; the editor excludes the filter-only `全部` value.
- Add and remove OE/replacement rows and fitment rows.
- Resolve the EPC replacement conflict and update publish readiness from 5/6 to 6/6.
- Open and close the EPC diagram viewer.
- Save a draft and save the SKU with visible feedback.
- Verify 1920 × 1080 layout has no horizontal overflow.
- Check browser console and page errors: none.

## Follow-up Polish

- P3: The generated source uses slightly softer text antialiasing than the browser render. This is expected raster-versus-DOM rendering variance and does not require a code change.

final result: passed
