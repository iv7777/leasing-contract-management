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

// Which handbook chapter explains a help topic best (anchor ids in guide/content.*.ts).
const topicChapters: Record<string, string> = {
  dashboard: "billing",
  "properties.list": "prepare",
  "properties.detail": "prepare",
  "parties.list": "prepare",
  "contracts.list": "create",
  "contracts.detail": "create",
  reminders: "monthly",
  occupancy: "monthly",
  users: "roles",
  audit: "monthly",
  backups: "monthly",
  billingRuns: "billing",
};

export function guideChapterForTopic(topic: string): string | undefined {
  return topicFallbackChain(topic)
    .map((key) => topicChapters[key])
    .find(Boolean);
}
