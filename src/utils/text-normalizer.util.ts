import { load } from "cheerio";
import type { AnyNode } from "domhandler";

const MAX_DOM_TEXT_DEPTH = 8_192;
const MAX_DOM_TEXT_NODES = 50_000;

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

export function normalizeHtmlNodesText(
  rootNodes: readonly AnyNode[],
): string | null {
  if (rootNodes.length > MAX_DOM_TEXT_NODES) {
    return null;
  }

  const tokens: HtmlTextToken[] = [];
  type TraversalFrame =
    { type: "node"; node: AnyNode; depth: number } | { type: "block-exit" };
  const stack: TraversalFrame[] = [...rootNodes]
    .reverse()
    .map((node) => ({ type: "node", node, depth: 0 }));
  let queuedNodes = rootNodes.length;
  let visitedNodes = 0;

  while (stack.length > 0) {
    const frame = stack.pop();

    if (!frame) {
      break;
    }

    if (frame.type === "block-exit") {
      tokens.push({ type: "break", source: "block" });
      continue;
    }

    const { node, depth } = frame;
    queuedNodes -= 1;
    visitedNodes += 1;

    if (
      depth > MAX_DOM_TEXT_DEPTH ||
      visitedNodes > MAX_DOM_TEXT_NODES
    ) {
      return null;
    }

    if (node.nodeType === 3 && "data" in node) {
      tokens.push({ type: "text", value: node.data.replace(/\s+/g, " ") });
      continue;
    }

    if (!("children" in node)) {
      continue;
    }

    const elementName = "name" in node ? node.name.toLowerCase() : undefined;

    if (elementName && SKIPPED_ELEMENT_NAMES.has(elementName)) {
      continue;
    }

    if (elementName === "br") {
      tokens.push({ type: "break", source: "br" });
      continue;
    }

    const isBlock = elementName ? BLOCK_ELEMENT_NAMES.has(elementName) : false;

    if (isBlock) {
      tokens.push({ type: "break", source: "block" });
      stack.push({ type: "block-exit" });
    }

    if (
      visitedNodes + queuedNodes + node.children.length >
      MAX_DOM_TEXT_NODES
    ) {
      return null;
    }

    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      stack.push({
        type: "node",
        node: node.children[index],
        depth: depth + 1,
      });
    }
    queuedNodes += node.children.length;
  }

  return normalizePlainText(renderHtmlTextTokens(tokens));
}

export function normalizeHtmlText(input: string): string {
  const $ = load(input, null, false);

  return normalizeHtmlNodesText($.root().contents().toArray()) ?? "";
}
