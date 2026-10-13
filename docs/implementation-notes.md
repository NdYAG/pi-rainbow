# pi-rainbow implementation notes

## Goal

Render standalone CSS-style color values in finalized assistant prose as terminal swatches using `pi.registerMarkdownTransformer()`. It does not modify pi's built-in message renderer or stored session content.

## Files

- `src/pi-rainbow.ts`: transformer extension and Markdown-aware scanner.
- `test/pi-rainbow.test.ts`: tests for colors and protected regions.

## Processing flow

1. Pi passes user/assistant/thinking Markdown through registered transformers inside `Markdown.render()`, before the Markdown parser runs.
2. The extension leaves user, thinking, and streaming content untouched.
3. For finalized assistant text it scans line by line. It preserves fenced code blocks, URLs, complete Markdown links, headings, and blockquotes. Inline code spans are preserved unless the whole span is exactly one color value, in which case the span (including backticks) is replaced by a swatch.
4. It parses `#rgb`, `#rrggbb`, `rgb()`/`rgba()`, `hsl()`/`hsla()`, `oklch()` and `oklab()` values (comma or space syntax, optional `/ alpha`, percentages, `deg`/`turn`/`rad`/`grad` hues), validates ranges, then emits terminal foreground/background ANSI sequences. The foreground is black or white based on higher WCAG contrast.
5. The built-in Markdown parser renders the transformed text. Terminal wrapping treats ANSI sequences as zero-width.

## Why session data is unaffected

The transformer receives a string and returns a string. The result is used only for rendering inside the TUI `Markdown` component and is never written back to the message. Sessions are persisted from the original message object, and HTML export renders the stored entries with its own Markdown renderer, so swatches do not appear there.

## Known limits

- Display-only ANSI transformation, not a token-level renderer hook.
- Streaming output is not transformed, so swatches appear after the message finishes.
- `oklch()`/`oklab()` use a per-channel clamp to sRGB. `color()`, `lab()`, `lch()`, `hwb()`, `var()`, `calc()`, and relative color syntax are not implemented. Alpha compositing is not implemented.
