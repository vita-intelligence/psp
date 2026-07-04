"use client";

// ContentEditable composer with light live-markdown formatting.
//
// Design goals (borrowed from Hatyna, trimmed for PSP scope):
//   - Live bold / italic / strike / code — the user sees the styled
//     result, not the markdown source.
//   - Imperative ref API (getMarkdown / setMarkdown / clear / focus /
//     toggleFormat) — the parent owns the send lifecycle, this
//     component just owns the caret.
//   - Paste is sanitized to plain text; the parent's file-paste
//     handler (`onFilesPasted`) intercepts image/file pastes before
//     they reach the editor.
//   - Cmd/Ctrl + B / I / Shift+X / Shift+M shortcuts fire the same
//     `toggleFormat` path a floating toolbar uses.
//
// The internal HTML is a small subset — `<strong>`, `<em>`, `<s>`,
// `<code>`, `<br>` — that round-trips cleanly through
// `elementToMarkdown` at send time. Every other element type is
// stripped by the serializer, so a paste with weird structure can't
// smuggle rich HTML into the wire body.

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import { cn } from "@/lib/utils";

export type FormatKind = "bold" | "italic" | "strike" | "code";

export interface ActiveFormats {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
}

export interface RichComposerRef {
  focus(): void;
  getMarkdown(): string;
  setMarkdown(md: string): void;
  clear(): void;
  getTextLength(): number;
  isEmpty(): boolean;
  toggleFormat(format: FormatKind): void;
  getActiveFormats(): ActiveFormats;
  getSelectionRect(): DOMRect | null;
}

interface Props {
  placeholder: string;
  disabled?: boolean;
  /** Fired on every input event. Parent uses this to refresh derived
   *  state (char counter, send-button enable, formatting popover). */
  onInput?: () => void;
  onSelectionChange?: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  /** Pass files through when the user pastes an image or file. When
   *  set, the composer swallows the paste; when unset, the paste
   *  falls through to a plain-text insertion. */
  onFilesPasted?: (files: File[]) => void;
  className?: string;
  style?: React.CSSProperties;
  ariaLabel?: string;
}

export const RichComposer = forwardRef<RichComposerRef, Props>(function RichComposer(
  {
    placeholder,
    disabled,
    onInput,
    onSelectionChange,
    onKeyDown,
    onFilesPasted,
    className,
    style,
    ariaLabel,
  },
  ref,
) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [isEmpty, setIsEmpty] = useState(true);

  const recomputeEmpty = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const empty = (el.textContent?.trim().length ?? 0) === 0;
    setIsEmpty(empty);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      focus() {
        editorRef.current?.focus();
      },
      getMarkdown() {
        if (!editorRef.current) return "";
        return elementToMarkdown(editorRef.current);
      },
      setMarkdown(md) {
        const el = editorRef.current;
        if (!el) return;
        el.innerHTML = markdownToHtml(md);
        recomputeEmpty();
        moveCaretToEnd(el);
      },
      clear() {
        const el = editorRef.current;
        if (!el) return;
        el.innerHTML = "";
        recomputeEmpty();
      },
      getTextLength() {
        return editorRef.current?.textContent?.length ?? 0;
      },
      isEmpty() {
        return (editorRef.current?.textContent?.trim().length ?? 0) === 0;
      },
      toggleFormat(format) {
        const el = editorRef.current;
        if (!el) return;
        applyToggleFormat(format);
        recomputeEmpty();
        onInput?.();
        onSelectionChange?.();
      },
      getActiveFormats() {
        return {
          bold: queryCommandStateSafe("bold"),
          italic: queryCommandStateSafe("italic"),
          strike: queryCommandStateSafe("strikeThrough"),
          code: isCaretInsideCode(editorRef.current),
        };
      },
      getSelectionRect() {
        const el = editorRef.current;
        if (!el) return null;
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
        const range = sel.getRangeAt(0);
        if (!el.contains(range.commonAncestorContainer)) return null;
        const rect = range.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return null;
        return rect;
      },
    }),
    [onInput, onSelectionChange, recomputeEmpty],
  );

  // Selection changes at the document level cover keyboard-driven
  // selection (Shift+Arrow) as well as mouse drags. Filter to
  // selections rooted inside our editor so unrelated page selection
  // doesn't blow away popover state.
  useEffect(() => {
    const handler = () => {
      const el = editorRef.current;
      if (!el) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      if (!el.contains(range.commonAncestorContainer)) return;
      onSelectionChange?.();
    };
    document.addEventListener("selectionchange", handler);
    return () => document.removeEventListener("selectionchange", handler);
  }, [onSelectionChange]);

  const handlePaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const types = Array.from(e.clipboardData.types);
    if (types.includes("Files") && onFilesPasted) {
      const files = Array.from(e.clipboardData.files);
      if (files.length > 0) {
        e.preventDefault();
        onFilesPasted(files);
        return;
      }
    }

    // Strip everything to plain text. Rich HTML paste smuggles in
    // arbitrary styles + fonts + tags we don't want in our wire body.
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    document.execCommand("insertText", false, text);
  };

  return (
    <div
      ref={editorRef}
      contentEditable={!disabled}
      role="textbox"
      aria-multiline="true"
      aria-label={ariaLabel ?? placeholder}
      data-placeholder={placeholder}
      data-empty={isEmpty || undefined}
      suppressContentEditableWarning
      onInput={() => {
        recomputeEmpty();
        onInput?.();
      }}
      onKeyDown={(e) => {
        // Tab inside a chat composer should NOT shift focus elsewhere
        // mid-message — block the default.
        if (e.key === "Tab") {
          e.preventDefault();
        }
        onKeyDown?.(e);
      }}
      onPaste={handlePaste}
      className={cn(
        "rich-composer relative outline-none",
        // Placeholder rendered via a :before pseudo. `absolute` +
        // `inset-*` pins it to the top-left of the editor so the
        // caret starts at the true content origin (position 0) —
        // otherwise the pseudo sits inline and the caret lands
        // AFTER the placeholder glyphs.
        "data-[empty]:before:content-[attr(data-placeholder)]",
        // Take the pseudo out of flow so the caret starts at
        // position 0 instead of after the placeholder glyphs. Offsets
        // match the editor's px-3 py-1.5 so the placeholder text
        // lines up EXACTLY where the first typed character will land.
        "data-[empty]:before:absolute",
        "data-[empty]:before:left-3",
        "data-[empty]:before:top-1.5",
        "data-[empty]:before:text-muted-foreground",
        "data-[empty]:before:pointer-events-none",
        className,
      )}
      style={style}
    />
  );
});

function moveCaretToEnd(el: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function queryCommandStateSafe(cmd: string): boolean {
  try {
    return document.queryCommandState(cmd);
  } catch {
    return false;
  }
}

/** Is the caret inside a `<code>` element? `queryCommandState` doesn't
 *  cover inline code, so we walk up manually. */
function isCaretInsideCode(root: HTMLDivElement | null): boolean {
  if (!root) return false;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  let node: Node | null = range.startContainer;
  while (node && node !== root) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.tagName === "CODE") return true;
    }
    node = node.parentNode;
  }
  return false;
}

function applyToggleFormat(format: FormatKind): void {
  // Rely on execCommand for bold/italic/strike — legacy API but the
  // only one that handles arbitrary selection ranges correctly with
  // undo-stack integration. `code` needs a bespoke wrap/unwrap because
  // execCommand has no inline-code toggle.
  if (format === "bold") {
    document.execCommand("bold");
    return;
  }
  if (format === "italic") {
    document.execCommand("italic");
    return;
  }
  if (format === "strike") {
    document.execCommand("strikeThrough");
    return;
  }
  // Code: wrap selection in <code>, or unwrap if the whole selection
  // is already inside one.
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return;

  const parent = findAncestor(range.commonAncestorContainer, "CODE");
  if (parent) {
    // Unwrap — replace the <code> with its text content.
    const text = document.createTextNode(parent.textContent ?? "");
    parent.parentNode?.replaceChild(text, parent);
    const newRange = document.createRange();
    newRange.selectNode(text);
    sel.removeAllRanges();
    sel.addRange(newRange);
    return;
  }

  const code = document.createElement("code");
  code.textContent = range.toString();
  range.deleteContents();
  range.insertNode(code);
  const after = document.createRange();
  after.selectNodeContents(code);
  sel.removeAllRanges();
  sel.addRange(after);
}

function findAncestor(node: Node | null, tag: string): HTMLElement | null {
  let cur: Node | null = node;
  while (cur) {
    if (cur.nodeType === Node.ELEMENT_NODE) {
      const el = cur as HTMLElement;
      if (el.tagName === tag) return el;
    }
    cur = cur.parentNode;
  }
  return null;
}

// ── Markdown ↔ HTML round-trip ────────────────────────────────────

/** Serialize the editor's DOM subtree to markdown wire format. Only
 *  the four inline styles we support are emitted; everything else is
 *  flattened to plain text so a rogue paste can't smuggle exotic tags
 *  through. */
export function elementToMarkdown(root: HTMLElement): string {
  let out = "";
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? "";
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName;
    if (tag === "BR") {
      out += "\n";
      return;
    }
    if (tag === "DIV" || tag === "P") {
      // Block-level element boundary → newline. Skip a leading
      // newline (very first node) so a single-line message doesn't
      // get a spurious `\n` prefix.
      if (out.length > 0 && !out.endsWith("\n")) out += "\n";
      el.childNodes.forEach(walk);
      return;
    }
    if (tag === "STRONG" || tag === "B") {
      out += "**";
      el.childNodes.forEach(walk);
      out += "**";
      return;
    }
    if (tag === "EM" || tag === "I") {
      out += "*";
      el.childNodes.forEach(walk);
      out += "*";
      return;
    }
    if (tag === "S" || tag === "STRIKE" || tag === "DEL") {
      out += "~~";
      el.childNodes.forEach(walk);
      out += "~~";
      return;
    }
    if (tag === "CODE") {
      out += "`";
      out += el.textContent ?? "";
      out += "`";
      return;
    }
    // Unknown element — flatten to its children.
    el.childNodes.forEach(walk);
  };
  root.childNodes.forEach(walk);
  return out.trim();
}

/** Inverse of `elementToMarkdown` — build an HTML string the editor
 *  can `innerHTML` into. Kept intentionally simple; only the four
 *  inline delimiters + newline are recognised. */
export function markdownToHtml(md: string): string {
  const escape = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  // Process line-by-line so we can turn `\n` into `<br>`.
  const lines = md.split("\n");
  const rendered = lines.map((line) => renderMdLine(line, escape));
  return rendered.join("<br>");
}

function renderMdLine(line: string, escape: (s: string) => string): string {
  let out = "";
  let i = 0;
  const push = (s: string) => {
    out += s;
  };
  while (i < line.length) {
    const ch = line[i];
    if (ch === "`") {
      const end = line.indexOf("`", i + 1);
      if (end === -1) {
        push(escape(ch));
        i += 1;
        continue;
      }
      push("<code>" + escape(line.slice(i + 1, end)) + "</code>");
      i = end + 1;
      continue;
    }
    if (ch === "*" && line[i + 1] === "*") {
      const end = line.indexOf("**", i + 2);
      if (end !== -1 && end > i + 2) {
        push("<strong>" + renderMdLine(line.slice(i + 2, end), escape) + "</strong>");
        i = end + 2;
        continue;
      }
    }
    if (ch === "*") {
      const end = line.indexOf("*", i + 1);
      if (end !== -1 && end > i + 1 && line[end + 1] !== "*") {
        push("<em>" + renderMdLine(line.slice(i + 1, end), escape) + "</em>");
        i = end + 1;
        continue;
      }
    }
    if (ch === "~" && line[i + 1] === "~") {
      const end = line.indexOf("~~", i + 2);
      if (end !== -1 && end > i + 2) {
        push("<s>" + renderMdLine(line.slice(i + 2, end), escape) + "</s>");
        i = end + 2;
        continue;
      }
    }
    push(escape(ch));
    i += 1;
  }
  return out;
}
