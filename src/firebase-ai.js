import { initializeApp, getApps, getApp } from "firebase/app";
import { initializeAppCheck, CustomProvider } from "firebase/app-check";
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
const appCheckDebugToken = import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN || "";

let model = null;
let app = null;
let appCheckInitialized = false;

function getFirebaseApp() {
  if (!isConfigured) {
    throw new Error("FIREBASE_AI_NOT_CONFIGURED");
  }

  if (!app) {
    app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  }

  if (!appCheckInitialized) {
    if (!appCheckDebugToken) {
      throw new Error("FIREBASE_APPCHECK_DEBUG_TOKEN_MISSING");
    }

    const provider = new CustomProvider({
      getToken: async () => ({
        token: appCheckDebugToken,
        expireTimeMillis: Date.now() + 60 * 60 * 1000,
      }),
    });

    try {
      initializeAppCheck(app, {
        provider,
        isTokenAutoRefreshEnabled: true,
      });
    } catch (error) {
      if (!String(error?.message || "").toLowerCase().includes("already")) {
        throw error;
      }
    }

    appCheckInitialized = true;
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

function toFirebaseParts(messages) {
  const parts = [];

  for (const message of messages || []) {
    if (typeof message.content === "string" && message.content.trim()) {
      parts.push({ text: message.content });
      continue;
    }

    if (!Array.isArray(message.content)) continue;

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

export function firebaseAIConfigured() {
  return isConfigured && Boolean(appCheckDebugToken);
}

export async function firebaseAICall({ system = "", messages = [] }) {
  const generativeModel = getModel();
  const parts = [];

  if (system) {
    parts.push({ text: `Instrukcja systemowa:\n${system}` });
  }

  parts.push(...toFirebaseParts(messages));

  const result = await generativeModel.generateContent(parts);
  return result.response.text() || "";
}
