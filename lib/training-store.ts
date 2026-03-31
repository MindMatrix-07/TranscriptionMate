type SharedItem = {
  createdAt: string;
  id: string;
};

export type SiteProfile = SharedItem & {
  domain: string;
  fingerprints: string[];
  name: string;
  notes: string;
  searchHint: string;
  updatedAt: string;
};

export type TrainingNote = SharedItem & {
  author: "admin" | "assistant";
  content: string;
};

export type TrainingLesson = SharedItem & {
  confidence: "low" | "medium" | "high";
  evidenceSources: string[];
  guidance: string;
  providerHints: string[];
  relatedDomains: string[];
  sourceMessage: string;
  title: string;
  updatedAt: string;
};

export type AuditFeedback = SharedItem & {
  auditRunId?: string | null;
  auditSummary: string;
  inputExcerpt: string;
  likelySourceDomain: string | null;
  likelySourceName: string | null;
  providerId?: string | null;
  spamProbability: number;
  verdict: "yes" | "no";
};

export type ProviderMode = "always" | "low-confidence-only";

export type ProviderSetting = SharedItem & {
  allowFallback: boolean;
  dailySoftLimit: number;
  enabled: boolean;
  mode: ProviderMode;
  name: string;
  priority: number;
  providerId: string;
  timeoutMs: number;
  updatedAt: string;
};

export type AuditRun = SharedItem & {
  fallbackChain: string[];
  inputHash: string;
  likelySourceDomain: string | null;
  likelySourceName: string | null;
  notes: string;
  providerId: string | null;
  queries: string[];
  searchResultCount: number;
  spamProbability: number;
  status: "success" | "fallback" | "heuristic" | "error";
  webEvidence: Array<{
    providerId: string;
    score?: number | null;
    snippet: string;
    title: string;
    url: string;
  }>;
};

const sharedMemoryStore = new Map<string, string>();

const storageKeys = {
  auditRuns: "trainer:audit-runs",
  feedback: "trainer:feedback",
  lessons: "trainer:lessons",
  providers: "trainer:providers",
  siteProfiles: "trainer:site-profiles",
  trainingNotes: "trainer:notes",
} as const;

const defaultProviders: ProviderSetting[] = [
  {
    allowFallback: true,
    createdAt: new Date(0).toISOString(),
    dailySoftLimit: 250,
    enabled: true,
    id: "provider-default-tavily",
    mode: "always",
    name: "Tavily",
    priority: 1,
    providerId: "tavily",
    timeoutMs: 8000,
    updatedAt: new Date(0).toISOString(),
  },
  {
    allowFallback: true,
    createdAt: new Date(0).toISOString(),
    dailySoftLimit: 250,
    enabled: false,
    id: "provider-default-gemini-search",
    mode: "always",
    name: "Gemini Search",
    priority: 2,
    providerId: "gemini-search",
    timeoutMs: 12000,
    updatedAt: new Date(0).toISOString(),
  },
];

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return null;
  }

  return { token, url };
}

async function upstashGet<T>(key: string) {
  const config = getRedisConfig();

  if (!config) {
    const raw = sharedMemoryStore.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  const response = await fetch(`${config.url}/get/${key}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
    },
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as { result?: string | null };

  if (!payload.result) {
    return null;
  }

  return JSON.parse(payload.result) as T;
}

async function upstashSet<T>(key: string, value: T) {
  const serialized = JSON.stringify(value);
  const config = getRedisConfig();

  if (!config) {
    sharedMemoryStore.set(key, serialized);
    return;
  }

  await fetch(`${config.url}/set/${key}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: serialized,
  });
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function readList<T>(key: string) {
  return (await upstashGet<T[]>(key)) ?? [];
}

async function writeList<T>(key: string, items: T[]) {
  await upstashSet(key, items);
}

export async function listSiteProfiles() {
  return readList<SiteProfile>(storageKeys.siteProfiles);
}

export async function listTrainingNotes() {
  return readList<TrainingNote>(storageKeys.trainingNotes);
}

export async function listTrainingLessons() {
  return readList<TrainingLesson>(storageKeys.lessons);
}

export async function listFeedback() {
  return readList<AuditFeedback>(storageKeys.feedback);
}

export async function appendFeedback(
  feedback: Omit<AuditFeedback, "createdAt" | "id">,
) {
  const items = await listFeedback();
  const nextItems = [
    {
      ...feedback,
      createdAt: new Date().toISOString(),
      id: createId("feedback"),
    },
    ...items,
  ].slice(0, 200);

  await writeList(storageKeys.feedback, nextItems);
  return nextItems[0];
}

export async function listProviderSettings() {
  const stored = await readList<ProviderSetting>(storageKeys.providers);
  const mergedProviders =
    stored.length > 0
      ? [
          ...stored,
          ...defaultProviders.filter(
            (provider) =>
              !stored.some(
                (storedProvider) =>
                  storedProvider.providerId === provider.providerId,
              ),
          ),
        ]
      : defaultProviders;

  return mergedProviders.sort((left, right) => left.priority - right.priority);
}

export async function upsertProviderSetting(
  provider: Omit<ProviderSetting, "createdAt" | "id" | "updatedAt"> & {
    id?: string;
  },
) {
  const items = await listProviderSettings();
  const now = new Date().toISOString();
  const existing =
    items.find((item) => item.id === provider.id) ??
    items.find((item) => item.providerId === provider.providerId);

  const nextProvider: ProviderSetting = existing
    ? {
        ...existing,
        ...provider,
        updatedAt: now,
      }
    : {
        ...provider,
        createdAt: now,
        id: createId("provider"),
        updatedAt: now,
      };

  const nextItems = existing
    ? items.map((item) => (item.id === existing.id ? nextProvider : item))
    : [...items, nextProvider];

  await writeList(storageKeys.providers, nextItems);
  return nextProvider;
}

export async function listAuditRuns() {
  return readList<AuditRun>(storageKeys.auditRuns);
}

export async function appendAuditRun(
  run: Omit<AuditRun, "createdAt" | "id">,
) {
  const items = await listAuditRuns();
  const nextItems = [
    {
      ...run,
      createdAt: new Date().toISOString(),
      id: createId("audit"),
    },
    ...items,
  ].slice(0, 500);

  await writeList(storageKeys.auditRuns, nextItems);
  return nextItems[0];
}
