import { describe, expect, test } from "vitest";
import { transformRainbowMarkdown } from "../src/pi-rainbow.ts";

// Strips SGR sequences only, which is all this extension emits.
const stripAnsi = (text: string) => text.replace(/\x1b\[[\d;]*m/g, "");

const assistantContext = { messageType: "assistant", isStreaming: false, availableWidth: 80 } as const;

describe("pi-rainbow extension", () => {
	test("renders valid hex and RGB literals as swatches", () => {
		const result = transformRainbowMarkdown("Colors: #3498db and rgb(52, 152, 219).", assistantContext);

		expect(result).toContain("\x1b[48;");
		expect(stripAnsi(result)).toBe("Colors:  #3498db  and  rgb(52, 152, 219) .");
	});

	test("renders CSS hsl, oklch, and oklab colors", () => {
		const markdown = "A hsl(210 70% 50%), B oklch(62% 0.2 250 / 50%), C oklab(0.7 -0.1 0.1), D rgb(10% 20% 30%).";
		const result = transformRainbowMarkdown(markdown, assistantContext);

		expect(result.match(/\x1b\[48;/g)).toHaveLength(4);
		// oklch(0.7 0 0) is neutral gray; hsl(0 100% 50%) is pure red.
		expect(transformRainbowMarkdown("oklch(0.7 0 0)", assistantContext)).toContain("48;2;");
		expect(transformRainbowMarkdown("hsl(0 100% 50%)", assistantContext)).toContain("48;2;255;0;0m");
	});

	test("leaves thinking, user, and streaming messages unchanged", () => {
		for (const context of [
			{ ...assistantContext, messageType: "assistant-thinking" as const },
			{ ...assistantContext, messageType: "user" as const },
			{ ...assistantContext, isStreaming: true },
		]) {
			expect(transformRainbowMarkdown("#fff", context)).toBe("#fff");
		}
	});

	test("renders inline code containing exactly one color as a swatch", () => {
		for (const markdown of ["`#ff0000`", "``#ff0000``", "`hsl(0, 100%, 50%)`"]) {
			const result = transformRainbowMarkdown(markdown, assistantContext);
			expect(result).toContain("\x1b[48;");
			expect(stripAnsi(result)).toBe(` ${markdown.replaceAll("`", "")} `);
		}
		expect(transformRainbowMarkdown("`#f00` and `#00f`", assistantContext).match(/\x1b\[48;/g)).toHaveLength(2);
	});

	test("leaves inline code with other content or no closing delimiter unchanged", () => {
		for (const markdown of ["`color: #fff`", "`#fff", "`rgb(300, 0, 0)`", "[x](`#fff`)"]) {
			expect(transformRainbowMarkdown(markdown, assistantContext)).toBe(markdown);
		}
	});

	test("preserves fenced code, URLs, and link destinations", () => {
		const markdown = [
			"Inline `x #fff`, [#abc](https://example.test/#def), and [site](https://example.test/#abc).",
			"```css",
			"body { color: #fff; }",
			"```",
		].join("\n");

		expect(transformRainbowMarkdown(markdown, assistantContext)).toBe(markdown);
	});

	test("leaves invalid RGB channel values unchanged", () => {
		const markdown = "Invalid: rgb(256, 0, 0).";
		expect(transformRainbowMarkdown(markdown, assistantContext)).toBe(markdown);
	});
});
