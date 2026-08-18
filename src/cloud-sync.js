// Klucz publishable jest przeznaczony do aplikacji klienckiej. Dostęp do danych
// zabezpieczają reguły RLS z pliku supabase-setup.sql.
const SUPABASE_URL = "https://ukymxrosjectjvlbrzdw.supabase.co";
const SUPABASE_PUBLIC_KEY = "sb_publishable_2Wuo6ATUgghKe_UbtWMF5w_XBiUqYmx";
const SESSION_KEY = "pilkarz-app:supabase-session";

async function request(path, { method = "GET", body, token } = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: SUPABASE_PUBLIC_KEY,
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = payload?.msg || payload?.message || payload?.error_description || payload?.error || `Błąd ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

function storeSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function getStoredSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { return null; }
}

export async function restoreSession() {
  const session = getStoredSession();
  if (!session?.access_token) return null;
  if (!session.expires_at || session.expires_at * 1000 > Date.now() + 60_000) return session;
  if (!session.refresh_token) { signOutCloud(); return null; }
  try {
    const refreshed = await request("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: session.refresh_token } });
    storeSession(refreshed);
    return refreshed;
  } catch {
    signOutCloud();
    return null;
  }
}

export async function signInWithPassword(email, password) {
  const result = await request("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password } });
  storeSession(result);
  return result;
}

export async function signUpWithPassword(email, password) {
  const result = await request("/auth/v1/signup", { method: "POST", body: { email, password } });
  if (result.session) storeSession(result.session);
  return result;
}

export function signOutCloud() {
  localStorage.removeItem(SESSION_KEY);
}

export async function loadCloudData(session) {
  const rows = await request(`/rest/v1/app_data?select=data&user_id=eq.${encodeURIComponent(session.user.id)}&limit=1`, { token: session.access_token });
  return rows[0]?.data || null;
}

export async function saveCloudData(session, data) {
  const userId = session.user.id;

  const existing = await request(
    `/rest/v1/app_data?select=user_id&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
    { token: session.access_token }
  );

  if (existing?.length) {
    await request(
      `/rest/v1/app_data?user_id=eq.${encodeURIComponent(userId)}`,
      {
        method: "PATCH",
        token: session.access_token,
        body: {
          data,
          updated_at: new Date().toISOString(),
        },
      }
    );
  } else {
    await request("/rest/v1/app_data", {
      method: "POST",
      token: session.access_token,
      body: {
        user_id: userId,
        data,
        updated_at: new Date().toISOString(),
      },
    });
  }
}
