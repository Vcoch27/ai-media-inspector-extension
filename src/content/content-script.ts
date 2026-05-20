type ScanRequestDetail = {
  src: string;
  alt: string;
  pageUrl: string;
  rect: DOMRectReadOnly;
};

type MockPredictResponse = {
  status: 'success';
  prediction: 'AI-GENERATED';
  confidence: string;
  message: string;
  aiProbability: number;
  realProbability: number;
  heatmapBase64: string | null;
  cvAnalysis: null;
  consistency: null;
  votes: null;
  timeline: null;
  keyFrameBase64: string | null;
};

type OverlayMode = 'hidden' | 'scan' | 'processing' | 'result';

const ROOT_ID = 'ai-media-inspector-overlay-root';
const SCAN_BUTTON_HEIGHT = 34;
const SCAN_BUTTON_WIDTH = 92;
const PANEL_MIN_WIDTH = 320;
const PANEL_MAX_WIDTH = 420;
const IMAGE_MIN_SIZE = 56;
const HIDE_DELAY_MS = 120;
const PROCESSING_DURATION_MS = 2200;

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

let activeImage: HTMLImageElement | null = null;
let activeMode: OverlayMode = 'hidden';
let activeRequest: ScanRequestDetail | null = null;
let activeResponse: MockPredictResponse | null = null;
let hideTimer: number | undefined;
let processingTimer: number | undefined;
let positionRaf = 0;
let scanActivationInProgress = false;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function roundProbability(value: number) {
  return Math.round(value * 100) / 100;
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function hashString(input: string) {
  let hash = 0;

  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash);
}

function buildMockResponse(detail: ScanRequestDetail): MockPredictResponse {
  const seed = hashString(`${detail.src}|${detail.alt}|${detail.pageUrl}`);
  const aiProbability = roundProbability(Math.min(0.96, 0.83 + (seed % 12) / 100));
  const realProbability = roundProbability(1 - aiProbability);

  return {
    status: 'success',
    prediction: 'AI-GENERATED',
    confidence: formatPercent(aiProbability),
    message: 'Mock detection completed. Backend integration will reuse this response shape.',
    aiProbability,
    realProbability,
    heatmapBase64: null,
    cvAnalysis: null,
    consistency: null,
    votes: null,
    timeline: null,
    keyFrameBase64: null,
  };
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
  overlayHost.style.pointerEvents = 'none';

  const shadowRoot = overlayHost.attachShadow({ mode: 'open' });
  shadowRoot.innerHTML = `
    <style>
      :host {
        all: initial;
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
        background: rgba(2, 6, 23, 0.14);
        backdrop-filter: blur(1px);
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
        border: 1px solid rgba(255, 255, 255, 0.72);
        border-radius: 999px;
        background: linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(51, 65, 85, 0.94) 100%);
        color: #f8fafc;
        font: 600 12px/1.1 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        letter-spacing: 0.02em;
        box-shadow: 0 12px 28px rgba(15, 23, 42, 0.28);
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
        color: #fbbf24;
        font-size: 10px;
        line-height: 1;
      }

      .panel {
        left: var(--overlay-left);
        top: var(--overlay-top);
        width: min(var(--overlay-width), calc(100vw - 16px));
        max-height: min(420px, calc(100vh - 20px));
        padding: 16px;
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 20px;
        background:
          radial-gradient(circle at top left, rgba(56, 189, 248, 0.16), transparent 38%),
          linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(15, 23, 42, 0.94));
        color: #f8fafc;
        box-shadow: 0 24px 60px rgba(15, 23, 42, 0.42);
        backdrop-filter: blur(14px);
        opacity: 0;
        visibility: hidden;
        transform: translateY(8px) scale(0.985);
        transition: opacity 160ms ease, transform 160ms ease, visibility 160ms ease;
        overflow: hidden;
      }

      .panel[data-visible='true'] {
        opacity: 1;
        visibility: visible;
        transform: translateY(0) scale(1);
      }

      .panel[data-mode='processing'] .processing-state,
      .panel[data-mode='result'] .result-state {
        display: flex;
      }

      .panel[data-mode='processing'] .result-state,
      .panel[data-mode='result'] .processing-state {
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
        color: #93c5fd;
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
      }

      .icon-button {
        width: 32px;
        height: 32px;
        border: 0;
        border-radius: 10px;
        background: rgba(148, 163, 184, 0.12);
        color: #e2e8f0;
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

      .processing-state {
        align-items: center;
        padding: 20px 8px 10px;
        text-align: center;
      }

      .spinner {
        width: 46px;
        height: 46px;
        border-radius: 999px;
        border: 3px solid rgba(148, 163, 184, 0.24);
        border-top-color: #38bdf8;
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
        color: #cbd5e1;
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
        gap: 10px;
        padding: 12px 14px;
        border-radius: 16px;
        background: rgba(15, 118, 110, 0.18);
        border: 1px solid rgba(45, 212, 191, 0.24);
      }

      .result-banner__title {
        margin: 0 0 4px;
        font-size: 16px;
        font-weight: 700;
      }

      .result-banner__subtitle {
        margin: 0;
        color: #d1fae5;
        font-size: 13px;
      }

      .status-chip {
        padding: 8px 10px;
        border-radius: 999px;
        background: rgba(34, 197, 94, 0.18);
        color: #bbf7d0;
        font-size: 12px;
        font-weight: 700;
        white-space: nowrap;
      }

      .metrics {
        display: grid;
        grid-template-columns: 1fr;
        gap: 10px;
      }

      .metric-card {
        padding: 12px;
        border-radius: 14px;
        background: rgba(30, 41, 59, 0.88);
        border: 1px solid rgba(148, 163, 184, 0.18);
      }

      .metric-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 8px;
      }

      .metric-label {
        font-size: 12px;
        font-weight: 600;
      }

      .metric-value {
        color: #f8fafc;
        font-size: 13px;
        font-weight: 700;
      }

      .metric-bar {
        position: relative;
        height: 10px;
        border-radius: 999px;
        overflow: hidden;
        background: rgba(148, 163, 184, 0.16);
      }

      .metric-bar__fill {
        position: absolute;
        inset: 0 auto 0 0;
        border-radius: inherit;
        transition: width 260ms ease;
      }

      .metric-bar__fill--ai {
        background: linear-gradient(90deg, #fb7185, #f97316);
      }

      .metric-bar__fill--real {
        background: linear-gradient(90deg, #38bdf8, #22c55e);
      }

      .footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-top: 14px;
      }

      .footer-actions {
        display: flex;
        gap: 8px;
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
        background: rgba(148, 163, 184, 0.12);
        color: #e2e8f0;
        border-color: rgba(148, 163, 184, 0.18);
      }

      .details-list {
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
        background: rgba(15, 23, 42, 0.55);
        border: 1px solid rgba(148, 163, 184, 0.16);
      }

      .detail-label {
        font-size: 12px;
        font-weight: 600;
      }

      .detail-value {
        font-size: 13px;
        font-weight: 700;
        color: #f8fafc;
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
          <p class="eyebrow" id="panel-eyebrow">Analyzing media...</p>
          <h2 class="panel-title" id="panel-title">Running AI detection...</h2>
        </div>
        <button class="icon-button" type="button" aria-label="Close scan overlay">×</button>
      </div>

      <div class="processing-state">
        <div class="spinner" aria-hidden="true"></div>
        <p class="processing-copy">Analyzing media...</p>
        <p class="subcopy">Preparing a mock AI response that matches the backend response shape.</p>
      </div>

      <div class="result-state">
        <div class="result-banner">
          <div>
            <p class="result-banner__title" id="prediction-label">Likely AI-generated</p>
            <p class="result-banner__subtitle" id="source-label">Mock detection completed.</p>
          </div>
          <div class="status-chip" id="confidence-value">Confidence 87.00%</div>
        </div>

        <div class="metrics">
          <div class="metric-card">
            <div class="metric-row">
              <p class="metric-label">AI probability</p>
              <p class="metric-value" id="ai-probability-value">87.00%</p>
            </div>
            <div class="metric-bar" aria-hidden="true">
              <div class="metric-bar__fill metric-bar__fill--ai" id="ai-probability-bar" style="width: 87%;"></div>
            </div>
          </div>

          <div class="metric-card">
            <div class="metric-row">
              <p class="metric-label">Real probability</p>
              <p class="metric-value" id="real-probability-value">13.00%</p>
            </div>
            <div class="metric-bar" aria-hidden="true">
              <div class="metric-bar__fill metric-bar__fill--real" id="real-probability-bar" style="width: 13%;"></div>
            </div>
          </div>
        </div>

        <div class="details-list">
          <div class="detail-row">
            <span class="detail-label">Status</span>
            <span class="detail-value">success</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Prediction</span>
            <span class="detail-value" id="prediction-detail">AI-GENERATED</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Confidence score</span>
            <span class="detail-value" id="confidence-detail">87.00%</span>
          </div>
        </div>
      </div>

      <div class="footer">
        <p class="footer-hint">This is a mock overlay for UX validation before backend integration.</p>
        <div class="footer-actions">
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

  overlayButton?.addEventListener('mouseenter', cancelHideOverlay);
  overlayButton?.addEventListener('mouseleave', scheduleHideOverlay);
  overlayButton?.addEventListener('pointerdown', handleScanPointerDown);
  overlayButton?.addEventListener('click', handleScanClick);
  closeButton?.addEventListener('click', closeOverlay);
  reportButton?.addEventListener('click', handleFullReportClick);

  (document.body ?? document.documentElement).appendChild(overlayHost);
}

function setOverlayMode(mode: OverlayMode) {
  activeMode = mode;

  if (!overlayHost || !overlayButton || !overlayPanel) {
    return;
  }

  overlayPanel.dataset.mode = mode;
  overlayPanel.dataset.visible = mode === 'processing' || mode === 'result' ? 'true' : 'false';
  overlayButton.dataset.visible = mode === 'scan' ? 'true' : 'false';

  if (overlayBackdrop) {
    overlayBackdrop.dataset.visible = mode === 'processing' || mode === 'result' ? 'true' : 'false';
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
  setOverlayMode('scan');
  requestPositionUpdate();
}

function showProcessingOverlay(image: HTMLImageElement, requestDetail: ScanRequestDetail) {
  ensureOverlay();
  activeImage = image;
  activeRequest = requestDetail;
  activeResponse = null;
  cancelHideOverlay();
  setOverlayMode('processing');
  syncProcessingText();
  requestPositionUpdate();

  processingTimer = window.setTimeout(() => {
    showResultOverlay(buildMockResponse(requestDetail));
  }, PROCESSING_DURATION_MS);
}

function showResultOverlay(response: MockPredictResponse) {
  activeResponse = response;
  cancelProcessingTimer();
  setOverlayMode('result');
  syncResultText(response);
  requestPositionUpdate();
}

function hideOverlay() {
  activeImage = null;
  activeRequest = null;
  activeResponse = null;
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
    panelEyebrow.textContent = 'Analyzing media...';
  }

  if (panelTitle) {
    panelTitle.textContent = 'Running AI detection...';
  }
}

function syncResultText(response: MockPredictResponse) {
  if (panelEyebrow) {
    panelEyebrow.textContent = 'Detection result';
  }

  if (panelTitle) {
    panelTitle.textContent = 'Mock AI report ready';
  }

  if (predictionLabel) {
    predictionLabel.textContent = 'Likely AI-generated';
  }

  if (confidenceValue) {
    confidenceValue.textContent = `Confidence ${response.confidence}`;
  }

  if (sourceLabel) {
    sourceLabel.textContent = response.message;
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
}

function handleImageMouseEnter(event: MouseEvent) {
  const target = event.currentTarget;
  if (target instanceof HTMLImageElement && isEligibleImage(target)) {
    showScanButton(target);
  }
}

function handleImageMouseLeave() {
  scheduleHideOverlay();
}

function handleImageLoad(event: Event) {
  const target = event.currentTarget;
  if (target instanceof HTMLImageElement && activeImage === target) {
    requestPositionUpdate();
  }
}

function startScanFromOverlayEvent(event: Event) {
  event.preventDefault();
  event.stopPropagation();

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

  showProcessingOverlay(activeImage, requestDetail);
}

function handleScanPointerDown(event: PointerEvent) {
  startScanFromOverlayEvent(event);
}

function handleScanClick(event: MouseEvent) {
  startScanFromOverlayEvent(event);
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
      hideOverlay();
      return;
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
