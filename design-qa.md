# SKU v2 视觉扩展 QA

- Source visual truth: `docs/references/workbench/home-reference.png`
- Implementation: `apps/web/qa-artifacts/implementation-sku-library-default-1680.png`
- Comparison board: `apps/web/qa-artifacts/sku-extension-design-comparison.png`
- Focused state: `apps/web/qa-artifacts/implementation-sku-source-modal-1680.png`
- Source pixels: 1672 × 941
- Implementation pixels: 1680 × 945 at CSS viewport 1680 × 945, device scale factor 1
- Normalization: both sides scaled to 1672 × 941 on a 3344 × 941 side-by-side comparison board
- State: SKU library default list, first record selected, identity and fitment tab visible

## Full-view comparison

This is an extension comparison rather than a pixel clone: the source is the home screen and the implementation is a new SKU workspace. The comparison therefore checks the shared visual language and protected shell rather than identical content placement.

- Navigation width, logo treatment, active fluorescent-lime state, cold-gray background, white working surfaces and restrained separators remain consistent with the source.
- The new screen preserves the source's desktop-first density while using a stable list/inspector split appropriate for SKU verification.
- The top search remains the single dominant search action. Import and new-SKU actions are visually secondary/primary in the expected order.
- No unrelated legacy page, card system or old business component is reintroduced.

## Focused comparison

- Typography: final list labels use 14–15px, part names 17px, OE numbers 18px, navigation 17px and inspector headings 16–23px. Weights and contrast follow the reference's strong operational hierarchy.
- Spacing: 12px primary gaps, 11–13px radii and lightweight row separators match the reference rhythm. The split view avoids nested card clutter.
- Colors: cold gray `#edf2f6`, white panels, dark ink and fluorescent lime remain the dominant tokens. Status colors are reserved for meaning.
- Images and icons: the original logo/avatar assets are reused; Phosphor icons match the existing application. No placeholder imagery, hand-drawn SVG or decorative CSS art was introduced.
- Copy: labels are specific to SKU identity, fitment and provenance. Mock-data scope is disclosed in the list and source dialog.
- Source dialog: the focused capture confirms a clear recommended EPC/VIN path, readable descriptions, working close action and a non-persistence disclaimer.

## Comparison history

### Pass 1

- P2: table metadata, inspector labels and source-dialog supporting copy rendered too small relative to the user's readability requirement.
- Fix: increased table headers to 14px, row body to 15px, part names to 17px, OE to 18px, inspector labels to 13–16px and dialog supporting copy to 13px; allowed the inspector to scroll rather than compress content.
- Post-fix evidence: `implementation-sku-library-default-1680.png` and `implementation-sku-source-modal-1680.png`.

### Pass 2

No actionable P0, P1 or P2 visual differences remain for an existing-product extension. The large empty lower list area is expected with only five mock records and will fill naturally with paginated production data.

## Browser verification

- Search by part name and result selection: passed.
- Inspector identity, inventory/price and history tabs: passed.
- New-SKU source dialog open/close path: passed.
- Home/SKU navigation and hash route: passed.
- Existing home search, command center and todo interactions: passed.
- Console and page errors: none in the final run.
- Automated browser tests: 4 passed.

## Follow-up polish

- P3: add keyboard row navigation and a denser loading skeleton when the real list API is connected.
- P3: add a compact list-column preference after real operator usage validates the default fields.

final result: passed
