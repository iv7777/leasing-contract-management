interface RouteTopic {
  pattern: RegExp;
  topic: string;
}

// Ordered most-specific first: a detail route must be checked before its list route.
const routeTopics: RouteTopic[] = [
  { pattern: /^\/guide$/, topic: "guide" },
  { pattern: /^\/properties\/\d+$/, topic: "properties.detail" },
  { pattern: /^\/properties$/, topic: "properties.list" },
  { pattern: /^\/contracts\/\d+$/, topic: "contracts.detail" },
  { pattern: /^\/contracts$/, topic: "contracts.list" },
  { pattern: /^\/parties$/, topic: "parties.list" },
  { pattern: /^\/reminders$/, topic: "reminders" },
  { pattern: /^\/occupancy$/, topic: "occupancy" },
  { pattern: /^\/users$/, topic: "users" },
  { pattern: /^\/audit$/, topic: "audit" },
  { pattern: /^\/backups$/, topic: "backups" },
  { pattern: /^\/billing-runs$/, topic: "billingRuns" },
  { pattern: /^\/system-health$/, topic: "systemHealth" },
  { pattern: /^\/$/, topic: "dashboard" },
];

export function defaultTopicForPath(pathname: string): string {
  return routeTopics.find((r) => r.pattern.test(pathname))?.topic ?? "dashboard";
}

// Topics that have no dedicated content fall back to their parent page's article.
export function topicFallbackChain(topic: string): string[] {
  const parts = topic.split(".");
  const chain: string[] = [];
  for (let i = parts.length; i > 0; i--) {
    chain.push(parts.slice(0, i).join("."));
  }
  return chain;
}

// Which handbook chapters explain a help topic, most relevant first (anchor ids
// in guide/content.*.ts). Topics without an entry fall back to their parent's.
const topicChapters: Record<string, string[]> = {
  dashboard: ["billing", "collect", "interface"],
  "properties.list": ["prepare", "interface"],
  "properties.detail": ["prepare"],
  "parties.list": ["prepare", "concepts"],
  "contracts.list": ["create", "interface"],
  "contracts.detail": ["create", "interface"],
  "contracts.detail.units": ["create"],
  "contracts.detail.pricing": ["create"],
  "contracts.detail.concessions": ["create"],
  "contracts.detail.deposit": ["deposit"],
  "contracts.detail.statement": ["monthly", "collect"],
  "contracts.detail.receipts": ["collect"],
  "contracts.detail.usage": ["billing"],
  "contracts.detail.charges": ["billing", "collect"],
  "contracts.detail.upcoming": ["billing"],
  "contracts.detail.amendments": ["change"],
  "contracts.detail.documents": ["create", "roles"],
  reminders: ["monthly", "deposit"],
  occupancy: ["monthly"],
  users: ["roles", "welcome"],
  audit: ["monthly"],
  billingRuns: ["billing"],
  backups: ["monthly"],
  systemHealth: ["monthly"],
  guide: ["interface", "welcome"],
};

export function guideChaptersForTopic(topic: string): string[] {
  const hit = topicFallbackChain(topic)
    .map((key) => topicChapters[key])
    .find(Boolean);
  return hit ?? ["interface"];
}
