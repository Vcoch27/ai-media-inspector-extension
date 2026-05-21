const DEFAULT_BACKEND_BASE_URL_RAW =
  import.meta.env.VITE_BACKEND_BASE_URL || 'http://localhost:8080';

export const DEFAULT_BACKEND_BASE_URL = normalizeBackendBaseUrl(DEFAULT_BACKEND_BASE_URL_RAW);

export const STORAGE_KEYS = {
  authToken: 'ai-media-inspector-auth-token',
  authUser: 'ai-media-inspector-auth-user',
  backendBaseUrl: 'ai-media-inspector-backend-base-url',
} as const;

export type ExtensionUser = {
  id?: number;
  email?: string;
  displayName?: string;
  role?: string;
  createdAt?: string;
};

export type ExtensionAuthState = {
  token: string | null;
  user: ExtensionUser | null;
  backendBaseUrl: string;
};

export type BackendLoginResponse = {
  token?: string;
  user?: ExtensionUser;
  message?: string;
  error?: string;
  reason?: string;
};

export type BackendPredictResponse = Record<string, unknown> & {
  status?: string;
  prediction?: string;
  confidence?: string | number;
  message?: string | null;
  ai_probability?: number;
  aiProbability?: number;
  real_probability?: number;
  realProbability?: number;
  heatmap_base64?: string | null;
  heatmapBase64?: string | null;
  cv_analysis?: unknown[] | null;
  cvAnalysis?: unknown[] | null;
  consistency?: number | null;
  votes?: Record<string, number> | null;
  timeline?: unknown[] | null;
  key_frame_base64?: string | null;
  keyFrameBase64?: string | null;
};

export type NormalizedPredictResponse = {
  status: 'success' | 'error';
  prediction: string;
  confidence: string;
  confidenceValue: number;
  message: string;
  aiProbability: number;
  realProbability: number;
  heatmapBase64: string | null;
  cvAnalysis: unknown[] | null;
  consistency: number | null;
  votes: Record<string, number> | null;
  timeline: unknown[] | null;
  keyFrameBase64: string | null;
  isVideo: boolean;
};

export type RuntimeErrorPayload = {
  code: string;
  message: string;
  details?: string;
};

export function normalizeBackendBaseUrl(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return DEFAULT_BACKEND_BASE_URL;
  }

  return trimmed.replace(/\/+$/, '');
}

export function buildApiUrl(baseUrl: string, path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizeBackendBaseUrl(baseUrl)}${normalizedPath}`;
}

export function formatPercent(value: number) {
  return `${Math.max(0, Math.min(100, value)).toFixed(2)}%`;
}

export function parsePercent(value: string | number | null | undefined) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace('%', ''));
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

export function normalizePredictResponse(
  payload: BackendPredictResponse
): NormalizedPredictResponse {
  const aiProbability = clampPercent(
    payload.ai_probability ?? payload.aiProbability ?? parsePercent(payload.confidence)
  );
  const realProbability = clampPercent(
    payload.real_probability ?? payload.realProbability ?? 100 - aiProbability
  );
  const prediction = String(payload.prediction ?? 'UNKNOWN');
  const confidenceValue = clampPercent(parsePercent(payload.confidence));
  const confidence =
    typeof payload.confidence === 'string' && payload.confidence.trim().length > 0
      ? payload.confidence
      : formatPercent(confidenceValue || aiProbability);

  return {
    status: String(payload.status ?? 'success') === 'success' ? 'success' : 'error',
    prediction,
    confidence,
    confidenceValue: confidenceValue || aiProbability,
    message: String(payload.message ?? ''),
    aiProbability,
    realProbability,
    heatmapBase64: (payload.heatmap_base64 ?? payload.heatmapBase64 ?? null) as string | null,
    cvAnalysis: (payload.cv_analysis ?? payload.cvAnalysis ?? null) as unknown[] | null,
    consistency: typeof payload.consistency === 'number' ? payload.consistency : null,
    votes: (payload.votes ?? null) as Record<string, number> | null,
    timeline: (payload.timeline ?? null) as unknown[] | null,
    keyFrameBase64: (payload.key_frame_base64 ?? payload.keyFrameBase64 ?? null) as string | null,
    isVideo: Boolean((payload as { isVideo?: boolean }).isVideo),
  };
}

export function buildFileName(_sourceUrl: string, _altText: string) {
  return 'ai-media-inspector-image.jpg';
}

export function makeRuntimeError(
  code: string,
  message: string,
  details?: string
): RuntimeErrorPayload {
  return { code, message, details };
}

export async function storageGet<T extends Record<string, unknown>>(keys: string[]) {
  return new Promise<T>((resolve) => {
    chrome.storage.local.get(keys, (items: T) => {
      resolve(items);
    });
  });
}

export async function storageSet(items: Record<string, unknown>) {
  return new Promise<void>((resolve) => {
    chrome.storage.local.set(items, () => resolve());
  });
}

export async function storageRemove(keys: string[]) {
  return new Promise<void>((resolve) => {
    chrome.storage.local.remove(keys, () => resolve());
  });
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, value));
}
