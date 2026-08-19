import webpush from "web-push";

function localWarsawParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("pl-PL", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

function isoDate({ year, month, day }) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDays(dateString, days) {
  const d = new Date(`${dateString}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default async () => {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:szymon.guziec@icloud.com";
  const supabaseUrl = process.env.SUPABASE_URL || "https://ukymxrosjectjvlbrzdw.supabase.co";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!publicKey || !privateKey || !serviceKey) {
    console.error("Brak VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY lub SUPABASE_SERVICE_ROLE_KEY.");
    return;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);

  const now = localWarsawParts();
  const reminderHours = new Set([15, 17, 19]);
  if (!reminderHours.has(now.hour) || now.minute !== 0) return;

  const today = isoDate(now);
  const targetDate = addDays(today, 1);

  const response = await fetch(
    `${supabaseUrl}/rest/v1/app_data?select=user_id,data`,
    {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Supabase error ${response.status}: ${await response.text()}`);
  }

  const rows = await response.json();

  for (const row of rows || []) {
    const data = row?.data || {};
    const subscription = data?.pushSubscription;
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) continue;

    const schoolItems = Array.isArray(data.schoolItems) ? data.schoolItems : [];
    const matching = schoolItems.filter((item) => item?.date === targetDate);
    if (!matching.length) continue;

    const names = matching.slice(0, 3).map((item) => item?.name || item?.subject || "wydarzenie szkolne");
    const body = `${names.join(", ")} — przypomnienie na jutro.`;

    try {
      await webpush.sendNotification(
        subscription,
        JSON.stringify({
          title: "Moje Centrum ⚽",
          body,
          url: "/",
        }),
      );
    } catch (error) {
      console.error(`Push failed for ${row.user_id}:`, error?.message || error);
    }
  }
};

export const config = {
  schedule: "* * * * *",
};
