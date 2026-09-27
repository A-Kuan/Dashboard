# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Dashboard implementation rules

- Treat `deliverables/sku-command-center-visual-states/01-default-collapsed.png` as the source of truth for the first screen.
- Reproduce the selected 1680×945 desktop design at full fidelity before adding new visual ideas.
- Extract repeated structures such as the application header, section header, tabs, filters, data table, badges, cards, and detail tabs into reusable components.
- Keep spacing, typography, colors, borders, radii, and interaction states consistent through shared design tokens.
- When production data or APIs are unavailable, use realistic auto-parts test data matching the visual reference.
- Selection values such as brand, part category, and SKU status must come from shared configurable dictionaries; do not add page-local hardcoded option arrays.
- Dictionary-backed filters should use the shared searchable picker, and SKU management must retain a visible page-level entry for dictionary configuration.
- Dictionary item values are system-generated immutable codes. Preserve existing values for compatibility; users may edit only the display label and other non-identifier properties.
- SKU create/edit screens should use the horizontal section-tab navigation selected in the 2026-09-27 visual direction. Keep the editor single-page and combine it with a persistent EPC evidence pane for source comparison and publish checks; do not replace it with a wizard or global sidebar.
