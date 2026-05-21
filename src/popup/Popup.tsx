import React, { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_BACKEND_BASE_URL,
  STORAGE_KEYS,
  normalizeBackendBaseUrl,
  storageGet,
  storageRemove,
  storageSet,
} from '../shared/extension-api';

type SessionSnapshot = {
  token: string | null;
  user: {
    email?: string;
    displayName?: string;
  } | null;
  backendBaseUrl: string;
};

type ProfileSnapshot = {
  id?: number;
  email?: string;
  displayName?: string;
  avatar?: string | null;
  role?: string;
  createdAt?: string;
  totalDetections?: number;
  aiDetections?: number;
  realDetections?: number;
  storageUsedBytes?: number;
  storageQuotaBytes?: number;
};

type BackgroundLoginSuccess = {
  ok: true;
  data: {
    token: string;
    user: Record<string, unknown> | null;
    backendBaseUrl: string;
  };
};

type BackgroundLoginFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: string;
  };
};

type BackgroundLogoutResult = {
  ok: true;
  data: {
    loggedOut: boolean;
  };
};

type BackgroundProfileSuccess = {
  ok: true;
  data: ProfileSnapshot;
};

function runtimeMessage<T>(message: Record<string, unknown>) {
  return new Promise<T>((resolve, reject) => {
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

async function loadSession(): Promise<SessionSnapshot> {
  const snapshot = await storageGet<Record<string, unknown>>([
    STORAGE_KEYS.authToken,
    STORAGE_KEYS.authUser,
    STORAGE_KEYS.backendBaseUrl,
  ]);

  return {
    token: (snapshot[STORAGE_KEYS.authToken] as string | null | undefined) ?? null,
    user: (snapshot[STORAGE_KEYS.authUser] as SessionSnapshot['user']) ?? null,
    backendBaseUrl: normalizeBackendBaseUrl(
      (snapshot[STORAGE_KEYS.backendBaseUrl] as string | null | undefined) ??
        DEFAULT_BACKEND_BASE_URL
    ),
  };
}

function formatBytes(bytes?: number) {
  const normalized = Number(bytes || 0);
  if (!normalized) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const power = Math.min(Math.floor(Math.log(normalized) / Math.log(1024)), units.length - 1);
  const value = normalized / 1024 ** power;
  return `${value.toFixed(power === 0 ? 0 : 2)} ${units[power]}`;
}

function formatDate(date?: string) {
  if (!date) return 'Unknown';

  return new Date(date).toLocaleDateString('vi-VN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function getInitials(name?: string | null, email?: string | null) {
  const source = (name || email || 'U').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] || 'U';
  const second = parts.length > 1 ? parts[parts.length - 1]?.[0] || '' : source[1] || '';
  return `${first}${second}`.toUpperCase();
}

export default function Popup() {
  const [email, setEmail] = useState('demo@example.com');
  const [password, setPassword] = useState('');
  const [session, setSession] = useState<SessionSnapshot>({
    token: null,
    user: null,
    backendBaseUrl: DEFAULT_BACKEND_BASE_URL,
  });
  const [profile, setProfile] = useState<ProfileSnapshot | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);

  const isAuthenticated = Boolean(session.token);

  const titleLine = useMemo(() => {
    if (profile?.displayName) {
      return profile.displayName;
    }

    if (session.user?.displayName) {
      return session.user.displayName;
    }

    if (profile?.email) {
      return profile.email;
    }

    if (session.user?.email) {
      return session.user.email;
    }

    return 'Extension session';
  }, [profile, session.user]);

  const storageUsedBytes = Number(profile?.storageUsedBytes || 0);
  const storageQuotaBytes = Math.max(Number(profile?.storageQuotaBytes || 0), 1);
  const usageRatio = Math.min(storageUsedBytes / storageQuotaBytes, 1);
  const usagePercent = Math.round(usageRatio * 100);
  type StorageChangeEntry = {
    oldValue?: unknown;
    newValue?: unknown;
  };

  const hydrateSession = async () => {
    const currentSession = await loadSession();
    setSession(currentSession);
    setStatusMessage(
      currentSession.token
        ? 'Signed in and ready to detect images on the current page.'
        : 'Sign in before using AI Scan on the page.'
    );

    if (currentSession.token) {
      setIsLoadingProfile(true);
      try {
        const response = await runtimeMessage<BackgroundProfileSuccess | BackgroundLoginFailure>({
          type: 'AI_MEDIA_INSPECTOR_GET_PROFILE',
        });

        if (!response.ok) {
          throw new Error(response.error.message);
        }

        setProfile(response.data);
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : 'Failed to load the profile summary.'
        );
      } finally {
        setIsLoadingProfile(false);
      }
    } else {
      setProfile(null);
    }
  };

  useEffect(() => {
    void hydrateSession().catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to read the saved session.');
    });

    const handleStorageChange = (changes: Record<string, StorageChangeEntry>, areaName: string) => {
      if (areaName !== 'local') {
        return;
      }

      if (
        !changes[STORAGE_KEYS.authToken] &&
        !changes[STORAGE_KEYS.authUser] &&
        !changes[STORAGE_KEYS.backendBaseUrl]
      ) {
        return;
      }

      void hydrateSession().catch((error: unknown) => {
        setErrorMessage(
          error instanceof Error ? error.message : 'Failed to refresh the saved session.'
        );
      });
    };

    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  const handleLogin = async () => {
    setIsSubmitting(true);
    setErrorMessage('');
    setStatusMessage('Logging in...');

    try {
      const response = await runtimeMessage<BackgroundLoginSuccess | BackgroundLoginFailure>({
        type: 'AI_MEDIA_INSPECTOR_LOGIN',
        payload: {
          email,
          password,
          backendBaseUrl: DEFAULT_BACKEND_BASE_URL,
        },
      });

      if (!response.ok) {
        throw new Error(response.error.message);
      }

      const nextSession = {
        token: response.data.token,
        user: (response.data.user as SessionSnapshot['user']) ?? null,
        backendBaseUrl: response.data.backendBaseUrl,
      };

      await storageSet({
        [STORAGE_KEYS.authToken]: response.data.token,
        [STORAGE_KEYS.authUser]: response.data.user ?? null,
        [STORAGE_KEYS.backendBaseUrl]: response.data.backendBaseUrl,
      });

      setSession(nextSession);
      setStatusMessage('Signed in. Loading profile summary...');

      const profileResponse = await runtimeMessage<
        BackgroundProfileSuccess | BackgroundLoginFailure
      >({
        type: 'AI_MEDIA_INSPECTOR_GET_PROFILE',
      });

      if (!profileResponse.ok) {
        throw new Error(profileResponse.error.message);
      }

      setProfile(profileResponse.data);
      setStatusMessage('Signed in. You can now scan images from the page.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Login failed.');
      setStatusMessage('Login did not complete.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    setIsSubmitting(true);
    setErrorMessage('');
    setStatusMessage('Signing out...');

    try {
      const response = await runtimeMessage<BackgroundLogoutResult | BackgroundLoginFailure>({
        type: 'AI_MEDIA_INSPECTOR_LOGOUT',
      });

      if (!response.ok) {
        throw new Error(response.error.message);
      }

      await storageRemove([STORAGE_KEYS.authToken, STORAGE_KEYS.authUser]);

      setSession({
        token: null,
        user: null,
        backendBaseUrl: session.backendBaseUrl,
      });
      setProfile(null);
      setStatusMessage('Signed out. Log in again to enable detection.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Logout failed.');
      setStatusMessage('Logout did not complete.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const avatarText = getInitials(
    profile?.displayName || session.user?.displayName,
    profile?.email || session.user?.email
  );
  const storageRemainingBytes = Math.max(storageQuotaBytes - storageUsedBytes, 0);
  const statusSummary = isAuthenticated
    ? 'Local backend connected. Scan actions are ready from the page overlay.'
    : 'Sign in once to unlock the page scanner, profile summary, and local session state.';

  const Skeleton = ({ style }: { style: React.CSSProperties }) => (
    <span style={{ ...styles.skeleton, ...style }} aria-hidden="true" />
  );

  return (
    <div style={styles.shell}>
      <style>{`
        @keyframes ai-media-inspector-skeleton-shimmer {
          0% {
            background-position: 200% 0;
          }
          100% {
            background-position: -200% 0;
          }
        }
      `}</style>

      <div style={styles.header}>
        <div>
          <p style={styles.eyebrow}>AI Media Inspector</p>
          <h2 style={styles.title}>Scan pages for synthetic media</h2>
        </div>
      </div>

      <p style={styles.subtitle}>
        Use your local backend to detect AI-generated images on the current page. Sign in once, then
        hover an image and click <strong>AI Scan</strong>.
      </p>

      {isAuthenticated ? (
        <>
          <div
            style={{
              ...styles.profileCard,
              ...(isLoadingProfile ? styles.profileCardLoading : {}),
            }}
          >
            <div style={styles.profileTop}>
              <div style={styles.avatar} aria-hidden="true">
                {isLoadingProfile ? (
                  <Skeleton style={styles.skeletonAvatar} />
                ) : profile?.avatar ? (
                  <img src={profile.avatar} alt="" style={styles.avatarImage} />
                ) : (
                  avatarText
                )}
              </div>

              <div style={styles.profileCopy}>
                {isLoadingProfile ? (
                  <>
                    <Skeleton style={styles.skeletonLineShort} />
                    <div style={{ height: 10 }} />
                    <Skeleton style={styles.skeletonLineLong} />
                    <div style={{ height: 8 }} />
                    <div style={styles.profileMetaRow}>
                      <Skeleton style={styles.skeletonChip} />
                      <Skeleton style={styles.skeletonChip} />
                    </div>
                  </>
                ) : (
                  <>
                    <div style={styles.profileName}>{titleLine}</div>
                    <div style={styles.profileEmail}>
                      {profile?.email || session.user?.email || 'Signed in user'}
                    </div>
                    <div style={styles.profileMetaRow}>
                      <span style={styles.metaChip}>{profile?.role || 'USER'}</span>
                      <span style={styles.metaChip}>
                        Member since {formatDate(profile?.createdAt)}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div style={styles.statsGrid}>
              <div style={styles.statCard}>
                {isLoadingProfile ? (
                  <>
                    <Skeleton style={styles.skeletonStatValue} />
                    <Skeleton style={styles.skeletonStatLabel} />
                  </>
                ) : (
                  <>
                    <div style={styles.statValue}>{profile?.totalDetections ?? 0}</div>
                    <div style={styles.statLabel}>Total detections</div>
                  </>
                )}
              </div>
              <div style={styles.statCard}>
                {isLoadingProfile ? (
                  <>
                    <Skeleton style={styles.skeletonStatValue} />
                    <Skeleton style={styles.skeletonStatLabel} />
                  </>
                ) : (
                  <>
                    <div style={{ ...styles.statValue, color: '#dc2626' }}>
                      {profile?.aiDetections ?? 0}
                    </div>
                    <div style={styles.statLabel}>AI-generated</div>
                  </>
                )}
              </div>
              <div style={styles.statCard}>
                {isLoadingProfile ? (
                  <>
                    <Skeleton style={styles.skeletonStatValue} />
                    <Skeleton style={styles.skeletonStatLabel} />
                  </>
                ) : (
                  <>
                    <div style={{ ...styles.statValue, color: '#16a34a' }}>
                      {profile?.realDetections ?? 0}
                    </div>
                    <div style={styles.statLabel}>Real images</div>
                  </>
                )}
              </div>
            </div>
          </div>

          <div
            style={{ ...styles.quotaCard, ...(isLoadingProfile ? styles.quotaCardLoading : {}) }}
          >
            <div style={styles.quotaHeader}>
              <div>
                <div style={styles.sectionLabel}>Storage quota</div>
                <div style={styles.quotaTitle}>Profile usage overview</div>
              </div>
              {isLoadingProfile ? (
                <Skeleton style={styles.skeletonQuotaBadge} />
              ) : (
                <div style={styles.quotaBadge}>{usagePercent}% used</div>
              )}
            </div>

            {isLoadingProfile ? (
              <div style={styles.quotaTrack} aria-hidden="true">
                <div style={styles.quotaTrackSkeleton} />
              </div>
            ) : (
              <div style={styles.quotaTrack} aria-hidden="true">
                <div style={{ ...styles.quotaFill, width: `${usagePercent}%` }} />
              </div>
            )}

            <div style={styles.quotaStats}>
              <div style={styles.quotaStat}>
                {isLoadingProfile ? (
                  <>
                    <Skeleton style={styles.skeletonQuotaLabel} />
                    <Skeleton style={styles.skeletonQuotaValue} />
                  </>
                ) : (
                  <>
                    <div style={styles.quotaStatLabel}>Used</div>
                    <div style={styles.quotaStatValue}>{formatBytes(storageUsedBytes)}</div>
                  </>
                )}
              </div>
              <div style={styles.quotaStat}>
                {isLoadingProfile ? (
                  <>
                    <Skeleton style={styles.skeletonQuotaLabel} />
                    <Skeleton style={styles.skeletonQuotaValue} />
                  </>
                ) : (
                  <>
                    <div style={styles.quotaStatLabel}>Limit</div>
                    <div style={styles.quotaStatValue}>{formatBytes(storageQuotaBytes)}</div>
                  </>
                )}
              </div>
              <div style={styles.quotaStat}>
                {isLoadingProfile ? (
                  <>
                    <Skeleton style={styles.skeletonQuotaLabel} />
                    <Skeleton style={styles.skeletonQuotaValue} />
                  </>
                ) : (
                  <>
                    <div style={styles.quotaStatLabel}>Remaining</div>
                    <div style={styles.quotaStatValue}>{formatBytes(storageRemainingBytes)}</div>
                  </>
                )}
              </div>
            </div>
          </div>

          <div style={styles.cardStatus}>
            <div style={styles.statusHeader}>
              <div>
                <div style={styles.statusLabel}>Status</div>
                <div style={styles.statusTitle}>Ready to scan</div>
              </div>
              <div style={styles.statusAccent}>AI scan enabled</div>
            </div>
            <div style={styles.statusText}>{statusMessage || statusSummary}</div>
            <div style={styles.statusSupportRow}>
              <span style={styles.statusSupportChip}>Page overlay</span>
              <span style={styles.statusSupportChip}>Local backend</span>
              <span style={styles.statusSupportChip}>Confidence signal</span>
            </div>
          </div>

          <div style={styles.sessionCard}>
            <div style={styles.sessionHeader}>
              <div>
                <div style={styles.sessionLabel}>Session</div>
                <div style={styles.sessionValue}>JWT stored locally</div>
              </div>
              <button
                type="button"
                onClick={() => void handleLogout()}
                disabled={isSubmitting}
                style={{
                  ...styles.linkButton,
                  opacity: isSubmitting ? 0.7 : 1,
                  cursor: isSubmitting ? 'not-allowed' : 'pointer',
                }}
              >
                {isSubmitting ? 'Signing out...' : 'Sign out'}
              </button>
            </div>
            <div style={styles.sessionMeta}>
              <span>Token: {session.token ? 'saved' : 'missing'}</span>
              <span>Backend: {session.backendBaseUrl}</span>
            </div>
          </div>
        </>
      ) : (
        <>
          <div style={styles.heroCard}>
            <div style={styles.heroMark} aria-hidden="true">
              <div style={styles.heroMarkRing} />
              <div style={styles.heroMarkCore}>SCAN</div>
            </div>
            <div style={styles.heroCopy}>
              <div style={styles.heroKicker}>Browser extension · local AI backend</div>
              <div style={styles.heroTitle}>Turn every page into a detection surface.</div>
              <div style={styles.heroText}>
                Keep the popup lightweight, but make the action obvious: authenticate once, then
                scan images in context without leaving the page.
              </div>
              <div style={styles.heroPillRow}>
                <span style={styles.heroPill}>Synthetic media</span>
                <span style={styles.heroPill}>Confidence review</span>
                <span style={styles.heroPill}>Page overlay</span>
              </div>
            </div>
          </div>

          <div style={styles.formCard}>
            <label style={styles.label} htmlFor="email">
              Email
            </label>
            <input
              id="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="demo@example.com"
              style={styles.input}
            />

            <label style={{ ...styles.label, marginTop: 12 }} htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Your backend password"
              style={styles.input}
            />

            <div style={styles.formMeta}>This only unlocks the local extension session.</div>

            <button
              type="button"
              onClick={() => void handleLogin()}
              disabled={isSubmitting || !email.trim() || !password.trim()}
              style={{
                ...styles.primaryButton,
                opacity: isSubmitting || !email.trim() || !password.trim() ? 0.7 : 1,
                cursor:
                  isSubmitting || !email.trim() || !password.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              {isSubmitting && !isAuthenticated ? 'Signing in...' : 'Login to scan'}
            </button>
          </div>

          <div style={styles.cardStatus}>
            <div style={styles.statusHeader}>
              <div>
                <div style={styles.statusLabel}>Status</div>
                <div style={styles.statusTitle}>Not logged in</div>
              </div>
              <div style={styles.statusAccentMuted}>Login required</div>
            </div>
            <div style={styles.statusText}>{statusMessage || statusSummary}</div>
            <div style={styles.statusSupportRow}>
              <span style={styles.statusSupportChip}>Secure session</span>
              <span style={styles.statusSupportChip}>AI analysis</span>
              <span style={styles.statusSupportChip}>On-page scan</span>
            </div>
          </div>
        </>
      )}

      {errorMessage && <div style={styles.errorBox}>{errorMessage}</div>}

      <div style={styles.footerNote}>
        Open the extension popup to refresh auth, then hover an image and click AI Scan.
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    width: 360,
    padding: 18,
    fontFamily: 'Inter, Segoe UI, Arial, sans-serif',
    color: '#0f172a',
    background:
      'radial-gradient(circle at top left, rgba(37, 99, 235, 0.16), transparent 28%), radial-gradient(circle at 100% 0%, rgba(34, 197, 94, 0.12), transparent 22%), linear-gradient(180deg, #f7faff 0%, #edf3ff 100%)',
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  eyebrow: {
    margin: 0,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: '#1d4ed8',
  },
  title: {
    margin: '6px 0 0',
    fontSize: 19,
    lineHeight: 1.15,
    fontWeight: 700,
  },
  subtitle: {
    margin: '10px 0 0',
    fontSize: 13,
    lineHeight: 1.55,
    color: '#475569',
  },
  heroCard: {
    marginTop: 14,
    padding: 14,
    borderRadius: 22,
    background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.96), rgba(30, 41, 59, 0.96))',
    border: '1px solid rgba(96, 165, 250, 0.18)',
    boxShadow: '0 16px 28px rgba(15, 23, 42, 0.18)',
    color: '#f8fafc',
    display: 'flex',
    gap: 12,
    alignItems: 'center',
  },
  heroMark: {
    width: 70,
    height: 70,
    borderRadius: 22,
    background:
      'radial-gradient(circle at 35% 35%, rgba(96, 165, 250, 0.28), transparent 40%), linear-gradient(135deg, rgba(37, 99, 235, 0.92), rgba(34, 197, 94, 0.88))',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    flexShrink: 0,
    overflow: 'hidden',
  },
  heroMarkRing: {
    position: 'absolute',
    inset: 10,
    borderRadius: 18,
    border: '1px solid rgba(255, 255, 255, 0.28)',
    boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.08)',
  },
  heroMarkCore: {
    position: 'relative',
    zIndex: 1,
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: '0.18em',
  },
  heroCopy: {
    minWidth: 0,
    flex: 1,
  },
  heroKicker: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: '#93c5fd',
  },
  heroTitle: {
    marginTop: 6,
    fontSize: 18,
    lineHeight: 1.18,
    fontWeight: 700,
    color: '#f8fafc',
  },
  heroText: {
    marginTop: 6,
    fontSize: 12.5,
    lineHeight: 1.5,
    color: '#cbd5e1',
  },
  heroPillRow: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
    marginTop: 10,
  },
  heroPill: {
    padding: '5px 8px',
    borderRadius: 999,
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.08)',
    color: '#e2e8f0',
    fontSize: 11,
    fontWeight: 700,
  },
  formCard: {
    marginTop: 14,
    padding: 14,
    borderRadius: 20,
    background: 'rgba(255,255,255,0.92)',
    border: '1px solid rgba(148, 163, 184, 0.2)',
    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
  },
  profileCard: {
    marginTop: 14,
    padding: 16,
    borderRadius: 20,
    background: 'linear-gradient(135deg, rgba(255,255,255,0.96), rgba(241,245,249,0.94))',
    border: '1px solid rgba(148, 163, 184, 0.18)',
    boxShadow: '0 10px 24px rgba(15, 23, 42, 0.08)',
  },
  profileCardLoading: {
    background: 'linear-gradient(135deg, rgba(255,255,255,0.98), rgba(248,250,252,0.98))',
    border: '1px solid rgba(191, 219, 254, 0.88)',
    boxShadow: '0 10px 24px rgba(37, 99, 235, 0.08)',
  },
  profileTop: {
    display: 'flex',
    gap: 12,
    alignItems: 'center',
  },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 18,
    background: 'linear-gradient(135deg, #2563eb, #22c55e)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 800,
    fontSize: 18,
    overflow: 'hidden',
    flexShrink: 0,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  profileCopy: {
    minWidth: 0,
    flex: 1,
  },
  profileName: {
    fontSize: 18,
    fontWeight: 700,
    color: '#0f172a',
    lineHeight: 1.15,
  },
  profileEmail: {
    marginTop: 4,
    fontSize: 13,
    color: '#475569',
    overflowWrap: 'anywhere',
  },
  profileMetaRow: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: 10,
  },
  metaChip: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '6px 10px',
    borderRadius: 999,
    background: 'rgba(37, 99, 235, 0.08)',
    color: '#1e40af',
    fontSize: 11,
    fontWeight: 700,
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 8,
    marginTop: 14,
  },
  statCard: {
    padding: 10,
    borderRadius: 14,
    background: 'rgba(255,255,255,0.92)',
    border: '1px solid rgba(226, 232, 240, 0.95)',
    textAlign: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: 700,
    color: '#2563eb',
    lineHeight: 1.1,
  },
  statLabel: {
    marginTop: 4,
    fontSize: 11,
    color: '#64748b',
    fontWeight: 700,
  },
  skeleton: {
    display: 'block',
    background:
      'linear-gradient(90deg, rgba(226, 232, 240, 0.9) 0%, rgba(248, 250, 252, 1) 50%, rgba(226, 232, 240, 0.9) 100%)',
    backgroundSize: '200% 100%',
    animation: 'ai-media-inspector-skeleton-shimmer 1.35s ease-in-out infinite',
  },
  skeletonAvatar: {
    width: 54,
    height: 54,
    borderRadius: 18,
  },
  skeletonLineShort: {
    width: '58%',
    height: 18,
    borderRadius: 999,
  },
  skeletonLineLong: {
    width: '84%',
    height: 12,
    borderRadius: 999,
  },
  skeletonChip: {
    width: 94,
    height: 28,
    borderRadius: 999,
  },
  skeletonStatValue: {
    width: '64%',
    height: 22,
    borderRadius: 999,
    margin: '0 auto',
  },
  skeletonStatLabel: {
    width: '76%',
    height: 10,
    borderRadius: 999,
    margin: '10px auto 0',
  },
  quotaCard: {
    marginTop: 14,
    padding: 16,
    borderRadius: 20,
    background: 'rgba(15, 23, 42, 0.96)',
    color: '#f8fafc',
  },
  quotaCardLoading: {
    background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.95), rgba(15, 23, 42, 0.98))',
  },
  quotaHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: '#93c5fd',
  },
  quotaTitle: {
    marginTop: 6,
    fontSize: 16,
    fontWeight: 700,
  },
  quotaBadge: {
    padding: '7px 10px',
    borderRadius: 999,
    background: 'rgba(147, 197, 253, 0.14)',
    color: '#dbeafe',
    fontSize: 12,
    fontWeight: 700,
    whiteSpace: 'nowrap',
  },
  skeletonQuotaBadge: {
    width: 74,
    height: 28,
    borderRadius: 999,
  },
  quotaTrack: {
    marginTop: 14,
    height: 12,
    borderRadius: 999,
    overflow: 'hidden',
    background: 'rgba(148, 163, 184, 0.24)',
  },
  quotaTrackSkeleton: {
    width: '42%',
    height: '100%',
    borderRadius: 999,
  },
  quotaFill: {
    height: '100%',
    borderRadius: 999,
    background: 'linear-gradient(90deg, #60a5fa, #22c55e)',
  },
  quotaStats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 8,
    marginTop: 14,
  },
  quotaStat: {
    padding: 10,
    borderRadius: 14,
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(148, 163, 184, 0.16)',
  },
  quotaStatLabel: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: '#94a3b8',
    fontWeight: 700,
  },
  quotaStatValue: {
    marginTop: 4,
    fontSize: 14,
    fontWeight: 800,
    color: '#f8fafc',
  },
  skeletonQuotaLabel: {
    width: '52%',
    height: 10,
    borderRadius: 999,
  },
  skeletonQuotaValue: {
    width: '72%',
    height: 16,
    borderRadius: 999,
    marginTop: 8,
  },
  cardStatus: {
    marginTop: 14,
    padding: 14,
    borderRadius: 18,
    background: 'linear-gradient(135deg, rgba(255,255,255,0.96), rgba(241,245,249,0.96))',
    border: '1px solid rgba(148, 163, 184, 0.18)',
  },
  statusHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  label: {
    display: 'block',
    marginBottom: 6,
    fontSize: 12,
    fontWeight: 700,
    color: '#334155',
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 12,
    border: '1px solid #cbd5e1',
    outline: 'none',
    background: '#fff',
    fontSize: 13,
    color: '#0f172a',
    boxSizing: 'border-box',
  },
  formMeta: {
    marginTop: 10,
    fontSize: 12,
    lineHeight: 1.45,
    color: '#64748b',
  },
  primaryButton: {
    width: '100%',
    marginTop: 12,
    padding: '11px 12px',
    borderRadius: 14,
    border: 'none',
    background: 'linear-gradient(135deg, #1d4ed8, #2563eb)',
    color: '#fff',
    fontWeight: 700,
    fontSize: 13,
    boxShadow: '0 10px 18px rgba(37, 99, 235, 0.22)',
  },
  linkButton: {
    padding: 0,
    border: 'none',
    background: 'transparent',
    color: '#1d4ed8',
    fontWeight: 700,
    fontSize: 12,
  },
  statusLabel: {
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: '#64748b',
  },
  statusTitle: {
    marginTop: 6,
    fontSize: 15,
    fontWeight: 700,
  },
  statusText: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 1.5,
    color: '#475569',
  },
  statusAccent: {
    padding: '7px 10px',
    borderRadius: 999,
    background: '#dbeafe',
    color: '#1d4ed8',
    fontSize: 11,
    fontWeight: 700,
    whiteSpace: 'nowrap',
  },
  statusAccentMuted: {
    padding: '7px 10px',
    borderRadius: 999,
    background: '#e2e8f0',
    color: '#334155',
    fontSize: 11,
    fontWeight: 700,
    whiteSpace: 'nowrap',
  },
  statusSupportRow: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
    marginTop: 10,
  },
  statusSupportChip: {
    padding: '5px 8px',
    borderRadius: 999,
    background: 'rgba(37, 99, 235, 0.08)',
    color: '#1e40af',
    fontSize: 11,
    fontWeight: 700,
  },
  sessionCard: {
    marginTop: 14,
    padding: 14,
    borderRadius: 18,
    background: '#0f172a',
    color: '#f8fafc',
  },
  sessionHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  sessionLabel: {
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: '#93c5fd',
  },
  sessionValue: {
    marginTop: 6,
    fontSize: 15,
    fontWeight: 700,
  },
  sessionMeta: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    marginTop: 10,
    fontSize: 12,
    color: '#cbd5e1',
  },
  errorBox: {
    marginTop: 14,
    padding: 12,
    borderRadius: 14,
    background: '#fef2f2',
    color: '#b91c1c',
    border: '1px solid #fecaca',
    fontSize: 13,
    lineHeight: 1.45,
  },
  footerNote: {
    marginTop: 14,
    fontSize: 12,
    lineHeight: 1.5,
    color: '#64748b',
    textAlign: 'center',
  },
};
