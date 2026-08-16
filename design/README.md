# Design import pipeline

The Studio dashboard is **generated** from a Claude Design project, not hand-written.
Re-importing an updated design is a two-command operation, and it never touches the
wiring that connects the dashboard to the app's real data.

## Source

| | |
| --- | --- |
| Project | `Website address request` |
| Project id | `d7a14b1f-462f-4bf0-acec-bee1f7d50768` |
| File | `Studio Dashboard.dc.html` |
| Design system | `nocturne-627c1d31-d4ff-422f-831d-1ab0d0351779` (**not used** — see below) |

The design project is linked to this repo (`youssefchannaoui/Clip-agent-`, branch
`deenclipped-v2-2`) through its own GitHub integration.

## Re-importing

Export `Studio Dashboard.dc.html` from Claude Design (any download location is
fine), then:

```sh
npm run design:pull
```

That takes the newest `.dc.html` from `~/Downloads`, strips the preview preamble
the design app injects, vendors it into `design/`, and recompiles. Pass a path to
use a specific file: `npm run design:pull -- path/to/export.dc.html`.

It refuses an incomplete export **before** writing anything, and puts the previous
one back if the importer rejects it — a truncated file still parses far enough to
look plausible, and would otherwise replace a known-good source on its way to
failing.

To recompile without pulling a new export:

```sh
npm run design:import
```

That regenerates two files, both of which are build output and should never be
edited by hand:

- `src/public/studio-template.generated.js` — the markup, as a data AST
- `src/public/studio-styles.generated.css` — every literal style, hoisted and deduped

To see what a new design would change without writing anything:

```sh
node scripts/import-design.mjs --check
```

`--check` exits non-zero when the template uses a binding that nothing supplies,
which is the signal that the design added a surface and `studio-adapter.js` has to
grow to match.

## What is hand-written

Two files, deliberately kept out of the importer's output so a re-import cannot
clobber them:

- `src/public/studio-runtime.js` — interprets the AST into DOM. Only needs changing
  if Claude Design introduces a new template construct.
- `src/public/studio-adapter.js` — maps the app's `/api/state` payload onto the
  binding names the design expects. **This is the file to edit** when a re-import
  reports unsupplied bindings.

## Notes on the source format

`.dc.html` is a Claude Design file: an `<x-dc>` markup block plus a
`<script data-dc-script>` block holding a React component that supplies the
bindings. The importer compiles **only the markup**. The script is read but never
executed or ported — its job in this repo is limited to telling `--check` which
bindings the design itself considered supplied.

The template language is small:

| Construct | Meaning |
| --- | --- |
| `{{ expr }}` | binding, in text or an attribute value |
| `<sc-if value="{{ x }}">` | conditional |
| `<sc-for list="{{ xs }}" as="x">` | repetition |
| `style-hover` / `style-active` | pseudo-state styles, hoisted into real CSS |

`hint-placeholder-*` attributes are editor-only and are dropped.

### The design system is not load-bearing

The dashboard uses **no** Nocturne component classes — every element carries its own
inline style. Of the classes in the template, 288 are Phosphor icon names and the
rest are bindings that also resolve to icon names. `_ds_bundle.js` is empty
(zero components). Neither file is vendored here because neither affects rendering.

The genuine external dependencies are:

- **Phosphor Icons** (`@phosphor-icons/web@2.1.1`) — regular and fill weights
- **Google Fonts** — Inter and Outfit

Both are emitted as `@import` rules at the top of the generated stylesheet.

### Style hoisting

Inline `style` on ~1100 elements is most of the file's weight and none of it is
cacheable, so the importer hoists every *literal* style into a generated class,
deduped by content (509 unique styles across 960 attributes). A style that is a
runtime binding stays inline. Because inline style beats a class even on `:hover`,
hover and active rules for those elements are emitted with `!important`.
