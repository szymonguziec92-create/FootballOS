import { initializeApp, getApps, getApp } from "firebase/app";
import { initializeAppCheck, DebugProvider } from "firebase/app-check";
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
let appCheckInitialized = false;

function getFirebaseApp() {
  if (!isConfigured) {
    throw new Error("FIREBASE_AI_NOT_CONFIGURED");
  }

  if (!app) {
    app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  }

  if (!appCheckInitialized) {
    try {
      initializeAppCheck(app, {
        provider: new DebugProvider(),
        isTokenAutoRefreshEnabled: true,
      });
    } catch (error) {
      // App Check can already be initialized during hot reload.
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

function toFirebaseContents(messages) {
  const contents = [];

  for (const message of messages || []) {
    const parts = [];

    if (typeof message.content === "string" && message.content.trim()) {
      parts.push({ text: message.content });
    }

    if (Array.isArray(message.content)) {
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

    if (parts.length) {
      contents.push({
        role: message.role === "assistant" ? "model" : "user",
        parts,
      });
    }
  }

  return contents;
}

export function firebaseAIConfigured() {
  return isConfigured;
}

export async function firebaseAICall({ system = "", messages = [] }) {
  const generativeModel = getModel();
  const contents = toFirebaseContents(messages);

  if (system) {
    contents.unshift({
      role: "user",
      parts: [{ text: `Instrukcja systemowa:\n${system}` }],
    });
  }

  const result = await generativeModel.generateContent(contents);
  return result.response.text() || "";
}
