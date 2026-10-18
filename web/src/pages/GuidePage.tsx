import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { FloatButton, Input, Segmented, Select } from "antd";
import { VerticalAlignTopOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { useHelpTopic } from "../help/HelpContext";
import { guideEn } from "../guide/content.en";
import { guideZh } from "../guide/content.zh";
import type { Block, CalloutKind, Chapter, Step } from "../guide/types";
import "../guide/guide.css";

type RoleId = "admin" | "manager" | "collector" | "viewer";

const calloutIcon: Record<CalloutKind, string> = { tip: "💡", warn: "⚠️", danger: "⛔", info: "ℹ️" };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** **bold** markup plus search-term highlighting. */
function Inline({ text, q }: { text: string; q: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  const hl = (s: string, key: string): ReactNode => {
    if (!q) return s;
    const bits = s.split(new RegExp(`(${esc(q)})`, "ig"));
    return bits.map((b, i) => (i % 2 === 1 ? <mark key={`${key}-${i}`}>{b}</mark> : b));
  };
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{hl(p.slice(2, -2), String(i))}</strong> : <Fragment key={i}>{hl(p, String(i))}</Fragment>,
      )}
    </>
  );
}

function Cell({ text, q }: { text: string; q: string }) {
  const m = text.match(/^\{(red|green|amber|blue):(.*)\}$/);
  if (m) return <span className={`hb-tag ${m[1]}`}>{m[2]}</span>;
  return <Inline text={text} q={q} />;
}

function CalloutView({ kind, title, text, q }: { kind: CalloutKind; title: string; text: string; q: string }) {
  return (
    <div className={`hb-callout ${kind}`}>
      <span className="ci">{calloutIcon[kind]}</span>
      <div>
        <span className="t">
          <Inline text={title} q={q} />
        </span>
        <Inline text={text} q={q} />
      </div>
    </div>
  );
}

function Paragraphs({ lines, q }: { lines: string[]; q: string }) {
  const out: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = (k: number) => {
    if (bullets.length) {
      out.push(
        <ul key={`u${k}`}>
          {bullets.map((b, i) => (
            <li key={i}>
              <Inline text={b} q={q} />
            </li>
          ))}
        </ul>,
      );
      bullets = [];
    }
  };
  lines.forEach((l, i) => {
    if (l.startsWith("- ")) bullets.push(l.slice(2));
    else {
      flush(i);
      out.push(
        <p key={`p${i}`}>
          <Inline text={l} q={q} />
        </p>,
      );
    }
  });
  flush(lines.length);
  return <>{out}</>;
}

function StepView({ step, n, seeLabel, q }: { step: Step; n: number; seeLabel: string; q: string }) {
  return (
    <div className="hb-step">
      <div className="hb-num">{n}</div>
      <div className="hb-body">
        <h5>
          <Inline text={step.title} q={q} />
        </h5>
        <Paragraphs lines={step.body} q={q} />
        {step.see && (
          <div className="hb-see">
            <b>{seeLabel}</b> <Inline text={step.see} q={q} />
          </div>
        )}
        {step.callouts?.map((c, i) => (
          <CalloutView key={i} {...c} q={q} />
        ))}
      </div>
    </div>
  );
}

function RoleStart({ block, role, setRole, q }: { block: Extract<Block, { type: "roleStart" }>; role: RoleId; setRole: (r: RoleId) => void; q: string }) {
  const current = block.roles.find((r) => r.id === role) ?? block.roles[0];
  return (
    <div className="hb-rolebox">
      <div className="seg">
        <Segmented value={current.id} onChange={(v) => setRole(v as RoleId)} options={block.roles.map((r) => ({ value: r.id, label: r.label }))} />
      </div>
      <p style={{ margin: "0 0 8px", color: "#5d6a63" }}>
        <Inline text={current.intro} q={q} />
      </p>
      <ol style={{ margin: 0, paddingLeft: 20 }}>
        {current.steps.map((s, i) => (
          <li key={i} style={{ marginBottom: 5 }}>
            <Inline text={s} q={q} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function BlockView({ block, q, role, setRole, seeLabel }: { block: Block; q: string; role: RoleId; setRole: (r: RoleId) => void; seeLabel: string }) {
  switch (block.type) {
    case "p":
      return (
        <p className="hb-p">
          <Inline text={block.text} q={q} />
        </p>
      );
    case "h":
      return (
        <h3 className="hb-h">
          <Inline text={block.text} q={q} />
        </h3>
      );
    case "list":
      return (
        <ul className="hb-list">
          {block.items.map((it, i) => (
            <li key={i}>
              <Inline text={it} q={q} />
            </li>
          ))}
        </ul>
      );
    case "callout":
      return <CalloutView kind={block.kind} title={block.title} text={block.text} q={q} />;
    case "steps":
      return (
        <>
          {block.steps.map((s, i) => (
            <StepView key={i} step={s} n={i + 1} seeLabel={seeLabel} q={q} />
          ))}
        </>
      );
    case "table":
      return (
        <div className="hb-table-wrap">
          <table className="hb-table">
            <thead>
              <tr>
                {block.head.map((h, i) => (
                  <th key={i} className={block.rightAlign?.includes(i) ? "r" : undefined}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((c, ci) => (
                    <td key={ci} className={block.rightAlign?.includes(ci) ? "r" : undefined}>
                      <Cell text={c} q={q} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "cards":
      return (
        <div className="hb-grid">
          {block.items.map((c, i) => (
            <div className="hb-card" key={i}>
              <h5>
                <span className="hb-ico">{c.icon}</span>
                <Inline text={c.title} q={q} />
              </h5>
              <p>
                <Inline text={c.text} q={q} />
              </p>
              {c.where && <span className="hb-where">{c.where}</span>}
            </div>
          ))}
        </div>
      );
    case "faq":
      return (
        <>
          {block.items.map((f, i) => {
            const hit = !!q && `${f.q} ${f.a}`.toLowerCase().includes(q.toLowerCase());
            return (
              <details className="hb-faq" key={`${i}-${hit}`} open={hit}>
                <summary>
                  <Inline text={f.q} q={q} />
                </summary>
                <div className="a">
                  <Inline text={f.a} q={q} />
                </div>
              </details>
            );
          })}
        </>
      );
    case "checklist":
      return (
        <ul className="hb-check">
          {block.items.map((c, i) => (
            <li key={i}>
              <input type="checkbox" />
              <div>
                <b>
                  <Inline text={c.title} q={q} />
                </b>
                {c.text && (
                  <small>
                    <Inline text={c.text} q={q} />
                  </small>
                )}
              </div>
            </li>
          ))}
        </ul>
      );
    case "roleStart":
      return <RoleStart block={block} role={role} setRole={setRole} q={q} />;
  }
}

function blockText(b: Block): string {
  switch (b.type) {
    case "p":
    case "h":
      return b.text;
    case "list":
      return b.items.join(" ");
    case "callout":
      return `${b.title} ${b.text}`;
    case "steps":
      return b.steps.map((s) => `${s.title} ${s.body.join(" ")} ${s.see ?? ""} ${(s.callouts ?? []).map((c) => `${c.title} ${c.text}`).join(" ")}`).join(" ");
    case "table":
      return `${b.head.join(" ")} ${b.rows.map((r) => r.join(" ")).join(" ")}`;
    case "cards":
      return b.items.map((c) => `${c.title} ${c.text} ${c.where ?? ""}`).join(" ");
    case "faq":
      return b.items.map((f) => `${f.q} ${f.a}`).join(" ");
    case "checklist":
      return b.items.map((c) => `${c.title} ${c.text ?? ""}`).join(" ");
    case "roleStart":
      return b.roles.map((r) => `${r.label} ${r.intro} ${r.steps.join(" ")}`).join(" ");
  }
}

const chapterText = (c: Chapter) => `${c.title} ${c.lead} ${c.blocks.map(blockText).join(" ")}`.replace(/\*\*/g, "").toLowerCase();

export default function GuidePage() {
  const { i18n } = useTranslation();
  const location = useLocation();
  useHelpTopic("guide");

  const g = i18n.language?.startsWith("zh") ? guideZh : guideEn;
  const [q, setQ] = useState("");
  const [role, setRole] = useState<RoleId>("admin");
  const [cur, setCur] = useState(g.chapters[0].id);
  const [showTop, setShowTop] = useState(false);
  const query = q.trim();

  const visible = useMemo(() => (query ? g.chapters.filter((c) => chapterText(c).includes(query.toLowerCase())) : g.chapters), [g, query]);

  // Scroll to #chapter when arriving from a help link or a bookmark.
  useEffect(() => {
    const id = location.hash.replace("#", "");
    if (!id) return;
    const t = setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    return () => clearTimeout(t);
  }, [location.hash, g]);

  // Highlight the chapter being read in the contents list.
  useEffect(() => {
    const onScroll = () => {
      let id = visible[0]?.id;
      for (const c of visible) {
        const el = document.getElementById(c.id);
        if (el && el.getBoundingClientRect().top < 140) id = c.id;
      }
      if (id) setCur(id);
      // Offer "back to top" once the hero has scrolled well out of view.
      setShowTop((document.querySelector(".hb-hero")?.getBoundingClientRect().bottom ?? 0) < -400);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [visible]);

  const toTop = () => document.querySelector(".hb-hero")?.scrollIntoView({ behavior: "smooth", block: "start" });
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const groups = Object.keys(g.groups);

  return (
    <div className="hb">
      {showTop && <FloatButton className="hb-top" icon={<VerticalAlignTopOutlined />} tooltip={g.backToTop} onClick={toTop} />}
      <header className="hb-hero">
        <div className="hb-eyebrow">{g.eyebrow}</div>
        <h1>{g.title}</h1>
        <p>{g.subtitle}</p>
        <Input.Search className="hb-search" size="large" allowClear placeholder={g.searchPlaceholder} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="hb-chips">
          <span className="lbl">{g.roleChipsLabel}</span>
          {(Object.keys(g.roleLabels) as RoleId[]).map((r) => (
            <button
              key={r}
              className="hb-chip"
              onClick={() => {
                setRole(r);
                setQ("");
                setTimeout(() => go("welcome"), 30);
              }}
            >
              {g.roleLabels[r]}
            </button>
          ))}
        </div>
      </header>

      <section className="hb-life" aria-label={g.lifecycleTitle}>
        <h3>{g.lifecycleTitle}</h3>
        <div className="hb-steps">
          {g.stages.map((s, i) => (
            <a key={i} className={`hb-stage${s.system ? " sys" : ""}`} href={`#${s.chapter}`} onClick={(e) => { e.preventDefault(); go(s.chapter); }}>
              <div className="hb-dot">{i + 1}</div>
              <b>{s.title}</b>
              <small>{s.text}</small>
            </a>
          ))}
        </div>
        <div className="hb-legend">
          <span>
            <i /> {g.legendYou}
          </span>
          <span>
            <i className="s" /> {g.legendSystem}
          </span>
        </div>
      </section>

      <div className="hb-jump">
        <Select
          style={{ width: "100%" }}
          placeholder={g.jumpTo}
          value={cur}
          onChange={(v) => go(v)}
          options={g.chapters.map((c) => ({ value: c.id, label: c.title }))}
        />
      </div>

      <div className="hb-layout">
        <nav className="hb-toc" aria-label={g.jumpTo}>
          {groups.map((gr) => {
            const items = visible.filter((c) => c.group === gr);
            if (!items.length) return null;
            return (
              <Fragment key={gr}>
                <h4>{g.groups[gr]}</h4>
                {items.map((c) => (
                  <a key={c.id} href={`#${c.id}`} className={cur === c.id ? "cur" : undefined} onClick={(e) => { e.preventDefault(); go(c.id); }}>
                    {c.title}
                  </a>
                ))}
              </Fragment>
            );
          })}
        </nav>

        <main>
          {query && (
            <p className="hb-p" style={{ color: "#5d6a63" }}>
              {g.resultsFor.replace("{{q}}", query).replace("{{n}}", String(visible.length))}
            </p>
          )}
          {visible.length === 0 && <div className="hb-empty">{g.noResults}</div>}
          {visible.map((c) => (
            <section className="hb-chapter" id={c.id} key={c.id}>
              <div className="hb-kicker">{c.kicker}</div>
              <h2>
                <Inline text={c.title} q={query} />
              </h2>
              <p className="hb-lead">
                <Inline text={c.lead} q={query} />
              </p>
              {c.blocks.map((b, i) => (
                <BlockView key={i} block={b} q={query} role={role} setRole={setRole} seeLabel={g.youllSee} />
              ))}
            </section>
          ))}
        </main>
      </div>
    </div>
  );
}
