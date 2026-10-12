# Right Away Repairs

Marketing and lead-generation site for Right Away Repairs, a handyman business serving the
Washington, D.C. metro area (DMV). It is live and generates leads.

- Static site with no build step: `index.html` (landing page with a quick-consultation form),
  `serviceRequest.html` (full service-request form with image upload), `thank-you.html` (noindex, where
  both forms land: `?form=consult` / `?form=request`), `css/`, `assets/`.
- Generated files (committed; rerun the script after changing a source): `node scripts/images.mjs` builds the
  WebP photos in `assets/img/` from the masters in `assets/source/` (it never upscales, and prints a
  `TODO(joey)` for every width a master is too small for); `node scripts/icons.mjs` builds `favicon.svg`,
  `favicon.ico`, `apple-touch-icon.png` and `og-image.jpg`.
- `docs/case-study-metrics.md` is a before/after write-up for a portfolio (screenshots in `docs/img/`, copied from
  `qa/`, which is gitignored). It describes the `61032a1` → `audit-fixes` work; it isn't a spec.
- Both forms send through EmailJS: the CDN script loads with `defer` in `<head>`, and the last inline
  `<script>` on each page holds the init and submit handler. It checks `window.emailjs` at submit time
  (`defer` does nothing on an inline script, so it runs before the CDN script), and if it's missing
  it shows the inline `.form-error` (`role="alert"`, right above the submit button) instead of throwing.
  Nothing else may depend on EmailJS. Each form has a `company_website` honeypot (visually hidden,
  `aria-hidden`); if it's filled the form skips sending and still redirects. `sendForm` gets a clone of the
  form with the honeypot removed. There are no `alert()`s.
  **Never submit the real forms.** QA blocks `api.emailjs.com`; stub `window.emailjs` in tests
  (e.g. fulfil the jsdelivr request with a stub script; `qa forms` does this).
- Field `name` attributes are EmailJS template variables; never rename them. The same goes for
  the EmailJS service and template IDs.

## CSS structure

Four stylesheets, linked in this order from each page's `<head>` (no `@import` anywhere):

| File | Layer | Contents |
| --- | --- | --- |
| `css/tokens.css` | `tokens` | Line 1 declares the layer order. Custom properties only. |
| `css/base.css` | `base` | Reset, element defaults, root font-size steps. |
| `css/primitives.css` | `primitives` | Layout primitives and generic UI primitives. |
| `css/components.css` | `components` | Page blocks, each under a `/* === Name === */` heading. |

Layer order: `@layer tokens, base, primitives, components, utilities;` A later layer beats an
earlier one regardless of selector specificity.

Fonts come from Google Fonts via `<link>` tags in each `<head>` (Open Sans 500–700, Odor Mean Chey).
If you add a rule that uses another Open Sans weight or italics, widen the URL's range.

## Token rules

- Primitive tokens (`--white`, `--neutral-600`, `--orange-500`, ...) are used **only inside tokens.css**.
- Everywhere else, use semantic tokens (`--color-text-muted`, `--color-action`, `--space-4`, ...).
- Contrast tokens (keep these pairings at AA if you touch them): `--color-action` / `--color-accent-text`
  orange-600 (4.77:1 with white), `--color-action-hover` orange-800 (6.93:1), `--color-field-border`
  neutral-500 (4.54:1, WCAG 1.4.11), `--color-danger` red-700 (5.62:1, solid, no alpha).
  `--color-accent-text-large` (orange-500, 3.46:1) is for display-size text only.
- Spacing is a 5px scale: `--space-N` = N × 5px (1, 2, 3, 4, 5, 6, 10, 15, 20, 24).
  Every gap, padding and margin uses one of these.
- No raw values in primitives.css or components.css: no hex, no rgba, no px. The exceptions are
  1px/2px borders and focus outlines, the `.visually-hidden` clip pattern, and the existing 100% / auto / 3% layout values.
  Anything else becomes a token in tokens.css.
- Responsive values are tokens redefined inside tokens.css media queries where possible.

## Primitives

Configure a primitive by setting its custom properties **on the same element**, from a component class.
Each primitive declares its own defaults, so nested primitives never inherit a parent's setting.
Primitives never set outer margins.

| Class | Custom properties (default) |
| --- | --- |
| `.container` | none. Full-bleed row: `padding-inline: max(var(--gutter), (100% - var(--content-max)) / 2)`, no max-width, so backgrounds reach both edges and content is centred, at most `--content-max` wide. |
| `.stack` | `--stack-gap` (`--space-3`) |
| `.cluster` | `--cluster-gap` (`--space-2`), `--cluster-justify` (`flex-start`), `--cluster-align` (`center`) |
| `.split` | `--split-gap` (`--space-10`). Children get `flex: 1`. |
| `.grid` | `--grid-gap` (`--space-5`), `--grid-min` (`--card-min`), `--grid-columns` (auto-fit of `--grid-min`) |
| `.button` | none. Modifiers `--primary`, `--outline` (white, for the hero photo), `--outline-on-light`, `--inverse`, `--upload`. Padding from `--button-pad-y/x`. Renders the same on `<a>` and `<button>`; uppercases its text. |
| `.field` | none. `<label for>` + input/textarea column, with the filled/focus background swap and muted placeholder. Controls are `max(--text-input-min, --text-md)`: never under 16px, so iOS doesn't zoom on focus. Below 1537, inputs' intrinsic width is pinned to `--field-intrinsic-w` (their natural width at `--text-md`), so the consult card and `.split` pairs keep their widths and wrap points. |
| `.display-2xl` / `.display-xl` / `.display-lg` | none. Heading looks (old h1 / h2 / h3). Headings get their look from these, never from their tag. |
| `.label` | none. Small medium-weight text (the `.field label` look). |
| `.icon` | `--icon-size` (`--icon-sm`) |
| `.visually-hidden` | none |

## Breakpoints

CSS can't use variables in `@media`, so every media query uses one of these:

`max-width: 480px`, `640px`, `768px`, `1024px`, `1440px`, `1536px`, and `min-width: 1537px`.

Within a block, write media queries from wide to narrow.

## Scaling

The design was tuned at 1440×900. Up to 1536 wide it must stay pixel-identical; above that it scales.

- Root font-size: 15px from 1025–1536 (smaller below). From 1537 it is
  `clamp(16px, 0.25vw + 12.4px, 19px)` (≈16.2px at 1537, 17.2 at 1920, 18.8 at 2560, 19 max).
- `--content-max: 96rem` (1440px at the 15px root) caps the content column through the container formula,
  so the column grows with the type above 1536 and never jumps narrower at a breakpoint above 1440.
- Hero (≥769): `min-height: clamp(var(--hero-min), calc(100svh - var(--header-offset)), var(--hero-max))`
  (560px / 960px) instead of a fixed height, so short laptops grow to fit the form. Its content has
  `padding-block: var(--space-1)`: the 1280×720 form is 541.8px, and more than 9px would make the
  560px hero grow there. Mobile (≤768) uses `min-height: auto`.
- `--measure: 75ch` caps the hero paragraph, the services intro and the About body, only at ≥1537
  (at 15px type it would rewrap them).
- The services grid sets `--grid-columns` explicitly: 4 columns (≥1025), 2 (≤1024), 1 (≤480).
  Card photos are `--service-media-h` (200px) tall up to 1536 and `aspect-ratio: var(--service-media-ratio)`
  (1.63) above.
- The CTA band bleeds `--cta-bleed` (`max(var(--space-2), 0.65vw)`) past each side for its 3° tilt.
  `<main>` has `overflow-x: clip` for it; nothing else overflows sideways.

## Links and accessibility

Target: WCAG 2.2 AA, zero `qa axe` violations.

- Navigation is always a real `<a href>`, never a click handler. "Request service" is
  `<a class="button button--primary" href="serviceRequest.html" data-qa="request-cta">` (`--inverse` in the CTA band).
  Section links are `#service-offerings` / `#about-us` on index and `./#...` on serviceRequest. The logo links to `./`.
  Only form submits, the upload trigger and the photo remove buttons are `<button>`s.
- Write button and nav text in sentence case in the source; CSS uppercases it, so screen readers don't spell it out.
- Phone and email are `tel:+12026706479` / `mailto:` links, shown as "(202) 670-6479". No format-detection meta, no UA sniffing.
- Smooth scrolling is CSS only (`scroll-behavior` behind `prefers-reduced-motion: no-preference` in base.css).
- Each page starts with the `.skip-link` to `<main id="main">`, and has one `<h1>` with headings in order.
  The header nav is `<nav aria-label="Main">`; the top bar and the service tags are `<ul>`s.
- Every field has a `<label for>` matching its `id` and an `autocomplete` token where one applies.
  Mark optional fields "(optional)" in the label; each form opens with the `.form-note` "All fields are required..." line.
- Decorative images (icons, logos next to text, the hero background, service photos) get `alt=""`.
  The header logo link's image is `alt="Right Away Repairs"`.
- Customer-facing messages never mention the console, EmailJS or configuration. Failures give the phone number and email.
- Never set `outline: none`; the browser's focus ring must stay visible on every interactive element.

## QA

`scripts/qa.mjs` serves the site itself (port 4173). It uses Playwright and selects elements by `data-qa`
attributes only, so keep those attributes.

| Command | When |
| --- | --- |
| `node scripts/qa.mjs shots <name>` | Full-page screenshots of both pages at 12 viewports → `qa/<name>/` |
| `node scripts/qa.mjs diff <a> <b>` | Pixel diff of two shot sets → `qa/diff-<a>-<b>/` |
| `node scripts/qa.mjs measure [name]` | Hero/grid/band metrics. Compare against `qa/baseline/measure.json` after layout work. |
| `node scripts/qa.mjs axe` | WCAG A/AA scan, after markup or color changes |
| `node scripts/qa.mjs cdn-down` | REQUEST SERVICE buttons still navigate with jsdelivr blocked, after JS changes |
| `node scripts/qa.mjs keys` | Tab order, after markup or focus changes |
| `node scripts/qa.mjs forms` | Both forms against a stubbed EmailJS (success, reject, missing, honeypot, payload) and input font-size ≥16px, after form or JS changes |

**Every change ends with `qa shots <name>` + `qa diff` against the previous state.** Any visual
difference must be intended and called out.

## How to work

Adapted from github.com/multica-ai/andrej-karpathy-skills (MIT).

1. **Think before coding.** State your assumptions. If something is ambiguous, name it and ask instead of guessing. If a simpler approach exists, say so.
2. **Simplicity first.** Write only the code the task needs.
3. **Surgical changes.** Change only what was asked, and match the existing style. Mention unrelated problems instead of fixing them.
4. **Goal-driven execution.** Turn each task into verifiable checks and keep going until they pass.
