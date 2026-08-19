import { initializeApp, getApps, getApp } from "firebase/app";
import { getAI, getGenerativeModel, GoogleAIBackend } from "firebase/ai";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "",
};

const isConfigured = Object.values(firebaseConfig).every(Boolean);

let model = null;
let app = null;

function getFirebaseApp() {
  if (!isConfigured) {
    throw new Error("FIREBASE_AI_NOT_CONFIGURED");
  }

  if (!app) {
    app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  }

  return app;
}

function getModel() {
  const firebaseApp = getFirebaseApp();

  if (!model) {
    const ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });
    model = getGenerativeModel(ai, {
      model: "gemini-3.6-flash",
    });
  }

  return model;
}

function toFirebaseParts(message) {
  const parts = [];

  if (typeof message?.content === "string" && message.content.trim()) {
    parts.push({ text: message.content });
  }

  if (Array.isArray(message?.content)) {
    for (const item of message.content) {
      if (item.type === "text") {
        parts.push({ text: item.text || "" });
      }

      if (item.type === "image" && item.source?.data) {
        parts.push({
          inlineData: {
            mimeType: item.source.media_type || "image/jpeg",
            data: item.source.data,
          },
        });
      }
    }
  }

  return parts;
}

function toFirebasePrompt(system, messages) {
  const prompt = [];

  if (system?.trim()) {
    prompt.push(`Instrukcja systemowa:\n${system.trim()}`);
  }

  for (const message of messages || []) {
    const parts = toFirebaseParts(message);
    if (parts.length === 0) continue;

    // Firebase AI Logic Web accepts a prompt made from strings/parts.
    // We preserve conversation roles as plain text so the SDK does not
    // receive nested { role, parts } objects where it expects Part objects.
    if (message.role === "assistant") {
      prompt.push("Odpowiedź asystenta:\n" + parts.filter((p) => p.text).map((p) => p.text).join("\n"));
    } else if (message.role === "user") {
      prompt.push(...parts);
    } else {
      prompt.push(...parts);
    }
  }

  return prompt;
}

export function firebaseAIConfigured() {
  return isConfigured;
}

export async function firebaseAICall({ system = "", messages = [] }) {
  const generativeModel = getModel();
  const prompt = toFirebasePrompt(system, messages);

  if (prompt.length === 0) {
    throw new Error("EMPTY_AI_PROMPT");
  }

  const result = await generativeModel.generateContent(prompt);
  return result.response.text() || "";
}
