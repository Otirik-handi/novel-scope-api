import { load } from "cheerio";

const BLOCK_BREAK_MARKER = "\uE000";
const HTML_BREAK_MARKER = "\uE001";

const BLOCK_ELEMENTS = [
  "address",
  "article",
  "aside",
  "blockquote",
  "div",
  "dl",
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
  "table",
  "tr",
  "ul",
].join(",");

function resolveHtmlBreaks(input: string): string {
  return input.replace(/[\s\uE000\uE001]+/g, (sequence) => {
    const htmlBreakCount = sequence.split(HTML_BREAK_MARKER).length - 1;
    const hasBlockBreak = sequence.includes(BLOCK_BREAK_MARKER);

    if (htmlBreakCount === 0 && !hasBlockBreak) {
      return sequence;
    }

    const breakCount = Math.min(2, Math.max(htmlBreakCount, 1));

    return "\n".repeat(breakCount);
  });
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

  $("script,style,noscript").remove();
  $("br").replaceWith(HTML_BREAK_MARKER);
  $(BLOCK_ELEMENTS).each((_, element) => {
    $(element).before(BLOCK_BREAK_MARKER).after(BLOCK_BREAK_MARKER);
  });

  return normalizePlainText(resolveHtmlBreaks($.root().text()));
}
