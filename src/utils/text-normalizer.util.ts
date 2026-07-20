import { load } from "cheerio";
import { hasChildren, isTag, isText, type AnyNode } from "domhandler";

const BLOCK_ELEMENT_NAMES = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "caption",
  "dd",
  "details",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "td",
  "th",
  "tr",
  "ul",
]);

const SKIPPED_ELEMENT_NAMES = new Set(["noscript", "script", "style"]);

type HtmlTextToken =
  { type: "text"; value: string } | { type: "break"; source: "block" | "br" };

function collectHtmlTextTokens(node: AnyNode, tokens: HtmlTextToken[]): void {
  if (isText(node)) {
    tokens.push({ type: "text", value: node.data.replace(/\s+/g, " ") });
    return;
  }

  if (!hasChildren(node)) {
    return;
  }

  const elementName = isTag(node) ? node.name.toLowerCase() : undefined;

  if (elementName && SKIPPED_ELEMENT_NAMES.has(elementName)) {
    return;
  }

  if (elementName === "br") {
    tokens.push({ type: "break", source: "br" });
    return;
  }

  const isBlock = elementName ? BLOCK_ELEMENT_NAMES.has(elementName) : false;

  if (isBlock) {
    tokens.push({ type: "break", source: "block" });
  }

  for (const child of node.children) {
    collectHtmlTextTokens(child, tokens);
  }

  if (isBlock) {
    tokens.push({ type: "break", source: "block" });
  }
}

function renderHtmlTextTokens(tokens: HtmlTextToken[]): string {
  let output = "";
  let pendingSpace = false;
  let htmlBreakCount = 0;
  let hasBlockBreak = false;

  const flushBreaks = (): void => {
    const breakCount = Math.min(
      2,
      Math.max(htmlBreakCount, hasBlockBreak ? 1 : 0),
    );

    if (output && breakCount > 0) {
      output = `${output.trimEnd()}${"\n".repeat(breakCount)}`;
    }

    htmlBreakCount = 0;
    hasBlockBreak = false;
  };

  for (const token of tokens) {
    if (token.type === "break") {
      pendingSpace = false;

      if (token.source === "br") {
        htmlBreakCount += 1;
      } else {
        hasBlockBreak = true;
      }

      continue;
    }

    const value = token.value;
    const trimmedValue = value.trim();

    if (!trimmedValue) {
      if (htmlBreakCount === 0 && !hasBlockBreak) {
        pendingSpace = true;
      }

      continue;
    }

    flushBreaks();

    if ((pendingSpace || value.startsWith(" ")) && output) {
      output += " ";
    }

    output += trimmedValue;
    pendingSpace = value.endsWith(" ");
  }

  return output.trim();
}

export function normalizePlainText(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeHtmlText(input: string): string {
  const $ = load(input, null, false);
  const tokens: HtmlTextToken[] = [];

  for (const node of $.root().toArray()) {
    collectHtmlTextTokens(node, tokens);
  }

  return normalizePlainText(renderHtmlTextTokens(tokens));
}
