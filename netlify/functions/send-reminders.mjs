import webpush from "web-push";
import { getStore } from "@netlify/blobs";

export default async () => {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;

  if (!publicKey || !privateKey || !subject) {
    console.error("Brak konfiguracji VAPID.");
    return;
  }

  const store = getStore("footballos-push");

  const subscription = await store.get("subscription", { type: "json" });
  const events = await store.get("events", { type: "json" });

  if (!subscription || !Array.isArray(events)) return;

  let sentReminders =
    (await store.get("sent-reminders", { type: "json" })) || {};

  webpush.setVapidDetails(subject, publicKey, privateKey);

  const now = new Date();

 // =========================
// SZKOŁA — przypomnienia dzień wcześniej
// 15:00, 17:00 i 19:00
// =========================

const schoolEvents = events.filter(
  (event) =>
    event?.id &&
    event?.date &&
    event?.title &&
    ["test", "quiz", "homework", "project", "presentation", "school"].includes(
      event.category
    )
);

const tomorrow = new Date(now);
tomorrow.setDate(tomorrow.getDate() + 1);

const tomorrowDate =
  tomorrow.getFullYear() +
  "-" +
  String(tomorrow.getMonth() + 1).padStart(2, "0") +
  "-" +
  String(tomorrow.getDate()).padStart(2, "0");

const schoolTomorrow = schoolEvents.filter(
  (event) => event.date === tomorrowDate
);

const schoolHours = [15, 17, 19];

if (schoolTomorrow.length > 0) {
  const currentHour = now.getHours();

  for (const hour of schoolHours) {
    if (currentHour !== hour || now.getMinutes() > 1) continue;

    const schoolKey = `school-${tomorrowDate}-${hour}`;

    if (sentReminders[schoolKey]) continue;

    const items = schoolTomorrow
      .map((event) => `• ${event.title}`)
      .join("\n");

    let message;

    if (hour === 15) {
      message = `Jutro:\n${items}\nWarto zacząć naukę. 📚`;
    } else if (hour === 17) {
      message = `Pamiętaj o jutrze:\n${items}\nMożesz jeszcze chwilę się pouczyć. 📖`;
    } else {
      message = `Ostatnie przypomnienie na dziś:\n${items}\nPrzygotuj się na jutro. 💪`;
    }

    try {
      await webpush.sendNotification(
        subscription,
        JSON.stringify({
          title: "📚 FootballOS — szkoła",
          body: message,
          url: "/",
        })
      );

      sentReminders[schoolKey] = new Date().toISOString();

      await store.setJSON("sent-reminders", sentReminders);

      console.log("Wysłano szkolne przypomnienie:", schoolKey);
    } catch (error) {
      console.error("Błąd wysyłania szkolnego Push:", error);
    }
  }
}

  // =========================
  // TRENINGI / MECZE — 30 minut wcześniej
  // =========================

  for (const event of events) {
    if (
      !event?.id ||
      !event?.date ||
      !event?.time ||
      event.reminder !== true
    ) {
      continue;
    }

    if (
      ["test", "quiz", "homework", "project", "presentation", "school"].includes(
        event.category
      )
    ) {
      continue;
    }

    const eventTime = new Date(`${event.date}T${event.time}:00+02:00`);
   const reminderMinutes =
  Number.isFinite(Number(event.reminderMinutes))
    ? Number(event.reminderMinutes)
    : 30;

const reminderTime = new Date(
  eventTime.getTime() - reminderMinutes * 60 * 1000
);

    const difference = Math.abs(
      now.getTime() - reminderTime.getTime()
    );

    if (difference > 90 * 1000) continue;

    const reminderKey = `${event.id}-${event.date}-${event.time}`;

    if (sentReminders[reminderKey]) continue;

   const reminderText =
  reminderMinutes === 1
    ? "za 1 minutę"
    : `za ${reminderMinutes} minut`;

const title =
  event.category === "match"
    ? `⚽ Mecz ${reminderText}!`
    : `🏃 Trening ${reminderText}!`;

    const body = event.title || "Masz zaplanowane wydarzenie.";

    try {
      await webpush.sendNotification(
        subscription,
        JSON.stringify({
          title,
          body,
          url: "/",
        })
      );

      sentReminders[reminderKey] = new Date().toISOString();

      await store.setJSON("sent-reminders", sentReminders);

      console.log("Wysłano przypomnienie:", reminderKey);
    } catch (error) {
      console.error("Błąd wysyłania Push:", error);
    }
  }
};

export const config = {
  schedule: "* * * * *",
};
