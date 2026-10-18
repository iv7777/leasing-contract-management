/** Handbook content is plain data (one file per language) rendered by
 * GuidePage, so a chapter can be rewritten without touching any layout code.
 * Inline markup in any text: **bold**. In table cells, {red:text},
 * {green:text}, {amber:text}, {blue:text} render as coloured tags. */

export type CalloutKind = "tip" | "warn" | "danger" | "info";

export interface Callout {
  kind: CalloutKind;
  title: string;
  text: string;
}

export interface Step {
  title: string;
  body: string[]; // paragraphs; lines starting with "- " become bullets
  see?: string; // "You'll see: ..."
  callouts?: Callout[];
}

export type Block =
  | { type: "p"; text: string }
  | { type: "h"; text: string }
  | { type: "list"; items: string[] }
  | { type: "callout"; kind: CalloutKind; title: string; text: string }
  | { type: "steps"; steps: Step[] }
  | { type: "table"; head: string[]; rows: string[][]; rightAlign?: number[] }
  | { type: "cards"; items: { icon: string; title: string; text: string; where?: string }[] }
  | { type: "faq"; items: { q: string; a: string }[] }
  | { type: "checklist"; items: { title: string; text?: string }[] }
  | { type: "roleStart"; roles: { id: "admin" | "manager" | "collector" | "viewer"; label: string; intro: string; steps: string[] }[] };

export interface Chapter {
  id: string;
  group: string;
  kicker: string;
  title: string;
  lead: string;
  blocks: Block[];
}

export interface LifecycleStage {
  title: string;
  text: string;
  chapter: string;
  system?: boolean;
}

export interface GuideContent {
  title: string;
  subtitle: string;
  eyebrow: string;
  searchPlaceholder: string;
  roleChipsLabel: string;
  roleLabels: Record<"admin" | "manager" | "collector" | "viewer", string>;
  lifecycleTitle: string;
  legendYou: string;
  legendSystem: string;
  stages: LifecycleStage[];
  groups: Record<string, string>;
  jumpTo: string;
  noResults: string;
  resultsFor: string;
  youllSee: string;
  stepWord: string;
  backToTop: string;
  chapters: Chapter[];
}
