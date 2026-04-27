/**
 * Minimal markdown renderer for Maya's brief output.
 *
 * Why not react-markdown / remark / marked: the brief is a constrained
 * format Maya emits herself — paragraphs, single-level bullets, **bold**,
 * `inline-code`, and the occasional citation chip. Pulling a 30KB+ markdown
 * lib for that is bundle-bloat for no upside, and the brief content lands
 * in real-time via Convex subscription so render speed matters.
 *
 * What we support:
 *   - paragraphs (blank-line separated)
 *   - `- item` and `* item` bullet lists
 *   - `**bold**` and `*italic*` inline
 *   - `` `code` `` inline (rendered with the mono font + paper-faint bg)
 *   - autolinks for `[text](url)` (relative href only — external links
 *     are not autolinked, which is intentional for a v0 brief)
 *
 * What we deliberately don't support: headings, blockquotes, images,
 * tables, code fences, raw HTML. Maya's playbook constrains the brief to
 * the supported subset; if she ever emits a heading, it'll just render as
 * inline text — not a regression, just unstyled.
 */

interface MarkdownLiteProps {
  source: string;
}

export function MarkdownLite({ source }: MarkdownLiteProps) {
  const blocks = parseBlocks(source.trim());
  return (
    <div className="space-y-4 text-base leading-relaxed text-paper-dim">
      {blocks.map((b, i) => {
        if (b.kind === "list") {
          return (
            <ul
              key={i}
              className="space-y-2 pl-1 text-paper-dim"
            >
              {b.items.map((item, j) => (
                <li key={j} className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className="mt-2.5 h-1 w-3 shrink-0 bg-lime"
                  />
                  <span>{renderInline(item)}</span>
                </li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{renderInline(b.text)}</p>;
      })}
    </div>
  );
}

type Block =
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] };

function parseBlocks(src: string): Block[] {
  const lines = src.split(/\r?\n/);
  const blocks: Block[] = [];
  let buf: string[] = [];
  let inList = false;
  let listBuf: string[] = [];

  const flushPara = () => {
    if (buf.length === 0) return;
    blocks.push({ kind: "paragraph", text: buf.join(" ").trim() });
    buf = [];
  };
  const flushList = () => {
    if (listBuf.length === 0) return;
    blocks.push({ kind: "list", items: listBuf });
    listBuf = [];
    inList = false;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") {
      flushPara();
      flushList();
      continue;
    }
    const bulletMatch = /^[-*]\s+(.+)$/.exec(line);
    if (bulletMatch) {
      flushPara();
      inList = true;
      listBuf.push(bulletMatch[1]);
      continue;
    }
    if (inList) flushList();
    buf.push(line);
  }
  flushPara();
  flushList();
  return blocks;
}

/**
 * Render a single chunk of text with inline formatting. We tokenize once,
 * then map each token to a React node. Order matters: code first (so we
 * don't bold an asterisk inside a code span), then links, then bold/italic.
 */
function renderInline(text: string): React.ReactNode[] {
  type Token =
    | { kind: "text"; value: string }
    | { kind: "code"; value: string }
    | { kind: "link"; label: string; href: string }
    | { kind: "bold"; value: string }
    | { kind: "italic"; value: string };

  const tokens: Token[] = [];
  let rest = text;

  // Pattern is intentionally non-greedy to avoid swallowing across markers.
  const PATTERNS: Array<[RegExp, (m: RegExpExecArray) => Token]> = [
    [/`([^`]+)`/, (m) => ({ kind: "code", value: m[1] })],
    [
      /\[([^\]]+)\]\(([^)]+)\)/,
      (m) => ({ kind: "link", label: m[1], href: m[2] }),
    ],
    [/\*\*([^*]+)\*\*/, (m) => ({ kind: "bold", value: m[1] })],
    [/\*([^*]+)\*/, (m) => ({ kind: "italic", value: m[1] })],
  ];

  // Greedy left-to-right scan: at each position pick the earliest match
  // across all patterns and consume up to that point.
  while (rest.length > 0) {
    let bestIdx = -1;
    let bestMatch: RegExpExecArray | null = null;
    let bestProducer: ((m: RegExpExecArray) => Token) | null = null;
    for (const [re, prod] of PATTERNS) {
      const m = re.exec(rest);
      if (m && (bestIdx === -1 || m.index < bestIdx)) {
        bestIdx = m.index;
        bestMatch = m;
        bestProducer = prod;
      }
    }
    if (!bestMatch || !bestProducer) {
      tokens.push({ kind: "text", value: rest });
      break;
    }
    if (bestMatch.index > 0) {
      tokens.push({ kind: "text", value: rest.slice(0, bestMatch.index) });
    }
    tokens.push(bestProducer(bestMatch));
    rest = rest.slice(bestMatch.index + bestMatch[0].length);
  }

  return tokens.map((t, i) => {
    switch (t.kind) {
      case "text":
        return <span key={i}>{t.value}</span>;
      case "code":
        return (
          <code
            key={i}
            className="rounded bg-ink-3 px-1.5 py-0.5 font-mono text-[0.9em] text-paper"
          >
            {t.value}
          </code>
        );
      case "link":
        return (
          <a
            key={i}
            href={t.href}
            className="text-paper underline decoration-lime decoration-2 underline-offset-4 transition-colors hover:text-lime"
          >
            {t.label}
          </a>
        );
      case "bold":
        return (
          <strong key={i} className="font-medium text-paper">
            {t.value}
          </strong>
        );
      case "italic":
        return (
          <em key={i} className="italic text-paper">
            {t.value}
          </em>
        );
    }
  });
}
