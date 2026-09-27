# Design QA — SKU 管理默认收起状态

- Source visual truth: `/Users/wenshihuang/Codex-Project/Dashboard/apps/web/public/references/01-default-collapsed.png`
- Implementation screenshot: `/Users/wenshihuang/Codex-Project/Dashboard/apps/web/qa-artifacts/implementation-default.png`
- Full comparison: `/Users/wenshihuang/Codex-Project/Dashboard/apps/web/qa-artifacts/comparison-pass-3.png`
- Focused top/table comparison: `/Users/wenshihuang/Codex-Project/Dashboard/apps/web/qa-artifacts/comparison-top-pass-3.png`
- Focused detail comparison: `/Users/wenshihuang/Codex-Project/Dashboard/apps/web/qa-artifacts/comparison-detail-pass-3.png`
- Viewport: 1680 × 945 CSS px
- Source pixels: 1680 × 945
- Implementation pixels: 1680 × 945
- Device scale factor: 1
- Density normalization: not required; source and implementation use identical pixel dimensions
- State: desktop, light theme, default search collapsed, fourth SKU selected

## Full-view comparison evidence

The final full comparison confirms that the implementation matches the source composition: 54px application header, page heading and actions, summary tabs, filter row, 14-column SKU table with eight visible records, selected fourth row, and the four-column detail region. The table and detail boundary, selected-row position, card edges, and viewport crop align at the target viewport.

## Focused comparison evidence

The top/table comparison was used to verify navigation position, title hierarchy, action placement, filter sizing, table column boundaries, row heights, selected state, status colors, copy, and part thumbnail crops.

The detail comparison was used to verify the reusable card grid, selected SKU summary, detail tabs, EPC diagram crop, fitment table, read-only OEM price, inventory table, internal padding, and card heights.

## Required fidelity surfaces

- Fonts and typography: PingFang SC/system UI stack reproduces the compact Chinese ERP typography. Sizes, weights, line heights, truncation and hierarchy align with the source. Minor glyph antialiasing differences are expected between the raster source and browser rendering.
- Spacing and layout rhythm: header, controls, table and detail grid match the 1680 × 945 source geometry. Reusable spacing, border, radius and elevation values are centralized in CSS tokens and shared components.
- Colors and visual tokens: primary blue, navy text, muted copy, grid borders, selected-row blue, in-stock green and low-stock orange match the source palette.
- Image quality and asset fidelity: the part thumbnails, selected part image, EPC diagram and avatar are individual raster assets derived from the supplied visual source; no placeholders, emoji, CSS drawings or handcrafted SVG assets are used.
- Copy and content: visible labels, SKU/OE data, fitment records, prices, statuses, warehouse records and dates match the source; missing production data is represented with realistic test data.

## Primary interactions tested

- Open and close the command search through the header control and Escape.
- Search by brand and show matching SKU results.
- Filter the table by brand and restore all brands.
- Select a different SKU row and update the detail header.
- Open and cancel the New SKU dialog.
- Verify the default selected row and default collapsed search state.
- Check browser console and page errors: none.

## Comparison history

### Pass 1 — blocked

- P1: Main table column proportions differed from the source, clipping SKU and data-source values.
- P2: Header navigation and search were shifted approximately 14px to the right.
- P2: The right detail stack was wider than the source and the EPC/fitment columns were too narrow.
- P2: The detail edit button included an icon absent from the source.
- P2: Fitment values were truncated because all columns used equal widths.

Fixes: measured and applied source-aligned column widths, shifted the header grid, corrected detail-grid tracks, removed the extra icon, and assigned content-aware fitment widths.

### Pass 2 — blocked

- P2: New SKU text wrapped to two lines after matching the source button width.
- P2: Table typography still clipped longer SKU values.
- P2: Detail cards ended several pixels above the source viewport edge.
- P2: Fitment year and vehicle values remained truncated.

Fixes: prevented action-label wrapping, refined SKU type size and cell padding, extended the detail grid to the source height, and rebalanced fitment columns.

### Pass 3 — passed

Post-fix full and focused comparisons show no remaining actionable P0, P1 or P2 differences. The only residual variation is platform font antialiasing at small sizes, classified as acceptable rendering variance.

## Findings

No actionable P0, P1 or P2 findings remain.

## Follow-up polish

- P3: Re-check small-text antialiasing if production specifies a bundled corporate font instead of the current system font stack.
- P3: Additional responsive breakpoints should be reviewed when a separate narrow-desktop or mobile visual target is approved.

final result: passed
