# Front End Instructions

Coding standards for GeekHub's front end: server-rendered EJS views, plain CSS, and minimal vanilla JS. Complements [AGENTS.md](../AGENTS.md).

## Stack

- Views: EJS in `src/views/`, shared pieces in `src/views/partials/` (`header`, `footer`, `repo_header`, `repo_list`).
- Styles: single plain CSS file, `public/style.css`.
- Scripts: vanilla browser JS in `public/` (currently `theme.js`).
- No front-end framework, bundler, CSS preprocessor, or client-side build step. Don't add one.

## Views (EJS)

- Every page starts with `<%- include('partials/header') %>` and ends with `<%- include('partials/footer') %>`. Pass `title` (and optional `bodyClass`) from the route.
- Escape all dynamic output with `<%= %>`. Use `<%- %>` only for includes and HTML already sanitized server-side (e.g. rendered Markdown via `sanitize-html`).
- Every `<form method="post">` must include `<input type="hidden" name="_csrf" value="<%= csrfToken %>">`.
- Use `locals.x` for optional variables to avoid `ReferenceError`.
- Keep logic out of templates: no data fetching, permission checks, or non-trivial computation. Compute in the route or in `auth/`, `repos/`, `git/` modules and pass results in.
- Extract repeated markup into a partial rather than copy-pasting.
- Mirror server-side validation with HTML attributes (`required`, `maxlength`, `pattern`) for UX only; the server remains authoritative.
- Use semantic HTML: `label` wrapping its `input`, `nav`, `main`, `table` for tabular data, `button type="button"` for non-submit buttons.
- Page-level errors and notices use `.alert.error` / `.alert.success`.

## CSS

- Edit `public/style.css`; don't add inline `style` attributes or `<style>` blocks.
- Colors come from CSS variables defined on `:root` and overridden in `[data-theme="dark"]` (`--fg`, `--bg`, `--surface`, `--border`, `--link`, `--danger`, `--err-*`, `--ok-*`). Add a new variable to both themes instead of hard-coding colors in shared components.
- Reuse existing classes (`.card`, `.alert`, `.inline`, `button.link`, `button.danger`, `.btn`) before creating new ones.
- Class selectors, lowercase kebab-case names; avoid IDs for styling and avoid `!important` unless overriding an existing one.
- Page-specific styling is scoped by body class (e.g. `body.home`), with a `[data-theme="light"]` variant when the page uses fixed dark colors.
- Match the existing compact one-rule-per-line format.
- Layout with flexbox/grid; keep pages responsive (`main` is max-width constrained; use `auto-fit`/`minmax` or `clamp()` for fluid layouts).
- Keep animations decorative and CSS-only.

## JavaScript

- Vanilla ES5-compatible style in an IIFE, no globals, no dependencies, matching `public/theme.js`.
- Load via `<script src="/file.js">` from the header/footer partial. No inline scripts (keeps a strict CSP possible).
- Progressive enhancement: pages must work without JS. JS may only enhance (e.g. theme toggle).
- Never put secrets, tokens, or user-supplied HTML into the DOM via `innerHTML`; use `textContent`.
- Wrap `localStorage` access in `try/catch`.
- Theme is stored in `localStorage` key `theme` and applied as `data-theme` on `<html>`; set it before first paint to avoid flashing.

## Accessibility

- Provide `aria-label` for icon- or symbol-only controls and update it when state changes.
- Maintain sufficient contrast in both light and dark themes.
- Every form control has a visible label.
- Set `lang` on `<html>` and a meaningful `<title>` per page (`<%= title %> · GeekHub`).

## Verification

- Manually check changed pages in both light and dark themes and at narrow widths.
- Add or update tests in `test/` for behavior changes (e.g. CSRF field present, output escaping).
- Run `npm run build` and `npm test`.
