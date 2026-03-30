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

export type AuditFeedback = SharedItem & {
  auditSummary: string;
  inputExcerpt: string;
  likelySourceDomain: string | null;
  likelySourceName: string | null;
  spamProbability: number;
  verdict: "yes" | "no";
};

const sharedMemoryStore = new Map<string, string>();

const storageKeys = {
  feedback: "trainer:feedback",
  siteProfiles: "trainer:site-profiles",
  trainingNotes: "trainer:notes",
} as const;

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
