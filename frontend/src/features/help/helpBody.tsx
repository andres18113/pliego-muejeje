import { Fragment, type MouseEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import classes from "./help.module.css";

/**
 * A Help article's body is plain text with a small, safe convention, so the published content can be scanned:
 * blocks are separated by a blank line; `## Título` starts a section; consecutive `1. ` lines are steps and `- `
 * lines are a list; `[texto](/ruta)` links to a PLIEGO page. Nothing else is markup: there is no HTML, an
 * external or protocol-relative address stays text, and a body without the convention reads as paragraphs.
 */
export type HelpInline = { kind: "text"; text: string } | { kind: "link"; text: string; to: string };
export type HelpBlock =
  | { kind: "heading"; text: string; id: string }
  | { kind: "paragraph"; inline: HelpInline[] }
  | { kind: "steps" | "bullets"; items: HelpInline[][] };

const heading = /^##\s+(.+)$/;
const step = /^\d{1,2}[.)]\s+(.+)$/;
const bullet = /^[-•]\s+(.+)$/;
const link = /\[([^\]\n]+)\]\((\/(?!\/)[^\s()]*)\)/g;

export function parseInline(text: string): HelpInline[] {
  const parts: HelpInline[] = [];
  let last = 0;
  for (const match of text.matchAll(link)) {
    if (match.index > last) parts.push({ kind: "text", text: text.slice(last, match.index) });
    parts.push({ kind: "link", text: match[1], to: match[2] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts;
}

const anchor = (text: string) => `seccion-${text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "ayuda"}`;

export function parseHelpBody(body: string): HelpBlock[] {
  const blocks: HelpBlock[] = [];
  const ids = new Set<string>();
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", inline: parseInline(paragraph.join("\n")) });
    paragraph = [];
  };
  for (const raw of body.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    const listKind = step.test(line) ? "steps" : bullet.test(line) ? "bullets" : null;
    if (!line) { flush(); continue; }
    const title = heading.exec(line);
    if (title) {
      flush();
      let id = anchor(title[1]);
      for (let n = 2; ids.has(id); n++) id = `${anchor(title[1])}-${n}`;
      ids.add(id);
      blocks.push({ kind: "heading", text: title[1].trim(), id });
      continue;
    }
    if (listKind) {
      flush();
      const item = parseInline((step.exec(line) ?? bullet.exec(line))![1]);
      const previous = blocks.at(-1);
      if (previous?.kind === listKind) previous.items.push(item);
      else blocks.push({ kind: listKind, items: [item] });
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

function Inline({ parts }: { parts: HelpInline[] }) {
  return parts.map((part, index) => part.kind === "link"
    ? <Link key={index} to={part.to} className={classes.inlineLink}>{part.text}</Link>
    : <Fragment key={index}>{part.text}</Fragment>);
}

/** Moves to a section without touching the address (the router would treat a hash as a new page) and gives it focus. */
function jump(event: MouseEvent<HTMLAnchorElement>, id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  event.preventDefault();
  target.focus({ preventScroll: true });
  target.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

/** Only a long article earns a contents list; a short one is read faster than its outline. */
const longArticle = (sections: number, body: string) => sections >= 5 && body.length >= 2400;

const sameText = (a: string, b: string) => a.localeCompare(b, "es", { sensitivity: "base" }) === 0;

/**
 * The body in reading order; a long article adds a short "En este artículo" list of its sections first.
 * `within` places something of the reader's own right where the article explains it: after the first block of the
 * named section, or — if the published text no longer has that section — before the body, so it is never lost.
 */
export function HelpBody({ body, within }: { body: string; within?: { section: string; render: (placement: "section" | "top") => ReactNode } }) {
  const blocks = parseHelpBody(body);
  const sections = blocks.filter((block): block is Extract<HelpBlock, { kind: "heading" }> => block.kind === "heading");
  const anchor = within ? blocks.findIndex(block => block.kind === "heading" && sameText(block.text, within.section)) : -1;
  // After the section's first paragraph or list: the general rule is read first, then the reader's own case.
  const slotAfter = anchor >= 0 && anchor + 1 < blocks.length && blocks[anchor + 1].kind !== "heading" ? anchor + 1 : anchor;
  return <>
    {longArticle(sections.length, body) && <nav className={classes.contents} aria-labelledby="help-contents-heading">
      <h2 id="help-contents-heading" className={classes.contentsTitle}>En este artículo</h2>
      <ul>{sections.map(section => <li key={section.id}><a href={`#${section.id}`} onClick={event => jump(event, section.id)}>{section.text}</a></li>)}</ul>
    </nav>}
    {within && anchor < 0 && within.render("top")}
    <div className={classes.body}>
      {blocks.map((block, index) => {
        const slot = index === slotAfter && within ? within.render("section") : null;
        if (block.kind === "heading") return <Fragment key={index}><h2 id={block.id} tabIndex={-1} className={classes.section}>{block.text}</h2>{slot}</Fragment>;
        if (block.kind === "paragraph") return <Fragment key={index}><p><Inline parts={block.inline} /></p>{slot}</Fragment>;
        const List = block.kind === "steps" ? "ol" : "ul";
        return <Fragment key={index}><List className={block.kind === "steps" ? classes.steps : classes.bullets}>
          {block.items.map((item, itemIndex) => <li key={itemIndex}><Inline parts={item} /></li>)}
        </List>{slot}</Fragment>;
      })}
    </div>
  </>;
}
