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
5. Fenced code blocks (closed, top-level or indented under a list) of a color-friendly language are handled separately, see below.
6. The built-in Markdown parser renders the transformed text. Terminal wrapping treats ANSI sequences as zero-width.

## Fenced code blocks

Injecting ANSI into fence content before pi highlights it does not work: highlight.js tokenizes the numbers inside the escape sequences (`38;2;0;0;0`) and corrupts both the escapes and the highlighting. So the extension highlights first and then inserts swatches:

1. Strip the fence's indentation from content lines (as CommonMark does) and call `highlightCode(code, info)` exported by `@earendil-works/pi-coding-agent`. Extension imports resolve to the running pi, so the active theme and loaded grammars are used. pi re-renders after loading the non-eager grammars, so CSS blocks get highlighted once those are available.
2. For each highlighted line, find color tokens on the visible text (SGR codes stripped) and map them back to string offsets. The token's characters and inner SGR codes are replaced by an unpadded swatch, then the fg/bg/intensity state active at the end of the token is re-emitted, so a swatch inside a comment or string keeps the rest of it styled.
3. Re-emit the fence as ```` ```<info>\u200b ````. pi's `supportsLanguage()` no longer matches, so it does not highlight again and only wraps each line in `mdCodeBlock`; a leading `\x1b[39m` on each line cancels that wrapper so unscoped code keeps the default foreground, as with normal highlighting. The zero-width space has no visible width, so the border still reads ```` ```css ````.

Blocks without a valid color, unclosed fences, and languages outside the allowlist are returned unchanged.

## Why session data is unaffected

The transformer receives a string and returns a string. The result is used only for rendering inside the TUI `Markdown` component and is never written back to the message. Sessions are persisted from the original message object, and HTML export renders the stored entries with its own Markdown renderer, so swatches do not appear there.

## Known limits

- Display-only ANSI transformation, not a token-level renderer hook. The `\u200b` fence marker relies on pi skipping highlighting for unknown languages; a dedicated code block hook in pi would remove that dependency.
- Streaming output is not transformed, so swatches appear after the message finishes.
- `oklch()`/`oklab()` use a per-channel clamp to sRGB. `color()`, `lab()`, `lch()`, `hwb()`, `var()`, `calc()`, and relative color syntax are not implemented. Alpha compositing is not implemented.
