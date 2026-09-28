# Vehicle Library Design QA

- Source visual truth: `/Users/wenshihuang/.codex/generated_images/01a0e65d-512b-7c30-a470-80d5ff03b390/exec-19f6d572-a873-41f4-99d9-38fa673ffb6e.png`
- Implementation screenshot: `apps/web/qa-artifacts/implementation-vehicle-library.png`
- Combined comparison evidence: `apps/web/qa-artifacts/vehicle-library-design-comparison.png`
- State: Porsche Macan 95B 2.0L vehicle detail, common-parts tab active, one missing part number
- Browser viewport: 1680 x 945 CSS px (16:9)
- Device scale factor: 1
- Source pixels: 1672 x 941
- Implementation pixels: 1680 x 945
- Density normalization: both full views were normalized to 836 x 470 for the side-by-side comparison; the lower content regions were cropped at equal normalized coordinates and enlarged equally for focused review.

## Findings

No actionable P0, P1, or P2 differences remain.

- Fonts and typography: passed. The implementation uses the existing Inter / PingFang SC / Microsoft YaHei stack, preserves compact enterprise-data sizing, clear navy hierarchy, readable table text, and controlled truncation.
- Spacing and layout rhythm: passed. The final detail route follows the reference hierarchy: slim return row, vehicle identity strip, section tabs, wide parts matrix, and narrower sticky evidence panel. There is no horizontal overflow or clipped primary action at the tested viewport.
- Colors and visual tokens: passed. Existing Dashboard white and pale blue-gray surfaces, cobalt primary actions, cool-gray dividers, green verified states, and amber incomplete states match the selected direction.
- Image quality and asset fidelity: passed. The dedicated Macan catalog asset and existing EPC diagram are real raster assets with correct containment and no stretching. No product imagery is approximated with CSS or handcrafted vector shapes.
- Copy and content: passed. The screen uses the supplied Macan/VIN/OE business data, clearly marks the missing oil-filter seal number, preserves source and verification status, and uses "快速选品" instead of a quote-generation action.
- Interaction and accessibility: passed. Navigation, tabs, edit, auto-match, package selection, custom selection, publish, close, and save actions are keyboard-reachable and expose accessible names. Browser console and page errors were checked by the Playwright suite.

## Comparison History

### Pass 1 - blocked

- P1: The implementation initially placed the vehicle-library title, global vehicle search, and horizontal vehicle picker above the selected record. This pushed the identity and parts matrix too far down and materially changed the selected visual's primary hierarchy.

Fix made:

- Split the experience into a directory route (`/vehicles`) and focused detail routes (`/vehicles/:id`). The detail route now begins with the compact return row and keeps the selected vehicle record above the fold, while the directory route retains search, creation, and browsing.

### Pass 2 - passed

Post-fix evidence: `apps/web/qa-artifacts/vehicle-library-design-comparison.png` places the normalized selected visual on the left and the revised browser implementation on the right. The vehicle identity, active common-parts tab, parts/evidence split, primary quick-selection action, status colors, and content density align without remaining P0/P1/P2 drift.

## Focused Region Comparison

The focused lower-region comparison covers the tab strip, common-parts heading, table columns, missing-row treatment, linked-SKU presentation, and the EPC evidence/completeness panel. These are the fidelity-critical regions because they contain the densest typography, row-state colors, source metadata, and product-specific content. They pass after the route-level hierarchy fix.

## Primary Interactions Tested

- Open the focused vehicle detail route and return to the vehicle directory.
- Read the supplied VIN, engine, transmission, production date, market, part numbers, linked SKUs, source, and verification status.
- Detect and display a retained part requirement with no part number.
- Paste tab-separated Excel rows into the vehicle editor and retain rows with an empty part number.
- Open the service-package tab and start fast selection from the minor-service package.
- Confirm the selection drawer exposes unresolved items and explicitly does not create a quote document.
- Confirm there is no `生成报价单` action.
- Run the full 19-test browser suite with no console or page errors.

## Intentional Product Differences

- The selected visual displayed stock and price values. The current SKU service has no authoritative inventory or pricing integration, so the implementation does not invent those values. Candidate SKUs are linked now; live inventory and prices can be added when their source modules are available.
- The implementation adds a separate searchable directory route because a production vehicle library needs discovery and creation in addition to the focused detail screen. This does not alter the selected detail view.

## Follow-up Polish

- P3: The generated reference uses slightly softer antialiasing and more photographic part thumbnails. Browser-rendered text is intentionally sharper, and SKU thumbnails remain absent when the persisted SKU has no image.

final result: passed
