import { getStore } from "@netlify/blobs";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const events = await req.json();

    if (!Array.isArray(events)) {
      return Response.json(
        { error: "Nieprawidłowa lista wydarzeń." },
        { status: 400 }
      );
    }

    const store = getStore("footballos-push");

    await store.setJSON(
      "events",
      events.filter((e) => e && e.reminder === true)
    );

    return Response.json({ ok: true });
  } catch (error) {
    console.error(error);

    return Response.json(
      { error: error?.message || "Nie udało się zapisać wydarzeń." },
      { status: 500 }
    );
  }
};