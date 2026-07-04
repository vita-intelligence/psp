"use client";

// URL autolinker for comment bodies. Splits a plain-text run into
// alternating text + anchor spans so `http://…` or `https://…` /
// `www.…` substrings become clickable. Deliberately conservative on
// matching — we prefer under-linking over false positives that turn
// a stray "a.b" in someone's SKU into a broken link.
//
// `rel="noopener noreferrer nofollow"` is non-negotiable:
//   - noopener stops the destination from controlling window.opener.
//   - noreferrer stops PSP URLs from leaking to the link target via
//     the Referer header.
//   - nofollow keeps us out of the SEO graph (irrelevant inside a
//     private discussion but harmless).

import { Fragment } from "react";
import { cn } from "@/lib/utils";

// Match http/https URLs and bare `www.` URLs. Non-greedy path so a
// trailing punctuation char (period at end of sentence, closing paren
// after "(see https://example.com)") isn't gobbled into the link.
const URL_RE =
  /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?"'\]]|www\.[^\s<>()]+[^\s<>().,;:!?"'\]])/gi;

interface Token {
  kind: "text" | "url";
  value: string;
}

function tokenise(text: string): Token[] {
  const tokens: Token[] = [];
  let lastIndex = 0;
  URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(text)) !== null) {
    if (m.index > lastIndex) {
      tokens.push({ kind: "text", value: text.slice(lastIndex, m.index) });
    }
    tokens.push({ kind: "url", value: m[0] });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) {
    tokens.push({ kind: "text", value: text.slice(lastIndex) });
  }
  return tokens;
}

export function Autolink({
  text,
  linkClassName,
}: {
  text: string;
  linkClassName?: string;
}) {
  const tokens = tokenise(text);
  return (
    <>
      {tokens.map((tok, i) =>
        tok.kind === "text" ? (
          <Fragment key={i}>{tok.value}</Fragment>
        ) : (
          <a
            key={i}
            href={tok.value.startsWith("www.") ? `https://${tok.value}` : tok.value}
            target="_blank"
            rel="noopener noreferrer nofollow"
            title={tok.value}
            className={cn(
              "underline underline-offset-2 transition-colors hover:no-underline",
              linkClassName,
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {tok.value}
          </a>
        ),
      )}
    </>
  );
}
