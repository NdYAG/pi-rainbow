# pi-rainbow

A [pi](https://pi.dev) extension that renders CSS color values in assistant messages as terminal color swatches, similar to Emacs `rainbow-mode`. The foreground is black or white, whichever has higher WCAG contrast against the swatch.

## Install

```sh
pi install npm:pi-rainbow
# or try it for one run
pi -e npm:pi-rainbow
# or from a local checkout
pi install ./pi-rainbow
```

## Supported values

- `#rgb`, `#rrggbb`
- `rgb()`, `rgba()`
- `hsl()`, `hsla()`
- `oklch()`, `oklab()`

Comma and space syntax, `/ alpha`, percentages, and `deg`/`turn`/`rad`/`grad` hues are accepted. Invalid values (for example `rgb(256, 0, 0)`) are left unchanged.

## Behavior

- Applies to finalized assistant text only. User messages, thinking blocks, and streaming output are untouched, so swatches appear when the message completes.
- Standalone values in prose become swatches.
- An inline code span whose whole content is one color value, such as `` `#ff0000` ``, also becomes a swatch. Inline code with other content, such as `` `color: #fff` ``, is unchanged.
- Fenced code blocks, headings, blockquotes, links, and URLs are unchanged.

## Limits

- Display only. It affects the interactive TUI and does not change session data or the context sent to the model. HTML export does not show swatches.
- Alpha is accepted but shown opaque.
- `oklch()` and `oklab()` are converted to sRGB with a per-channel clamp, not CSS gamut mapping, so out-of-gamut colors can differ from a browser.
- Not supported: `color()`, `lab()`, `lch()`, `hwb()`, `var()`, `calc()`, relative color syntax.
- It rewrites Markdown before parsing, so other markdown transformers can interact with the injected escape sequences.

## Development

```sh
npm install --ignore-scripts
npm run check
npm test
```

Implementation notes are in [docs/implementation-notes.md](docs/implementation-notes.md).

## License

MIT
