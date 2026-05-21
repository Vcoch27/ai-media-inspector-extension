import type { NormalizedPredictResponse } from '../shared/extension-api';

type ScanRequestDetail = {
  src: string;
  alt: string;
  pageUrl: string;
  rect: DOMRectReadOnly;
};

type OverlayMode = 'hidden' | 'scan' | 'processing' | 'result' | 'error';

type DetectRequestMessage = {
  type: 'AI_MEDIA_INSPECTOR_DETECT_IMAGE';
  payload: {
    imageUrl: string;
    imageDataUrl?: string;
    alt: string;
    pageUrl: string;
  };
};

type OpenPopupMessage = {
  type: 'AI_MEDIA_INSPECTOR_OPEN_POPUP';
};

type SyncSessionMessage = {
  type: 'AI_MEDIA_INSPECTOR_SYNC_SESSION';
  payload:
    | {
        action: 'login';
        token: string;
        user: Record<string, unknown> | null;
        backendBaseUrl: string;
      }
    | {
        action: 'logout';
      };
};

type WebAuthSyncMessage = {
  type: 'AI_MEDIA_INSPECTOR_AUTH_SYNC';
  source: 'ai-content-detection-app';
  action: 'login' | 'logout';
  payload?: {
    token?: string;
    user?: Record<string, unknown> | null;
    backendBaseUrl?: string;
  };
};

type BackgroundSuccess<T> = {
  ok: true;
  data: T;
};

type BackgroundFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: string;
  };
};

type DetectResponse = BackgroundSuccess<NormalizedPredictResponse> | BackgroundFailure;

type OverlayError = {
  code: string;
  message: string;
  details?: string;
};

const STORAGE_KEYS = {
  authToken: 'ai-media-inspector-auth-token',
  authUser: 'ai-media-inspector-auth-user',
  backendBaseUrl: 'ai-media-inspector-backend-base-url',
} as const;

// Receive messages from the extension background and forward them into the
// page context so the web app can react to extension-initiated auth syncs.
chrome.runtime?.onMessage?.addListener((message: any, _sender: any, sendResponse: any) => {
  try {
    if (message && message.type === 'AI_MEDIA_INSPECTOR_AUTH_SYNC') {
      const payload = message.payload || {};
      // Post into the page window; page listener will verify __from and type
      window.postMessage(
        {
          __from: 'ai-media-inspector-extension',
          type: 'AI_MEDIA_INSPECTOR_AUTH',
          action: payload.action,
          token: payload.token ?? null,
          user: payload.user ?? null,
          backendBaseUrl: payload.backendBaseUrl ?? null,
        },
        window.location.origin
      );

      sendResponse({ ok: true });
    }
  } catch (err) {
    // ignore
  }

  // Keep message channel open if response will be async (not used here)
  return true;
});

// Listen for messages posted into the page by the web app and forward them
// to the background so the extension can persist the synced session.
window.addEventListener('message', (event) => {
  try {
    const data = event?.data;
    if (!data || data.type !== 'AI_MEDIA_INSPECTOR_AUTH_SYNC') return;
    if (data.source !== 'ai-content-detection-app') return;

    const payload = data.payload || {};

    if (payload.action === 'login') {
      chrome.runtime.sendMessage(
        {
          type: 'AI_MEDIA_INSPECTOR_SYNC_SESSION',
          payload: {
            action: 'login',
            token: payload.token,
            user: payload.user ?? null,
            backendBaseUrl: payload.backendBaseUrl ?? null,
          },
        },
        () => {}
      );
    } else if (payload.action === 'logout') {
      chrome.runtime.sendMessage(
        { type: 'AI_MEDIA_INSPECTOR_SYNC_SESSION', payload: { action: 'logout' } },
        () => {}
      );
    }
  } catch (err) {
    // ignore
  }
});

const TRUSTED_WEB_APP_ORIGIN = import.meta.env.VITE_WEB_APP_ORIGIN || 'http://localhost:5173';
const WEB_AUTH_SYNC_MESSAGE_TYPE = 'AI_MEDIA_INSPECTOR_AUTH_SYNC';
const RUNTIME_SYNC_MESSAGE_TYPE = 'AI_MEDIA_INSPECTOR_SYNC_SESSION';

const ROOT_ID = 'ai-media-inspector-overlay-root';
const SCAN_BUTTON_HEIGHT = 34;
const SCAN_BUTTON_WIDTH = 92;
const PANEL_MIN_WIDTH = 320;
const PANEL_MAX_WIDTH = 420;
const IMAGE_MIN_SIZE = 56;
const HIDE_DELAY_MS = 120;
const DETECTION_TIMEOUT_MS = 45000;

const registeredImages = new WeakSet<HTMLImageElement>();

let overlayHost: HTMLDivElement | null = null;
let overlayButton: HTMLButtonElement | null = null;
let overlayBackdrop: HTMLDivElement | null = null;
let overlayPanel: HTMLElement | null = null;
let panelTitle: HTMLElement | null = null;
let panelEyebrow: HTMLElement | null = null;
let processingState: HTMLElement | null = null;
let resultState: HTMLElement | null = null;
let closeButton: HTMLButtonElement | null = null;
let reportButton: HTMLButtonElement | null = null;
let predictionLabel: HTMLElement | null = null;
let confidenceValue: HTMLElement | null = null;
let aiProbabilityValue: HTMLElement | null = null;
let realProbabilityValue: HTMLElement | null = null;
let aiProbabilityBar: HTMLElement | null = null;
let realProbabilityBar: HTMLElement | null = null;
let sourceLabel: HTMLElement | null = null;
let previewImage: HTMLImageElement | null = null;
let heatmapOverlayImage: HTMLImageElement | null = null;
let heatmapSection: HTMLElement | null = null;
let heatmapOpacityValue: HTMLElement | null = null;
let heatmapOpacityRange: HTMLInputElement | null = null;
let heatmapEmpty: HTMLElement | null = null;
let analysisGrid: HTMLElement | null = null;
let analysisEmpty: HTMLElement | null = null;
let consistencyRow: HTMLElement | null = null;
let consistencyValue: HTMLElement | null = null;
let votesRow: HTMLElement | null = null;
let votesValue: HTMLElement | null = null;
let timelineRow: HTMLElement | null = null;
let timelineValue: HTMLElement | null = null;
let predictionDetail: HTMLElement | null = null;
let confidenceDetail: HTMLElement | null = null;
let errorState: HTMLElement | null = null;
let errorTitle: HTMLElement | null = null;
let errorDetail: HTMLElement | null = null;
let errorCode: HTMLElement | null = null;
let errorPrimaryButton: HTMLButtonElement | null = null;
let errorSecondaryButton: HTMLButtonElement | null = null;

let activeImage: HTMLImageElement | null = null;
let activeMode: OverlayMode = 'hidden';
let activeRequest: ScanRequestDetail | null = null;
let activeResponse: NormalizedPredictResponse | null = null;
let hideTimer: number | undefined;
let processingTimer: number | undefined;
let positionRaf = 0;
let scanActivationInProgress = false;
let heatmapOpacity = 0.7;
let activeError: OverlayError | null = null;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function roundProbability(value: number) {
  return Math.round(value * 100) / 100;
}

function formatPercent(value: number) {
  return `${Math.max(0, Math.min(100, value)).toFixed(2)}%`;
}

function makeRuntimeError(code: string, message: string, details?: string): OverlayError {
  return { code, message, details };
}

function isWebAuthSyncMessage(data: unknown): data is WebAuthSyncMessage {
  if (!data || typeof data !== 'object') {
    return false;
  }

  const message = data as Record<string, unknown>;
  return (
    message.type === WEB_AUTH_SYNC_MESSAGE_TYPE &&
    message.source === 'ai-content-detection-app' &&
    (message.action === 'login' || message.action === 'logout')
  );
}

function forwardAuthSyncToBackground(message: WebAuthSyncMessage) {
  const runtimeMessage: SyncSessionMessage =
    message.action === 'login'
      ? {
          type: RUNTIME_SYNC_MESSAGE_TYPE,
          payload: {
            action: 'login',
            token: String(message.payload?.token || ''),
            user: (message.payload?.user ?? null) as Record<string, unknown> | null,
            backendBaseUrl: String(message.payload?.backendBaseUrl || ''),
          },
        }
      : {
          type: RUNTIME_SYNC_MESSAGE_TYPE,
          payload: {
            action: 'logout',
          },
        };

  chrome.runtime.sendMessage(runtimeMessage, () => {
    const runtimeError = chrome.runtime.lastError;
    if (runtimeError) {
      console.warn('Failed to forward auth sync to background:', runtimeError.message);
    }
  });
}

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window) {
    return;
  }

  if (event.origin !== TRUSTED_WEB_APP_ORIGIN) {
    return;
  }

  if (!isWebAuthSyncMessage(event.data)) {
    return;
  }

  forwardAuthSyncToBackground(event.data);
});

async function storageGet<T extends Record<string, unknown>>(keys: string[]) {
  return new Promise<T>((resolve) => {
    chrome.storage.local.get(keys, (items: T) => {
      resolve(items);
    });
  });
}

function getErrorCopy(error: OverlayError) {
  if (error.code === 'UNAUTHORIZED') {
    return {
      title: 'Sign in required',
      description: error.message,
      primaryAction: 'Open Login',
      secondaryAction: 'Close',
    };
  }

  return {
    title: 'Detection failed',
    description: error.details ? `${error.message} ${error.details}` : error.message,
    primaryAction: 'Retry',
    secondaryAction: 'Close',
  };
}

function getPredictionLabel(response: NormalizedPredictResponse) {
  const normalizedPrediction = response.prediction.toUpperCase();
  const looksAI = normalizedPrediction.includes('AI') || normalizedPrediction.includes('GENERATED');

  return looksAI ? 'AI-Generated Content' : 'Authentic Content';
}

function isUnauthorizedError(error: OverlayError) {
  return error.code === 'UNAUTHORIZED' || error.code === 'HTTP_401';
}

function setTextContent(element: HTMLElement | null, value: string) {
  if (element) {
    element.textContent = value;
  }
}

function normalizeAnalysisItem(item: unknown) {
  const source = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
  const category = String(
    source.category ?? source.feature_name ?? source.featureName ?? 'Feature'
  );
  const name = String(source.feature_name ?? source.featureName ?? source.label ?? category);
  const description = String(
    source.description ?? source.details ?? 'No extra description provided.'
  );
  const rawScore = Number(source.impact_score ?? source.impactScore ?? source.score ?? 0);
  const score = Number.isFinite(rawScore) ? rawScore : 0;

  return { category, name, description, score };
}

function normalizeHeatmapData(response: NormalizedPredictResponse) {
  // Support multiple possible backend fields (`heatmapBase64`, `heatmap_base64`, or nested).
  const raw =
    (response as any).heatmapBase64 ??
    (response as any).heatmap_base64 ??
    (response as any).heatmap?.base64 ??
    (response as any).heatmap?.data ??
    (response as any).heatmap_bytes ??
    '';

  if (!raw) return '';
  const str = String(raw || '').trim();
  if (!str) return '';
  // If it's already a data URL, or a blob/http url, return as-is
  if (str.startsWith('data:') || str.startsWith('blob:') || str.startsWith('http')) return str;

  // If the backend used URL-safe base64 or included newlines, trim them
  const cleaned = str.replace(/\s+/g, '');
  return `data:image/png;base64,${cleaned}`;
}

function renderCvAnalysis(response: NormalizedPredictResponse) {
  if (!analysisGrid || !analysisEmpty) {
    return;
  }

  analysisGrid?.replaceChildren();

  const allItems = Array.isArray(response.cvAnalysis) ? response.cvAnalysis : [];
  if (allItems.length === 0) {
    analysisEmpty.hidden = false;
    return;
  }

  analysisEmpty.hidden = true;

  // Compact view: show top 3 items with short description, preserve data for full report
  const list = document.createElement('ul');
  list.className = 'analysis-compact-list';

  const topItems = allItems.slice(0, 3);
  topItems.forEach((item) => {
    const normalized = normalizeAnalysisItem(item);

    const li = document.createElement('li');
    li.className = 'analysis-compact-item';

    const meta = document.createElement('div');
    meta.className = 'analysis-compact-item__meta';
    meta.textContent = normalized.name;

    const score = document.createElement('div');
    score.className = 'analysis-compact-item__score';
    score.textContent = `${Math.round(normalized.score)}%`;

    li.append(meta, score);

    list.append(li);
  });

  analysisGrid.append(list);

  if (allItems.length > topItems.length) {
    const moreWrap = document.createElement('div');
    moreWrap.style.display = 'flex';
    moreWrap.style.justifyContent = 'flex-end';
    moreWrap.style.marginTop = '8px';

    const moreBtn = document.createElement('button');
    moreBtn.className = 'action-button action-button--secondary';
    moreBtn.type = 'button';
    moreBtn.textContent = 'See full analysis';
    moreBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (reportButton) {
        try {
          reportButton.click();
        } catch (err) {
          // fallback: dispatch report-request on the active image
          if (activeImage && activeRequest && activeResponse) {
            activeImage.dispatchEvent(
              new CustomEvent('ai-media-inspector:report-request', {
                detail: { request: activeRequest, response: activeResponse },
                bubbles: true,
                composed: true,
              })
            );
          }
        }
      }
    });

    moreWrap.append(moreBtn);
    analysisGrid.append(moreWrap);
  }
}

function syncVideoMetrics(response: NormalizedPredictResponse) {
  if (consistencyValue) {
    consistencyValue.textContent =
      typeof response.consistency === 'number' ? `${Math.round(response.consistency)}%` : 'N/A';
  }

  if (votesValue) {
    const aiVotes = response.votes?.AI ?? 0;
    const realVotes = response.votes?.REAL ?? 0;
    votesValue.textContent = `AI ${aiVotes} / Real ${realVotes}`;
  }

  if (timelineValue) {
    timelineValue.textContent = Array.isArray(response.timeline)
      ? `${response.timeline.length} frame${response.timeline.length === 1 ? '' : 's'}`
      : 'N/A';
  }
}

function syncHeatmapPreview(response: NormalizedPredictResponse) {
  if (previewImage) {
    previewImage.src = activeRequest?.src || activeImage?.currentSrc || activeImage?.src || '';
  }

  const heatmapUrl = normalizeHeatmapData(response);

  if (heatmapOverlayImage) {
    // Hide overlay while loading a new image to avoid visual glitches
    heatmapOverlayImage.hidden = true;
    heatmapOverlayImage.style.opacity = String(heatmapOpacity);

    // Clean up previous handlers
    heatmapOverlayImage.onload = null;
    heatmapOverlayImage.onerror = null;

    if (heatmapUrl) {
      const img = heatmapOverlayImage;
      if (img) {
        img.onload = () => {
          img.hidden = false;
          if (heatmapEmpty) heatmapEmpty.hidden = true;
          requestPositionUpdate();
        };

        img.onerror = () => {
          img.hidden = true;
          if (heatmapEmpty) heatmapEmpty.hidden = false;
        };

        // Start loading
        img.src = heatmapUrl;
      } else {
        if (heatmapEmpty) heatmapEmpty.hidden = false;
      }
    } else {
      if (heatmapOverlayImage) {
        heatmapOverlayImage.src = '';
        if (heatmapEmpty) heatmapEmpty.hidden = false;
      }
    }
  }

  if (heatmapOpacityValue) {
    heatmapOpacityValue.textContent = `${Math.round(heatmapOpacity * 100)}%`;
  }

  if (heatmapOpacityRange) {
    heatmapOpacityRange.value = String(heatmapOpacity);
  }
}

function runtimeMessage<T>(message: DetectRequestMessage | OpenPopupMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: T) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      resolve(response);
    });
  });
}

function requestDetection(request: DetectRequestMessage) {
  return runtimeMessage<DetectResponse>(request);
}

function requestPopupOpen() {
  return runtimeMessage<BackgroundSuccess<{ opened: boolean }> | BackgroundFailure>({
    type: 'AI_MEDIA_INSPECTOR_OPEN_POPUP',
  });
}

function ensureOverlay() {
  if (overlayHost && overlayButton && overlayPanel) {
    return;
  }

  overlayHost = document.createElement('div');
  overlayHost.id = ROOT_ID;
  overlayHost.setAttribute('aria-hidden', 'true');
  overlayHost.style.position = 'fixed';
  overlayHost.style.left = '0';
  overlayHost.style.top = '0';
  overlayHost.style.width = '0';
  overlayHost.style.height = '0';
  overlayHost.style.zIndex = '2147483647';
  // Allow the overlay host to receive pointer events so we can handle
  // transitions between the image and overlay without click-through.
  overlayHost.style.pointerEvents = 'auto';

  const shadowRoot = overlayHost.attachShadow({ mode: 'open' });
  shadowRoot.innerHTML = `
    <style>
      :host {
        all: initial;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        --overlay-left: 0px;
        --overlay-top: 0px;
        --overlay-width: 360px;
      }

      * {
        box-sizing: border-box;
      }

      .scan-button,
      .backdrop,
      .panel {
        position: fixed;
      }

      .backdrop {
        inset: 0;
        background: radial-gradient(circle at top left, rgba(37, 99, 235, 0.14), transparent 38%),
          rgba(15, 23, 42, 0.16);
        backdrop-filter: blur(4px);
        opacity: 0;
        visibility: hidden;
        transition: opacity 160ms ease, visibility 160ms ease;
        pointer-events: none;
      }

      .scan-button {
        left: var(--overlay-left);
        top: var(--overlay-top);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        min-width: ${SCAN_BUTTON_WIDTH}px;
        height: ${SCAN_BUTTON_HEIGHT}px;
        padding: 0 12px;
        border: 1px solid rgba(37, 99, 235, 0.24);
        border-radius: 999px;
        background: linear-gradient(135deg, #2563eb, #1d4ed8);
        color: #eff6ff;
        font: 700 12px/1.1 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        letter-spacing: 0.03em;
        box-shadow: 0 16px 30px rgba(37, 99, 235, 0.28);
        opacity: 0;
        visibility: hidden;
        transform: translateY(-4px) scale(0.98);
        transition: opacity 120ms ease, transform 120ms ease, visibility 120ms ease;
        cursor: pointer;
      }

      .scan-button[data-visible='true'] {
        opacity: 1;
        visibility: visible;
        transform: translateY(0) scale(1);
      }

      .backdrop[data-visible='true'] {
        opacity: 1;
        visibility: visible;
      }

      .scan-button::before {
        content: '✦';
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.14);
        color: #fef3c7;
        font-size: 10px;
        line-height: 1;
      }

      .panel {
        left: var(--overlay-left);
        top: var(--overlay-top);
        width: max-content;
        min-width: min(var(--overlay-width), calc(100vw - 16px));
        max-width: min(520px, calc(100vw - 16px));
        max-height: calc(85vh - 20px);
        padding: 12px;
        border: 1px solid rgba(203, 213, 225, 0.9);
        border-radius: 16px;
        background:
          radial-gradient(circle at top left, rgba(37, 99, 235, 0.06), transparent 28%),
          linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 252, 0.96));
        color: #0f172a;
        box-shadow: 0 18px 46px rgba(15, 23, 42, 0.14), 0 6px 14px rgba(37, 99, 235, 0.08);
        backdrop-filter: blur(12px);
        opacity: 0;
        visibility: hidden;
        transform: translateY(6px) scale(0.99);
        transition: opacity 160ms ease, transform 160ms ease, visibility 160ms ease;
        overflow: auto;
      }

      .panel[data-visible='true'] {
        opacity: 1;
        visibility: visible;
        transform: translateY(0) scale(1);
      }

      .panel[data-mode='processing'] .processing-state,
      .panel[data-mode='result'] .result-state,
      .panel[data-mode='error'] .error-state {
        display: flex;
      }

      .panel[data-mode='processing'] .result-state,
      .panel[data-mode='processing'] .error-state,
      .panel[data-mode='result'] .processing-state,
      .panel[data-mode='result'] .error-state,
      .panel[data-mode='error'] .processing-state,
      .panel[data-mode='error'] .result-state {
        display: none;
      }

      .panel-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 14px;
      }

      .eyebrow {
        margin: 0 0 6px;
        color: #2563eb;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }

      .panel-title {
        margin: 0;
        font-size: 18px;
        font-weight: 700;
        line-height: 1.2;
        color: #0f172a;
      }

      .icon-button {
        width: 32px;
        height: 32px;
        border: 0;
        border-radius: 10px;
        background: rgba(15, 23, 42, 0.06);
        color: #475569;
        font-size: 18px;
        line-height: 1;
        cursor: pointer;
      }

      .processing-state,
      .result-state {
        display: none;
        flex-direction: column;
        gap: 14px;
      }

      .result-state {
        animation: fade-up 180ms ease;
        gap: 16px;
      }

      .processing-state {
        align-items: center;
        padding: 20px 8px 10px;
        text-align: center;
      }

      .error-state {
        display: none;
        flex-direction: column;
        gap: 14px;
      }

      .error-shell {
        padding: 18px;
        border-radius: 20px;
        border: 1px solid rgba(254, 202, 202, 0.9);
        background: linear-gradient(180deg, rgba(255, 241, 242, 0.98), rgba(255, 255, 255, 0.98));
      }

      .error-copy {
        margin: 0;
        color: #991b1b;
        font-size: 15px;
        font-weight: 700;
        line-height: 1.5;
      }

      .error-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .error-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 7px 10px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.92);
        border: 1px solid rgba(254, 202, 202, 0.95);
        color: #b91c1c;
        font-size: 12px;
        font-weight: 700;
      }

      .spinner {
        width: 46px;
        height: 46px;
        border-radius: 999px;
        border: 3px solid rgba(37, 99, 235, 0.14);
        border-top-color: #2563eb;
        animation: spin 900ms linear infinite;
      }

      .processing-copy {
        margin: 0;
        font-size: 16px;
        font-weight: 700;
      }

      .subcopy,
      .source-copy,
      .detail-label,
      .metric-label,
      .metric-value,
      .footer-hint {
        margin: 0;
        color: #475569;
      }

      .subcopy,
      .source-copy,
      .footer-hint {
        font-size: 13px;
        line-height: 1.5;
      }

      .result-banner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 8px 10px;
        border-radius: 12px;
        background: linear-gradient(135deg, rgba(250, 252, 255, 0.98), rgba(245, 248, 255, 0.95));
        border: 1px solid rgba(220, 230, 245, 0.9);
      }

      .result-banner__title {
        margin: 0 0 2px;
        font-size: 16px;
        font-weight: 700;
        color: #0f172a;
        line-height: 1.1;
      }

      .result-banner__subtitle {
        margin: 0;
        color: #334155;
        font-size: 13px;
      }

      .status-chip {
        padding: 6px 8px;
        border-radius: 999px;
        background: rgba(239, 68, 68, 0.12);
        color: #b91c1c;
        border: 1px solid rgba(239, 68, 68, 0.12);
        font-size: 12px;
        font-weight: 700;
        white-space: nowrap;
      }

      .confidence-card {
        padding: 10px;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.96);
        border: 1px solid rgba(226, 232, 240, 0.95);
      }

      .heatmap-section,
      .analysis-section {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 14px;
        border-radius: 18px;
        background: rgba(15, 23, 42, 0.96);
        color: #f8fafc;
        border: 1px solid rgba(96, 165, 250, 0.16);
      }

      .heatmap-header,
      .analysis-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
      }

      .heatmap-kicker,
      .analysis-kicker {
        margin: 0 0 4px;
        color: #93c5fd;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }

      .heatmap-title,
      .analysis-title {
        margin: 0;
        color: #f8fafc;
        font-size: 15px;
        font-weight: 700;
        line-height: 1.2;
      }

      .heatmap-copy,
      .analysis-copy {
        margin: 4px 0 0;
        color: #cbd5e1;
        font-size: 12px;
        line-height: 1.45;
      }

      .heatmap-badge {
        padding: 7px 10px;
        border-radius: 999px;
        background: rgba(147, 197, 253, 0.14);
        border: 1px solid rgba(147, 197, 253, 0.2);
        color: #dbeafe;
        font-size: 11px;
        font-weight: 700;
        white-space: nowrap;
      }

      .heatmap-stage {
        position: relative;
        overflow: hidden;
        border-radius: 16px;
        background: radial-gradient(circle at top left, rgba(37, 99, 235, 0.24), transparent 30%),
          rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(148, 163, 184, 0.16);
        aspect-ratio: 16 / 10;
        min-height: 180px;
      }

      .heatmap-stage__image,
      .heatmap-stage__overlay {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: contain;
        object-position: center;
        display: block;
      }

      .heatmap-stage__overlay {
        pointer-events: none;
        mix-blend-mode: multiply;
      }

      .heatmap-stage__empty {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        color: #cbd5e1;
        font-size: 13px;
        text-align: center;
      }

      .heatmap-controls {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }

      .heatmap-controls__label {
        margin: 0;
        color: #93c5fd;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        white-space: nowrap;
      }

      .heatmap-controls__value {
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.08);
        color: #e2e8f0;
        font-size: 11px;
        font-weight: 700;
        white-space: nowrap;
      }

      .heatmap-controls__range {
        width: 100%;
        accent-color: #60a5fa;
      }

      .heatmap-legend {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }

      .legend-chip {
        padding: 8px 10px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(148, 163, 184, 0.16);
        text-align: center;
      }

      .legend-chip__label {
        margin: 0;
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }

      .legend-chip__copy {
        margin: 2px 0 0;
        color: #cbd5e1;
        font-size: 10px;
        line-height: 1.4;
      }

      .analysis-section {
        background: linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(17, 24, 39, 0.98));
      }

      .analysis-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }

      .analysis-card {
        padding: 12px;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(148, 163, 184, 0.16);
      }

      .analysis-card__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }

      .analysis-card__meta {
        display: inline-flex;
        align-items: center;
        padding: 5px 8px;
        border-radius: 999px;
        background: rgba(37, 99, 235, 0.12);
        color: #bfdbfe;
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .analysis-card__score {
        color: #f8fafc;
        font-size: 14px;
        font-weight: 800;
      }

      .analysis-card__title {
        margin: 8px 0 0;
        color: #f8fafc;
        font-size: 13px;
        font-weight: 700;
        line-height: 1.35;
      }

      .analysis-card__copy {
        margin: 6px 0 0;
        color: #cbd5e1;
        font-size: 11px;
        line-height: 1.45;
      }

      .analysis-card__bar {
        height: 8px;
        margin-top: 10px;
        overflow: hidden;
        border-radius: 999px;
        background: rgba(148, 163, 184, 0.18);
      }

      .analysis-card__bar-fill {
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, #60a5fa, #22c55e);
      }

      .analysis-empty {
        padding: 12px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px dashed rgba(148, 163, 184, 0.22);
        color: #cbd5e1;
        font-size: 12px;
        line-height: 1.45;
      }

      .confidence-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 10px;
      }

      .confidence-title {
        margin: 0;
        color: #0f172a;
        font-size: 13px;
        font-weight: 700;
      }

      .confidence-note {
        margin: 2px 0 0;
        color: #64748b;
        font-size: 12px;
        line-height: 1.4;
      }

      .confidence-track {
        display: flex;
        height: 12px;
        overflow: hidden;
        border-radius: 999px;
        background: rgba(226, 232, 240, 0.95);
      }

      .confidence-fill {
        height: 100%;
        min-width: 0;
        transition: width 260ms ease;
      }

      .confidence-fill--ai {
        background: #ef4444;
      }

      .confidence-fill--real {
        background: #22c55e;
      }

      .confidence-stats {
        position: relative;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
        margin-top: 12px;
      }

      .confidence-stat {
        padding: 10px 12px;
        border-radius: 14px;
        background: rgba(248, 250, 252, 0.96);
        border: 1px solid rgba(226, 232, 240, 0.95);
      }

      .confidence-stat__label {
        margin: 0;
        color: #64748b;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .confidence-stat__value {
        margin: 4px 0 0;
        color: #0f172a;
        font-size: 16px;
        font-weight: 700;
      }

      .footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-top: 14px;
        flex-wrap: wrap;
      }

      .footer-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .footer-actions--error,
      .footer-actions--result {
        display: flex;
      }

      .panel[data-mode='processing'] .footer-actions--error,
      .panel[data-mode='processing'] .footer-actions--result {
        display: none;
      }

      .panel[data-mode='error'] .footer-actions--result {
        display: none;
      }

      .panel[data-mode='result'] .footer-actions--error {
        display: none;
      }

      .action-button {
        height: 36px;
        padding: 0 14px;
        border: 1px solid transparent;
        border-radius: 12px;
        font: 600 13px/1 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        cursor: pointer;
      }

      .action-button--primary {
        background: linear-gradient(135deg, #2563eb, #1d4ed8);
        color: #eff6ff;
      }

      .action-button--secondary {
        background: rgba(15, 23, 42, 0.04);
        color: #334155;
        border-color: rgba(148, 163, 184, 0.22);
      }

      .analysis-note {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 14px;
        border-radius: 14px;
        background: rgba(248, 250, 252, 0.98);
        border: 1px solid rgba(226, 232, 240, 0.95);
      }

      .analysis-note__label {
        margin: 0;
        color: #64748b;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        white-space: nowrap;
      }

      .analysis-note__text {
        margin: 0;
        color: #334155;
        font-size: 13px;
        line-height: 1.45;
      }

      .details-list {
        display: grid;
        gap: 8px;
      }

      .details-section {
        display: grid;
        gap: 8px;
      }

      .detail-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 12px;
        border-radius: 12px;
        background: rgba(248, 250, 252, 0.96);
        border: 1px solid rgba(226, 232, 240, 0.95);
      }

      .detail-label {
        font-size: 12px;
        font-weight: 600;
      }

      .detail-value {
        font-size: 13px;
        font-weight: 700;
        color: #0f172a;
      }

      .processing-shell {
        padding: 18px;
        border-radius: 20px;
        border: 1px solid rgba(191, 219, 254, 0.8);
        background: linear-gradient(180deg, rgba(239, 246, 255, 0.95), rgba(255, 255, 255, 0.98));
      }

      .processing-state .subcopy {
        max-width: 28ch;
      }

      .result-state {
        min-width: 0;
      }

      .confidence-card,
      .analysis-note,
      .details-list,
      .footer {
        min-width: 0;
      }

      .result-banner,
      .confidence-header,
      .confidence-stat,
      .detail-row {
        min-width: 0;
      }

      .result-banner__subtitle,
      .confidence-note,
      .analysis-note__text,
      .footer-hint {
        overflow-wrap: anywhere;
      }

      .footer-hint {
        flex: 1 1 220px;
      }

      @media (max-width: 360px) {
        .confidence-stats {
          grid-template-columns: 1fr;
        }

        .footer {
          align-items: flex-start;
        }
      }

      @keyframes fade-up {
        from {
          opacity: 0;
          transform: translateY(6px);
        }

        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @keyframes spin {
        from {
          transform: rotate(0deg);
        }

        to {
          transform: rotate(360deg);
        }
      }
    </style>

    <button class="scan-button" type="button" aria-label="Scan this image">AI Scan</button>

    <div class="backdrop" aria-hidden="true"></div>

    <section class="panel" data-mode="processing" data-visible="false" aria-live="polite">
      <div class="panel-header">
        <div>
          <p class="eyebrow" id="panel-eyebrow">AI content detector</p>
          <h2 class="panel-title" id="panel-title">Running AI detection...</h2>
        </div>
        <button class="icon-button" type="button" aria-label="Close scan overlay">×</button>
      </div>

      <div class="processing-state">
        <div class="processing-shell">
          <div class="spinner" aria-hidden="true"></div>
          <p class="processing-copy">Analyzing media...</p>
          <p class="subcopy">Uploading the selected image to your local backend for a real prediction.</p>
        </div>
      </div>

      <div class="error-state">
        <div class="error-shell">
          <p class="error-copy" id="error-title">Detection failed</p>
          <p class="subcopy" id="error-detail">We could not complete the request.</p>
          <div class="error-meta">
            <span class="error-chip" id="error-code">NETWORK_ERROR</span>
          </div>
        </div>
      </div>

      <div class="result-state">
        <div class="result-banner">
          <div>
            <p class="result-banner__title" id="prediction-label">Likely AI-generated</p>
            <p class="result-banner__subtitle" id="source-label">Waiting for prediction.</p>
          </div>
          <div class="status-chip" id="confidence-value">Confidence 87.00%</div>
        </div>

        <div class="confidence-card">
          <div class="confidence-header">
            <div>
              <p class="confidence-title">Confidence split</p>
              <p class="confidence-note">The main conclusion stays first, with the AI vs real probability split underneath.</p>
            </div>
          </div>

          <div class="confidence-track" aria-hidden="true">
            <div class="confidence-fill confidence-fill--ai" id="ai-probability-bar" style="width: 87%;"></div>
            <div class="confidence-fill confidence-fill--real" id="real-probability-bar" style="width: 13%;"></div>
          </div>

          <div class="confidence-stats">
            <div class="confidence-stat">
              <p class="confidence-stat__label">AI likelihood</p>
              <p class="confidence-stat__value" id="ai-probability-value">87.00%</p>
            </div>
            <div class="confidence-stat">
              <p class="confidence-stat__label">Real likelihood</p>
              <p class="confidence-stat__value" id="real-probability-value">13.00%</p>
            </div>
          </div>
        </div>

        <section class="heatmap-section" id="heatmap-section">
          <div class="heatmap-header">
            <div>
              <p class="heatmap-kicker">Grad-CAM Visual Analysis</p>
              <h3 class="heatmap-title">Heatmap overlay</h3>
              <p class="heatmap-copy">Move the slider to inspect the regions most impacting the result.</p>
            </div>
            <div class="heatmap-badge" id="heatmap-opacity-value">70%</div>
          </div>

          <div class="heatmap-stage" id="heatmap-stage">
            <img class="heatmap-stage__image" id="preview-image" alt="Detected media preview" />
            <img class="heatmap-stage__overlay" id="heatmap-overlay-image" alt="Grad-CAM heatmap overlay" />
            <div class="heatmap-stage__empty" id="heatmap-empty">Waiting for a heatmap from the backend.</div>
          </div>

          <div class="heatmap-controls">
            <p class="heatmap-controls__label">Opacity</p>
            <div class="heatmap-controls__value" id="heatmap-opacity-display">70%</div>
            <input
              class="heatmap-controls__range"
              id="heatmap-opacity-range"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value="0.7"
            />
          </div>

          <div class="heatmap-legend">
            <div class="legend-chip">
              <p class="legend-chip__label" style="color: #f87171;">Red Zone</p>
              <p class="legend-chip__copy">High impact</p>
            </div>
            <div class="legend-chip">
              <p class="legend-chip__label" style="color: #facc15;">Yellow Zone</p>
              <p class="legend-chip__copy">Medium impact</p>
            </div>
            <div class="legend-chip">
              <p class="legend-chip__label" style="color: #60a5fa;">Blue Zone</p>
              <p class="legend-chip__copy">Low impact</p>
            </div>
          </div>
        </section>

        <section class="analysis-section">
          <div class="analysis-header">
            <div>
              <p class="analysis-kicker">Feature Analysis</p>
              <h3 class="analysis-title">Backend explanation signals</h3>
              <p class="analysis-copy">Top supporting signals returned by the model are summarized below.</p>
            </div>
          </div>

          <div class="analysis-grid" id="analysis-grid"></div>
          <div class="analysis-empty" id="analysis-empty">No CV analysis details were returned for this prediction.</div>
        </section>

        <div class="analysis-note">
          <p class="analysis-note__label">Why this result</p>
          <p class="analysis-note__text" id="confidence-detail">Waiting for the backend response.</p>
        </div>

        <div class="details-section">
          <div class="detail-row">
            <span class="detail-label">Prediction</span>
            <span class="detail-value" id="prediction-detail">AI-GENERATED</span>
          </div>
          <div class="detail-row" id="consistency-row" style="display: none;">
            <span class="detail-label">Consistency</span>
            <span class="detail-value" id="consistency-value">N/A</span>
          </div>
          <div class="detail-row" id="votes-row" style="display: none;">
            <span class="detail-label">Video votes</span>
            <span class="detail-value" id="votes-value">N/A</span>
          </div>
          <div class="detail-row" id="timeline-row" style="display: none;">
            <span class="detail-label">Timeline</span>
            <span class="detail-value" id="timeline-value">N/A</span>
          </div>
        </div>
      </div>

      <div class="footer">
        <p class="footer-hint">The overlay shows the summary result only. Open the popup for login and settings.</p>
        <div class="footer-actions footer-actions--error">
          <button class="action-button action-button--secondary" type="button" id="error-secondary-button">Close</button>
          <button class="action-button action-button--primary" type="button" id="error-primary-button">Open Login</button>
        </div>
        <div class="footer-actions footer-actions--result">
          <button class="action-button action-button--secondary" type="button" id="report-button">View Full Report</button>
          <button class="action-button action-button--primary" type="button" id="close-button">Close</button>
        </div>
      </div>
    </section>
  `;

  overlayButton = shadowRoot.querySelector('.scan-button');
  overlayBackdrop = shadowRoot.querySelector('.backdrop');
  overlayPanel = shadowRoot.querySelector('.panel');
  panelTitle = shadowRoot.querySelector('#panel-title');
  panelEyebrow = shadowRoot.querySelector('#panel-eyebrow');
  processingState = shadowRoot.querySelector('.processing-state');
  errorState = shadowRoot.querySelector('.error-state');
  errorTitle = shadowRoot.querySelector('#error-title');
  errorDetail = shadowRoot.querySelector('#error-detail');
  errorCode = shadowRoot.querySelector('#error-code');
  errorPrimaryButton = shadowRoot.querySelector('#error-primary-button');
  errorSecondaryButton = shadowRoot.querySelector('#error-secondary-button');
  resultState = shadowRoot.querySelector('.result-state');
  closeButton = shadowRoot.querySelector('#close-button');
  reportButton = shadowRoot.querySelector('#report-button');
  predictionLabel = shadowRoot.querySelector('#prediction-label');
  confidenceValue = shadowRoot.querySelector('#confidence-value');
  aiProbabilityValue = shadowRoot.querySelector('#ai-probability-value');
  realProbabilityValue = shadowRoot.querySelector('#real-probability-value');
  aiProbabilityBar = shadowRoot.querySelector('#ai-probability-bar');
  realProbabilityBar = shadowRoot.querySelector('#real-probability-bar');
  sourceLabel = shadowRoot.querySelector('#source-label');
  heatmapSection = shadowRoot.querySelector('#heatmap-section');
  previewImage = shadowRoot.querySelector('#preview-image');
  heatmapOverlayImage = shadowRoot.querySelector('#heatmap-overlay-image');
  heatmapOpacityValue = shadowRoot.querySelector('#heatmap-opacity-value');
  heatmapOpacityRange = shadowRoot.querySelector('#heatmap-opacity-range');
  heatmapEmpty = shadowRoot.querySelector('#heatmap-empty');
  // User requested: remove heatmap display from overlay entirely.
  if (heatmapSection) {
    heatmapSection.remove();
    // Clear references so subsequent logic won't try to access heatmap nodes.
    previewImage = null;
    heatmapOverlayImage = null;
    heatmapOpacityValue = null;
    heatmapOpacityRange = null;
    heatmapEmpty = null;
    heatmapSection = null;
  }
  analysisGrid = shadowRoot.querySelector('#analysis-grid');
  analysisEmpty = shadowRoot.querySelector('#analysis-empty');
  consistencyRow = shadowRoot.querySelector('#consistency-row');
  consistencyValue = shadowRoot.querySelector('#consistency-value');
  votesRow = shadowRoot.querySelector('#votes-row');
  votesValue = shadowRoot.querySelector('#votes-value');
  timelineRow = shadowRoot.querySelector('#timeline-row');
  timelineValue = shadowRoot.querySelector('#timeline-value');
  predictionDetail = shadowRoot.querySelector('#prediction-detail');
  confidenceDetail = shadowRoot.querySelector('#confidence-detail');

  heatmapOpacityRange?.addEventListener('input', () => {
    const slider = heatmapOpacityRange;
    if (!slider) {
      return;
    }

    const nextValue = clamp(Number(slider.value || 0.7), 0, 1);
    heatmapOpacity = nextValue;

    if (heatmapOverlayImage) {
      heatmapOverlayImage.style.opacity = String(nextValue);
    }

    const percent = `${Math.round(nextValue * 100)}%`;
    if (heatmapOpacityValue) {
      heatmapOpacityValue.textContent = percent;
    }
  });

  overlayButton?.addEventListener('mouseenter', cancelHideOverlay);
  overlayButton?.addEventListener('mouseleave', handleOverlayMouseLeave);
  // Make pointerdown cancel any pending hide immediately and capture the pointer
  // so small pointer moves don't trigger a mouseleave that hides the scan button
  overlayButton?.addEventListener('pointerdown', (e: PointerEvent) => {
    try {
      e.preventDefault();
      e.stopPropagation();
    } catch (err) {
      // ignore
    }

    cancelHideOverlay();

    try {
      overlayButton?.setPointerCapture?.(e.pointerId);
    } catch (err) {
      // ignore if not supported
    }

    // Use the inline handler to ensure cancelHideOverlay runs before any
    // scheduled hide timers.
    handleScanPointerDown(e);
  });

  overlayButton?.addEventListener('pointerup', (e: PointerEvent) => {
    try {
      overlayButton?.releasePointerCapture?.(e.pointerId);
    } catch (err) {
      // ignore
    }
  });

  overlayButton?.addEventListener('click', handleScanClick);
  closeButton?.addEventListener('click', closeOverlay);
  reportButton?.addEventListener('click', handleFullReportClick);
  errorSecondaryButton?.addEventListener('click', closeOverlay);
  errorPrimaryButton?.addEventListener('click', async () => {
    if (!activeError) {
      return;
    }

    if (isUnauthorizedError(activeError)) {
      const popupResponse = await requestPopupOpen().catch(() => null);
      if (!popupResponse || !popupResponse.ok) {
        debugLog('popup open failed', popupResponse);
      }
      return;
    }

    if (!activeImage || !activeRequest) {
      return;
    }

    showProcessingOverlay(activeImage, activeRequest);
    try {
      const prediction = await runBackendDetection(activeRequest);
      showResultOverlay(prediction);
    } catch (error) {
      const resolvedError =
        error && typeof error === 'object' && 'code' in error && 'message' in error
          ? (error as OverlayError)
          : makeRuntimeError(
              'NETWORK_ERROR',
              'Unable to complete the detection request',
              error instanceof Error ? error.message : String(error)
            );

      showErrorOverlay(resolvedError);
    }
  });

  // The header close icon uses the class 'icon-button' (no id). Ensure it
  // also closes the overlay.
  const headerClose = shadowRoot.querySelector('.icon-button');
  if (headerClose) {
    headerClose.addEventListener('click', (e: Event) => {
      const me = e as MouseEvent;
      try {
        me.preventDefault();
        me.stopPropagation();
      } catch (err) {
        // ignore
      }

      closeOverlay();
    });
  }

  // Prevent clicks/pointer events inside overlay from reaching the page
  // underneath (avoids click-through to underlying images/links).
  overlayBackdrop?.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
  });
  overlayBackdrop?.addEventListener('click', (e) => {
    e.stopPropagation();
  });
  overlayPanel?.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
  });
  overlayPanel?.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  (document.body ?? document.documentElement).appendChild(overlayHost);
}

// Debug helpers
function debugLog(...args: any[]) {
  try {
    // eslint-disable-next-line no-console
    console.debug('[AI-Inspector]', ...args);
  } catch (e) {
    // ignore
  }
}

function setOverlayMode(mode: OverlayMode) {
  activeMode = mode;

  debugLog('setOverlayMode', mode);

  if (!overlayHost || !overlayButton || !overlayPanel) {
    return;
  }

  overlayPanel.dataset.mode = mode;
  overlayPanel.dataset.visible =
    mode === 'processing' || mode === 'result' || mode === 'error' ? 'true' : 'false';
  overlayButton.dataset.visible = mode === 'scan' ? 'true' : 'false';

  if (overlayBackdrop) {
    overlayBackdrop.dataset.visible =
      mode === 'processing' || mode === 'result' || mode === 'error' ? 'true' : 'false';
  }
}

function isEligibleImage(image: HTMLImageElement) {
  if (!image.isConnected) {
    return false;
  }

  const rect = image.getBoundingClientRect();
  if (rect.width < IMAGE_MIN_SIZE || rect.height < IMAGE_MIN_SIZE) {
    return false;
  }

  if (rect.bottom <= 0 || rect.right <= 0) {
    return false;
  }

  const computed = window.getComputedStyle(image);
  return (
    computed.display !== 'none' && computed.visibility !== 'hidden' && computed.opacity !== '0'
  );
}

function updateOverlayPosition() {
  if (!activeImage || !overlayHost) {
    return;
  }

  const rect = activeImage.getBoundingClientRect();
  if (rect.width < IMAGE_MIN_SIZE || rect.height < IMAGE_MIN_SIZE) {
    closeOverlay();
    return;
  }

  if (activeMode === 'scan') {
    const left = clamp(
      rect.right - SCAN_BUTTON_WIDTH - 10,
      8,
      Math.max(8, window.innerWidth - SCAN_BUTTON_WIDTH - 8)
    );
    const top = clamp(rect.top + 10, 8, Math.max(8, window.innerHeight - SCAN_BUTTON_HEIGHT - 8));
    debugLog('updateOverlayPosition scan', { left, top, rect });

    overlayHost.style.setProperty('--overlay-left', `${left}px`);
    overlayHost.style.setProperty('--overlay-top', `${top}px`);
    return;
  }

  const panelWidth = clamp(
    Math.max(rect.width * 0.95, PANEL_MIN_WIDTH),
    PANEL_MIN_WIDTH,
    Math.min(PANEL_MAX_WIDTH, window.innerWidth - 16)
  );
  const panelHeight = overlayPanel?.getBoundingClientRect().height || 360;
  const centeredLeft = rect.left + rect.width / 2 - panelWidth / 2;
  const centeredTop = rect.top + rect.height / 2 - panelHeight / 2;
  const left = clamp(centeredLeft, 8, Math.max(8, window.innerWidth - panelWidth - 8));
  const top = clamp(centeredTop, 8, Math.max(8, window.innerHeight - panelHeight - 8));

  overlayHost.style.setProperty('--overlay-left', `${left}px`);
  overlayHost.style.setProperty('--overlay-top', `${top}px`);
  overlayHost.style.setProperty('--overlay-width', `${panelWidth}px`);
  debugLog('updateOverlayPosition panel', { left, top, panelWidth, rect });
}

function requestPositionUpdate() {
  if (!activeImage || activeMode === 'hidden') {
    return;
  }

  if (positionRaf) {
    cancelAnimationFrame(positionRaf);
  }

  positionRaf = window.requestAnimationFrame(() => {
    positionRaf = 0;
    updateOverlayPosition();
  });
}

function showScanButton(image: HTMLImageElement) {
  ensureOverlay();
  activeImage = image;
  activeRequest = null;
  activeResponse = null;
  scanActivationInProgress = false;
  cancelHideOverlay();
  cancelProcessingTimer();
  // Compute initial position and set CSS vars before making the button visible
  try {
    const rect = image.getBoundingClientRect();
    const left = clamp(
      rect.right - SCAN_BUTTON_WIDTH - 10,
      8,
      Math.max(8, window.innerWidth - SCAN_BUTTON_WIDTH - 8)
    );
    const top = clamp(rect.top + 10, 8, Math.max(8, window.innerHeight - SCAN_BUTTON_HEIGHT - 8));
    if (overlayHost) {
      overlayHost.style.setProperty('--overlay-left', `${left}px`);
      overlayHost.style.setProperty('--overlay-top', `${top}px`);
    }
  } catch (e) {
    // ignore errors computing initial position
  }

  debugLog('showScanButton for', image.src, image.getBoundingClientRect());
  setOverlayMode('scan');
  requestPositionUpdate();
}

function showProcessingOverlay(image: HTMLImageElement, requestDetail: ScanRequestDetail) {
  ensureOverlay();
  activeImage = image;
  activeRequest = requestDetail;
  activeResponse = null;
  activeError = null;
  cancelHideOverlay();
  setOverlayMode('processing');
  debugLog('showProcessingOverlay for', requestDetail.src);
  syncProcessingText();
  requestPositionUpdate();
}

function showResultOverlay(response: NormalizedPredictResponse) {
  activeError = null;
  activeResponse = response;
  cancelProcessingTimer();
  setOverlayMode('result');
  syncResultText(response);
  requestPositionUpdate();
  scanActivationInProgress = false;
}

function showErrorOverlay(error: OverlayError) {
  activeError = error;
  activeResponse = null;
  cancelProcessingTimer();
  setOverlayMode('error');
  syncErrorText(error);
  requestPositionUpdate();
  scanActivationInProgress = false;
}

function hideOverlay() {
  activeImage = null;
  activeRequest = null;
  activeResponse = null;
  activeError = null;
  scanActivationInProgress = false;
  cancelHideOverlay();
  cancelProcessingTimer();
  setOverlayMode('hidden');
}

function closeOverlay() {
  hideOverlay();
}

function scheduleHideOverlay() {
  if (activeMode !== 'scan') {
    return;
  }

  cancelHideOverlay();
  hideTimer = window.setTimeout(() => {
    hideOverlay();
  }, HIDE_DELAY_MS);
}

function cancelHideOverlay() {
  if (hideTimer !== undefined) {
    window.clearTimeout(hideTimer);
    hideTimer = undefined;
  }
}

function cancelProcessingTimer() {
  if (processingTimer !== undefined) {
    window.clearTimeout(processingTimer);
    processingTimer = undefined;
  }
}

function syncProcessingText() {
  if (panelEyebrow) {
    panelEyebrow.textContent = 'Analyzing media';
  }

  if (panelTitle) {
    panelTitle.textContent = 'Uploading the image to the backend...';
  }
}

function syncResultText(response: NormalizedPredictResponse) {
  if (panelEyebrow) {
    panelEyebrow.textContent = 'Detection result';
  }

  if (panelTitle) {
    panelTitle.textContent = 'Real AI report ready';
  }

  if (predictionLabel) {
    predictionLabel.textContent = getPredictionLabel(response);
  }

  if (confidenceValue) {
    confidenceValue.textContent = `Confidence ${response.confidence}`;
  }

  if (sourceLabel) {
    sourceLabel.textContent = response.message || 'The backend returned a completed prediction.';
  }

  if (predictionDetail) {
    predictionDetail.textContent = response.prediction || 'UNKNOWN';
  }

  if (confidenceDetail) {
    const explanationParts: string[] = [];

    if (response.message) {
      explanationParts.push(response.message);
    }

    if (response.cvAnalysis && response.cvAnalysis.length > 0) {
      explanationParts.push(
        `${response.cvAnalysis.length} feature signal${response.cvAnalysis.length === 1 ? '' : 's'} returned.`
      );
    }

    if (response.isVideo && typeof response.consistency === 'number') {
      explanationParts.push(`Frame consistency ${Math.round(response.consistency)}%.`);
    }

    confidenceDetail.textContent =
      explanationParts.join(' ') || 'Waiting for the backend response.';
  }

  if (aiProbabilityValue) {
    aiProbabilityValue.textContent = formatPercent(response.aiProbability);
  }

  if (realProbabilityValue) {
    realProbabilityValue.textContent = formatPercent(response.realProbability);
  }

  if (aiProbabilityBar) {
    aiProbabilityBar.style.width = `${response.aiProbability * 100}%`;
  }

  if (realProbabilityBar) {
    realProbabilityBar.style.width = `${response.realProbability * 100}%`;
  }

  if (reportButton) {
    reportButton.textContent = 'View Details';
  }

  if (heatmapOpacityRange) {
    heatmapOpacityRange.value = String(heatmapOpacity);
  }

  heatmapOpacity = Math.max(0, Math.min(1, heatmapOpacity));
  if (heatmapOpacityValue) {
    heatmapOpacityValue.textContent = `${Math.round(heatmapOpacity * 100)}%`;
  }

  // heatmap display removed per user request; skip preview sync
  renderCvAnalysis(response);
  syncVideoMetrics(response);

  if (consistencyRow) {
    consistencyRow.style.display = response.isVideo ? 'flex' : 'none';
  }

  if (votesRow) {
    votesRow.style.display = response.isVideo && response.votes ? 'flex' : 'none';
  }

  if (timelineRow) {
    timelineRow.style.display =
      response.isVideo && Array.isArray(response.timeline) ? 'flex' : 'none';
  }

  if (closeButton) {
    closeButton.textContent = 'Close';
  }
}

function syncErrorText(error: OverlayError) {
  const copy = getErrorCopy(error);

  if (panelEyebrow) {
    panelEyebrow.textContent = 'Detection unavailable';
  }

  if (panelTitle) {
    panelTitle.textContent = copy.title;
  }

  if (errorTitle) {
    errorTitle.textContent = copy.title;
  }

  if (errorDetail) {
    errorDetail.textContent = copy.description;
  }

  if (errorCode) {
    errorCode.textContent = error.code;
  }

  if (errorPrimaryButton) {
    errorPrimaryButton.textContent = copy.primaryAction;
  }

  if (errorSecondaryButton) {
    errorSecondaryButton.textContent = copy.secondaryAction;
  }
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      resolve(String(reader.result || ''));
    };

    reader.onerror = () => {
      reject(reader.error || new Error('Unable to read the image blob'));
    };

    reader.readAsDataURL(blob);
  });
}

async function resolveImageDataUrl(sourceUrl: string) {
  if (sourceUrl.startsWith('data:')) {
    return sourceUrl;
  }

  if (!sourceUrl.startsWith('blob:')) {
    return null;
  }

  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw makeRuntimeError(
      'IMAGE_FETCH_FAILED',
      'Unable to read the selected blob image',
      response.statusText
    );
  }

  return blobToDataUrl(await response.blob());
}

async function runBackendDetection(
  requestDetail: ScanRequestDetail
): Promise<NormalizedPredictResponse> {
  const authState = await storageGet<Record<string, unknown>>([STORAGE_KEYS.authToken]);

  const token = authState[STORAGE_KEYS.authToken] as string | null | undefined;
  if (!token) {
    throw makeRuntimeError(
      'UNAUTHORIZED',
      'You must log in from the extension popup before running a detection'
    );
  }

  const sourceUrl = requestDetail.src;
  const imageDataUrl = await resolveImageDataUrl(sourceUrl).catch((error: unknown) => {
    if (sourceUrl.startsWith('blob:') || sourceUrl.startsWith('data:')) {
      throw error;
    }

    return null;
  });

  const response = await requestDetection({
    type: 'AI_MEDIA_INSPECTOR_DETECT_IMAGE',
    payload: {
      imageUrl: sourceUrl,
      imageDataUrl: imageDataUrl || undefined,
      alt: requestDetail.alt,
      pageUrl: requestDetail.pageUrl,
    },
  });

  if (!response.ok) {
    throw response.error;
  }

  return response.data;
}

function handleImageMouseEnter(event: MouseEvent) {
  // Keep the overlay stable during an in-flight request, but let hover recover
  // from a stale result/error state so the scan button becomes visible again.
  if (activeMode === 'processing') {
    return;
  }

  if (activeMode === 'result' || activeMode === 'error') {
    closeOverlay();
  }

  const target = event.currentTarget;
  if (target instanceof HTMLImageElement && isEligibleImage(target)) {
    showScanButton(target);
  }
}

function handleImageMouseLeave(event: MouseEvent) {
  // If the pointer is entering the overlay (backdrop/panel/button), do not hide.
  const related = event.relatedTarget as EventTarget | null;
  if (isRelatedTargetOverlay(related)) {
    return;
  }

  scheduleHideOverlay();
}

function handleOverlayMouseLeave(event: MouseEvent) {
  // When leaving the overlay, if the pointer moves back to the active image,
  // keep the overlay visible; otherwise schedule hide.
  const related = event.relatedTarget as EventTarget | null;
  if (isRelatedTargetImage(related)) {
    return;
  }

  scheduleHideOverlay();
}

function isRelatedTargetOverlay(related: EventTarget | null) {
  if (!related || !overlayHost) return false;
  try {
    // related can be a node inside the shadowRoot; check both.
    if (related instanceof Node) {
      if (overlayHost.contains(related)) return true;
      if (overlayHost.shadowRoot && overlayHost.shadowRoot.contains(related)) return true;
    }
  } catch (e) {
    // ignore
  }
  return false;
}

function isRelatedTargetImage(related: EventTarget | null) {
  if (!related || !activeImage) return false;
  try {
    if (related instanceof Node) {
      if (activeImage === related) return true;
      if (activeImage.contains(related)) return true;
    }
  } catch (e) {
    // ignore
  }
  return false;
}

function handleImageLoad(event: Event) {
  const target = event.currentTarget;
  if (target instanceof HTMLImageElement && activeImage === target) {
    requestPositionUpdate();
  }
}

async function startScanFromOverlayEvent(event: Event) {
  debugLog('startScanFromOverlayEvent', { activeMode, scanActivationInProgress });
  try {
    event.preventDefault();
    event.stopPropagation();
  } catch (e) {
    // ignore
  }

  if (typeof event.stopImmediatePropagation === 'function') {
    event.stopImmediatePropagation();
  }

  if (!activeImage || activeMode !== 'scan' || scanActivationInProgress) {
    return;
  }

  scanActivationInProgress = true;

  const requestDetail: ScanRequestDetail = {
    src: activeImage.currentSrc || activeImage.src,
    alt: activeImage.alt,
    pageUrl: window.location.href,
    rect: activeImage.getBoundingClientRect(),
  };

  activeRequest = requestDetail;
  activeImage.dispatchEvent(
    new CustomEvent<ScanRequestDetail>('ai-media-inspector:scan-request', {
      detail: requestDetail,
      bubbles: true,
      composed: true,
    })
  );

  debugLog('dispatching scan-request for', requestDetail.src);

  const authState = await storageGet<Record<string, unknown>>([STORAGE_KEYS.authToken]);
  if (!(authState[STORAGE_KEYS.authToken] as string | null | undefined)) {
    showErrorOverlay(
      makeRuntimeError(
        'UNAUTHORIZED',
        'You must log in from the extension popup before running a detection'
      )
    );
    return;
  }

  try {
    showProcessingOverlay(activeImage, requestDetail);
    const prediction = await runBackendDetection(requestDetail);
    showResultOverlay(prediction);
  } catch (error) {
    const resolvedError =
      error && typeof error === 'object' && 'code' in error && 'message' in error
        ? (error as OverlayError)
        : makeRuntimeError(
            'NETWORK_ERROR',
            'Unable to complete the detection request',
            error instanceof Error ? error.message : String(error)
          );

    debugLog('detection failed', resolvedError);
    showErrorOverlay(resolvedError);
  }
}

function handleScanPointerDown(event: PointerEvent) {
  void startScanFromOverlayEvent(event);
}

function handleScanClick(event: MouseEvent) {
  void startScanFromOverlayEvent(event);
}

function handleFullReportClick(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();

  if (!activeRequest || !activeResponse || !activeImage) {
    return;
  }

  const detail = {
    request: activeRequest,
    response: activeResponse,
  };

  activeImage.dispatchEvent(
    new CustomEvent('ai-media-inspector:report-request', {
      detail,
      bubbles: true,
      composed: true,
    })
  );

  console.log('AI Media Inspector full report requested.', detail);
}

function bindImage(image: HTMLImageElement) {
  if (registeredImages.has(image)) {
    return;
  }

  image.dataset.aiMediaInspectorBound = 'true';
  image.addEventListener('mouseenter', handleImageMouseEnter, { passive: true });
  image.addEventListener('mouseleave', handleImageMouseLeave, { passive: true });
  image.addEventListener('load', handleImageLoad, { passive: true });
  registeredImages.add(image);
}

function scanForImages(root: ParentNode | Element) {
  if (root instanceof HTMLImageElement) {
    bindImage(root);
    return;
  }

  root.querySelectorAll('img').forEach((image) => {
    bindImage(image);
  });
}

function observePage() {
  const observer = new MutationObserver((mutations) => {
    let shouldReposition = false;

    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node instanceof HTMLImageElement) {
          bindImage(node);
          shouldReposition = shouldReposition || node === activeImage;
          return;
        }

        if (node instanceof Element) {
          scanForImages(node);
        }
      });
    }

    if (activeImage && !document.contains(activeImage)) {
      debugLog('activeImage removed from document', activeImage?.src, 'mode=', activeMode);
      // If we're showing the scanning UI (processing/result), keep the overlay
      // visible even if the image node was replaced by the page. Only hide when
      // we're in the lightweight 'scan' state.
      if (activeMode === 'scan') {
        hideOverlay();
        return;
      }

      // Clear the reference but keep the overlay visible for processing/result.
      activeImage = null;
    }

    shouldReposition = shouldReposition || Boolean(activeImage && activeMode !== 'hidden');

    if (shouldReposition) {
      requestPositionUpdate();
    }
  });

  observer.observe(document.body ?? document.documentElement, {
    childList: true,
    subtree: true,
  });
}

function registerGlobalListeners() {
  window.addEventListener('scroll', requestPositionUpdate, { passive: true, capture: true });
  window.addEventListener('resize', requestPositionUpdate, { passive: true });
  window.addEventListener('blur', closeOverlay);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeOverlay();
    }
  });
}

function init() {
  console.log('AI Media Inspector content script loaded.');
  ensureOverlay();
  scanForImages(document);
  observePage();
  registerGlobalListeners();
}

init();
