import {
  BackendLoginResponse,
  BackendPredictResponse,
  DEFAULT_BACKEND_BASE_URL,
  ExtensionAuthState,
  buildApiUrl,
  buildFileName,
  makeRuntimeError,
  normalizeBackendBaseUrl,
  normalizePredictResponse,
  storageGet,
  storageRemove,
  storageSet,
  STORAGE_KEYS,
} from '../shared/extension-api';

type LoginMessage = {
  type: 'AI_MEDIA_INSPECTOR_LOGIN';
  payload: {
    email: string;
    password: string;
    backendBaseUrl?: string;
  };
};

type SessionMessage = {
  type: 'AI_MEDIA_INSPECTOR_GET_SESSION';
};

type LogoutMessage = {
  type: 'AI_MEDIA_INSPECTOR_LOGOUT';
};

type ProfileMessage = {
  type: 'AI_MEDIA_INSPECTOR_GET_PROFILE';
};

type DetectMessage = {
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

type ExtensionMessage =
  | LoginMessage
  | SessionMessage
  | LogoutMessage
  | ProfileMessage
  | DetectMessage
  | OpenPopupMessage
  | SyncSessionMessage;

type MessageSuccess<T> = {
  ok: true;
  data: T;
};

type MessageFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: string;
  };
};

type PredictMessageResult =
  | MessageSuccess<ReturnType<typeof normalizePredictResponse>>
  | MessageFailure;

function createSuccess<T>(data: T): MessageSuccess<T> {
  return { ok: true, data };
}

function createFailure(code: string, message: string, details?: string): MessageFailure {
  return {
    ok: false,
    error: makeRuntimeError(code, message, details),
  };
}

async function readAuthState(): Promise<ExtensionAuthState> {
  const snapshot = await storageGet<Record<string, unknown>>([
    STORAGE_KEYS.authToken,
    STORAGE_KEYS.authUser,
    STORAGE_KEYS.backendBaseUrl,
  ]);

  return {
    token: (snapshot[STORAGE_KEYS.authToken] as string | null | undefined) ?? null,
    user: (snapshot[STORAGE_KEYS.authUser] as ExtensionAuthState['user']) ?? null,
    backendBaseUrl: normalizeBackendBaseUrl(
      (snapshot[STORAGE_KEYS.backendBaseUrl] as string | null | undefined) ??
        DEFAULT_BACKEND_BASE_URL
    ),
  };
}

async function readJsonResponse(response: Response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }

  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 30000
) {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

async function login(payload: LoginMessage['payload']) {
  const backendBaseUrl = normalizeBackendBaseUrl(payload.backendBaseUrl);
  const response = await fetchWithTimeout(buildApiUrl(backendBaseUrl, '/api/auth/login'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: payload.email,
      password: payload.password,
    }),
  });

  const body = (await readJsonResponse(response)) as BackendLoginResponse | string | null;
  if (!response.ok) {
    const message =
      (body && typeof body === 'object' && (body.message || body.error || body.reason)) ||
      (typeof body === 'string' && body) ||
      response.statusText ||
      'Login failed';

    return createFailure(`HTTP_${response.status}`, String(message), JSON.stringify(body ?? {}));
  }

  if (!body || typeof body !== 'object' || !body.token) {
    return createFailure('INVALID_RESPONSE', 'Backend returned an invalid login response');
  }

  await storageSet({
    [STORAGE_KEYS.authToken]: body.token,
    [STORAGE_KEYS.authUser]: body.user ?? null,
    [STORAGE_KEYS.backendBaseUrl]: backendBaseUrl,
  });

  // Broadcast auth state to all page tabs so the website can sync extension login
  try {
    const message = {
      type: 'AI_MEDIA_INSPECTOR_AUTH_SYNC',
      payload: {
        action: 'login',
        token: body.token,
        user: body.user ?? null,
        backendBaseUrl,
      },
    };

    chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] }, (tabs: any[]) => {
      for (const t of tabs) {
        try {
          if (t.id != null) chrome.tabs.sendMessage(t.id, message, () => {});
        } catch {
          // ignore individual tab errors
        }
      }
    });
  } catch (err) {
    // ignore broadcast errors
  }

  return createSuccess({
    token: body.token,
    user: body.user ?? null,
    backendBaseUrl,
  });
}

async function logout() {
  await storageRemove([STORAGE_KEYS.authToken, STORAGE_KEYS.authUser]);

  // Broadcast logout to all page tabs so the website can clear session
  try {
    const message = {
      type: 'AI_MEDIA_INSPECTOR_AUTH_SYNC',
      payload: {
        action: 'logout',
      },
    };

    chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] }, (tabs: any[]) => {
      for (const t of tabs) {
        try {
          if (t.id != null) chrome.tabs.sendMessage(t.id, message, () => {});
        } catch {
          // ignore
        }
      }
    });
  } catch (err) {
    // ignore
  }

  return createSuccess({ loggedOut: true });
}

async function syncSession(payload: SyncSessionMessage['payload']) {
  if (payload.action === 'logout') {
    await storageRemove([STORAGE_KEYS.authToken, STORAGE_KEYS.authUser]);
    return createSuccess({ loggedOut: true, synced: true });
  }

  if (!payload.token) {
    return createFailure('INVALID_PAYLOAD', 'Sync session payload is missing a token');
  }

  await storageSet({
    [STORAGE_KEYS.authToken]: payload.token,
    [STORAGE_KEYS.authUser]: payload.user ?? null,
    [STORAGE_KEYS.backendBaseUrl]: normalizeBackendBaseUrl(payload.backendBaseUrl),
  });

  return createSuccess({
    synced: true,
    token: payload.token,
  });
}

async function fetchProfile() {
  const authState = await readAuthState();
  if (!authState.token) {
    return createFailure('UNAUTHORIZED', 'You must log in before loading the profile');
  }

  const response = await fetchWithTimeout(
    buildApiUrl(authState.backendBaseUrl, '/api/auth/profile'),
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${authState.token}`,
      },
    }
  );

  const body = await readJsonResponse(response);
  if (!response.ok) {
    const message =
      (body && typeof body === 'object' && (body.message || body.error || body.reason)) ||
      (typeof body === 'string' && body) ||
      response.statusText ||
      'Profile load failed';

    return createFailure(`HTTP_${response.status}`, String(message), JSON.stringify(body ?? {}));
  }

  if (!body || typeof body !== 'object') {
    return createFailure('INVALID_RESPONSE', 'Backend returned an invalid profile response');
  }

  return createSuccess(body);
}

function dataUrlToBlob(dataUrl: string) {
  const [meta, data] = dataUrl.split(',', 2);
  const match = /^data:(.*?)(;base64)?$/i.exec(meta);
  const mimeType = match?.[1] || 'application/octet-stream';
  const base64 = data ?? '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

async function buildUploadFile(payload: DetectMessage['payload']) {
  let blob: Blob;

  if (payload.imageDataUrl) {
    blob = dataUrlToBlob(payload.imageDataUrl);
  } else {
    const response = await fetchWithTimeout(payload.imageUrl, { method: 'GET' }, 30000);
    if (!response.ok) {
      throw createFailure(
        'IMAGE_FETCH_FAILED',
        'Unable to read the selected image',
        `HTTP ${response.status}: ${response.statusText}`
      );
    }

    blob = await response.blob();
  }

  return new File([blob], buildFileName(payload.imageUrl, payload.alt), {
    type: blob.type || 'application/octet-stream',
  });
}

async function detectImage(payload: DetectMessage['payload']) {
  const authState = await readAuthState();
  if (!authState.token) {
    return createFailure('UNAUTHORIZED', 'You must log in before running a detection');
  }

  try {
    const file = await buildUploadFile(payload);
    const formData = new FormData();
    formData.append('file', file, file.name);

    const response = await fetchWithTimeout(buildApiUrl(authState.backendBaseUrl, '/api/predict'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authState.token}`,
      },
      body: formData,
    });

    const body = (await readJsonResponse(response)) as BackendPredictResponse | string | null;
    if (!response.ok) {
      const message =
        (body && typeof body === 'object' && (body.message || body.error || body.reason)) ||
        (typeof body === 'string' && body) ||
        response.statusText ||
        'Detection failed';

      return createFailure(`HTTP_${response.status}`, String(message), JSON.stringify(body ?? {}));
    }

    if (!body || typeof body !== 'object') {
      return createFailure('INVALID_RESPONSE', 'Backend returned an invalid detection response');
    }

    return createSuccess(normalizePredictResponse(body));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown detection error';
    if (message.toLowerCase().includes('aborted') || message.toLowerCase().includes('timeout')) {
      return createFailure('TIMEOUT', 'Detection timed out', message);
    }

    return createFailure('NETWORK_ERROR', 'Unable to reach the detection backend', message);
  }
}

async function openPopup() {
  try {
    if (chrome.action?.openPopup) {
      await chrome.action.openPopup();
      return createSuccess({ opened: true });
    }
  } catch (error) {
    return createFailure(
      'POPUP_OPEN_FAILED',
      'Unable to open the extension popup',
      error instanceof Error ? error.message : String(error)
    );
  }

  return createFailure(
    'POPUP_UNSUPPORTED',
    'Opening the popup is not supported in this browser context'
  );
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('AI Media Inspector extension installed.');
});

chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    _sender: unknown,
    sendResponse: (
      response: PredictMessageResult | MessageSuccess<unknown> | MessageFailure
    ) => void
  ) => {
    const run = async () => {
      switch (message.type) {
        case 'AI_MEDIA_INSPECTOR_LOGIN':
          return login(message.payload);
        case 'AI_MEDIA_INSPECTOR_GET_SESSION':
          return createSuccess(await readAuthState());
        case 'AI_MEDIA_INSPECTOR_LOGOUT':
          return logout();
        case 'AI_MEDIA_INSPECTOR_SYNC_SESSION':
          return syncSession(message.payload);
        case 'AI_MEDIA_INSPECTOR_GET_PROFILE':
          return fetchProfile();
        case 'AI_MEDIA_INSPECTOR_DETECT_IMAGE':
          return detectImage(message.payload);
        case 'AI_MEDIA_INSPECTOR_OPEN_POPUP':
          return openPopup();
        default:
          return createFailure('UNKNOWN_MESSAGE', 'Unknown extension message');
      }
    };

    run()
      .then((response) => sendResponse(response))
      .catch((error: unknown) => {
        const messageText = error instanceof Error ? error.message : String(error);
        sendResponse(createFailure('UNHANDLED_ERROR', 'Unexpected background error', messageText));
      });

    return true;
  }
);
