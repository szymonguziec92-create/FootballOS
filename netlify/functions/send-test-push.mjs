import webpush from "web-push";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;

  if (!publicKey || !privateKey || !subject) {
    return Response.json({ error: "Brak konfiguracji VAPID w Netlify." }, { status: 500 });
  }

  try {
    const subscription = await req.json();
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return Response.json({ error: "Nieprawidłowa subskrypcja push." }, { status: 400 });
    }

    webpush.setVapidDetails(
  "mailto:szymon.guziec@icloud.com",
  publicKey,
  privateKey
);

    await webpush.sendNotification(
      subscription,
      JSON.stringify({
        title: "Moje Centrum ⚽",
        body: "Działa! Powiadomienia push są już włączone 🎉",
        url: "/",
      })
    );

    return Response.json({ ok: true });
  } catch (error) {
    console.error("Push error", error);
    return Response.json({ error: error?.message || "Nie udało się wysłać powiadomienia." }, { status: 500 });
  }
};
