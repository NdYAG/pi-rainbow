import { initTheme } from "@earendil-works/pi-coding-agent";
import { beforeAll, describe, expect, test } from "vitest";
import { transformRainbowMarkdown } from "../src/pi-rainbow.ts";

beforeAll(async () => {
	initTheme("dark", false);
	// pi loads non-eager grammars (css, html, ...) after startup.
	const allLanguages: string = "highlight.js/lib/index.js";
	await import(allLanguages);
});

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

	test("preserves URLs and link destinations", () => {
		const markdown = "Inline `x #fff`, [#abc](https://example.test/#def), and [site](https://example.test/#abc).";
		expect(transformRainbowMarkdown(markdown, assistantContext)).toBe(markdown);
	});

	test("leaves invalid RGB channel values unchanged", () => {
		const markdown = "Invalid: rgb(256, 0, 0).";
		expect(transformRainbowMarkdown(markdown, assistantContext)).toBe(markdown);
	});

	describe("fenced code blocks", () => {
		const fence = (lang: string, ...body: string[]) => [`\`\`\`${lang}`, ...body, "```"].join("\n");

		test("highlights the block and inserts unpadded swatches", () => {
			const result = transformRainbowMarkdown(
				fence("css", "--red:  oklch(0.7 0.18 25);", "--blue: #3b82f6;"),
				assistantContext,
			);
			const lines = result.split("\n");

			// Zero-width marker keeps pi from highlighting the pre-highlighted lines again.
			expect(lines[0]).toBe("```css\u200b");
			expect(result.match(/\x1b\[48;/g)).toHaveLength(2);
			expect(lines.slice(1).map(stripAnsi)).toEqual(["--red:  oklch(0.7 0.18 25);", "--blue: #3b82f6;", "```"]);
		});

		test("restores the surrounding style after a swatch", () => {
			const [, line] = transformRainbowMarkdown(fence("css", "a {} /* was #fff here */"), assistantContext).split(
				"\n",
			);
			const [beforeSwatch, afterSwatch] = line.split("#fff");
			const commentColor = /(\x1b\[38;[\d;]+m)\/\*/.exec(beforeSwatch)?.[1];

			expect(commentColor).toBeTruthy();
			expect(afterSwatch.startsWith(`\x1b[39m\x1b[49m\x1b[22m${commentColor}`)).toBe(true);
		});

		test("colors blocks without a language", () => {
			const result = transformRainbowMarkdown(fence("", "plain #00ff00 here"), assistantContext);
			expect(result.split("\n")[0]).toBe("```\u200b");
			expect(result).toContain("48;2;0;255;0m#00ff00");
		});

		test("keeps the fence indentation of nested blocks", () => {
			const markdown = ["- item", "", "  ```js", '  const c = "#ff0000";', "  ```"].join("\n");
			const lines = transformRainbowMarkdown(markdown, assistantContext).split("\n");

			expect(lines[2]).toBe("  ```js\u200b");
			expect(stripAnsi(lines[3])).toBe('  const c = "#ff0000";');
			expect(lines[4]).toBe("  ```");
		});

		test("leaves blocks unchanged when there is nothing to color", () => {
			for (const markdown of [
				fence("c", "#define FEED 1 // #fff"),
				fence("python", "x = 1  # add"),
				fence("css", "a { color: red; }"),
				fence("css", "b { fill: url(#abc); x: my-rgb(1, 2, 3); }"),
				"```css\na: #fff;",
				"~~~css\na: #fff;\n```",
			]) {
				expect(transformRainbowMarkdown(markdown, assistantContext)).toBe(markdown);
			}
		});

		test("does not treat code block content as prose", () => {
			const markdown = fence("python", "color = '#fff'");
			expect(transformRainbowMarkdown(`${markdown}\nafter #fff`, assistantContext)).toBe(
				`${markdown}\nafter ${transformRainbowMarkdown("#fff", assistantContext)}`,
			);
		});
	});
});
