import webpush from "web-push";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://ukymxrosjectjvlbrzdw.supabase.co";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT;

const TIME_ZONE = "Europe/Warsaw";
const REMINDER_HOURS = new Set([15, 17, 19]);

function getWarsawParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    date: `${values.year}-${values.month}-${values.day}`,
  };
}

function addDays(dateString, days) {
  const d = new Date(`${dateString}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

async function supabase(path, options = {}) {
  if (!SERVICE_ROLE_KEY) throw new Error("Brak SUPABASE_SERVICE_ROLE_KEY w Netlify.");

  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(payload?.message || payload?.msg || `Supabase ${response.status}`);
  }

  return payload;
}

export default async () => {
  const now = getWarsawParts();

  // Scheduled function runs every hour; only 15:00, 17:00 and 19:00 in Poland send reminders.
  if (!REMINDER_HOURS.has(now.hour) || now.minute > 5) {
    return new Response("Skipped");
  }

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    throw new Error("Brak konfiguracji VAPID w Netlify.");
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const tomorrow = addDays(now.date, 1);
  const rows = await supabase("/rest/v1/app_data?select=user_id,data");

  let sent = 0;
  let skipped = 0;

  for (const row of rows || []) {
    const data = row?.data || {};
    const subscription = data.pushSubscription;
    const enabled = data.settings?.notificationsEnabled;

    if (!enabled || !subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      skipped += 1;
      continue;
    }

    const schoolItems = Array.isArray(data.schoolItems)
      ? data.schoolItems.filter((item) => item?.date === tomorrow)
      : [];

    if (!schoolItems.length) continue;

    const remindedLog = Array.isArray(data.remindedSchoolLog) ? data.remindedSchoolLog : [];
    const eventKeys = schoolItems.map((item) => String(item.id ?? `${item.subject || "szkoła"}-${item.name || "wydarzenie"}-${item.date}`));
    const reminderKey = `${tomorrow}|${now.hour}`;

    if (remindedLog.includes(reminderKey)) continue;

    const body = schoolItems
      .slice(0, 4)
      .map((item) => `• ${item.subject ? item.subject + ": " : ""}${item.name || "Wydarzenie szkolne"}`)
      .join("\n");

    try {
      await webpush.sendNotification(
        subscription,
        JSON.stringify({
          title: "Moje Centrum 📚",
          body: `Jutro: ${body}`,
          url: "/",
        })
      );

      const nextData = {
        ...data,
        remindedSchoolLog: [...remindedLog, reminderKey].slice(-100),
      };

      await supabase(`/rest/v1/app_data?user_id=eq.${encodeURIComponent(row.user_id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          data: nextData,
          updated_at: new Date().toISOString(),
        }),
      });

      sent += 1;
    } catch (error) {
      console.error("School reminder push error", {
        userId: row.user_id,
        message: error?.message,
        eventKeys,
      });
    }
  }

  return Response.json({ ok: true, hour: now.hour, tomorrow, sent, skipped });
};

export const config = {
  schedule: "0 * * * *",
};
