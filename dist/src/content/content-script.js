var e=`ai-media-inspector-overlay-root`,t=34,n=92,r=320,i=420,a=56,o=120,s=2200,c=new WeakSet,l=null,u=null,d=null,f=null,p=null,m=null,h=null,g=null,_=null,v=null,y=null,b=null,x=null,S=null,C=null,w=null,T=`hidden`,E=null,D=null,O,k,A=0,j=!1;function M(e,t,n){return Math.min(Math.max(e,t),n)}function N(e){return Math.round(e*100)/100}function P(e){return`${(e*100).toFixed(2)}%`}function F(e){let t=0;for(let n=0;n<e.length;n+=1)t=(t<<5)-t+e.charCodeAt(n),t|=0;return Math.abs(t)}function ee(e){let t=F(`${e.src}|${e.alt}|${e.pageUrl}`),n=N(Math.min(.96,.83+t%12/100)),r=N(1-n);return{status:`success`,prediction:`AI-GENERATED`,confidence:P(n),message:`Mock detection completed. Backend integration will reuse this response shape.`,aiProbability:n,realProbability:r,heatmapBase64:null,cvAnalysis:null,consistency:null,votes:null,timeline:null,keyFrameBase64:null}}function I(){if(l&&u&&f)return;l=document.createElement(`div`),l.id=e,l.setAttribute(`aria-hidden`,`true`),l.style.position=`fixed`,l.style.left=`0`,l.style.top=`0`,l.style.width=`0`,l.style.height=`0`,l.style.zIndex=`2147483647`,l.style.pointerEvents=`none`;let r=l.attachShadow({mode:`open`});r.innerHTML=`
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
        min-width: ${n}px;
        height: ${t}px;
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
  `,u=r.querySelector(`.scan-button`),d=r.querySelector(`.backdrop`),f=r.querySelector(`.panel`),p=r.querySelector(`#panel-title`),m=r.querySelector(`#panel-eyebrow`),r.querySelector(`.processing-state`),r.querySelector(`.result-state`),h=r.querySelector(`#close-button`),g=r.querySelector(`#report-button`),_=r.querySelector(`#prediction-label`),v=r.querySelector(`#confidence-value`),y=r.querySelector(`#ai-probability-value`),b=r.querySelector(`#real-probability-value`),x=r.querySelector(`#ai-probability-bar`),S=r.querySelector(`#real-probability-bar`),C=r.querySelector(`#source-label`),u?.addEventListener(`mouseenter`,W),u?.addEventListener(`mouseleave`,U),u?.addEventListener(`pointerdown`,ae),u?.addEventListener(`click`,oe),h?.addEventListener(`click`,H),g?.addEventListener(`click`,se),(document.body??document.documentElement).appendChild(l)}function L(e){T=e,!(!l||!u||!f)&&(f.dataset.mode=e,f.dataset.visible=e===`processing`||e===`result`?`true`:`false`,u.dataset.visible=e===`scan`?`true`:`false`,d&&(d.dataset.visible=e===`processing`||e===`result`?`true`:`false`))}function te(e){if(!e.isConnected)return!1;let t=e.getBoundingClientRect();if(t.width<a||t.height<a||t.bottom<=0||t.right<=0)return!1;let n=window.getComputedStyle(e);return n.display!==`none`&&n.visibility!==`hidden`&&n.opacity!==`0`}function R(){if(!w||!l)return;let e=w.getBoundingClientRect();if(e.width<a||e.height<a){H();return}if(T===`scan`){let r=M(e.right-n-10,8,Math.max(8,window.innerWidth-n-8)),i=M(e.top+10,8,Math.max(8,window.innerHeight-t-8));l.style.setProperty(`--overlay-left`,`${r}px`),l.style.setProperty(`--overlay-top`,`${i}px`);return}let o=M(Math.max(e.width*.95,r),r,Math.min(i,window.innerWidth-16)),s=f?.getBoundingClientRect().height||360,c=e.left+e.width/2-o/2,u=e.top+e.height/2-s/2,d=M(c,8,Math.max(8,window.innerWidth-o-8)),p=M(u,8,Math.max(8,window.innerHeight-s-8));l.style.setProperty(`--overlay-left`,`${d}px`),l.style.setProperty(`--overlay-top`,`${p}px`),l.style.setProperty(`--overlay-width`,`${o}px`)}function z(){!w||T===`hidden`||(A&&cancelAnimationFrame(A),A=window.requestAnimationFrame(()=>{A=0,R()}))}function B(e){I(),w=e,E=null,D=null,j=!1,W(),G(),L(`scan`),z()}function ne(e,t){I(),w=e,E=t,D=null,W(),L(`processing`),K(),z(),k=window.setTimeout(()=>{re(ee(t))},s)}function re(e){D=e,G(),L(`result`),q(e),z()}function V(){w=null,E=null,D=null,j=!1,W(),G(),L(`hidden`)}function H(){V()}function U(){T===`scan`&&(W(),O=window.setTimeout(()=>{V()},o))}function W(){O!==void 0&&(window.clearTimeout(O),O=void 0)}function G(){k!==void 0&&(window.clearTimeout(k),k=void 0)}function K(){m&&(m.textContent=`Analyzing media...`),p&&(p.textContent=`Running AI detection...`)}function q(e){m&&(m.textContent=`Detection result`),p&&(p.textContent=`Mock AI report ready`),_&&(_.textContent=`Likely AI-generated`),v&&(v.textContent=`Confidence ${e.confidence}`),C&&(C.textContent=e.message),y&&(y.textContent=P(e.aiProbability)),b&&(b.textContent=P(e.realProbability)),x&&(x.style.width=`${e.aiProbability*100}%`),S&&(S.style.width=`${e.realProbability*100}%`)}function J(e){let t=e.currentTarget;t instanceof HTMLImageElement&&te(t)&&B(t)}function Y(){U()}function ie(e){let t=e.currentTarget;t instanceof HTMLImageElement&&w===t&&z()}function X(e){if(e.preventDefault(),e.stopPropagation(),typeof e.stopImmediatePropagation==`function`&&e.stopImmediatePropagation(),!w||T!==`scan`||j)return;j=!0;let t={src:w.currentSrc||w.src,alt:w.alt,pageUrl:window.location.href,rect:w.getBoundingClientRect()};E=t,w.dispatchEvent(new CustomEvent(`ai-media-inspector:scan-request`,{detail:t,bubbles:!0,composed:!0})),ne(w,t)}function ae(e){X(e)}function oe(e){X(e)}function se(e){if(e.preventDefault(),e.stopPropagation(),!E||!D||!w)return;let t={request:E,response:D};w.dispatchEvent(new CustomEvent(`ai-media-inspector:report-request`,{detail:t,bubbles:!0,composed:!0})),console.log(`AI Media Inspector full report requested.`,t)}function Z(e){c.has(e)||(e.dataset.aiMediaInspectorBound=`true`,e.addEventListener(`mouseenter`,J,{passive:!0}),e.addEventListener(`mouseleave`,Y,{passive:!0}),e.addEventListener(`load`,ie,{passive:!0}),c.add(e))}function Q(e){if(e instanceof HTMLImageElement){Z(e);return}e.querySelectorAll(`img`).forEach(e=>{Z(e)})}function ce(){new MutationObserver(e=>{let t=!1;for(let n of e)n.addedNodes.forEach(e=>{if(e instanceof HTMLImageElement){Z(e),t||=e===w;return}e instanceof Element&&Q(e)});if(w&&!document.contains(w)){V();return}t||=!!(w&&T!==`hidden`),t&&z()}).observe(document.body??document.documentElement,{childList:!0,subtree:!0})}function le(){window.addEventListener(`scroll`,z,{passive:!0,capture:!0}),window.addEventListener(`resize`,z,{passive:!0}),window.addEventListener(`blur`,H),window.addEventListener(`keydown`,e=>{e.key===`Escape`&&H()})}function $(){console.log(`AI Media Inspector content script loaded.`),I(),Q(document),ce(),le()}$();