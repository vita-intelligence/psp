"use client";

// Render a comment body with light markdown formatting + autolinked
// URLs. Ported from Hatyna but self-contained — PSP doesn't have the
// `@/lib/markdown` module Hatyna uses, so we ship a small purpose-built
// parser that handles the four inline delimiters we care about:
//
//   **bold**  ·  *italic*  ·  ~~strike~~  ·  `inline code`
//
// Anything more elaborate (code blocks, mentions, headings) is out of
// scope for the port — the composer emits only these delimiters so
// the round-trip stays clean. Autolinking runs on every plain-text
// leaf so a URL inside *emphasis* is still clickable.

import { Fragment } from "react";
import { Autolink } from "./autolink";
import { cn } from "@/lib/utils";

type Node =
  | { type: "text"; value: string }
  | { type: "bold"; children: Node[] }
  | { type: "italic"; children: Node[] }
  | { type: "strike"; children: Node[] }
  | { type: "code"; value: string };

// Recursive-descent parser. Cheap and small — regex-only markdown
// parsers get confused by nested wrappers; a hand-rolled tokeniser
// keeps `**bold with *italic* inside**` correct.
function parseInline(text: string): Node[] {
  const out: Node[] = [];
  let i = 0;
  let buf = "";
  const flush = () => {
    if (buf) {
      out.push({ type: "text", value: buf });
      buf = "";
    }
  };

  while (i < text.length) {
    const ch = text[i];

    // Inline code — greedy grab up to the matching backtick. Any
    // escaped backtick (`\``) inside is treated as content.
    if (ch === "`") {
      const end = text.indexOf("`", i + 1);
      if (end === -1) {
        buf += ch;
        i += 1;
        continue;
      }
      flush();
      out.push({ type: "code", value: text.slice(i + 1, end) });
      i = end + 1;
      continue;
    }

    // Bold — `**foo**`. Peek ahead for the closing pair.
    if (ch === "*" && text[i + 1] === "*") {
      const end = text.indexOf("**", i + 2);
      if (end !== -1 && end > i + 2) {
        flush();
        out.push({
          type: "bold",
          children: parseInline(text.slice(i + 2, end)),
        });
        i = end + 2;
        continue;
      }
    }

    // Italic — `*foo*`. Must NOT be preceded by another `*` (that's
    // the bold case handled above) and must have non-empty content.
    if (ch === "*") {
      const end = text.indexOf("*", i + 1);
      if (
        end !== -1 &&
        end > i + 1 &&
        text[end + 1] !== "*"
      ) {
        flush();
        out.push({
          type: "italic",
          children: parseInline(text.slice(i + 1, end)),
        });
        i = end + 1;
        continue;
      }
    }

    // Strike — `~~foo~~`.
    if (ch === "~" && text[i + 1] === "~") {
      const end = text.indexOf("~~", i + 2);
      if (end !== -1 && end > i + 2) {
        flush();
        out.push({
          type: "strike",
          children: parseInline(text.slice(i + 2, end)),
        });
        i = end + 2;
        continue;
      }
    }

    buf += ch;
    i += 1;
  }

  flush();
  return out;
}

function renderNode(
  node: Node,
  ctx: { linkClassName?: string; isSelf: boolean },
): React.ReactNode {
  switch (node.type) {
    case "text":
      return (
        <Autolink text={node.value} linkClassName={ctx.linkClassName} />
      );
    case "bold":
      return (
        <strong className="font-semibold">
          {node.children.map((child, i) => (
            <Fragment key={i}>{renderNode(child, ctx)}</Fragment>
          ))}
        </strong>
      );
    case "italic":
      return (
        <em>
          {node.children.map((child, i) => (
            <Fragment key={i}>{renderNode(child, ctx)}</Fragment>
          ))}
        </em>
      );
    case "strike":
      return (
        <s>
          {node.children.map((child, i) => (
            <Fragment key={i}>{renderNode(child, ctx)}</Fragment>
          ))}
        </s>
      );
    case "code":
      return (
        <code
          className={cn(
            "rounded px-1 py-0.5 font-mono text-[0.92em]",
            ctx.isSelf
              ? "bg-brand-foreground/15 text-brand-foreground"
              : "bg-foreground/[0.08] text-foreground",
          )}
        >
          {node.value}
        </code>
      );
  }
}

export function FormattedText({
  text,
  isSelf,
  linkClassName,
}: {
  text: string;
  isSelf: boolean;
  linkClassName?: string;
}) {
  const nodes = parseInline(text);
  return (
    <>
      {nodes.map((node, i) => (
        <Fragment key={i}>
          {renderNode(node, { isSelf, linkClassName })}
        </Fragment>
      ))}
    </>
  );
}
