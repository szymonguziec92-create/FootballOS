import { getStore } from "@netlify/blobs";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const subscription = await req.json();

    if (
      !subscription?.endpoint ||
      !subscription?.keys?.p256dh ||
      !subscription?.keys?.auth
    ) {
      return Response.json(
        { error: "Nieprawidłowa subskrypcja." },
        { status: 400 }
      );
    }

    const store = getStore("footballos-push");

    await store.setJSON("subscription", subscription);

    return Response.json({ ok: true });
  } catch (error) {
    console.error(error);

    return Response.json(
      { error: error?.message || "Nie udało się zapisać subskrypcji." },
      { status: 500 }
    );
  }
};