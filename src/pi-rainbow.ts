import { type ExtensionAPI, highlightCode, type MarkdownTransformContext } from "@earendil-works/pi-coding-agent";
import { getCapabilities } from "@earendil-works/pi-tui";

interface Rgb {
	r: number;
	g: number;
	b: number;
}

const COLOR_TOKEN = /#(?:[\da-f]{3}|[\da-f]{6})\b|(?:rgba?|hsla?|oklch|oklab)\([^()]*\)/gi;
const FENCE_START = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const SGR = /\x1b\[([\d;]*)m/y;
// Zero-width, so the fence border still reads ```css, but pi's supportsLanguage() no longer matches and the
// pre-highlighted lines are not highlighted again.
const NO_REHIGHLIGHT = "\u200b";
// Languages where #rgb / rgb() etc. are likely to be colors. Others (C #define, shell comments) are skipped.
const CODE_COLOR_LANGUAGES = new Set([
	"",
	"text",
	"txt",
	"plaintext",
	"css",
	"scss",
	"sass",
	"less",
	"stylus",
	"postcss",
	"html",
	"xml",
	"svg",
	"vue",
	"svelte",
	"js",
	"jsx",
	"javascript",
	"ts",
	"tsx",
	"typescript",
	"json",
	"jsonc",
	"json5",
	"yaml",
	"yml",
	"toml",
	"ini",
]);

/** Parse a number, or a percentage scaled so that 100% equals `percentScale`. */
function parseComponent(value: string, percentScale: number): number | undefined {
	if (value.toLowerCase() === "none") return 0;
	const number = Number.parseFloat(value);
	if (Number.isNaN(number)) return undefined;
	return value.endsWith("%") ? (number / 100) * percentScale : number;
}

function parseAngle(value: string): number | undefined {
	const number = parseComponent(value.replace(/deg$/i, ""), 360);
	if (number === undefined) return undefined;
	if (/turn$/i.test(value)) return Number.parseFloat(value) * 360;
	if (/grad$/i.test(value)) return Number.parseFloat(value) * 0.9;
	if (/rad$/i.test(value)) return (Number.parseFloat(value) * 180) / Math.PI;
	return number;
}

function toByte(value: number): number {
	return Math.round(Math.min(1, Math.max(0, value)) * 255);
}

function hslToRgb(h: number, s: number, l: number): Rgb {
	const hue = (((h % 360) + 360) % 360) / 360;
	const a = s * Math.min(l, 1 - l);
	const channel = (offset: number) => {
		const k = (offset + hue * 12) % 12;
		return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
	};
	return { r: toByte(channel(0)), g: toByte(channel(8)), b: toByte(channel(4)) };
}

function oklabToRgb(lightness: number, a: number, b: number): Rgb {
	const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
	const gamma = (value: number) => {
		const clamped = Math.min(1, Math.max(0, value));
		return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
	};
	return {
		r: toByte(gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
		g: toByte(gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
		b: toByte(gamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
	};
}

/** Parse a CSS color token to sRGB. Out-of-gamut oklch/oklab colors are clamped per channel. */
function parseRgbToken(token: string): Rgb | undefined {
	if (token.startsWith("#")) {
		const hex = token.slice(1);
		const expanded = hex.length === 3 ? [...hex].map((digit) => `${digit}${digit}`).join("") : hex;
		return {
			r: Number.parseInt(expanded.slice(0, 2), 16),
			g: Number.parseInt(expanded.slice(2, 4), 16),
			b: Number.parseInt(expanded.slice(4, 6), 16),
		};
	}

	const match = /^(rgba?|hsla?|oklch|oklab)\(([^()]*)\)$/i.exec(token);
	if (!match) return undefined;
	const parts = match[2]
		.trim()
		.split(/[\s,/]+/)
		.filter(Boolean);
	if (parts.length < 3 || parts.length > 4) return undefined;
	if (parts[3] !== undefined) {
		const alpha = parseComponent(parts[3], 1);
		if (alpha === undefined || alpha < 0 || alpha > 1) return undefined;
	}

	const fn = match[1].toLowerCase();
	if (fn === "rgb" || fn === "rgba") {
		const channels = parts.slice(0, 3).map((part) => parseComponent(part, 255));
		if (channels.some((channel) => channel === undefined || channel < 0 || channel > 255)) return undefined;
		const [r, g, b] = channels as number[];
		return { r: Math.round(r), g: Math.round(g), b: Math.round(b) };
	}
	if (fn === "hsl" || fn === "hsla") {
		const h = parseAngle(parts[0]);
		const s = parseComponent(parts[1], 1);
		const l = parseComponent(parts[2], 1);
		if (h === undefined || s === undefined || l === undefined) return undefined;
		// Legacy syntax requires %, but bare numbers are 0-100 there.
		const normalize = (part: string, value: number) => (part.endsWith("%") ? value : value / 100);
		return hslToRgb(h, normalize(parts[1], s), normalize(parts[2], l));
	}

	const lightness = parseComponent(parts[0], 1);
	if (lightness === undefined) return undefined;
	if (fn === "oklab") {
		const a = parseComponent(parts[1], 0.4);
		const b = parseComponent(parts[2], 0.4);
		return a === undefined || b === undefined ? undefined : oklabToRgb(lightness, a, b);
	}
	const chroma = parseComponent(parts[1], 0.4);
	const hue = parseAngle(parts[2]);
	if (chroma === undefined || hue === undefined) return undefined;
	const radians = (hue * Math.PI) / 180;
	return oklabToRgb(lightness, chroma * Math.cos(radians), chroma * Math.sin(radians));
}

function linearize(channel: number): number {
	const value = channel / 255;
	return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance({ r, g, b }: Rgb): number {
	return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

function contrastRatio(first: number, second: number): number {
	const lighter = Math.max(first, second);
	const darker = Math.min(first, second);
	return (lighter + 0.05) / (darker + 0.05);
}

function rgbTo256({ r, g, b }: Rgb): number {
	const toCube = (channel: number) => Math.round((channel / 255) * 5);
	return 16 + 36 * toCube(r) + 6 * toCube(g) + toCube(b);
}

/** Render a swatch. `padded` adds a space on each side, which reads better in prose but breaks code alignment. */
function renderSwatch(token: string, rgb: Rgb, padded = true): string {
	const luminance = relativeLuminance(rgb);
	const blackContrast = contrastRatio(luminance, 0);
	const whiteContrast = contrastRatio(luminance, 1);
	const foreground = blackContrast >= whiteContrast ? "0;0;0" : "255;255;255";
	const colorCodes = getCapabilities().trueColor
		? `38;2;${foreground}m\x1b[48;2;${rgb.r};${rgb.g};${rgb.b}m`
		: `38;5;${foreground === "0;0;0" ? 16 : 231}m\x1b[48;5;${rgbTo256(rgb)}m`;
	const text = padded ? ` ${token} ` : token;
	return `\x1b[${colorCodes}${text}\x1b[39m\x1b[49m`;
}

function isMarkdownLink(markdown: string, index: number): boolean {
	const links = /\[[^\]]*\]\([^)]*\)/g;
	let match = links.exec(markdown);
	while (match) {
		if (index >= match.index && index < match.index + match[0].length) return true;
		match = links.exec(markdown);
	}
	return false;
}

function isUrl(markdown: string, index: number): boolean {
	const lineStart = markdown.lastIndexOf("\n", index - 1) + 1;
	const prefix = markdown.slice(lineStart, index);
	const urlStart = prefix.search(/https?:\/\/\S*$/i);
	return urlStart >= 0;
}

/** Find the closing backtick run that exactly matches the opening delimiter. */
function findClosingDelimiter(line: string, delimiter: string, from: number): number {
	let index = line.indexOf(delimiter, from);
	while (index >= 0) {
		let end = index + delimiter.length;
		while (line[end] === "`") end++;
		if (end - index === delimiter.length) return index;
		index = line.indexOf(delimiter, end);
	}
	return -1;
}

/**
 * A color token must not be glued to identifier characters (`my-rgb(...)`, `#abcdef1`) and must not be an id
 * reference such as `url(#abc)`.
 */
function hasTokenBoundaries(text: string, start: number, end: number): boolean {
	if (start > 0 && /[\w#-]/.test(text[start - 1])) return false;
	if (end < text.length && /\w/.test(text[end])) return false;
	return !(text[start] === "#" && /url\(\s*['"]?$/i.test(text.slice(0, start)));
}

function transformLine(line: string): string {
	if (/^ {0,3}#{1,6}(?:\s|$)/.test(line) || /^ {0,3}>/.test(line)) return line;

	let result = "";
	let position = 0;
	let inlineCodeFence = "";
	while (position < line.length) {
		if (line[position] === "`") {
			let end = position + 1;
			while (line[end] === "`") end++;
			const delimiter = line.slice(position, end);
			if (!inlineCodeFence) {
				// An inline code span whose whole content is one color token renders as a swatch.
				const close = findClosingDelimiter(line, delimiter, end);
				if (close >= 0 && !isMarkdownLink(line, position) && !isUrl(line, position)) {
					const content = line.slice(end, close);
					COLOR_TOKEN.lastIndex = 0;
					const whole = COLOR_TOKEN.exec(content);
					const rgb = whole?.index === 0 && whole[0] === content ? parseRgbToken(content) : undefined;
					if (rgb) {
						result += renderSwatch(content, rgb);
						position = close + delimiter.length;
						continue;
					}
				}
			}
			if (!inlineCodeFence) inlineCodeFence = delimiter;
			else if (delimiter === inlineCodeFence) inlineCodeFence = "";
			result += delimiter;
			position = end;
			continue;
		}

		COLOR_TOKEN.lastIndex = position;
		const match = COLOR_TOKEN.exec(line);
		if (!inlineCodeFence && match?.index === position) {
			const token = match[0];
			const rgb = parseRgbToken(token);
			if (
				rgb &&
				!isMarkdownLink(line, position) &&
				!isUrl(line, position) &&
				(position === 0 || !/[\w#]/.test(line[position - 1])) &&
				(position + token.length === line.length || !/[\w]/.test(line[position + token.length]))
			) {
				result += renderSwatch(token, rgb);
			} else {
				result += token;
			}
			position += token.length;
			continue;
		}
		result += line[position];
		position++;
	}
	return result;
}

/** SGR state that matters for restoring styling after a swatch: one entry per attribute group. */
interface SgrState {
	fg?: string;
	bg?: string;
	intensity?: string;
}

function applySgr(state: SgrState, params: string): void {
	const codes = params === "" ? ["0"] : params.split(";");
	for (let index = 0; index < codes.length; index++) {
		const code = Number(codes[index]);
		if (code === 0) {
			state.fg = undefined;
			state.bg = undefined;
			state.intensity = undefined;
		} else if (code === 1 || code === 2) state.intensity = String(code);
		else if (code === 22) state.intensity = undefined;
		else if (code === 39) state.fg = undefined;
		else if (code === 49) state.bg = undefined;
		else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) state.fg = String(code);
		else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) state.bg = String(code);
		else if (code === 38 || code === 48) {
			const length = codes[index + 1] === "5" ? 2 : codes[index + 1] === "2" ? 4 : 0;
			const value = codes.slice(index, index + 1 + length).join(";");
			if (code === 38) state.fg = value;
			else state.bg = value;
			index += length;
		}
	}
}

function serializeSgr(state: SgrState): string {
	return [
		state.intensity ? `\x1b[${state.intensity}m` : "\x1b[22m",
		state.fg ? `\x1b[${state.fg}m` : "\x1b[39m",
		state.bg ? `\x1b[${state.bg}m` : "\x1b[49m",
	].join("");
}

/**
 * Insert swatches into an already syntax-highlighted line. Tokens are matched on the visible text, the SGR codes
 * inside a token are replaced by the swatch, and the styling active at the end of the token is restored afterwards
 * (e.g. a comment color when the token sits inside a comment).
 */
function colorizeHighlightedLine(line: string): { line: string; changed: boolean } {
	let visible = "";
	const offsets: number[] = [];
	for (let index = 0; index < line.length; ) {
		SGR.lastIndex = index;
		const sgr = SGR.exec(line);
		if (sgr) {
			index += sgr[0].length;
			continue;
		}
		offsets.push(index);
		visible += line[index];
		index++;
	}
	offsets.push(line.length);

	let result = "";
	let cursor = 0;
	let changed = false;
	const state: SgrState = {};
	const advance = (to: number, keep: boolean) => {
		for (let index = cursor; index < to; ) {
			SGR.lastIndex = index;
			const sgr = SGR.exec(line);
			if (sgr) {
				applySgr(state, sgr[1]);
				if (keep) result += sgr[0];
				index += sgr[0].length;
			} else {
				if (keep) result += line[index];
				index++;
			}
		}
		cursor = to;
	};

	COLOR_TOKEN.lastIndex = 0;
	for (const match of visible.matchAll(COLOR_TOKEN)) {
		const start = match.index;
		const end = start + match[0].length;
		if (!hasTokenBoundaries(visible, start, end)) continue;
		const rgb = parseRgbToken(match[0]);
		if (!rgb) continue;
		advance(offsets[start], true);
		// Skip the token's own characters and SGR codes, up to (not including) the next visible character.
		advance(offsets[end - 1] + 1, false);
		result += `\x1b[22m${renderSwatch(match[0], rgb, false)}${serializeSgr(state)}`;
		changed = true;
	}
	advance(line.length, true);
	return { line: result, changed };
}

/**
 * Re-render a fenced code block with pi's highlighter and swatches. Returns undefined to keep the block unchanged.
 * `lines` are the raw lines of the block, including the opening and closing fence.
 */
function transformCodeBlock(lines: string[]): string[] | undefined {
	const open = FENCE_START.exec(lines[0]);
	if (!open) return undefined;
	const [, indent, marker, rawInfo] = open;
	const info = rawInfo.trim();
	if (marker[0] === "`" && info.includes("`")) return undefined;
	const language = info.split(/\s+/, 1)[0].toLowerCase();
	if (!CODE_COLOR_LANGUAGES.has(language)) return undefined;

	// Like CommonMark, strip up to the opening fence's indentation from content lines.
	const content = lines.slice(1, -1).map((line) => line.replace(new RegExp(`^ {0,${indent.length}}`), ""));
	COLOR_TOKEN.lastIndex = 0;
	if (!content.some((line) => COLOR_TOKEN.test(line))) return undefined;

	let highlighted: string[];
	try {
		highlighted = highlightCode(content.join("\n"), info || undefined);
	} catch {
		return undefined;
	}
	if (highlighted.length !== content.length) return undefined;

	let changed = false;
	// pi wraps lines of an unrecognized language in the code block color; reset it so highlighting shows as-is.
	const body = highlighted.map((line) => {
		const colorized = colorizeHighlightedLine(line);
		changed ||= colorized.changed;
		return `${indent}\x1b[39m${colorized.line}`;
	});
	if (!changed) return undefined;
	return [`${indent}${marker}${info}${NO_REHIGHLIGHT}`, ...body, lines[lines.length - 1]];
}

/**
 * Colorize standalone color values in assistant prose, including inline code spans that contain exactly one color
 * value, and color values inside fenced code blocks of color-friendly languages. Other inline code and link
 * destinations stay unchanged.
 */
export function transformRainbowMarkdown(markdown: string, context: MarkdownTransformContext): string {
	if (context.messageType !== "assistant" || context.isStreaming) return markdown;

	const lines = markdown.split("\n");
	const output: string[] = [];
	for (let index = 0; index < lines.length; index++) {
		const open = FENCE_START.exec(lines[index]);
		if (!open || (open[2][0] === "`" && open[3].includes("`"))) {
			output.push(transformLine(lines[index]));
			continue;
		}
		const marker = open[2];
		let close = index + 1;
		while (close < lines.length) {
			const fence = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(lines[close]);
			if (fence && fence[1][0] === marker[0] && fence[1].length >= marker.length) break;
			close++;
		}
		const block = lines.slice(index, close + 1);
		// An unclosed fence runs to the end of the message; leave it as-is.
		const transformed = close < lines.length ? transformCodeBlock(block) : undefined;
		output.push(...(transformed ?? block));
		index = close;
	}
	return output.join("\n");
}

export default function (pi: ExtensionAPI): void {
	pi.registerMarkdownTransformer(transformRainbowMarkdown);
}
