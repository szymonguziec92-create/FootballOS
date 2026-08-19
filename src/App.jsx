import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { getDailySnack, getDietSummary } from "./snack-utils.js";
import { getWaterAmount, changeWater } from "./water-utils.js";
import TrainingGeneratorTabNew from "./TrainingGeneratorTabNew.jsx";
import { getStoredSession, restoreSession, signInWithPassword, signUpWithPassword, signOutCloud, loadCloudData, saveCloudData } from "./cloud-sync.js";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell,
} from "recharts";
import {
  Home, Calendar as CalendarIcon, Dumbbell, Apple, GraduationCap, Bot, Menu, X, Plus, Trash2,
  Flame, Droplet, Moon, Sun, Check, ChevronLeft, ChevronRight, Target, Clock, Users, Save,
  Trophy, BookOpen, ListChecks, User, Settings, Send, RotateCcw, Star, StarOff, Search, Award,
  AlertTriangle, TrendingUp, Activity, Shirt, Bell, FileText, CalendarDays,
} from "lucide-react";

/* ============================== HELPERS ============================== */

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const pad = (n) => String(n).padStart(2, "0");
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => toISO(new Date());
const fromISO = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (iso, n) => {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
};
const diffDays = (iso1, iso2) => Math.round((fromISO(iso2) - fromISO(iso1)) / 86400000);
const startOfWeek = (iso) => {
  const d = fromISO(iso);
  const day = (d.getDay() + 6) % 7; // monday = 0
  d.setDate(d.getDate() - day);
  return toISO(d);
};
const MONTHS_PL = ["stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca", "lipca", "sierpnia", "września", "października", "listopada", "grudnia"];
const MONTHS_PL_NOM = ["Styczeń", "Luty", "Marzec", "Kwiecień", "Maj", "Czerwiec", "Lipiec", "Sierpień", "Wrzesień", "Październik", "Listopad", "Grudzień"];
const DAYS_PL = ["Pon", "Wt", "Śr", "Czw", "Pt", "Sob", "Nie"];
const formatDatePL = (iso) => {
  const d = fromISO(iso);
  return `${d.getDate()} ${MONTHS_PL[d.getMonth()]}`;
};
const isToday = (iso) => iso === todayISO();

// Web Push — publiczny klucz VAPID może być w kodzie aplikacji. Klucz prywatny
// jest trzymany wyłącznie jako zmienna środowiskowa w Netlify Function.
const VAPID_PUBLIC_KEY = "BOFuVugjsZYD27n_7wAkvkz4qjgUu5kmmroe-qODi_E5HibfK5vtzBv-7wxsMN8MEcx9JhVgY1I5YxlZZUjxQxc";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

async function subscribeToPush() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Brak obsługi Service Worker.");
  }

  if (!("PushManager" in window)) {
    throw new Error("Brak obsługi Web Push.");
  }

  if (!("Notification" in window)) {
    throw new Error("Brak obsługi powiadomień.");
  }

  let permission = Notification.permission;

if (permission === "default") {
  permission = await Notification.requestPermission();
}

if (permission !== "granted") {
  throw new Error("STATUS POWIADOMIEŃ: " + permission);
}

  const registration = await navigator.serviceWorker.register("/push-sw.js", {
    scope: "/",
  });

  await navigator.serviceWorker.ready;

  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const response = await fetch("/.netlify/functions/send-test-push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(subscription),
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      result.error || "Nie udało się wysłać powiadomienia."
    );
  }
await fetch("/.netlify/functions/save-subscription", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify(subscription),
});
  return subscription;
}

// Wywołania AI: 1) Anthropic bez klucza (działa "od razu" wewnątrz Claude),
// 2) jeśli to nie zadziała (appka poza Claude) — Google Gemini (darmowy klucz,
// bez karty płatniczej), 3) jeśli podano — Anthropic z własnym kluczem (płatny po kredycie).
async function anthropicCall(apiKey, system, messages, maxTokens) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  }
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers,
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: maxTokens, system, messages }),
  });
  if (!response.ok) {
    const t = await response.text().catch(() => "");
    throw new Error(`Anthropic error ${response.status}: ${t.slice(0, 200)}`);
  }
  const data = await response.json();
  return (data.content || []).map((c) => c.text || "").join("\n");
}

async function geminiCall(apiKey, system, messages) {
  const res = await fetch("/api/ai", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      system,
      messages,
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`AI error ${res.status}: ${t.slice(0, 300)}`);
  }

  const data = await res.json();

  return (
    data.text ||
    data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("\n") ||
    ""
  );
}

async function askAI(profile, options) {
  const {
    system = "",
    messages = [],
    maxTokens = 1000,
  } = options || {};

  const response = await fetch("/api/ai", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      system,
      messages,
      maxTokens,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    const error = new Error(
      data?.error || "Nie udało się połączyć z AI."
    );

    if (data?.error?.includes("GEMINI_API_KEY")) {
      error.code = "NO_PROVIDER";
    }

    throw error;
  }

  return data.text || "";
}


const CATEGORIES = {
  football: { label: "Trening piłkarski", color: "#C6FF3D", icon: "⚽" },
  strength: { label: "Trening siłowy", color: "#FF5A36", icon: "🏋️" },
  match: { label: "Mecz", color: "#FFD23C", icon: "🏆" },
  school: { label: "Szkoła", color: "#5AA9FF", icon: "🏫" },
  test: { label: "Sprawdzian", color: "#FF3CAC", icon: "📝" },
  quiz: { label: "Kartkówka", color: "#FF8A3C", icon: "✏️" },
  homework: { label: "Zadanie domowe", color: "#B9B0FF", icon: "📚" },
  recovery: { label: "Regeneracja", color: "#3CD2FF", icon: "🧊" },
  other: { label: "Inne", color: "#B0B8B4", icon: "•" },
};

const MUSCLE_GROUPS = [
  { id: "legs", label: "Nogi" },
  { id: "core", label: "Brzuch / Core" },
  { id: "back", label: "Plecy" },
  { id: "chest", label: "Klatka" },
  { id: "full", label: "Całe ciało" },
  { id: "stability", label: "Stabilizacja" },
  { id: "mobility", label: "Mobilność" },
];

const DIFFICULTIES = ["Łatwy", "Średni", "Trudny"];

const DRILL_CATEGORIES = ["Drybling", "Podania", "Przyjęcie piłki", "Szybkość", "Zwinność", "Koordynacja", "Strzały", "Technika", "Fizyczność", "Wytrzymałość", "Szybkość reakcji"];

const MEAL_TAGS = {
  breakfast: "Śniadanie", preTraining: "Przed treningiem", postTraining: "Po treningu",
  preMatch: "Przed meczem", postMatch: "Po meczu", school: "Do szkoły", dinner: "Kolacja", snack: "Przekąska",
};

const POINT_TOOLS = [
  { id: "cone", label: "Pachołek", glyph: "▲", color: "#FF7A3C" },
  { id: "pole", label: "Tyczka", glyph: "❙", color: "#FFD23C" },
  { id: "ladder", label: "Drabinka", glyph: "▦", color: "#CFCFCF" },
  { id: "ball", label: "Piłka", glyph: "●", color: "#FFFFFF" },
  { id: "marker", label: "Znacznik", glyph: "✕", color: "#C6FF3D" },
  { id: "smallGoal", label: "Mała bramka", glyph: "⊓", color: "#5AA9FF" },
  { id: "bigGoal", label: "Duża bramka", glyph: "⊓⊓", color: "#3CD2FF" },
  { id: "obstacle", label: "Przeszkoda", glyph: "▤", color: "#FF5A36" },
  { id: "player", label: "Zawodnik", glyph: "P", color: "#3CD2FF" },
];
const LINE_TOOLS = [
  { id: "runLine", label: "Linia biegu", color: "#C6FF3D" },
  { id: "arrow", label: "Strzał / podanie", color: "#FF5A36" },
];
const LABEL_PRESETS = ["Start zawodnika", "Tutaj ma biec", "Tutaj oddaje strzał", "Tutaj podaje", "Cel"];

const FOOD_DB = [
  { id: "chicken", name: "Kurczak (pierś)", kcal: 165, protein: 31, carbs: 0, fat: 3.6 },
  { id: "rice_w", name: "Ryż biały (gotowany)", kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 },
  { id: "rice_b", name: "Ryż brązowy (gotowany)", kcal: 123, protein: 2.6, carbs: 25, fat: 1 },
  { id: "pasta", name: "Makaron (gotowany)", kcal: 158, protein: 5.8, carbs: 31, fat: 0.9 },
  { id: "egg", name: "Jajko", kcal: 155, protein: 13, carbs: 1.1, fat: 11 },
  { id: "banana", name: "Banan", kcal: 89, protein: 1.1, carbs: 23, fat: 0.3 },
  { id: "apple", name: "Jabłko", kcal: 52, protein: 0.3, carbs: 14, fat: 0.2 },
  { id: "oats", name: "Płatki owsiane", kcal: 389, protein: 17, carbs: 66, fat: 7 },
  { id: "milk", name: "Mleko 2%", kcal: 50, protein: 3.4, carbs: 5, fat: 2 },
  { id: "yogurt", name: "Jogurt naturalny", kcal: 61, protein: 3.5, carbs: 4.7, fat: 3.3 },
  { id: "cheese", name: "Ser żółty", kcal: 350, protein: 25, carbs: 1.3, fat: 27 },
  { id: "bread", name: "Chleb pełnoziarnisty", kcal: 247, protein: 13, carbs: 41, fat: 3.4 },
  { id: "peanut", name: "Masło orzechowe", kcal: 588, protein: 25, carbs: 20, fat: 50 },
  { id: "nuts", name: "Orzechy mieszane", kcal: 607, protein: 20, carbs: 21, fat: 54 },
  { id: "avocado", name: "Awokado", kcal: 160, protein: 2, carbs: 9, fat: 15 },
  { id: "salmon", name: "Łosoś", kcal: 208, protein: 20, carbs: 0, fat: 13 },
  { id: "tuna", name: "Tuńczyk (w wodzie)", kcal: 116, protein: 26, carbs: 0, fat: 1 },
  { id: "broccoli", name: "Brokuł", kcal: 34, protein: 2.8, carbs: 7, fat: 0.4 },
  { id: "potato", name: "Ziemniaki (gotowane)", kcal: 87, protein: 1.9, carbs: 20, fat: 0.1 },
  { id: "honey", name: "Miód", kcal: 304, protein: 0.3, carbs: 82, fat: 0 },
];

/* ---- Duża baza produktów (generowana, ~1000 pozycji) ---- */
const FOOD_CATS = ["Napoje", "Warzywa", "Owoce", "Mięso i wędliny", "Ryby i owoce morza", "Nabiał", "Pieczywo i zboża", "Makarony i ryż", "Słodycze i przekąski", "Orzechy i bakalie", "Dania gotowe", "Przyprawy i dodatki", "Odżywki sportowe"];

function hashVariance(str, spread = 0.12) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  const r = (h % 1000) / 1000; // 0..1
  return 1 + (r - 0.5) * 2 * spread;
}
function mk(name, category, kcal, protein, carbs, fat) {
  const v = hashVariance(name);
  const id = "gf_" + name.toLowerCase().replace(/[^a-ząćęłńóśżź0-9]+/gi, "_").replace(/^_+|_+$/g, "");
  return { id, name, category, kcal: Math.round(kcal * v), protein: +(protein * v).toFixed(1), carbs: +(carbs * v).toFixed(1), fat: +(fat * v).toFixed(1) };
}
function combine(base, mods, category, macroFn) {
  const out = [];
  base.forEach((b) => {
    mods.forEach((m) => {
      const name = `${b} ${m}`;
      const mm = macroFn(b, m);
      out.push(mk(name, category, mm[0], mm[1], mm[2], mm[3]));
    });
  });
  return out;
}

function generateFoodDatabase() {
  const items = [];

  // NAPOJE
  const napTypy = [["Sok", [45, 0.3, 11, 0]], ["Nektar", [55, 0.2, 13, 0]], ["Napój gazowany", [42, 0, 10.6, 0]], ["Woda smakowa", [18, 0, 4.5, 0]], ["Kompot", [40, 0.1, 10, 0]], ["Herbata mrożona", [30, 0, 7.5, 0]], ["Napój izotoniczny", [26, 0, 6.5, 0]], ["Napój energetyczny", [45, 0, 11, 0]], ["Lemoniada", [38, 0, 9.5, 0]], ["Napój mleczny", [62, 3.2, 9, 1.8]]];
  const smaki = ["pomarańczowy", "jabłkowy", "cytrynowy", "malinowy", "wiśniowy", "brzoskwiniowy", "truskawkowy", "ananasowy", "grejpfrutowy", "mango", "czarna porzeczka", "gruszkowy", "arbuzowy", "limonkowy", "multiwitamina"];
  napTypy.forEach(([typ, m]) => smaki.forEach((s) => items.push(mk(`${typ} ${s}`, "Napoje", m[0], m[1], m[2], m[3]))));
  [["Woda mineralna niegazowana", 0, 0, 0, 0], ["Woda mineralna gazowana", 0, 0, 0, 0], ["Kawa czarna", 2, 0.1, 0, 0], ["Kawa z mlekiem", 35, 1.5, 3, 1.6], ["Herbata czarna", 1, 0, 0.3, 0], ["Herbata zielona", 1, 0, 0.2, 0], ["Kakao na mleku", 85, 3.6, 11, 3], ["Mleko 0,5%", 35, 3.3, 5, 0.5], ["Mleko 2%", 50, 3.4, 5, 2], ["Mleko 3,2%", 61, 3.2, 4.7, 3.2], ["Maślanka", 40, 3.3, 4.8, 0.5], ["Kefir", 52, 3.3, 4.1, 2.5]].forEach((f) => items.push(mk(f[0], "Napoje", f[1], f[2], f[3], f[4])));

  // WARZYWA
  const warzywa = ["Marchew", "Ziemniak", "Pomidor", "Ogórek", "Papryka czerwona", "Papryka żółta", "Cebula", "Czosnek", "Brokuł", "Kalafior", "Kapusta biała", "Kapusta czerwona", "Szpinak", "Sałata", "Cukinia", "Bakłażan", "Fasolka szparagowa", "Groszek zielony", "Kukurydza", "Buraki", "Rzodkiewka", "Pietruszka korzeń", "Seler", "Por", "Szczypiorek", "Koper", "Brukselka", "Jarmuż", "Rukola", "Botwinka", "Dynia", "Pieczarki", "Boczniaki", "Rzepa", "Fasola biała", "Ciecierzyca", "Soczewica czerwona", "Soczewica zielona", "Bób", "Kapusta pekińska"];
  const wForm = [["świeże", 1], ["gotowane", 0.95], ["mrożone", 0.9], ["z puszki", 0.85]];
  warzywa.forEach((w) => wForm.forEach(([f, mult]) => items.push(mk(`${w} (${f})`, "Warzywa", 32 * mult, 2 * mult, 6 * mult, 0.3 * mult))));

  // OWOCE
  const owoce = ["Jabłko", "Banan", "Pomarańcza", "Mandarynka", "Gruszka", "Winogrona", "Truskawki", "Maliny", "Jagody", "Wiśnie", "Czereśnie", "Śliwki", "Brzoskwinia", "Nektarynka", "Morela", "Kiwi", "Ananas", "Mango", "Arbuz", "Melon", "Grejpfrut", "Cytryna", "Limonka", "Granat", "Figi", "Daktyle", "Żurawina", "Jeżyny", "Porzeczki czarne", "Porzeczki czerwone", "Agrest", "Awokado", "Papaja", "Liczi", "Pomelo"];
  const oForm = [["świeże", 1, 1], ["suszone", 3.2, 0.35], ["mrożone", 0.95, 1], ["z puszki w syropie", 1.3, 1]];
  owoce.forEach((o) => oForm.forEach(([f, kmul, other]) => items.push(mk(`${o} (${f})`, "Owoce", 55 * kmul, 0.6 * other, 13 * kmul * 0.9, 0.3 * other))));

  // MIĘSO I WĘDLINY
  const mieso = [["Kurczak", 165, 31, 0, 3.6], ["Indyk", 150, 29, 0, 3], ["Wołowina", 250, 26, 0, 16], ["Wieprzowina", 290, 25, 0, 21], ["Cielęcina", 172, 27, 0, 6.5], ["Jagnięcina", 294, 25, 0, 21], ["Kaczka", 337, 19, 0, 28]];
  const cuts = ["pierś", "udko", "filet", "mielone", "schab", "karkówka", "żeberka", "polędwica"];
  mieso.forEach(([b, k, p, c, f]) => cuts.forEach((cut) => items.push(mk(`${b} (${cut})`, "Mięso i wędliny", k, p, c, f))));
  [["Szynka gotowana", 110, 18, 1, 3.5], ["Szynka wędzona", 145, 20, 1, 6], ["Kiełbasa śląska", 300, 15, 2, 26], ["Kiełbasa krakowska", 270, 16, 1.5, 22], ["Parówki drobiowe", 220, 12, 3, 18], ["Boczek wędzony", 480, 12, 0, 47], ["Salami", 400, 20, 2, 35], ["Mortadela", 280, 15, 3, 24], ["Kabanosy", 380, 28, 1, 29], ["Pasztet drobiowy", 310, 12, 4, 27]].forEach((f) => items.push(mk(f[0], "Mięso i wędliny", f[1], f[2], f[3], f[4])));

  // RYBY I OWOCE MORZA
  const ryby = [["Łosoś", 208, 20, 0, 13], ["Tuńczyk", 116, 26, 0, 1], ["Dorsz", 82, 18, 0, 0.7], ["Pstrąg", 148, 20, 0, 7], ["Makrela", 205, 19, 0, 14], ["Sardynka", 208, 25, 0, 11], ["Śledź", 158, 18, 0, 9], ["Halibut", 111, 21, 0, 2.3], ["Mintaj", 92, 20, 0, 1], ["Karp", 162, 18, 0, 9]];
  const rForm = ["świeży", "wędzony", "w oleju", "w sosie pomidorowym"];
  ryby.forEach(([b, k, p, c, f]) => rForm.forEach((rf) => items.push(mk(`${b} (${rf})`, "Ryby i owoce morza", k, p, c, f))));
  [["Krewetki", 99, 24, 0.2, 0.3], ["Kalmary", 92, 15, 3, 1.4], ["Małże", 86, 12, 3.7, 2.2], ["Ośmiornica", 82, 15, 2, 1]].forEach((f) => items.push(mk(f[0], "Ryby i owoce morza", f[1], f[2], f[3], f[4])));

  // NABIAŁ
  const nabialSmakowy = ["Jogurt owocowy", "Jogurt grecki", "Skyr", "Serek wiejski", "Deser mleczny"];
  const nSmaki = ["naturalny", "truskawkowy", "malinowy", "waniliowy", "brzoskwiniowy", "wiśniowy", "bananowy", "czekoladowy"];
  nabialSmakowy.forEach((b) => nSmaki.forEach((s) => items.push(mk(`${b} ${s}`, "Nabiał", 95, 6, 9, 3.5))));
  [["Jogurt naturalny", 61, 3.5, 4.7, 3.3], ["Kefir naturalny", 52, 3.3, 4.1, 2.5], ["Maślanka naturalna", 40, 3.3, 4.8, 0.5], ["Twaróg półtłusty", 130, 18, 3.5, 5], ["Twaróg chudy", 96, 19, 3.5, 0.5], ["Ser żółty gouda", 356, 25, 1.3, 27], ["Ser żółty edamski", 310, 26, 0, 23], ["Ser topiony", 280, 16, 4, 22], ["Ser feta", 264, 14, 4, 21], ["Ser mozzarella", 280, 22, 2, 21], ["Śmietana 18%", 195, 2.8, 3.5, 18], ["Śmietana 30%", 292, 2.4, 3.2, 30], ["Mleko 0,5%", 35, 3.3, 5, 0.5], ["Mleko 2%", 50, 3.4, 5, 2], ["Mleko 3,2%", 61, 3.2, 4.7, 3.2], ["Mleko bez laktozy", 48, 3.3, 4.9, 1.8], ["Serek homogenizowany", 130, 8, 14, 4.5]].forEach((f) => items.push(mk(f[0], "Nabiał", f[1], f[2], f[3], f[4])));

  // PIECZYWO I ZBOŻA
  [["Chleb pszenny", 265, 8, 49, 3.3], ["Chleb żytni", 220, 6.5, 45, 1.5], ["Chleb pełnoziarnisty", 247, 13, 41, 3.4], ["Chleb orkiszowy", 245, 10, 44, 2.8], ["Chleb graham", 240, 9, 44, 2.5], ["Bułka pszenna", 275, 9, 51, 3], ["Bułka kajzerka", 280, 9, 52, 3.2], ["Bagietka", 270, 9, 53, 1.5], ["Chleb tostowy", 265, 8, 49, 3.5], ["Chleb razowy", 210, 7, 40, 1.5], ["Bułka grahamka", 250, 9, 45, 3], ["Pumpernikiel", 200, 6, 38, 1.2], ["Chałka", 330, 8, 50, 10], ["Rogalik maślany", 406, 8, 45, 21], ["Precel", 340, 10, 65, 3], ["Płatki owsiane", 389, 17, 66, 7], ["Płatki kukurydziane", 357, 7, 84, 0.9], ["Płatki żytnie", 335, 9, 68, 2], ["Musli", 375, 10, 64, 8], ["Otręby pszenne", 216, 16, 64, 4.3], ["Kasza gryczana", 343, 13, 72, 3.4], ["Kasza jaglana", 378, 11, 73, 4.2], ["Kasza jęczmienna", 354, 10, 77, 2.3], ["Kasza manna", 360, 10, 73, 1], ["Kasza kuskus", 376, 13, 77, 0.6], ["Quinoa", 368, 14, 64, 6], ["Bulgur", 342, 12, 76, 1.3], ["Granola", 471, 10, 60, 20]].forEach((f) => items.push(mk(f[0], "Pieczywo i zboża", f[1], f[2], f[3], f[4])));

  // MAKARONY I RYŻ
  const makarony = [["Makaron pszenny", 158, 5.8, 31, 0.9], ["Makaron pełnoziarnisty", 150, 6, 30, 1.3], ["Makaron ryżowy", 109, 1.8, 25, 0.2], ["Makaron jajeczny", 165, 6.5, 30, 2.5], ["Makaron soba", 99, 5, 21, 0.1], ["Makaron orkiszowy", 155, 6, 29, 1.5], ["Spaghetti", 158, 5.8, 31, 0.9], ["Penne", 158, 5.8, 31, 0.9], ["Fusilli", 158, 5.8, 31, 0.9], ["Tagliatelle", 158, 5.8, 31, 0.9]];
  const mForm = [["surowy", 3.5], ["gotowany", 1]];
  makarony.forEach(([b, k, p, c, f]) => mForm.forEach(([mf, mult]) => items.push(mk(`${b} (${mf})`, "Makarony i ryż", k * mult, p * mult, c * mult, f * mult))));
  const ryze = [["Ryż biały", 130, 2.7, 28, 0.3], ["Ryż brązowy", 123, 2.6, 25, 1], ["Ryż basmati", 121, 3.5, 25, 0.4], ["Ryż jaśminowy", 129, 2.7, 28, 0.2], ["Ryż paraboliczny", 136, 2.9, 30, 0.3], ["Ryż do sushi", 130, 2.4, 29, 0.2]];
  ryze.forEach(([b, k, p, c, f]) => mForm.forEach(([mf, mult]) => items.push(mk(`${b} (${mf})`, "Makarony i ryż", k * mult, p * mult, c * mult, f * mult))));

  // SŁODYCZE I PRZEKĄSKI
  const slodBase = [["Czekolada mleczna", 535, 7.6, 57, 30], ["Czekolada gorzka", 546, 5, 61, 31], ["Czekolada biała", 539, 6, 59, 30], ["Baton czekoladowy", 480, 6, 60, 24], ["Ciastka owsiane", 440, 7, 65, 17], ["Ciastka maślane", 480, 6, 65, 22], ["Herbatniki", 435, 7, 74, 12], ["Wafle ryżowe", 387, 8, 81, 2.8], ["Chipsy ziemniaczane", 536, 6.5, 53, 34], ["Chipsy kukurydziane", 500, 6, 62, 25], ["Precelki solone", 380, 10, 75, 3], ["Paluszki słone", 410, 11, 72, 8], ["Lody waniliowe", 207, 3.5, 24, 11], ["Lody czekoladowe", 216, 3.8, 26, 11], ["Lody owocowe (sorbet)", 130, 0.5, 32, 0.1], ["Cukierki żelki", 343, 6, 77, 0.2], ["Cukierki twarde", 390, 0, 98, 0], ["Pianki marshmallow", 318, 1.8, 81, 0.2], ["Ciasto drożdżowe z owocami", 280, 5, 48, 8], ["Sernik", 321, 6, 26, 22], ["Szarlotka", 260, 3, 38, 11], ["Pączek", 350, 5, 43, 18], ["Drożdżówka z serem", 320, 7, 42, 14], ["Croissant", 406, 8, 45, 21], ["Baton musli", 380, 6, 65, 12]];
  slodBase.forEach((b) => items.push(mk(b[0], "Słodycze i przekąski", b[1], b[2], b[3], b[4])));
  ["truskawkowy", "orzechowy", "kokosowy", "karmelowy"].forEach((s) => ["Baton", "Ciastka", "Lody", "Żelki"].forEach((t) => items.push(mk(`${t} ${s}`, "Słodycze i przekąski", 420, 5, 58, 17))));

  // ORZECHY I BAKALIE
  const orzechyBase = [["Migdały", 579, 21, 22, 50], ["Orzechy włoskie", 654, 15, 14, 65], ["Orzechy laskowe", 628, 15, 17, 61], ["Orzechy nerkowca", 553, 18, 30, 44], ["Orzechy ziemne", 567, 26, 16, 49], ["Pistacje", 560, 20, 28, 45], ["Orzechy brazylijskie", 656, 14, 12, 66], ["Orzechy makadamia", 718, 8, 14, 76]];
  const orzForm = ["naturalne", "prażone", "solone"];
  orzechyBase.forEach(([b, k, p, c, f]) => orzForm.forEach((of) => items.push(mk(`${b} (${of})`, "Orzechy i bakalie", k, p, c, f))));
  [["Pestki dyni", 559, 30, 11, 49], ["Pestki słonecznika", 584, 21, 20, 51], ["Siemię lniane", 534, 18, 29, 42], ["Chia", 486, 17, 42, 31], ["Sezam", 573, 18, 23, 50], ["Wiórki kokosowe", 660, 7, 24, 65], ["Suszona żurawina", 325, 0.1, 82, 1.4], ["Rodzynki", 299, 3.1, 79, 0.5], ["Morele suszone", 241, 3.4, 63, 0.5], ["Śliwki suszone", 240, 2.2, 64, 0.4], ["Daktyle suszone", 282, 2.5, 75, 0.4], ["Figi suszone", 249, 3.3, 64, 0.9]].forEach((f) => items.push(mk(f[0], "Orzechy i bakalie", f[1], f[2], f[3], f[4])));

  // DANIA GOTOWE / FAST FOOD
  const dania = [["Pizza margherita", 266, 11, 33, 10], ["Pizza pepperoni", 296, 13, 32, 13], ["Pizza z kurczakiem", 250, 14, 30, 9], ["Burger wołowy", 295, 17, 24, 15], ["Burger z kurczakiem", 260, 15, 26, 11], ["Kebab w picie", 250, 13, 28, 10], ["Zapiekanka", 270, 10, 33, 11], ["Pierogi ruskie", 200, 6, 30, 6], ["Pierogi z mięsem", 220, 9, 27, 8], ["Pierogi z owocami", 190, 4, 38, 3], ["Naleśniki z serem", 230, 8, 28, 9], ["Naleśniki z owocami", 210, 5, 33, 6], ["Frytki", 312, 3.4, 41, 15], ["Nuggetsy drobiowe", 296, 15, 17, 19], ["Sushi maki łosoś", 150, 6, 25, 2.5], ["Sushi maki ogórek", 120, 3, 26, 0.5], ["Sajgonki", 220, 5, 24, 11], ["Krokiety", 210, 7, 25, 9], ["Gulasz wołowy", 165, 15, 6, 9], ["Bigos", 120, 8, 8, 6], ["Rosół z makaronem", 55, 3.5, 6, 2], ["Zupa pomidorowa", 45, 1.5, 7, 1.2], ["Żurek", 70, 3, 8, 3], ["Krupnik", 60, 2.5, 9, 1.5], ["Kotlet schabowy z ziemniakami", 260, 15, 20, 13], ["Kurczak curry z ryżem", 200, 12, 24, 6], ["Spaghetti bolognese", 175, 9, 21, 6], ["Lasagne", 195, 10, 18, 9], ["Risotto grzybowe", 165, 4, 26, 5], ["Sałatka cezar", 180, 12, 8, 11], ["Sałatka grecka", 140, 5, 8, 10], ["Tortilla z kurczakiem", 220, 13, 22, 8], ["Falafel", 333, 13, 32, 18], ["Hummus", 166, 8, 14, 10], ["Omlet", 154, 11, 1, 12], ["Jajecznica", 150, 11, 1, 11], ["Tost z szynką i serem", 260, 13, 26, 11]];
  dania.forEach((d) => items.push(mk(d[0], "Dania gotowe", d[1], d[2], d[3], d[4])));
  ["mała porcja", "duża porcja"].forEach((p) => dania.slice(0, 20).forEach((d) => items.push(mk(`${d[0]} (${p})`, "Dania gotowe", d[1] * (p === "duża porcja" ? 1.4 : 0.7), d[2], d[3], d[4]))));

  // PRZYPRAWY I DODATKI
  [["Olej rzepakowy", 884, 0, 0, 100], ["Oliwa z oliwek", 884, 0, 0, 100], ["Masło", 717, 0.9, 0.1, 81], ["Margaryna", 717, 0.2, 0.5, 80], ["Ketchup", 112, 1.3, 27, 0.2], ["Majonez", 680, 1.1, 2.6, 75], ["Musztarda", 66, 4, 5, 3.4], ["Sos sojowy", 60, 8, 6, 0], ["Sos BBQ", 172, 1, 40, 0.5], ["Sos czosnkowy", 380, 1.5, 6, 39], ["Ocet balsamiczny", 88, 0.5, 17, 0], ["Miód", 304, 0.3, 82, 0], ["Dżem truskawkowy", 250, 0.4, 62, 0.1], ["Dżem morelowy", 245, 0.4, 60, 0.1], ["Nutella", 539, 6, 57, 31], ["Masło orzechowe", 588, 25, 20, 50], ["Masło migdałowe", 614, 21, 19, 56], ["Cukier biały", 400, 0, 100, 0], ["Cukier trzcinowy", 398, 0, 99, 0], ["Syrop klonowy", 260, 0, 67, 0], ["Syrop z agawy", 310, 0, 76, 0], ["Sól", 0, 0, 0, 0], ["Pieprz czarny", 251, 10, 64, 3], ["Papryka słodka mielona", 282, 14, 54, 13], ["Cynamon", 247, 4, 81, 1.2]].forEach((f) => items.push(mk(f[0], "Przyprawy i dodatki", f[1], f[2], f[3], f[4])));

  // ODŻYWKI SPORTOWE
  ["waniliowa", "czekoladowa", "truskawkowa", "orzechowa"].forEach((s) => items.push(mk(`Odżywka białkowa ${s}`, "Odżywki sportowe", 380, 75, 8, 5)));
  [["Baton proteinowy", 380, 25, 38, 13], ["Żel energetyczny", 260, 0, 65, 0], ["Izotonik proszek (napój)", 26, 0, 6.5, 0], ["Kreatyna (porcja 5g)", 0, 0, 0, 0], ["BCAA proszek", 5, 1, 0, 0], ["Baton energetyczny", 400, 8, 60, 14], ["Gainer waniliowy", 380, 25, 55, 5]].forEach((f) => items.push(mk(f[0], "Odżywki sportowe", f[1], f[2], f[3], f[4])));

  // deduplicate by id
  const seen = new Set();
  return items.filter((it) => { if (seen.has(it.id)) return false; seen.add(it.id); return true; });
}

const GENERATED_FOODS = generateFoodDatabase();

const DEFAULT_MEALS = [
  { id: "m_pretr1", name: "Banan + owsianka na mleku", foods: [{ id: "banana", qty: 120 }, { id: "oats", qty: 60 }, { id: "milk", qty: 150 }], tags: ["preTraining", "breakfast"], favorite: false },
  { id: "m_posttr1", name: "Kurczak z ryżem", foods: [{ id: "chicken", qty: 150 }, { id: "rice_w", qty: 200 }, { id: "broccoli", qty: 100 }], tags: ["postTraining", "dinner"], favorite: false },
  { id: "m_prematch1", name: "Makaron z łososiem (lekko)", foods: [{ id: "pasta", qty: 150 }, { id: "salmon", qty: 100 }], tags: ["preMatch"], favorite: false },
  { id: "m_postmatch1", name: "Jogurt z miodem i orzechami", foods: [{ id: "yogurt", qty: 200 }, { id: "honey", qty: 20 }, { id: "nuts", qty: 20 }], tags: ["postMatch", "snack"], favorite: false },
  { id: "m_school1", name: "Kanapki z serem i jajkiem", foods: [{ id: "bread", qty: 80 }, { id: "cheese", qty: 40 }, { id: "egg", qty: 50 }], tags: ["school", "snack"], favorite: false },
  { id: "m_break1", name: "Jajecznica z chlebem", foods: [{ id: "egg", qty: 150 }, { id: "bread", qty: 60 }], tags: ["breakfast"], favorite: false },
];

const STRENGTH_EXERCISE_LIB = [
  { id: "sq", name: "Przysiady", group: "legs", sets: 4, reps: 12, rest: 60, difficulty: "Średni", notes: "Kolana w linii ze stopami." },
  { id: "lunge", name: "Wykroki", group: "legs", sets: 3, reps: 10, rest: 60, difficulty: "Średni", notes: "Na każdą nogę." },
  { id: "calf", name: "Wspięcia na palce", group: "legs", sets: 3, reps: 20, rest: 45, difficulty: "Łatwy", notes: "" },
  { id: "plank", name: "Deska", group: "core", sets: 3, reps: 0, time: 40, rest: 30, difficulty: "Łatwy", notes: "Utrzymaj biodra w linii." },
  { id: "situp", name: "Brzuszki", group: "core", sets: 3, reps: 15, rest: 30, difficulty: "Łatwy", notes: "" },
  { id: "russiantwist", name: "Rosyjskie skręty", group: "core", sets: 3, reps: 20, rest: 30, difficulty: "Średni", notes: "" },
  { id: "superman", name: "Superman", group: "back", sets: 3, reps: 12, rest: 30, difficulty: "Łatwy", notes: "" },
  { id: "birddog", name: "Bird-dog", group: "stability", sets: 3, reps: 10, rest: 30, difficulty: "Łatwy", notes: "Na każdą stronę." },
  { id: "pushup", name: "Pompki", group: "chest", sets: 3, reps: 12, rest: 45, difficulty: "Średni", notes: "" },
  { id: "burpee", name: "Burpees", group: "full", sets: 3, reps: 10, rest: 45, difficulty: "Trudny", notes: "" },
  { id: "jumpsquat", name: "Przysiady z wyskokiem", group: "legs", sets: 3, reps: 10, rest: 60, difficulty: "Trudny", notes: "Miękkie lądowanie." },
  { id: "hipflex", name: "Mobilność bioder", group: "mobility", sets: 2, reps: 0, time: 60, rest: 15, difficulty: "Łatwy", notes: "" },
  { id: "hamstretch", name: "Rozciąganie dwugłowych", group: "mobility", sets: 2, reps: 0, time: 45, rest: 15, difficulty: "Łatwy", notes: "" },
  { id: "singleleg", name: "Przysiad jednonóż (asysta)", group: "stability", sets: 3, reps: 8, rest: 45, difficulty: "Trudny", notes: "Na każdą nogę." },
];

const STRENGTH_PRESETS = [
  { id: "p_legs", name: "Trening nóg", groups: ["legs"], exIds: ["sq", "lunge", "jumpsquat", "calf"] },
  { id: "p_core", name: "Trening core", groups: ["core"], exIds: ["plank", "situp", "russiantwist"] },
  { id: "p_full", name: "Całe ciało", groups: ["full"], exIds: ["sq", "pushup", "plank", "burpee"] },
  { id: "p_stab", name: "Stabilizacja", groups: ["stability"], exIds: ["birddog", "singleleg", "plank"] },
  { id: "p_mob", name: "Mobilność", groups: ["mobility"], exIds: ["hipflex", "hamstretch"] },
];

const DEFAULT_HABITS = [
  { id: "h_sleep", name: "8h snu", icon: "🌙" },
  { id: "h_water", name: "Picie wody", icon: "💧" },
  { id: "h_stretch", name: "Rozciąganie", icon: "🤸" },
];

const emptyData = () => ({
  events: [],
  drills: [],
  strengthExercises: [],
  strengthWorkouts: [],
  strengthLog: {}, // date -> [workoutId]
  footballLog: {}, // date -> [drillId]
  foods: [],
  meals: [],
  diary: {}, // date -> [{key, name, qty, kcal, protein, carbs, fat}]
  schoolItems: [],
  habits: DEFAULT_HABITS,
  habitLog: {}, // date -> [habitId]
  water: {}, // date -> ml wypite
  exerciseLogs: {}, // exerciseId -> [{date, weight, reps, sets}]
  remindedLog: [], // id zdarzeń, dla których powiadomienie już wysłano
  settings: { onboarded: false, notificationsEnabled: false },
  profile: { name: "", position: "", level: "Amator", goals: "", schoolHours: "", equipment: [], kcalTarget: 2600, proteinTarget: 140, carbsTarget: 340, fatTarget: 85, waterTarget: 2200, apiKey: "", geminiKey: "" },
  theme: "dark",
});

const ALL_FOODS = [...FOOD_DB, ...GENERATED_FOODS];


function AuthScreen({ onAuthenticated }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setInfo("");
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes("@")) return setError("Podaj poprawny adres e-mail.");
    if (password.length < 6) return setError("Hasło musi mieć co najmniej 6 znaków.");
    if (mode === "register" && password !== password2) return setError("Hasła nie są takie same.");
    setBusy(true);
    try {
      if (mode === "login") {
        const session = await signInWithPassword(normalizedEmail, password);
        onAuthenticated(session);
      } else {
        const result = await signUpWithPassword(normalizedEmail, password);
        if (result?.session) {
          onAuthenticated(result.session);
        } else {
          setInfo("Konto zostało utworzone. Sprawdź e-mail i kliknij link potwierdzający, a następnie zaloguj się.");
          setMode("login");
          setPassword(""); setPassword2("");
        }
      }
    } catch (err) {
      const msg = String(err?.message || "Nie udało się wykonać operacji.");
      if (/invalid login credentials/i.test(msg)) setError("Nieprawidłowy e-mail lub hasło.");
      else if (/user already registered/i.test(msg)) setError("Konto z tym adresem już istnieje. Zaloguj się.");
      else if (/email not confirmed/i.test(msg)) setError("Potwierdź adres e-mail przez wiadomość od Supabase, a potem spróbuj ponownie.");
      else setError(msg);
    } finally { setBusy(false); }
  };

  return (
    <div className="app" data-theme="dark">
      <Style />
      <main className="authWrap">
        <div className="authCard">
          <div className="brandMark authMark">⚽</div>
          <h1 className="authTitle">Moje Centrum</h1>
          <div className="muted authSub">Twoje centrum treningowe dla piłkarza</div>
          <div className="tabs authTabs">
            <button type="button" className={"tabBtn " + (mode === "login" ? "active" : "")} onClick={() => {setMode("login"); setError(""); setInfo("");}}>Logowanie</button>
            <button type="button" className={"tabBtn " + (mode === "register" ? "active" : "")} onClick={() => {setMode("register"); setError(""); setInfo("");}}>Rejestracja</button>
          </div>
          <form onSubmit={submit}>
            <div className="field"><label className="label">E-mail</label><input className="inp" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="twoj@email.pl" required /></div>
            <div className="field"><label className="label">Hasło</label><input className="inp" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Minimum 6 znaków" required /></div>
            {mode === "register" && <div className="field"><label className="label">Powtórz hasło</label><input className="inp" type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} placeholder="Powtórz hasło" required /></div>}
            {error && <div className="authError">{error}</div>}
            {info && <div className="authInfo">{info}</div>}
            <button className="btn authSubmit" disabled={busy}>{busy ? "Chwileczkę…" : mode === "login" ? "Zaloguj się" : "Utwórz konto"}</button>
          </form>
          <div className="muted authFoot">Dane konta są obsługiwane przez Supabase. Twoje dane aplikacji mogą być synchronizowane między urządzeniami.</div>
        </div>
      </main>
    </div>
  );
}

/* ============================== MAIN APP ============================== */

export default function App() {
  const [data, setData] = useState(emptyData());
  const [loaded, setLoaded] = useState(false);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [session, setSession] = useState(null);
  const [tab, setTab] = useState("today");
  const [menuOpen, setMenuOpen] = useState(false);
  const saveTimer = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const restored = await restoreSession();
        setSession(restored);
      } catch {}
      setAuthLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!authLoaded || !session) return;
    (async () => {
      let localData = emptyData();
      try {
        const res = await window.storage.get("app-data", false);
        if (res?.value) {
          const parsed = JSON.parse(res.value);
          localData = { ...localData, ...parsed, profile: { ...localData.profile, ...(parsed.profile || {}) }, settings: { ...localData.settings, ...(parsed.settings || {}) } };
        }
      } catch {}
      try {
        const cloudData = await loadCloudData(session);
        if (cloudData) {
          localData = { ...localData, ...cloudData, profile: { ...localData.profile, ...(cloudData.profile || {}) }, settings: { ...localData.settings, ...(cloudData.settings || {}) } };
        } else {
          await saveCloudData(session, localData);
        }
      } catch (e) {
        console.error("Błąd synchronizacji:", e);
      }
      setData(localData);
      setLoaded(true);
    })();
  }, [authLoaded, session]);

  const handleAuthenticated = useCallback((newSession) => {
    setSession(newSession);
    setLoaded(false);
  }, []);

  const handleSignOut = useCallback(() => {
    signOutCloud();
    setSession(null);
    setLoaded(false);
  }, []);

  useEffect(() => {
    if (!loaded || !session) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
     try {
  await window.storage.set("app-data", JSON.stringify(data), false);
  console.log("ZAPIS DO SUPABASE:", data);
  await saveCloudData(session, data);
} catch (e) {
        console.error("Błąd zapisu/synchronizacji", e);
      }
    }, 600);
    return () => clearTimeout(saveTimer.current);
  }, [data, loaded, session]);

  const update = useCallback((fn) => setData((prev) => fn(structuredClone(prev))), []);
  const theme = data.theme || "dark";

  // Powiadomienia o przypomnieniach (działają, gdy appka jest otwarta/w tle — patrz README)
  useEffect(() => {
    if (!loaded || !data.settings?.notificationsEnabled) return;
    const check = () => {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      const now = new Date();
      const nowStr = todayISO();
      data.events.forEach((e) => {
        if (!e.reminder || e.date !== nowStr) return;
        const remindKey = `${e.id}_${e.date}`;
        if ((data.remindedLog || []).includes(remindKey)) return;
        const [h, m] = (e.time || "00:00").split(":").map(Number);
        const evTime = new Date(); evTime.setHours(h, m, 0, 0);
        const diffMin = (evTime - now) / 60000;
        if (diffMin <= 15 && diffMin > -2) {
          try { new Notification("Moje Centrum ⚽", { body: `${e.title} o ${e.time}`, icon: "/icon-192.png" }); } catch (err) { /* brak wsparcia */ }
          update((d) => { d.remindedLog = [...(d.remindedLog || []), remindKey]; return d; });
        }
      });
    };
    check();
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
  }, [loaded, data.settings?.notificationsEnabled, data.events, data.remindedLog, update]);

    const enableNotifications = async () => {
    try {
      await subscribeToPush();

      update((d) => {
        d.settings.notificationsEnabled = true;
        return d;
      });

      alert("Powiadomienia push zostały włączone! 🎉");
    } catch (error) {
      alert("BŁĄD: " + (error?.message || error));
    }
  };
  const disableNotifications = () => update((d) => { d.settings.notificationsEnabled = false; return d; });

  const exportBackup = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `moje-centrum-kopia-${todayISO()}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  const importRef = useRef(null);
  const importBackup = async (file) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!window.confirm("To nadpisze obecne dane w appce kopią z pliku. Kontynuować?")) return;
      setData({ ...emptyData(), ...parsed, profile: { ...emptyData().profile, ...(parsed.profile || {}) }, settings: { ...emptyData().settings, ...(parsed.settings || {}) } });
      alert("Kopia zapasowa wczytana.");
    } catch (e) {
      alert("Nie udało się wczytać pliku — sprawdź, czy to poprawna kopia zapasowa (.json).");
    }
  };


  const NAV = [
  { id: "today", label: "Dzisiaj", icon: Trophy },
  { id: "calendar", label: "Kalendarz", icon: ListChecks },
  { id: "training", label: "Trening", icon: Dumbbell },
  { id: "diet", label: "Dieta", icon: Award },
  { id: "school", label: "Szkoła", icon: ListChecks },
  { id: "ai", label: "AI", icon: Bot },
];

  if (!authLoaded) {
    return (
      <div className="app" data-theme="dark">
        <Style />
        <div className="loadingScreen">Sprawdzanie konta…</div>
      </div>
    );
  }

  if (!session) return <AuthScreen onAuthenticated={handleAuthenticated} />;

  if (!loaded) {
    return (
      <div className="app" data-theme={theme}>
        <Style />
        <div className="loadingScreen">Wczytywanie centrum treningowego…</div>
      </div>
    );
  }

  return (
    <div className="app" data-theme={theme}>
      <Style />
      <header className="topbar">
        <div className="brandRow">
          <div className="brandMark">⚽</div>
          <div>
            <div className="brandTitle">Moje Centrum</div>
            <div className="brandSub">{data.profile.name ? `Cześć, ${data.profile.name}` : "Twoje boisko, plan i AI"}</div>
          </div>
        </div>
        <button className="iconBtn" onClick={() => setMenuOpen(true)}><Menu size={20} /></button>
      </header>

      <main className="content">
        {tab === "today" && <TodayTab data={data} update={update} goTo={setTab} />}
        {tab === "calendar" && <CalendarTab data={data} update={update} />}
        {tab === "training" && <TrainingTab data={data} update={update} />}
        {tab === "diet" && <DietTab data={data} update={update} />}
        {tab === "school" && <SchoolTab data={data} update={update} />}
        {tab === "ai" && <AITab data={data} />}
        {tab === "habits" && <HabitsTab data={data} update={update} />}
        {tab === "stats" && <StatsTab data={data} update={update} />}
        {tab === "profile" && <ProfileTab data={data} update={update} onImport={importBackup} />}
        {tab === "badges" && <BadgesTab data={data} />}
        {tab === "report" && <WeeklyReportTab data={data} />}
        {tab === "generator" && (
  <TrainingGeneratorTabNew
    data={data}
    update={update}
  />
)}
        {tab === "matches" && <MatchJournalTab data={data} update={update} />}
      </main>

      <nav className="bottomNav">
        {NAV.map((n) => (
          <button key={n.id} className={"navBtn" + (tab === n.id ? " active" : "")} onClick={() => setTab(n.id)}>
            <n.icon size={20} />
            <span>{n.label}</span>
          </button>
        ))}
      </nav>

      {menuOpen && (
        <div className="sheetOverlay" onClick={() => setMenuOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheetHead">
              <div className="brandTitle">Menu</div>
              <button className="iconBtn" onClick={() => setMenuOpen(false)}><X size={20} /></button>
            </div>
            {[
  { id: "habits", label: "Nawyki", icon: ListChecks },
  { id: "stats", label: "Statystyki", icon: TrendingUp },
  { id: "report", label: "Raport tygodniowy", icon: FileText },
  { id: "matches", label: "Dziennik meczowy", icon: Trophy },
  { id: "generator", label: "Generator treningów", icon: Dumbbell },
  { id: "profile", label: "Profil", icon: User },
  { id: "badges", label: "Odznaki", icon: Award },
].map((m) => (
              <button key={m.id} className="sheetItem" onClick={() => { setTab(m.id); setMenuOpen(false); }}>
                <m.icon size={18} /> {m.label}
              </button>
            ))}
            <button
              className="sheetItem"
              onClick={() => update((d) => { d.theme = d.theme === "dark" ? "light" : "dark"; return d; })}
            >
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />} {theme === "dark" ? "Tryb jasny" : "Tryb ciemny"}
            </button>
            {data.settings?.notificationsEnabled ? (
              <button className="sheetItem" onClick={disableNotifications}>🔕 Wyłącz powiadomienia</button>
            ) : (
              <button className="sheetItem" onClick={enableNotifications}>🔔 Włącz powiadomienia</button>
            )}
            <button className="sheetItem" onClick={exportBackup}>⬇️ Pobierz kopię zapasową</button>
            <button className="sheetItem" onClick={() => importRef.current?.click()}>⬆️ Wczytaj kopię zapasową</button>
            <button className="sheetItem" onClick={handleSignOut}>↪️ Wyloguj</button>
            <input ref={importRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={(e) => e.target.files[0] && importBackup(e.target.files[0])} />
          </div>
        </div>
      )}

      {!data.settings?.onboarded && (
        <OnboardingWizard
          onFinish={(profile) => update((d) => { Object.assign(d.profile, profile); d.settings.onboarded = true; return d; })}
        />
      )}
    </div>
  );
}

function OnboardingWizard({ onFinish }) {
  const [step, setStep] = useState(0);
  const [p, setP] = useState({ name: "", position: "", level: "Amator", goals: "", schoolHours: "", equipment: [] });
  const setF = (k, v) => setP((x) => ({ ...x, [k]: v }));
  const toggleEquip = (eq) => setP((x) => { const arr = x.equipment || []; return { ...x, equipment: arr.includes(eq) ? arr.filter((e) => e !== eq) : [...arr, eq] }; });
  const steps = ["Kim jesteś?", "Twoje cele", "Twój sprzęt"];
  return (
    <div className="modalOverlay">
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="cardTitle">⚽ Witaj w Moim Centrum!</div>
        <div className="muted" style={{ marginBottom: 14 }}>Krok {step + 1}/3 — {steps[step]}</div>

        {step === 0 && (
          <div>
            <div className="field"><label className="label">Imię / nick</label><input className="inp" value={p.name} onChange={(e) => setF("name", e.target.value)} autoFocus /></div>
            <div className="grid2">
              <div className="field"><label className="label">Pozycja</label>
                <select className="inp" value={p.position} onChange={(e) => setF("position", e.target.value)}>
                  <option value="">Wybierz</option>{POSITIONS.map((x) => <option key={x}>{x}</option>)}
                </select>
              </div>
              <div className="field"><label className="label">Poziom</label>
                <select className="inp" value={p.level} onChange={(e) => setF("level", e.target.value)}>{LEVELS.map((x) => <option key={x}>{x}</option>)}</select>
              </div>
            </div>
          </div>
        )}
        {step === 1 && (
          <div>
            <div className="field"><label className="label">Cele treningowe</label><textarea className="inp" rows={3} value={p.goals} onChange={(e) => setF("goals", e.target.value)} placeholder="np. poprawić szybkość i wytrzymałość" /></div>
            <div className="field"><label className="label">Godziny szkoły</label><input className="inp" value={p.schoolHours} onChange={(e) => setF("schoolHours", e.target.value)} placeholder="np. 8:00–14:30" /></div>
          </div>
        )}
        {step === 2 && (
          <div>
            <div className="muted" style={{ marginBottom: 8, fontSize: 12 }}>Zaznacz, co masz dostępne — możesz to zmienić później w Profilu.</div>
            <div className="row" style={{ flexWrap: "wrap" }}>
              {EQUIPMENT_OPTIONS.map((eq) => <span key={eq} className={"chip" + ((p.equipment || []).includes(eq) ? " active" : "")} onClick={() => toggleEquip(eq)}>{eq}</span>)}
            </div>
          </div>
        )}

        <div className="between" style={{ marginTop: 18 }}>
          {step > 0 ? <button className="btnGhost" onClick={() => setStep((s) => s - 1)}><ChevronLeft size={16} /> Wstecz</button> : <button className="btnGhost" onClick={() => onFinish(p)}>Pomiń</button>}
          {step < 2
            ? <button className="btn" onClick={() => setStep((s) => s + 1)}>Dalej <ChevronRight size={16} /></button>
            : <button className="btn" onClick={() => onFinish(p)}><Check size={16} /> Zaczynamy!</button>}
        </div>
      </div>
    </div>
  );
}

/* ============================== STYLE ============================== */

function Style() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap');
      .app[data-theme='dark']{
        --bg:#0B1210; --bg2:#0F1714; --card:#141E1A; --card2:#182420; --border:#243430;
        --text:#F2F5F0; --muted:#8FA098; --accent:#C6FF3D; --accent2:#FF5A36; --accent3:#5AA9FF;
        --shadow: 0 8px 24px rgba(0,0,0,0.35);
      }
      .app[data-theme='light']{
        --bg:#F4F7F2; --bg2:#ECF1E8; --card:#FFFFFF; --card2:#F0F4EC; --border:#DCE5D8;
        --text:#0F1712; --muted:#5C6B60; --accent:#4C9A16; --accent2:#E1481F; --accent3:#1D6FCE;
        --shadow: 0 8px 20px rgba(20,40,20,0.08);
      }
      .authWrap{ min-height:100vh; display:flex; align-items:center; justify-content:center; padding:20px; background:var(--bg); }
      .authCard{ width:100%; max-width:420px; background:var(--card); border:1px solid var(--border); border-radius:22px; padding:24px; box-shadow:var(--shadow); }
      .authMark{ margin:0 auto 12px; width:54px; height:54px; font-size:25px; }
      .authTitle{ text-align:center; margin:0; font-size:34px; }
      .authSub{ text-align:center; margin:4px 0 20px; }
      .authTabs{ margin-bottom:16px; }
      .authSubmit{ width:100%; justify-content:center; margin-top:4px; min-height:44px; }
      .authSubmit:disabled{ opacity:.65; cursor:wait; }
      .authError,.authInfo{ border-radius:10px; padding:10px; margin:8px 0 12px; font-size:13px; line-height:1.4; }
      .authError{ background:rgba(255,90,54,.12); border:1px solid rgba(255,90,54,.4); color:#ff9c87; }
      .authInfo{ background:rgba(90,169,255,.12); border:1px solid rgba(90,169,255,.4); color:#9ecbff; }
      .authFoot{ margin-top:16px; text-align:center; font-size:11px; line-height:1.5; }
      .app{ background:var(--bg); color:var(--text); font-family:'Inter',sans-serif; min-height:100vh; display:flex; flex-direction:column; }
      .app *{ box-sizing:border-box; }
      .loadingScreen{ display:flex; align-items:center; justify-content:center; height:100vh; color:var(--muted); font-family:'Barlow Condensed'; font-size:20px; }
      h1,h2,h3,.headFont{ font-family:'Barlow Condensed',sans-serif; font-weight:800; letter-spacing:0.3px; }
      .topbar{ display:flex; align-items:center; justify-content:space-between; padding:14px 16px; border-bottom:1px solid var(--border); position:sticky; top:0; background:var(--bg); z-index:20; }
      .brandRow{ display:flex; align-items:center; gap:10px; }
      .brandMark{ width:38px;height:38px;border-radius:12px; background:linear-gradient(135deg,var(--accent),var(--accent3)); display:flex;align-items:center;justify-content:center; font-size:18px; }
      .brandTitle{ font-family:'Barlow Condensed'; font-weight:800; font-size:20px; line-height:1.1; }
      .brandSub{ font-size:12px; color:var(--muted); }
      .iconBtn{ background:var(--card); border:1px solid var(--border); border-radius:10px; padding:8px; color:var(--text); cursor:pointer; }
      .content{ flex:1; overflow-y:auto; padding:14px 14px 90px; max-width:720px; width:100%; margin:0 auto; }
      .bottomNav{ position:fixed; bottom:0; left:0; right:0; display:flex; background:var(--card); border-top:1px solid var(--border); padding:6px 4px calc(6px + env(safe-area-inset-bottom)); z-index:30; }
      .navBtn{ flex:1; display:flex; flex-direction:column; align-items:center; gap:2px; background:none; border:none; color:var(--muted); font-size:10px; padding:6px 2px; cursor:pointer; border-radius:10px; }
      .navBtn.active{ color:var(--accent); background:var(--card2); }
      .card{ background:var(--card); border:1px solid var(--border); border-radius:16px; padding:14px; box-shadow:var(--shadow); margin-bottom:12px; }
      .cardTitle{ font-family:'Barlow Condensed'; font-weight:700; font-size:18px; margin-bottom:8px; display:flex; align-items:center; gap:8px; }
      .muted{ color:var(--muted); font-size:13px; }
      .row{ display:flex; align-items:center; gap:8px; }
      .between{ display:flex; align-items:center; justify-content:space-between; }
      .btn{ background:var(--accent); color:#0B1210; border:none; border-radius:12px; padding:10px 14px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:6px; font-size:14px; }
      .btnGhost{ background:var(--card2); color:var(--text); border:1px solid var(--border); border-radius:12px; padding:9px 13px; cursor:pointer; display:inline-flex; align-items:center; gap:6px; font-size:14px; }
      .btnDanger{ background:transparent; color:var(--accent2); border:1px solid var(--accent2); border-radius:10px; padding:6px 10px; cursor:pointer; font-size:13px; }
      .btnSmall{ padding:6px 10px; font-size:12px; border-radius:9px; }
      .pill{ display:inline-flex; align-items:center; gap:4px; padding:3px 9px; border-radius:999px; font-size:11px; font-weight:600; color:#0B1210; }
      .inp, select.inp, textarea.inp{ width:100%; background:var(--bg2); border:1px solid var(--border); color:var(--text); border-radius:10px; padding:9px 11px; font-size:14px; font-family:inherit; }
      .field{ margin-bottom:10px; }
      .label{ font-size:12px; color:var(--muted); margin-bottom:4px; display:block; font-weight:600; }
      .grid2{ display:grid; grid-template-columns:1fr 1fr; gap:8px; }
      .grid3{ display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
      .modalOverlay{ position:fixed; inset:0; background:rgba(0,0,0,0.55); display:flex; align-items:flex-end; justify-content:center; z-index:100; }
      .modal{ background:var(--bg); width:100%; max-width:720px; max-height:92vh; overflow-y:auto; border-radius:20px 20px 0 0; padding:16px; border-top:1px solid var(--border); }
      .sheetOverlay{ position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:100; display:flex; justify-content:flex-end; }
      .sheet{ background:var(--bg); width:78%; max-width:320px; height:100%; padding:16px; border-left:1px solid var(--border); }
      .sheetHead{ display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; }
      .sheetItem{ width:100%; text-align:left; padding:12px; border-radius:12px; background:var(--card); border:1px solid var(--border); margin-bottom:8px; color:var(--text); display:flex; gap:10px; align-items:center; cursor:pointer; font-size:14px; }
      .tabs{ display:flex; gap:6px; margin-bottom:12px; background:var(--card2); padding:4px; border-radius:12px; }
      .tabBtn{ flex:1; text-align:center; padding:8px; border-radius:9px; background:none; border:none; color:var(--muted); font-weight:600; cursor:pointer; font-size:13px; }
      .tabBtn.active{ background:var(--accent); color:#0B1210; }
      .eventItem{ display:flex; align-items:center; gap:10px; padding:9px; border-radius:12px; background:var(--card2); margin-bottom:6px; border-left:4px solid var(--accent); }
      .listEmpty{ color:var(--muted); font-size:13px; text-align:center; padding:20px 0; }
      .chip{ padding:6px 11px; border-radius:999px; border:1px solid var(--border); background:var(--card2); font-size:12px; cursor:pointer; color:var(--text); }
      .chip.active{ background:var(--accent); color:#0B1210; border-color:var(--accent); font-weight:700; }
      .fab{ position:fixed; bottom:78px; right:18px; background:var(--accent); color:#0B1210; border:none; border-radius:50%; width:52px; height:52px; display:flex; align-items:center; justify-content:center; box-shadow:var(--shadow); cursor:pointer; z-index:40; }
      .toolGrid{ display:grid; grid-template-columns:repeat(5,1fr); gap:6px; margin-bottom:10px; }
      .toolBtn{ background:var(--card2); border:1px solid var(--border); border-radius:10px; padding:8px 2px; text-align:center; cursor:pointer; font-size:10px; color:var(--text); }
      .toolBtn.active{ border-color:var(--accent); background:rgba(198,255,61,0.15); }
      .pitchWrap{ background:#1B7A3D; border-radius:14px; overflow:hidden; touch-action:none; user-select:none; }
      .progressOuter{ background:var(--bg2); border-radius:999px; height:10px; overflow:hidden; }
      .progressInner{ height:100%; background:var(--accent); border-radius:999px; }
      .habitDot{ width:34px;height:34px;border-radius:10px; display:flex;align-items:center;justify-content:center; background:var(--card2); border:1px solid var(--border); cursor:pointer; font-size:16px; }
      .habitDot.done{ background:var(--accent); }
      .chatBubble{ max-width:85%; padding:10px 13px; border-radius:14px; margin-bottom:8px; font-size:14px; line-height:1.4; white-space:pre-wrap; }
      .chatBubble.user{ background:var(--accent); color:#0B1210; margin-left:auto; border-bottom-right-radius:4px; }
      .chatBubble.bot{ background:var(--card2); border:1px solid var(--border); margin-right:auto; border-bottom-left-radius:4px; }
      .foodResult{ display:flex; justify-content:space-between; padding:8px; border-radius:10px; background:var(--card2); margin-bottom:5px; cursor:pointer; font-size:13px; }
      ::-webkit-scrollbar{ width:0; height:0; }
    `}</style>
  );
}

/* ============================== SMALL UI PARTS ============================== */

function CatPill({ cat }) {
  const c = CATEGORIES[cat] || CATEGORIES.other;
  return <span className="pill" style={{ background: c.color }}>{c.icon} {c.label}</span>;
}

function Modal({ title, onClose, children }) {
  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="between" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="iconBtn" onClick={onClose}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ============================== RECOMMENDATION ENGINE ============================== */

function getRecommendation(data) {
  const t = todayISO();
  const tmr = addDays(t, 1);
  const todayEv = data.events.filter((e) => e.date === t);
  const tmrEv = data.events.filter((e) => e.date === tmr);
  const hasMatchToday = todayEv.some((e) => e.category === "match");
  const hasMatchTomorrow = tmrEv.some((e) => e.category === "match");
  const hasStrengthToday = todayEv.some((e) => e.category === "strength");
  const hasFootballToday = todayEv.some((e) => e.category === "football");
  const dow = fromISO(t).getDay(); // 0 = niedziela
  const legDay = dow === 1 || dow === 4; // poniedziałek, czwartek
  const heavySchoolDay = todayEv.filter((e) => ["test", "quiz", "homework"].includes(e.category)).length >= 2;

  if (hasMatchToday) {
    return { title: "Dziś masz mecz! 🏆", text: "Skup się na lekkiej rozgrzewce, nawodnieniu i lekkostrawnym posiłku 2-3h przed meczem. Odpuść dodatkowy trening.", tone: "match" };
  }
  if (hasMatchTomorrow) {
    return { title: "Jutro mecz — dziś lekko", text: "Postaw na mobilność, rozciąganie i regenerację zamiast ciężkiego treningu siłowego czy sprintów.", tone: "recovery" };
  }
  if (!hasStrengthToday && legDay) {
    return { title: "Proponujemy trening nóg 🦵", text: "To Twój dzień nóg, a jutro nie masz meczu — dobry moment na solidny trening siłowy dolnych partii.", tone: "strength" };
  }
  if (hasFootballToday && !hasStrengthToday) {
    return { title: "Masz dziś trening piłkarski ⚽", text: "Pamiętaj o rozgrzewce, nawodnieniu i krótkiej mobilności po treningu.", tone: "football" };
  }
  if (heavySchoolDay) {
    return { title: "Dużo szkoły dziś 📚", text: "Zaplanuj naukę w blokach 45-60 min z przerwami. Krótki trening mobilności odświeży umysł.", tone: "school" };
  }
  if (!hasFootballToday && !hasStrengthToday) {
    return { title: "Brak zaplanowanego treningu", text: "Dobry dzień na sesję mobilności/stabilizacji albo dodaj własny trening w kalendarzu.", tone: "mobility" };
  }
  return { title: "Plan dnia wygląda dobrze", text: "Trzymaj się terminarza i pamiętaj o nawodnieniu oraz śnie.", tone: "ok" };
}

// Tryb "tydzień meczowy" — plan intensywności w dniach poprzedzających najbliższy mecz
function getMatchWeekPlan(data) {
  const t = todayISO();
  const nextMatch = data.events
    .filter((e) => e.category === "match" && diffDays(t, e.date) >= 0 && diffDays(t, e.date) <= 6)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!nextMatch) return null;

  const days = [];
  for (let i = 0; i <= diffDays(t, nextMatch.date); i++) {
    const date = addDays(t, i);
    const daysToMatch = diffDays(date, nextMatch.date);
    let label, intensity;
    if (daysToMatch === 0) { label = "MECZ"; intensity = "match"; }
    else if (daysToMatch === 1) { label = "Regeneracja / lekko"; intensity = "low"; }
    else if (daysToMatch === 2) { label = "Technika, bez ciężkich nóg"; intensity = "medium"; }
    else { label = "Normalny trening"; intensity = "normal"; }
    days.push({ date, daysToMatch, label, intensity });
  }
  return { match: nextMatch, days };
}
function toggleEventCompleted(update, eventId) {
  update((d) => {
    const event = d.events.find((e) => e.id === eventId);
    if (event) {
      event.completed = !event.completed;
    }
    return d;
  });
}

function EventStatusButton({ event, update }) {
  const completed = !!event.completed;

  return (
    <button
      className="btnGhost btnSmall"
      onClick={(e) => {
        e.stopPropagation();
        toggleEventCompleted(update, event.id);
      }}
      style={{
        minWidth: 105,
        marginLeft: 8,
        borderColor: completed ? "var(--accent)" : "var(--border)",
        color: completed ? "var(--accent)" : "var(--text)",
      }}
    >
      {completed ? "✓ Wykonane" : "☐ Nie wykonane"}
    </button>
  );
}
function TodayTab({ data, update, goTo }) {
  const t = todayISO();
  const todayEvents = data.events.filter((e) => e.date === t).sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  const rec = getRecommendation(data);
  const matchWeek = getMatchWeekPlan(data);
  const schoolSoon = data.schoolItems
    .filter((s) => diffDays(t, s.date) >= 0 && diffDays(t, s.date) <= 5)
    .sort((a, b) => diffDays(t, a.date) - diffDays(t, b.date));
  const habitsDone = (data.habitLog[t] || []);
  const diaryToday = data.diary[t] || [];
  const dietSummary = getDietSummary(
  diaryToday,
  data.profile.kcalTarget || 2600
);

  const dailySnack = getDailySnack(new Date());
  const kcalToday = diaryToday.reduce((s, i) => s + i.kcal, 0);
  const proteinToday = diaryToday.reduce((s, i) => s + i.protein, 0);
  const carbsToday = diaryToday.reduce((s, i) => s + i.carbs, 0);
  const fatToday = diaryToday.reduce((s, i) => s + i.fat, 0);
  const kcalTarget = data.profile.kcalTarget || 2600;
  const waterToday = getWaterAmount(data, t);
  const waterTarget = data.profile.waterTarget || 2200;
 const addWater = (ml) =>
  update((d) => changeWater(d, t, ml));
  const weekStart = startOfWeek(t);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekEvents = data.events.filter((e) => weekDays.includes(e.date));
  const weekTraining = weekEvents.filter((e) => e.category === "football" || e.category === "strength");
  const weekMinutes = weekTraining.reduce((sum, e) => sum + Number(e.duration || 0), 0);
  const nextEvent = data.events
    .filter((e) => `${e.date}T${e.time || "23:59"}` >= `${t}T${new Date().toTimeString().slice(0,5)}`)
    .sort((a, b) => `${a.date}T${a.time || "23:59"}`.localeCompare(`${b.date}T${b.time || "23:59"}`))[0];
  const kcalProgress = Math.min(100, Math.round((kcalToday / kcalTarget) * 100));
  const waterProgress = Math.min(100, Math.round((waterToday / waterTarget) * 100));


  return (
    <div>
      <div className="card" style={{ background: "linear-gradient(135deg, var(--card), var(--card2))", padding: 16 }}>
        <div className="between">
          <div>
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>CENTRUM PIŁKARZA</div>
            <div style={{ fontSize: 24, fontWeight: 850, marginTop: 2 }}>Twój dzień ⚡</div>
          </div>
          <div className="pill" style={{ background: "var(--accent)", color: "#0B1210" }}>{kcalProgress}% kcal</div>
        </div>
     
        <div className="grid3" style={{ marginTop: 14, gap: 8 }}>
          <div className="card" style={{ margin: 0, padding: 10, background: "var(--card2)" }}>
            <div className="muted" style={{ fontSize: 11 }}>Treningi</div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{weekTraining.length}</div>
            <div className="muted" style={{ fontSize: 10 }}>{weekMinutes} min w tygodniu</div>
          </div>
          <div className="card" style={{ margin: 0, padding: 10, background: "var(--card2)" }}>
            <div className="muted" style={{ fontSize: 11 }}>Nawyki</div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{habitsDone.length}/{data.habits.length}</div>
            <div className="muted" style={{ fontSize: 10 }}>dzisiaj wykonane</div>
          </div>
          <div className="card" style={{ margin: 0, padding: 10, background: "var(--card2)" }}>
            <div className="muted" style={{ fontSize: 11 }}>Woda</div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{waterProgress}%</div>
            <div className="muted" style={{ fontSize: 10 }}>{(waterToday/1000).toFixed(1)} / {(waterTarget/1000).toFixed(1)} l</div>
          </div>
        </div>
        {nextEvent && <div style={{ marginTop: 12, padding: 10, borderRadius: 10, background: "var(--card2)" }}>
          <div className="muted" style={{ fontSize: 11 }}>NAJBLIŻSZE WYDARZENIE</div>
          <div style={{ fontWeight: 750, marginTop: 2 }}>{nextEvent.title}</div>
          <div className="muted" style={{ fontSize: 11 }}>{nextEvent.date === t ? `Dzisiaj • ${nextEvent.time || ""}` : `${formatDatePL(nextEvent.date)} • ${nextEvent.time || ""}`}</div>
        </div>}
      </div>
      <div className="card" style={{ background: "linear-gradient(135deg, var(--card), var(--card2))" }} >
        <div className="cardTitle"><Target size={18} color="var(--accent)" /> Dzisiaj polecam</div>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>{rec.title}</div>
        <div className="muted">{rec.text}</div>
      </div>

      {matchWeek && matchWeek.days.length > 1 && (
        <div className="card">
          <div className="cardTitle"><Trophy size={18} color="#FFD23C" /> Tydzień meczowy</div>
          <div className="muted" style={{ marginBottom: 8, fontSize: 12 }}>Mecz: {matchWeek.match.title} — {formatDatePL(matchWeek.match.date)}</div>
          <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
            {matchWeek.days.map((dday) => (
              <div key={dday.date} style={{
                minWidth: 92, padding: 8, borderRadius: 10,
                background: isToday(dday.date) ? "var(--accent)" : "var(--card2)",
                color: isToday(dday.date) ? "#0B1210" : "var(--text)",
                border: "1px solid var(--border)",
              }}>
                <div style={{ fontSize: 11, fontWeight: 700 }}>{dday.daysToMatch === 0 ? "MECZ" : formatDatePL(dday.date)}</div>
                <div style={{ fontSize: 11, marginTop: 4 }}>{dday.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="between"><div className="cardTitle"><CalendarIcon size={18} /> Dzisiejszy plan</div>
          <button className="btnGhost btnSmall" onClick={() => goTo("calendar")}>Terminarz</button>
        </div>
        {todayEvents.length === 0 && <div className="listEmpty">Brak wydarzeń zaplanowanych na dziś.</div>}
        {todayEvents.map((e) => (
          <div
  key={e.id}
  className="eventItem"
  style={{
    borderColor: CATEGORIES[e.category]?.color,
    opacity: e.completed ? 0.65 : 1,
  }}
>
  <div style={{ fontWeight: 700, minWidth: 46 }}>
    {e.time || "--:--"}
  </div>

  <div style={{ flex: 1 }}>
    <div
      style={{
        fontWeight: 600,
        textDecoration: e.completed ? "line-through" : "none",
      }}
    >
      {e.title}
    </div>

    <CatPill cat={e.category} />
  </div>

  <EventStatusButton event={e} update={update} />
</div>
        ))}
      </div>

      <div className="grid2">
        <div className="card">
          <div className="cardTitle" style={{ fontSize: 15 }}><Flame size={16} color="var(--accent2)" /> Kalorie</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{Math.round(kcalToday)} <span className="muted" style={{ fontSize: 13 }}>/ {kcalTarget}</span></div>
          <div className="progressOuter" style={{ marginTop: 6 }}><div className="progressInner" style={{ width: `${Math.min(100, (kcalToday / kcalTarget) * 100)}%` }} /></div>
          <div className="muted" style={{ marginTop: 6, fontSize: 11 }}>B {Math.round(proteinToday)}g • W {Math.round(carbsToday)}g • T {Math.round(fatToday)}g</div>
        </div>
        <div className="card">
          <div className="cardTitle" style={{ fontSize: 15 }}><ListChecks size={16} color="var(--accent3)" /> Nawyki</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{habitsDone.length}<span className="muted" style={{ fontSize: 13 }}> / {data.habits.length}</span></div>
          <div className="row" style={{ marginTop: 8, flexWrap: "wrap" }}>
            {data.habits.map((h) => {
              const done = habitsDone.includes(h.id);
              return (
                <div key={h.id} className={"habitDot" + (done ? " done" : "")} title={h.name}
                  onClick={() => update((d) => {
                    const arr = d.habitLog[t] || [];
                    d.habitLog[t] = arr.includes(h.id) ? arr.filter((x) => x !== h.id) : [...arr, h.id];
                    return d;
                  })}>{h.icon}</div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="between">
          <div className="cardTitle" style={{ marginBottom: 0 }}><Droplet size={16} color="var(--accent3)" /> Woda</div>
          <div style={{ fontWeight: 700 }}>{(waterToday / 1000).toFixed(2)} l <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>/ {(waterTarget / 1000).toFixed(1)} l</span></div>
        </div>
        <div className="progressOuter" style={{ margin: "8px 0" }}><div className="progressInner" style={{ width: `${Math.min(100, (waterToday / waterTarget) * 100)}%`, background: "var(--accent3)" }} /></div>
        <div className="row">
          <button className="btnGhost btnSmall" onClick={() => addWater(250)}>+250 ml</button>
          <button className="btnGhost btnSmall" onClick={() => addWater(500)}>+500 ml</button>
          <button className="btnGhost btnSmall" onClick={() => addWater(-250)}>-250 ml</button>
        </div>
      </div>

      <div className="card">
        <div className="cardTitle"><GraduationCap size={18} /> Szkoła — najbliższe</div>
        {schoolSoon.length === 0 && <div className="listEmpty">Brak nadchodzących sprawdzianów / zadań.</div>}
        {schoolSoon.slice(0, 4).map((s) => (
          <div key={s.id} className="eventItem">
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: "var(--accent3)" }}>{s.subject}</div>
              <div>{s.name}</div>
            </div>
            <div className="muted" style={{ fontSize: 12, textAlign: "right" }}>{formatDatePL(s.date)}<br />{diffDays(t, s.date) === 0 ? "dziś" : `za ${diffDays(t, s.date)} dni`}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================== CALENDAR TAB ============================== */

function EventForm({ initial, data, onSave, onDelete, onClose }) {
  const [ev, setEv] = useState(initial || { id: uid(), title: "", date: todayISO(), time: "17:00", duration: 60, description: "", category: "football", reminder: false, reminderMinutes: 30, drillIds: [], exerciseIds: [] });
  const [readyWorkoutType, setReadyWorkoutType] = useState("");
  const [readyWorkoutId, setReadyWorkoutId] = useState("");
  const setF = (k, v) => setEv((e) => ({ ...e, [k]: v }));
  const toggleDrill = (id) => setEv((e) => { const arr = e.drillIds || []; return { ...e, drillIds: arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id] }; });
  const toggleExercise = (id) => setEv((e) => { const arr = e.exerciseIds || []; return { ...e, exerciseIds: arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id] }; });
  const allExercises = data ? [...STRENGTH_EXERCISE_LIB, ...data.strengthExercises] : [];
  const footballWorkouts = data?.footballWorkouts || [];
const strengthWorkouts = data?.strengthWorkouts || [];

const selectedFootballWorkout = footballWorkouts.find(
  (w) => w.id === readyWorkoutId
);

const selectedStrengthWorkout = strengthWorkouts.find(
  (w) => w.id === readyWorkoutId
);
  return (
    <Modal title={initial ? "Edytuj wydarzenie" : "Nowe wydarzenie"} onClose={onClose}>
      <div className="field"><label className="label">Nazwa</label><input className="inp" value={ev.title} onChange={(e) => setF("title", e.target.value)} placeholder="np. Trening przed meczem" /></div>
      <div className="grid2">
        <div className="field"><label className="label">Data</label><input type="date" className="inp" value={ev.date} onChange={(e) => setF("date", e.target.value)} /></div>
        <div className="field"><label className="label">Godzina</label><input type="time" className="inp" value={ev.time} onChange={(e) => setF("time", e.target.value)} /></div>
      </div>
      <div className="grid2">
        <div className="field"><label className="label">Czas trwania (min)</label><input type="number" className="inp" value={ev.duration} onChange={(e) => setF("duration", Number(e.target.value))} /></div>
        <div className="field"><label className="label">Kategoria</label>
          <select className="inp" value={ev.category} onChange={(e) => setF("category", e.target.value)}>
            {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
          </select>
        </div>
      </div>
      {(ev.category === "football" || ev.category === "strength") && (
  <div className="card" style={{ background: "var(--card2)" }}>
    <div className="cardTitle" style={{ fontSize: 15 }}>
      📋 Gotowy trening
    </div>

    <div className="field">
      <label className="label">
        Wybierz zapisany trening
      </label>

      <select
        className="inp"
        value={readyWorkoutType}
        onChange={(e) => {
          const type = e.target.value;
          setReadyWorkoutType(type);
          setReadyWorkoutId("");

          if (type === "football") {
            setF("category", "football");
          }

          if (type === "strength") {
            setF("category", "strength");
          }
        }}
      >
        <option value="">-- wybierz typ --</option>
        <option value="football">⚽ Gotowy trening piłkarski</option>
        <option value="strength">🏋️ Gotowy trening siłowy</option>
      </select>
    </div>

    {readyWorkoutType === "football" && (
      <div className="field">
        <label className="label">
          Trening piłkarski
        </label>

        <select
          className="inp"
          value={readyWorkoutId}
          onChange={(e) => {
            const id = e.target.value;
            setReadyWorkoutId(id);

            const workout = footballWorkouts.find(
              (w) => w.id === id
            );

            if (!workout) return;

            setF("title", workout.name);
            setF(
              "duration",
              Number(workout.duration) || 0
            );
            setF(
              "description",
              (workout.steps || [])
                .map(
                  (step, i) =>
                    `${i + 1}. ${step.title} — ${step.duration} min`
                )
                .join("\n")
            );
            setF(
              "drillIds",
              (workout.steps || [])
                .map((step) => step.drillId)
                .filter(Boolean)
            );
          }}
        >
          <option value="">
            -- wybierz trening --
          </option>

          {footballWorkouts.map((workout) => (
            <option key={workout.id} value={workout.id}>
              {workout.name} — {workout.duration} min
            </option>
          ))}
        </select>
      </div>
    )}

    {readyWorkoutType === "strength" && (
      <div className="field">
        <label className="label">
          Trening siłowy
        </label>

        <select
          className="inp"
          value={readyWorkoutId}
          onChange={(e) => {
            const id = e.target.value;
            setReadyWorkoutId(id);

            const workout = strengthWorkouts.find(
              (w) => w.id === id
            );

            if (!workout) return;

            setF("title", workout.name);

            setF(
              "duration",
              Number(workout.duration) ||
                45
            );

            setF(
              "description",
              workout.warmup
                ? `Rozgrzewka — ${workout.warmup} min\n\n` +
                  (workout.exIds || [])
                    .map((exerciseId) => {
                      const ex = allExercises.find(
                        (x) => x.id === exerciseId
                      );

                      if (!ex) return null;

                      return `${ex.name} — ${ex.sets} serie × ${
                        ex.reps || `${ex.time}s`
                      }`;
                    })
                    .filter(Boolean)
                    .join("\n")
                : (workout.exIds || [])
                    .map((exerciseId) => {
                      const ex = allExercises.find(
                        (x) => x.id === exerciseId
                      );

                      if (!ex) return null;

                      return `${ex.name} — ${ex.sets} serie × ${
                        ex.reps || `${ex.time}s`
                      }`;
                    })
                    .filter(Boolean)
                    .join("\n")
            );

            setF(
              "exerciseIds",
              workout.exIds || []
            );
          }}
        >
          <option value="">
            -- wybierz trening --
          </option>

          {strengthWorkouts.map((workout) => (
            <option key={workout.id} value={workout.id}>
              {workout.name}
            </option>
          ))}
        </select>
      </div>
    )}
  </div>
)}
      <div className="field"><label className="label">Opis</label><textarea className="inp" rows={3} value={ev.description} onChange={(e) => setF("description", e.target.value)} /></div>

      {ev.category === "football" && data && (
        <div className="field">
          <label className="label">Ćwiczenia piłkarskie z Twojej biblioteki</label>
          {data.drills.length === 0 && <div className="muted" style={{ fontSize: 12 }}>Nie masz jeszcze zapisanych ćwiczeń — stwórz je w zakładce Trening.</div>}
          <div style={{ maxHeight: 160, overflowY: "auto" }}>
            {data.drills.map((dr) => (
              <div key={dr.id} className="eventItem" style={{ cursor: "pointer", borderLeftColor: (ev.drillIds || []).includes(dr.id) ? "var(--accent)" : "var(--border)" }} onClick={() => toggleDrill(dr.id)}>
                <input type="checkbox" readOnly checked={(ev.drillIds || []).includes(dr.id)} />
                <div style={{ flex: 1 }}>{dr.name} <span className="muted">({dr.category})</span></div>
              </div>
            ))}
          </div>
        </div>
      )}

      {ev.category === "strength" && data && (
        <div className="field">
          <label className="label">Ćwiczenia siłowe z Twojej biblioteki</label>
          <div style={{ maxHeight: 160, overflowY: "auto" }}>
            {allExercises.map((ex) => (
              <div key={ex.id} className="eventItem" style={{ cursor: "pointer", borderLeftColor: (ev.exerciseIds || []).includes(ex.id) ? "var(--accent)" : "var(--border)" }} onClick={() => toggleExercise(ex.id)}>
                <input type="checkbox" readOnly checked={(ev.exerciseIds || []).includes(ex.id)} />
                <div style={{ flex: 1 }}>{ex.name} <span className="muted">({MUSCLE_GROUPS.find((m) => m.id === ex.group)?.label})</span></div>
              </div>
            ))}
          </div>
        </div>
      )}

     <div className="field">
  <div className="row">
    <input
      type="checkbox"
      checked={ev.reminder}
      onChange={(e) => setF("reminder", e.target.checked)}
      id="rem"
    />
    <label htmlFor="rem" className="label" style={{ margin: 0 }}>
      Ustaw przypomnienie
    </label>
  </div>

  {ev.reminder && (
    <div style={{ marginTop: 10 }}>
      <label className="label">Przypomnij przed wydarzeniem</label>
      <select
        className="inp"
        value={ev.reminderMinutes ?? 30}
        onChange={(e) =>
          setF("reminderMinutes", Number(e.target.value))
        }
      >
        <option value={5}>5 minut wcześniej</option>
        <option value={15}>15 minut wcześniej</option>
        <option value={30}>30 minut wcześniej</option>
        <option value={60}>1 godzinę wcześniej</option>
        <option value={120}>2 godziny wcześniej</option>
      </select>
    </div>
  )}
</div>
      <div className="between" style={{ marginTop: 14 }}>
        {initial ? <button className="btnDanger" onClick={() => onDelete(ev.id)}><Trash2 size={14} /> Usuń</button> : <span />}
        <button className="btn" onClick={() => ev.title.trim() && onSave(ev)}><Save size={16} /> Zapisz</button>
      </div>
    </Modal>
  );
}

function CalendarTab({ data, update }) {
  const [view, setView] = useState("week");
  const [cursor, setCursor] = useState(todayISO());
  const [editing, setEditing] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [filter, setFilter] = useState("all");

  const isSchoolEvent = (e) =>
    ["test", "quiz", "homework", "project", "presentation", "school"].includes(e.category);

  const filteredData = {
    ...data,
    events: data.events.filter((e) => {
      if (filter === "all") return true;
      if (filter === "football") return e.category === "football";
      if (filter === "strength") return e.category === "strength";
      if (filter === "school") return isSchoolEvent(e);
      return true;
    }),
  };

 const saveEvent = async (ev) => {
    let updatedEvents = [];

    update((d) => {
      const i = d.events.findIndex((e) => e.id === ev.id);

      if (i >= 0) {
        d.events[i] = ev;
      } else {
        d.events.push(ev);
      }

      updatedEvents = [...d.events];
      return d;
    });

    try {
      await fetch("/.netlify/functions/save-events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updatedEvents),
      });
    } catch (error) {
      console.error("Nie udało się zapisać wydarzeń na serwerze:", error);
    }

    setEditing(null);
    setShowNew(false);
  };

  const deleteEvent = async (id) => {
    let updatedEvents = [];

    update((d) => {
      d.events = d.events.filter((e) => e.id !== id);
      updatedEvents = [...d.events];
      return d;
    });

    try {
      await fetch("/.netlify/functions/save-events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updatedEvents),
      });
    } catch (error) {
      console.error("Nie udało się zaktualizować wydarzeń na serwerze:", error);
    }

    setEditing(null);
  };
  const shift = (n) => {
    if (view === "day") setCursor((c) => addDays(c, n));
    if (view === "week") setCursor((c) => addDays(c, n * 7));
    if (view === "month") {
      const d = fromISO(cursor); d.setMonth(d.getMonth() + n); setCursor(toISO(d));
    }
  };

 return (
  <div>
    <div className="tabs" style={{ marginBottom: 8, flexWrap: "wrap" }}>
      {[
        ["all", "📅 Wszystko"],
        ["football", "⚽ Piłkarski"],
        ["strength", "🏋️ Siłowy"],
        ["school", "🏫 Szkoła"],
      ].map(([v, l]) => (
        <button
          key={v}
          className={"tabBtn" + (filter === v ? " active" : "")}
          onClick={() => setFilter(v)}
        >
          {l}
        </button>
      ))}
    </div>

    <div className="tabs">
      {[["day", "Dzień"], ["week", "Tydzień"], ["month", "Miesiąc"]].map(([v, l]) => (
        <button
          key={v}
          className={"tabBtn" + (view === v ? " active" : "")}
          onClick={() => setView(v)}
        >
          {l}
        </button>
      ))}
    </div>
      <div className="between" style={{ marginBottom: 10 }}>
        <button className="iconBtn" onClick={() => shift(-1)}><ChevronLeft size={18} /></button>
        <div style={{ fontWeight: 700 }}>
          {view === "month" ? `${MONTHS_PL_NOM[fromISO(cursor).getMonth()]} ${fromISO(cursor).getFullYear()}` : formatDatePL(cursor)}
        </div>
        <button className="iconBtn" onClick={() => shift(1)}><ChevronRight size={18} /></button>
      </div>
{view === "day" && <DayView data={filteredData} date={cursor} onEdit={setEditing} update={update} />}
{view === "week" && <WeekView data={filteredData} cursor={cursor} onPick={setCursor} onEdit={setEditing} update={update} />}
{view === "month" && <MonthView data={filteredData} cursor={cursor} onPick={(d) => { setCursor(d); setView("day"); }} />}

      <button className="fab" onClick={() => setShowNew(true)}><Plus size={24} /></button>
      {showNew && <EventForm data={data} onSave={saveEvent} onClose={() => setShowNew(false)} />}
      {editing && <EventForm data={data} initial={editing} onSave={saveEvent} onDelete={deleteEvent} onClose={() => setEditing(null)} />}
    </div>
  );
}

function DayView({ data, cursor, onPick, onEdit, update }) {
 const evs = data.events.filter((e) => e.date === cursor).sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  const allExercises = [...STRENGTH_EXERCISE_LIB, ...data.strengthExercises];
  return (
    <div className="card">
      {evs.length === 0 && <div className="listEmpty">Brak wydarzeń tego dnia.</div>}
      {evs.map((e) => {
        const drillNames = (e.drillIds || []).map((id) => data.drills.find((d) => d.id === id)?.name).filter(Boolean);
        const exNames = (e.exerciseIds || []).map((id) => allExercises.find((x) => x.id === id)?.name).filter(Boolean);
        return (
          <div key={e.id} className="eventItem" style={{ borderColor: CATEGORIES[e.category]?.color, cursor: "pointer" }} onClick={() => onEdit(e)}>
            {e.time && (
  <div style={{ fontWeight: 700, minWidth: 46 }}>{e.time}</div>
)}
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{e.title}</div>
              <div className="muted" style={{ fontSize: 12 }}>{e.duration} min {e.description ? `• ${e.description}` : ""}</div>
              {(drillNames.length > 0 || exNames.length > 0) && <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>🎯 {[...drillNames, ...exNames].join(", ")}</div>}
              <CatPill cat={e.category} />
              <EventStatusButton event={e} update={update} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WeekView({ data, cursor, onPick, onEdit, update }) {
  const start = startOfWeek(cursor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return (
    <div>
      {days.map((day) => {
        const evs = data.events.filter((e) => e.date === day).sort((a, b) => (a.time || "").localeCompare(b.time || ""));
        return (
          <div key={day} className="card" style={{ padding: 10 }}>
            <div className="row" style={{ justifyContent: "space-between", marginBottom: evs.length ? 6 : 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{DAYS_PL[(fromISO(day).getDay() + 6) % 7]} {formatDatePL(day)} {isToday(day) && <span className="pill" style={{ background: "var(--accent)" }}>dziś</span>}</div>
            </div>
            {evs.map((e) => (
              <div key={e.id} className="eventItem" style={{ borderColor: CATEGORIES[e.category]?.color, cursor: "pointer", padding: 6 }} onClick={() => onEdit(e)}>
                {e.time && (
  <div style={{ fontWeight: 700, minWidth: 40, fontSize: 12 }}>{e.time}</div>
)}
                <div style={{ flex: 1, fontSize: 13 }}>{e.title}</div>
                <CatPill cat={e.category} />
                <EventStatusButton event={e} update={update} />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function MonthView({ data, cursor, onPick }) {
  const d = fromISO(cursor);
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const startOffset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let i = 1; i <= daysInMonth; i++) cells.push(toISO(new Date(d.getFullYear(), d.getMonth(), i)));
  return (
    <div className="card">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4, marginBottom: 6 }}>
        {DAYS_PL.map((x) => <div key={x} className="muted" style={{ textAlign: "center", fontSize: 11 }}>{x}</div>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>
        {cells.map((c, i) => {
          if (!c) return <div key={i} />;
          const evs = data.events.filter((e) => e.date === c);
          return (
            <div key={i} onClick={() => onPick(c)} style={{
              aspectRatio: "1", borderRadius: 9, background: isToday(c) ? "var(--accent)" : "var(--card2)",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer",
              color: isToday(c) ? "#0B1210" : "var(--text)", fontSize: 12, fontWeight: 600, position: "relative",
            }}>
              {fromISO(c).getDate()}
              {evs.length > 0 && <div style={{ display: "flex", gap: 2, marginTop: 2 }}>
                {evs.slice(0, 3).map((e, k) => <div key={k} style={{ width: 4, height: 4, borderRadius: 4, background: isToday(c) ? "#0B1210" : CATEGORIES[e.category]?.color }} />)}
              </div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================== TRAINING TAB ============================== */

function TrainingTab({ data, update }) {
  const [sub, setSub] = useState("football");
  const trainingEvents = data.events.filter((e) => e.category === "football" || e.category === "strength");
  const weekStart = startOfWeek(todayISO());
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekTraining = trainingEvents.filter((e) => weekDays.includes(e.date));
  const weekMinutes = weekTraining.reduce((sum, e) => sum + Number(e.duration || 0), 0);
  const footballCount = weekTraining.filter((e) => e.category === "football").length;
  const strengthCount = weekTraining.filter((e) => e.category === "strength").length;

  return (
    <div>
      <div className="card">
        <div className="cardTitle"><Dumbbell size={18} /> Tydzień treningowy</div>
        <div className="grid3" style={{ gap: 8 }}>
          <div><div className="muted" style={{ fontSize: 11 }}>Sesje</div><div style={{ fontSize: 22, fontWeight: 800 }}>{weekTraining.length}</div></div>
          <div><div className="muted" style={{ fontSize: 11 }}>Minuty</div><div style={{ fontSize: 22, fontWeight: 800 }}>{weekMinutes}</div></div>
          <div><div className="muted" style={{ fontSize: 11 }}>⚽ / 🏋️</div><div style={{ fontSize: 22, fontWeight: 800 }}>{footballCount} / {strengthCount}</div></div>
        </div>
        <div className="progressOuter" style={{ marginTop: 10 }}><div className="progressInner" style={{ width: `${Math.min(100, weekMinutes / 300 * 100)}%` }} /></div>
        <div className="muted" style={{ fontSize: 10, marginTop: 5 }}>Cel orientacyjny: 300 min aktywności w tygodniu.</div>
      </div>
      <div className="tabs">
        <button className={"tabBtn" + (sub === "football" ? " active" : "")} onClick={() => setSub("football")}>⚽ Piłkarski</button>
        <button className={"tabBtn" + (sub === "strength" ? " active" : "")} onClick={() => setSub("strength")}>🏋️ Siłowy</button>
      </div>
      {sub === "football" ? <FootballTraining data={data} update={update} /> : <StrengthTraining data={data} update={update} />}
    </div>
  );
}

/* ---- Football drill builder ---- */

function FootballTraining({ data, update }) {
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingDrill, setEditingDrill] = useState(null);
  const [workoutBuilderOpen, setWorkoutBuilderOpen] = useState(false);

  const footballWorkouts = data.footballWorkouts || [];

  const saveDrill = (drill) => {
    update((d) => {
      const i = d.drills.findIndex((x) => x.id === drill.id);
      if (i >= 0) d.drills[i] = drill;
      else d.drills.push(drill);
      return d;
    });

    setBuilderOpen(false);
    setEditingDrill(null);
  };

  const deleteDrill = (id) =>
    update((d) => {
      d.drills = d.drills.filter((x) => x.id !== id);
      return d;
    });

  const addToToday = (drill) =>
    update((d) => {
      const t = todayISO();

      d.footballLog[t] = [
        ...(d.footballLog[t] || []),
        drill.id,
      ];

      d.events.push({
        id: uid(),
        title: `Trening: ${drill.name}`,
        date: t,
        time: "17:00",
        duration: drill.duration || 30,
        description: drill.description || "",
        category: "football",
        reminder: false,
        reminderMinutes: 30,
        drillIds: [drill.id],
        exerciseIds: [],
      });

      return d;
    });

  const saveWorkout = (workout) => {
    update((d) => {
      d.footballWorkouts = d.footballWorkouts || [];

      const index = d.footballWorkouts.findIndex(
        (w) => w.id === workout.id
      );

      if (index >= 0) {
        d.footballWorkouts[index] = workout;
      } else {
        d.footballWorkouts.push(workout);
      }

      return d;
    });

    setWorkoutBuilderOpen(false);
  };

  const deleteWorkout = (id) => {
    update((d) => {
      d.footballWorkouts = (d.footballWorkouts || []).filter(
        (w) => w.id !== id
      );
      return d;
    });
  };

  const totalWorkoutMinutes = (workout) =>
    (workout.steps || []).reduce(
      (sum, step) => sum + Number(step.duration || 0),
      0
    );

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <button
          className="btn"
          style={{ flex: 1, justifyContent: "center" }}
          onClick={() => setWorkoutBuilderOpen(true)}
        >
          <Plus size={16} />
          Nowy gotowy trening
        </button>

        <button
          className="btnGhost"
          style={{ flex: 1, justifyContent: "center" }}
          onClick={() => {
            setEditingDrill(null);
            setBuilderOpen(true);
          }}
        >
          <Plus size={16} />
          Nowe ćwiczenie
        </button>
      </div>

      <div className="cardTitle">
        📋 Moje gotowe treningi
      </div>

      {footballWorkouts.length === 0 && (
        <div className="listEmpty">
          Nie masz jeszcze gotowych treningów.
        </div>
      )}

      {footballWorkouts.map((workout) => (
        <div key={workout.id} className="card">
          <div className="between">
            <div style={{ fontWeight: 800 }}>
              {workout.name}
            </div>

            <span
              className="pill"
              style={{ background: "var(--accent)" }}
            >
              ⚽ {totalWorkoutMinutes(workout)} min
            </span>
          </div>

          <div
            className="muted"
            style={{ marginTop: 6, marginBottom: 8 }}
          >
            {(workout.steps || [])
              .map((step) => step.title)
              .join(" → ")}
          </div>

          {(workout.steps || []).map((step, index) => (
            <div
              key={step.id}
              className="eventItem"
              style={{ marginBottom: 5 }}
            >
              <div
                style={{
                  fontWeight: 700,
                  minWidth: 28,
                }}
              >
                {index + 1}
              </div>

              <div style={{ flex: 1 }}>
                <div>{step.title}</div>

                <div
                  className="muted"
                  style={{ fontSize: 11 }}
                >
                  {step.duration} min
                </div>
              </div>
            </div>
          ))}

          <div
            className="row"
            style={{
              marginTop: 10,
              flexWrap: "wrap",
            }}
          >
            <button
              className="btnGhost btnSmall"
              onClick={() => {
                setWorkoutBuilderOpen(workout);
              }}
            >
              Edytuj
            </button>

            <button
              className="btnGhost btnSmall"
              onClick={() =>
                alert(
                  "Dodawanie gotowego treningu do kalendarza zrobimy w następnym kroku."
                )
              }
            >
              <CalendarIcon size={13} />
              Dodaj do kalendarza
            </button>

            <button
              className="btnDanger btnSmall"
              onClick={() => deleteWorkout(workout.id)}
            >
              <Trash2 size={13} />
              Usuń
            </button>
          </div>
        </div>
      ))}

      <div
        className="cardTitle"
        style={{ marginTop: 14 }}
      >
        <BookOpen size={18} />
        Biblioteka ćwiczeń ({data.drills.length})
      </div>

      {data.drills.length === 0 && (
        <div className="listEmpty">
          Nie masz jeszcze zapisanych ćwiczeń.
        </div>
      )}

      {data.drills.map((dr) => (
        <div key={dr.id} className="card">
          <div className="between">
            <div style={{ fontWeight: 700 }}>
              {dr.name}
            </div>

            <span
              className="pill"
              style={{ background: "var(--accent)" }}
            >
              {dr.category}
            </span>
          </div>

          <div
            className="muted"
            style={{ margin: "4px 0" }}
          >
            {dr.description}
          </div>

          <div
            className="muted"
            style={{ fontSize: 12 }}
          >
            Cel: {dr.goal || "—"}
          </div>

          <div
            className="row"
            style={{
              marginTop: 8,
              flexWrap: "wrap",
              gap: 6,
            }}
          >
            <span className="chip">
              {dr.sets} serie
            </span>

            <span className="chip">
              {dr.reps} powt.
            </span>

            <span className="chip">
              {dr.duration} min
            </span>

            <span className="chip">
              Odpoczynek {dr.rest}s
            </span>

            <span className="chip">
              {dr.difficulty}
            </span>
          </div>

          <div
            className="row"
            style={{ marginTop: 10 }}
          >
            <button
              className="btnGhost btnSmall"
              onClick={() => {
                setEditingDrill(dr);
                setBuilderOpen(true);
              }}
            >
              Edytuj
            </button>

            <button
              className="btnGhost btnSmall"
              onClick={() => addToToday(dr)}
            >
              <CalendarIcon size={13} />
              Dodaj do dziś
            </button>

            <button
              className="btnDanger btnSmall"
              onClick={() => deleteDrill(dr.id)}
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      ))}

      {builderOpen && (
        <DrillBuilder
          initial={editingDrill}
          onSave={saveDrill}
          onClose={() => setBuilderOpen(false)}
        />
      )}

      {workoutBuilderOpen && (
        <FootballWorkoutBuilder
          initial={
            typeof workoutBuilderOpen === "object"
              ? workoutBuilderOpen
              : null
          }
          drills={data.drills}
          onSave={saveWorkout}
          onClose={() => setWorkoutBuilderOpen(false)}
        />
      )}
    </div>
  );
}
function FootballWorkoutBuilder({
  initial,
  drills,
  onSave,
  onClose,
}) {
  const [name, setName] = useState(
    initial?.name || ""
  );

  const [steps, setSteps] = useState(
    initial?.steps || []
  );

  const addStep = (type) => {
    if (type === "drill") {
      setSteps((items) => [
        ...items,
        {
          id: uid(),
          type: "drill",
          drillId: drills[0]?.id || "",
          title: drills[0]?.name || "Ćwiczenie",
          duration: drills[0]?.duration || 10,
        },
      ]);

      return;
    }

    const presets = {
      warmup: {
        title: "Rozgrzewka",
        duration: 10,
      },
      juggling: {
        title: "Kapki",
        duration: 5,
      },
      cooldown: {
        title: "Schłodzenie",
        duration: 5,
      },
    };

    const preset = presets[type];

    setSteps((items) => [
      ...items,
      {
        id: uid(),
        type,
        title: preset.title,
        duration: preset.duration,
      },
    ]);
  };

  const updateStep = (id, key, value) => {
    setSteps((items) =>
      items.map((step) => {
        if (step.id !== id) return step;

        if (key === "drillId") {
          const drill = drills.find(
            (d) => d.id === value
          );

          return {
            ...step,
            drillId: value,
            title: drill?.name || "Ćwiczenie",
            duration: drill?.duration || step.duration,
          };
        }

        return {
          ...step,
          [key]: value,
        };
      })
    );
  };

  const removeStep = (id) => {
    setSteps((items) =>
      items.filter((step) => step.id !== id)
    );
  };

  const moveStep = (index, direction) => {
    const newIndex = index + direction;

    if (
      newIndex < 0 ||
      newIndex >= steps.length
    ) {
      return;
    }

    const copy = [...steps];

    [copy[index], copy[newIndex]] = [
      copy[newIndex],
      copy[index],
    ];

    setSteps(copy);
  };

  const totalMinutes = steps.reduce(
    (sum, step) =>
      sum + Number(step.duration || 0),
    0
  );

  const save = () => {
    if (!name.trim()) {
      alert("Podaj nazwę treningu.");
      return;
    }

    if (!steps.length) {
      alert("Dodaj przynajmniej jeden etap treningu.");
      return;
    }

    onSave({
      id: initial?.id || uid(),
      name: name.trim(),
      category: "football",
      steps: steps.map((step, index) => ({
        ...step,
        order: index,
        duration: Number(step.duration) || 1,
      })),
      duration: totalMinutes,
    });
  };

  return (
    <Modal
      title={
        initial
          ? "Edytuj gotowy trening"
          : "Nowy gotowy trening piłkarski"
      }
      onClose={onClose}
    >
      <div className="field">
        <label className="label">
          Nazwa treningu
        </label>

        <input
          className="inp"
          value={name}
          onChange={(e) =>
            setName(e.target.value)
          }
          placeholder="np. Trening techniczny A"
        />
      </div>

      <div className="card">
        <div className="cardTitle">
          Dodaj etap
        </div>

        <div
          className="row"
          style={{
            flexWrap: "wrap",
          }}
        >
          <button
            className="btnGhost btnSmall"
            onClick={() => addStep("warmup")}
          >
            🔥 Rozgrzewka
          </button>

          <button
            className="btnGhost btnSmall"
            onClick={() => addStep("juggling")}
          >
            ⚽ Kapki
          </button>

          <button
            className="btnGhost btnSmall"
            onClick={() => addStep("drill")}
          >
            🎯 Ćwiczenie
          </button>

          <button
            className="btnGhost btnSmall"
            onClick={() => addStep("cooldown")}
          >
            🧊 Schłodzenie
          </button>
        </div>
      </div>

      {steps.length === 0 && (
        <div className="listEmpty">
          Trening nie ma jeszcze żadnych etapów.
        </div>
      )}

      {steps.map((step, index) => (
        <div
          key={step.id}
          className="card"
          style={{
            background: "var(--card2)",
          }}
        >
          <div
            className="between"
            style={{
              marginBottom: 8,
            }}
          >
            <strong>
              {index + 1}. {step.title}
            </strong>

            <button
              className="btnDanger btnSmall"
              onClick={() =>
                removeStep(step.id)
              }
            >
              <Trash2 size={12} />
            </button>
          </div>

          {step.type === "drill" && (
            <div className="field">
              <label className="label">
                Ćwiczenie
              </label>

              <select
                className="inp"
                value={step.drillId}
                onChange={(e) =>
                  updateStep(
                    step.id,
                    "drillId",
                    e.target.value
                  )
                }
              >
                {drills.map((drill) => (
                  <option
                    key={drill.id}
                    value={drill.id}
                  >
                    {drill.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="field">
            <label className="label">
              Czas (min)
            </label>

            <input
              type="number"
              min="1"
              className="inp"
              value={step.duration}
              onChange={(e) =>
                updateStep(
                  step.id,
                  "duration",
                  Number(e.target.value)
                )
              }
            />
          </div>

          <div className="row">
            <button
              className="btnGhost btnSmall"
              disabled={index === 0}
              onClick={() =>
                moveStep(index, -1)
              }
            >
              ↑
            </button>

            <button
              className="btnGhost btnSmall"
              disabled={
                index === steps.length - 1
              }
              onClick={() =>
                moveStep(index, 1)
              }
            >
              ↓
            </button>
          </div>
        </div>
      ))}

      <div className="card">
        <div className="between">
          <span>Łączny czas</span>
          <strong>{totalMinutes} min</strong>
        </div>
      </div>

      <button
        className="btn"
        style={{
          width: "100%",
          justifyContent: "center",
        }}
        onClick={save}
      >
        <Save size={16} />
        Zapisz trening
      </button>
    </Modal>
  );
}

function DrillBuilder({ initial, onSave, onClose }) {
  const [elements, setElements] = useState(initial?.elements || []);
  const [lines, setLines] = useState(initial?.lines || []);
  const [tool, setTool] = useState("select");
  const [selectedId, setSelectedId] = useState(null);
  const [meta, setMeta] = useState(initial || { id: uid(), name: "", description: "", goal: "", category: DRILL_CATEGORIES[0], reps: 8, sets: 3, duration: 15, rest: 30, difficulty: "Średni" });
  const svgRef = useRef(null);
  const dragRef = useRef(null); // {id} for moving point, or {x1,y1} for drawing line
  const [tempLine, setTempLine] = useState(null);
  const [labelPopup, setLabelPopup] = useState(null); // element id awaiting label

  const setM = (k, v) => setMeta((m) => ({ ...m, [k]: v }));

  const coords = (e) => {
    const rect = svgRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 600;
    const y = ((e.clientY - rect.top) / rect.height) * 400;
    return { x: Math.max(10, Math.min(590, x)), y: Math.max(10, Math.min(390, y)) };
  };

  const onPitchDown = (e) => {
    e.preventDefault();
    try { svgRef.current.setPointerCapture(e.pointerId); } catch (err) { /* ignoruj, np. brak wsparcia */ }
    const { x, y } = coords(e);
    if (POINT_TOOLS.some((p) => p.id === tool)) {
      const newEl = { id: uid(), type: tool, x, y, label: "" };
      setElements((els) => [...els, newEl]);
      setSelectedId(newEl.id);
      setTool("select");
      return;
    }
    if (LINE_TOOLS.some((p) => p.id === tool)) {
      dragRef.current = { drawing: true, x1: x, y1: y };
      setTempLine({ x1: x, y1: y, x2: x, y2: y, type: tool });
      return;
    }
    setSelectedId(null);
  };

  const onElDown = (e, id) => {
    e.stopPropagation();
    e.preventDefault();
    if (tool !== "select") return;
    try { svgRef.current.setPointerCapture(e.pointerId); } catch (err) { /* ignoruj */ }
    dragRef.current = { movingId: id };
    setSelectedId(id);
  };

  const onPitchMove = (e) => {
    if (!dragRef.current) return;
    e.preventDefault();
    const { x, y } = coords(e);
    if (dragRef.current.movingId) {
      setElements((els) => els.map((el) => el.id === dragRef.current.movingId ? { ...el, x, y } : el));
    } else if (dragRef.current.drawing) {
      setTempLine((tl) => tl ? { ...tl, x2: x, y2: y } : tl);
    }
  };

  const onPitchUp = () => {
    if (dragRef.current?.drawing && tempLine) {
      if (Math.hypot(tempLine.x2 - tempLine.x1, tempLine.y2 - tempLine.y1) > 8) {
        setLines((ls) => [...ls, { id: uid(), ...tempLine }]);
      }
      setTempLine(null);
      setTool("select");
    }
    dragRef.current = null;
  };

  const deleteSelected = () => {
    setElements((els) => els.filter((e) => e.id !== selectedId));
    setLines((ls) => ls.filter((l) => l.id !== selectedId));
    setSelectedId(null);
  };

  const applyLabel = (text) => {
    setElements((els) => els.map((e) => e.id === labelPopup ? { ...e, label: text } : e));
    setLabelPopup(null);
  };

  const selectedEl = elements.find((e) => e.id === selectedId);

  const renderPoint = (el) => {
    const conf = POINT_TOOLS.find((p) => p.id === el.type);
    const isSel = el.id === selectedId;
    return (
      <g key={el.id} transform={`translate(${el.x},${el.y})`} onPointerDown={(e) => onElDown(e, el.id)}
        onDoubleClick={(e) => { e.stopPropagation(); setLabelPopup(el.id); }} style={{ cursor: "grab", touchAction: "none" }}>
        {isSel && <circle r={16} fill="none" stroke="#fff" strokeDasharray="3 3" />}
        {el.type === "cone" && <polygon points="0,-9 8,9 -8,9" fill={conf.color} stroke="#000" strokeWidth="0.5" />}
        {el.type === "pole" && <rect x={-2} y={-14} width={4} height={28} fill={conf.color} rx={2} />}
        {el.type === "ladder" && <g>{[-9, -3, 3, 9].map((yy) => <rect key={yy} x={-12} y={yy - 1.5} width={24} height={3} fill={conf.color} />)}<rect x={-12} y={-11} width={2} height={22} fill={conf.color} /><rect x={10} y={-11} width={2} height={22} fill={conf.color} /></g>}
        {el.type === "ball" && <circle r={7} fill="#fff" stroke="#111" strokeWidth="1" />}
        {el.type === "marker" && <g stroke={conf.color} strokeWidth="3"><line x1={-7} y1={-7} x2={7} y2={7} /><line x1={-7} y1={7} x2={7} y2={-7} /></g>}
        {el.type === "smallGoal" && <rect x={-14} y={-8} width={28} height={16} fill="none" stroke={conf.color} strokeWidth="3" />}
        {el.type === "bigGoal" && <rect x={-22} y={-12} width={44} height={24} fill="none" stroke={conf.color} strokeWidth="3" />}
        {el.type === "obstacle" && <rect x={-14} y={-6} width={28} height={12} fill={conf.color} rx={2} />}
        {el.type === "player" && <g><circle r={11} fill={conf.color} /><text y={4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#062018">P</text></g>}
        {el.label && <text y={-18} textAnchor="middle" fontSize="9" fill="#fff" style={{ paintOrder: "stroke", stroke: "#000", strokeWidth: 2 }}>{el.label}</text>}
      </g>
    );
  };

  return (
    <Modal title={initial ? "Edytuj ćwiczenie" : "Nowe ćwiczenie na boisku"} onClose={onClose}>
      <div className="muted" style={{ marginBottom: 8, fontSize: 12 }}>Wybierz narzędzie i kliknij na boisku, aby umieścić element. Kliknij dwukrotnie element, aby dodać opis (np. „Tutaj oddaje strzał”). Tryb „Wskaźnik” pozwala przeciągać elementy.</div>

      <div className="toolGrid">
        <div className={"toolBtn" + (tool === "select" ? " active" : "")} onClick={() => setTool("select")}>↖<br />Wskaźnik</div>
        {POINT_TOOLS.map((p) => (
          <div key={p.id} className={"toolBtn" + (tool === p.id ? " active" : "")} onClick={() => setTool(p.id)}>
            <span style={{ color: p.color }}>{p.glyph}</span><br />{p.label}
          </div>
        ))}
        {LINE_TOOLS.map((p) => (
          <div key={p.id} className={"toolBtn" + (tool === p.id ? " active" : "")} onClick={() => setTool(p.id)} style={{ color: p.color }}>
            ↗<br />{p.label}
          </div>
        ))}
      </div>

      <div className="pitchWrap">
        <svg ref={svgRef} viewBox="0 0 600 400" style={{ width: "100%", display: "block", touchAction: "none" }}
          onPointerDown={onPitchDown} onPointerMove={onPitchMove} onPointerUp={onPitchUp} onPointerCancel={onPitchUp}>
          <rect width="600" height="400" fill="#1B7A3D" />
          {Array.from({ length: 6 }).map((_, i) => <rect key={i} x={i * 100} y="0" width="100" height="400" fill={i % 2 === 0 ? "#1c8140" : "#1B7A3D"} />)}
          <rect x="10" y="10" width="580" height="380" fill="none" stroke="#fff" strokeWidth="2" />
          <line x1="300" y1="10" x2="300" y2="390" stroke="#fff" strokeWidth="2" />
          <circle cx="300" cy="200" r="50" fill="none" stroke="#fff" strokeWidth="2" />
          <rect x="10" y="120" width="60" height="160" fill="none" stroke="#fff" strokeWidth="2" />
          <rect x="530" y="120" width="60" height="160" fill="none" stroke="#fff" strokeWidth="2" />
          {lines.map((l) => (
            <g key={l.id} onPointerDown={(e) => onElDown(e, l.id)} style={{ touchAction: "none" }}>
              <defs><marker id={`arrow-${l.id}`} markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill={l.type === "arrow" ? "#FF5A36" : "#C6FF3D"} /></marker></defs>
              <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={l.type === "arrow" ? "#FF5A36" : "#C6FF3D"} strokeWidth={l.id === selectedId ? 4 : 3}
                strokeDasharray={l.type === "runLine" ? "6 4" : "0"} markerEnd={`url(#arrow-${l.id})`} />
            </g>
          ))}
          {tempLine && <line x1={tempLine.x1} y1={tempLine.y1} x2={tempLine.x2} y2={tempLine.y2} stroke="#fff" strokeWidth="2" strokeDasharray="4 4" />}
          {elements.map(renderPoint)}
        </svg>
      </div>

      {selectedId && (
        <div className="row" style={{ margin: "8px 0" }}>
          <button className="btnGhost btnSmall" onClick={() => setLabelPopup(selectedId)}>Dodaj opis</button>
          <button className="btnDanger btnSmall" onClick={deleteSelected}><Trash2 size={13} /> Usuń element</button>
        </div>
      )}

      {labelPopup && (
        <div className="card" style={{ background: "var(--card2)" }}>
          <div className="label">Opis punktu</div>
          <div className="row" style={{ flexWrap: "wrap", marginBottom: 6 }}>
            {LABEL_PRESETS.map((p) => <span key={p} className="chip" onClick={() => applyLabel(p)}>{p}</span>)}
          </div>
          <input className="inp" placeholder="Własny opis…" defaultValue={elements.find(e=>e.id===labelPopup)?.label||""}
            onKeyDown={(e) => e.key === "Enter" && applyLabel(e.target.value)} onBlur={(e) => applyLabel(e.target.value)} />
        </div>
      )}

      <div className="field" style={{ marginTop: 12 }}><label className="label">Nazwa ćwiczenia</label><input className="inp" value={meta.name} onChange={(e) => setM("name", e.target.value)} placeholder="np. Slalom z podaniem" /></div>
      <div className="field"><label className="label">Opis</label><textarea className="inp" rows={2} value={meta.description} onChange={(e) => setM("description", e.target.value)} /></div>
      <div className="field"><label className="label">Cel ćwiczenia</label><input className="inp" value={meta.goal} onChange={(e) => setM("goal", e.target.value)} placeholder="np. poprawa dryblingu pod presją" /></div>
      <div className="field"><label className="label">Kategoria</label>
        <select className="inp" value={meta.category} onChange={(e) => setM("category", e.target.value)}>
          {DRILL_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      <div className="grid3">
        <div className="field"><label className="label">Serie</label><input type="number" className="inp" value={meta.sets} onChange={(e) => setM("sets", Number(e.target.value))} /></div>
        <div className="field"><label className="label">Powtórzenia</label><input type="number" className="inp" value={meta.reps} onChange={(e) => setM("reps", Number(e.target.value))} /></div>
        <div className="field"><label className="label">Odpoczynek (s)</label><input type="number" className="inp" value={meta.rest} onChange={(e) => setM("rest", Number(e.target.value))} /></div>
      </div>
      <div className="grid2">
        <div className="field"><label className="label">Czas (min)</label><input type="number" className="inp" value={meta.duration} onChange={(e) => setM("duration", Number(e.target.value))} /></div>
        <div className="field"><label className="label">Poziom trudności</label>
          <select className="inp" value={meta.difficulty} onChange={(e) => setM("difficulty", e.target.value)}>
            {DIFFICULTIES.map((d) => <option key={d}>{d}</option>)}
          </select>
        </div>
      </div>

      <button className="btn" style={{ width: "100%", justifyContent: "center", marginTop: 8 }}
        onClick={() => meta.name.trim() && onSave({ ...meta, elements, lines })}><Save size={16} /> Zapisz ćwiczenie</button>
    </Modal>
  );
}

/* ---- Strength training ---- */

function StrengthTraining({ data, update }) {
  const allExercises = [...STRENGTH_EXERCISE_LIB, ...data.strengthExercises];
  const [builderOpen, setBuilderOpen] = useState(false);
  const [exerciseFormOpen, setExerciseFormOpen] = useState(false);
  const [playingWorkout, setPlayingWorkout] = useState(null);
  const [historyEx, setHistoryEx] = useState(null);

  const addPreset = (preset) => update((d) => {
    const exists = d.strengthWorkouts.find((w) => w.id === preset.id);
    if (!exists) d.strengthWorkouts.push({ id: preset.id, name: preset.name, groups: preset.groups, exIds: preset.exIds, preset: true });
    return d;
  });

  const saveCustomWorkout = (workout) => {
    update((d) => {
      const i = d.strengthWorkouts.findIndex((w) => w.id === workout.id);
      if (i >= 0) d.strengthWorkouts[i] = workout; else d.strengthWorkouts.push(workout);
      return d;
    });
    setBuilderOpen(false);
  };

  const saveExercise = (ex) => {
    update((d) => { d.strengthExercises.push({ ...ex, id: uid() }); return d; });
    setExerciseFormOpen(false);
  };

  const logWorkout = (w) => update((d) => {
    const t = todayISO();
    d.strengthLog[t] = [...(d.strengthLog[t] || []), w.id];
    d.events.push({ id: uid(), title: `Siłownia: ${w.name}`, date: t, time: "18:00", duration: 40, description: "", category: "strength", reminder: false, drillIds: [], exerciseIds: w.exIds || [] });
    return d;
  });

  const logExerciseEntry = (exerciseId, entry) => update((d) => {
    d.exerciseLogs[exerciseId] = [...(d.exerciseLogs[exerciseId] || []), { date: todayISO(), ...entry }];
    return d;
  });

  const rec = getRecommendation(data);
  const hasMatchTomorrow = data.events.some((e) => e.date === addDays(todayISO(), 1) && e.category === "match");

  return (
    <div>
      {hasMatchTomorrow && (
        <div className="card" style={{ borderLeft: "4px solid var(--accent2)" }}>
          <div className="row"><AlertTriangle size={16} color="var(--accent2)" /><b>Jutro masz mecz</b></div>
          <div className="muted">Unikaj dziś ciężkiego treningu nóg — postaw na mobilność i stabilizację.</div>
        </div>
      )}
      <div className="row" style={{ marginBottom: 10 }}>
        <button className="btn" style={{ flex: 1, justifyContent: "center" }} onClick={() => setBuilderOpen(true)}><Plus size={16} /> Własny trening</button>
        <button className="btnGhost" style={{ flex: 1, justifyContent: "center" }} onClick={() => setExerciseFormOpen(true)}><Dumbbell size={16} /> Nowe ćwiczenie</button>
      </div>

      <div className="cardTitle">Gotowe treningi</div>
      <div className="row" style={{ flexWrap: "wrap", marginBottom: 14 }}>
        {STRENGTH_PRESETS.map((p) => (
          <span key={p.id} className="chip" onClick={() => addPreset(p)}>{p.name}</span>
        ))}
      </div>

      <div className="cardTitle">Twoje treningi ({data.strengthWorkouts.length})</div>
      {data.strengthWorkouts.length === 0 && <div className="listEmpty">Dodaj gotowy trening powyżej albo stwórz własny.</div>}
      {data.strengthWorkouts.map((w) => (
        <div key={w.id} className="card">
          <div className="between">
            <div style={{ fontWeight: 700 }}>{w.name}</div>
            <div className="row">{w.groups.map((g) => <span key={g} className="pill" style={{ background: "var(--accent3)" }}>{MUSCLE_GROUPS.find((m) => m.id === g)?.label}</span>)}</div>
          </div>
          <div className="muted" style={{ margin: "6px 0", fontSize: 13 }}>
            {w.exIds.map((id) => allExercises.find((e) => e.id === id)?.name).filter(Boolean).join(" • ")}
          </div>
          <div className="row">
            <button className="btn btnSmall" onClick={() => setPlayingWorkout(w)}>▶ Rozpocznij</button>
            <button className="btnGhost btnSmall" onClick={() => logWorkout(w)}><CalendarIcon size={13} /> Dodaj do dziś</button>
          </div>
        </div>
      ))}

      <div className="cardTitle" style={{ marginTop: 10 }}>Biblioteka ćwiczeń</div>
      {allExercises.map((e) => (
        <div key={e.id} className="eventItem" style={{ cursor: "pointer" }} onClick={() => setHistoryEx(e)}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>{e.name}</div>
            <div className="muted" style={{ fontSize: 12 }}>{MUSCLE_GROUPS.find((m) => m.id === e.group)?.label} • {e.sets}x{e.reps || `${e.time}s`} • odp. {e.rest}s • {e.difficulty}</div>
          </div>
          <TrendingUp size={16} color="var(--muted)" />
        </div>
      ))}

      {builderOpen && <StrengthWorkoutBuilder exercises={allExercises} onSave={saveCustomWorkout} onClose={() => setBuilderOpen(false)} />}
      {exerciseFormOpen && <ExerciseForm onSave={saveExercise} onClose={() => setExerciseFormOpen(false)} />}
      {playingWorkout && (
        <WorkoutPlayer
          workout={playingWorkout}
          exercises={allExercises}
          onLogExercise={logExerciseEntry}
          onFinish={() => { logWorkout(playingWorkout); setPlayingWorkout(null); }}
          onClose={() => setPlayingWorkout(null)}
        />
      )}
      {historyEx && (
        <ExerciseHistoryModal
          exercise={historyEx}
          logs={data.exerciseLogs[historyEx.id] || []}
          onAdd={(entry) => logExerciseEntry(historyEx.id, entry)}
          onClose={() => setHistoryEx(null)}
        />
      )}
    </div>
  );
}

function Timer({ seconds, onDone, autoStart = true }) {
  const [left, setLeft] = useState(seconds);
  const [running, setRunning] = useState(autoStart);
  useEffect(() => {
    if (!running) return;
    if (left <= 0) { onDone && onDone(); return; }
    const id = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [running, left]);
  const mm = Math.floor(Math.max(0, left) / 60);
  const ss = Math.max(0, left) % 60;
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 40, fontWeight: 800, fontFamily: "'Barlow Condensed'" }}>{pad(mm)}:{pad(ss)}</div>
      <div className="row" style={{ justifyContent: "center", marginTop: 8 }}>
        <button className="btnGhost btnSmall" onClick={() => setRunning((r) => !r)}>{running ? "Pauza" : "Wznów"}</button>
        <button className="btnGhost btnSmall" onClick={() => setLeft((s) => s + 15)}>+15s</button>
        <button className="btn btnSmall" onClick={() => onDone && onDone()}>Pomiń</button>
      </div>
    </div>
  );
}

function WorkoutPlayer({ workout, exercises, onLogExercise, onFinish, onClose }) {
  const list = workout.exIds.map((id) => exercises.find((e) => e.id === id)).filter(Boolean);
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState("exercise"); // exercise | rest
  const [weight, setWeight] = useState("");
  const current = list[idx];

  if (list.length === 0) {
    return <Modal title={workout.name} onClose={onClose}><div className="listEmpty">Ten trening nie ma ćwiczeń.</div></Modal>;
  }

  const finishExercise = () => {
    if (current) onLogExercise(current.id, { weight: weight ? Number(weight) : null, reps: current.reps || null, sets: current.sets || null });
    setWeight("");
    if (idx < list.length - 1) {
      setPhase(current?.rest ? "rest" : "exercise");
      if (!current?.rest) setIdx((i) => i + 1);
    } else {
      onFinish();
    }
  };
  const afterRest = () => { setIdx((i) => i + 1); setPhase("exercise"); };

  return (
    <Modal title={`${workout.name} — ${idx + 1}/${list.length}`} onClose={onClose}>
      {phase === "exercise" && current && (
        <div>
          <div className="cardTitle">{current.name}</div>
          <div className="muted" style={{ marginBottom: 10 }}>{MUSCLE_GROUPS.find((m) => m.id === current.group)?.label} • {current.sets} serie x {current.reps || `${current.time}s`}</div>
          {current.notes && <div className="muted" style={{ marginBottom: 10, fontSize: 12 }}>{current.notes}</div>}
          {current.time > 0 && !current.reps ? (
            <Timer seconds={current.time} onDone={finishExercise} autoStart={false} />
          ) : (
            <div className="field"><label className="label">Ciężar (kg, opcjonalnie)</label><input type="number" className="inp" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="np. 20" /></div>
          )}
          <button className="btn" style={{ width: "100%", justifyContent: "center", marginTop: 10 }} onClick={finishExercise}>
            <Check size={16} /> {idx < list.length - 1 ? "Zrobione — dalej" : "Zakończ trening"}
          </button>
        </div>
      )}
      {phase === "rest" && (
        <div>
          <div className="cardTitle" style={{ justifyContent: "center" }}>Przerwa</div>
          <Timer seconds={current.rest || 30} onDone={afterRest} />
        </div>
      )}
    </Modal>
  );
}

function ExerciseHistoryModal({ exercise, logs, onAdd, onClose }) {
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState(exercise.reps || "");
  const chartData = logs.slice(-15).map((l, i) => ({ i: i + 1, data: formatDatePL(l.date), Ciężar: l.weight || 0 }));
  return (
    <Modal title={`Historia — ${exercise.name}`} onClose={onClose}>
      {logs.length === 0 && <div className="listEmpty">Brak jeszcze zapisanych wykonań tego ćwiczenia.</div>}
      {logs.length > 0 && logs.some((l) => l.weight) && (
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="data" stroke="var(--muted)" fontSize={10} />
            <YAxis stroke="var(--muted)" fontSize={10} />
            <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)" }} />
            <Bar dataKey="Ciężar" fill="var(--accent)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
      <div style={{ maxHeight: 140, overflowY: "auto", margin: "10px 0" }}>
        {[...logs].reverse().slice(0, 10).map((l, i) => (
          <div key={i} className="eventItem">
            <div style={{ flex: 1 }}>{formatDatePL(l.date)}</div>
            <div className="muted">{l.weight ? `${l.weight} kg` : ""} {l.reps ? `• ${l.reps} powt.` : ""}</div>
          </div>
        ))}
      </div>
      <div className="cardTitle" style={{ fontSize: 14 }}>Dodaj wpis ręcznie</div>
      <div className="grid2">
        <div className="field"><label className="label">Ciężar (kg)</label><input type="number" className="inp" value={weight} onChange={(e) => setWeight(e.target.value)} /></div>
        <div className="field"><label className="label">Powtórzenia</label><input type="number" className="inp" value={reps} onChange={(e) => setReps(e.target.value)} /></div>
      </div>
      <button className="btn" style={{ width: "100%", justifyContent: "center" }}
        onClick={() => { onAdd({ weight: weight ? Number(weight) : null, reps: reps ? Number(reps) : null, sets: exercise.sets || null }); setWeight(""); }}>
        <Save size={16} /> Zapisz wpis
      </button>
    </Modal>
  );
}

function ExerciseForm({ onSave, onClose }) {
  const [ex, setEx] = useState({ name: "", group: "legs", sets: 3, reps: 12, time: 0, rest: 45, difficulty: "Średni", notes: "" });
  const setF = (k, v) => setEx((e) => ({ ...e, [k]: v }));
  return (
    <Modal title="Nowe ćwiczenie siłowe" onClose={onClose}>
      <div className="field"><label className="label">Nazwa</label><input className="inp" value={ex.name} onChange={(e) => setF("name", e.target.value)} /></div>
      <div className="field"><label className="label">Opis / notatki</label><textarea className="inp" rows={2} value={ex.notes} onChange={(e) => setF("notes", e.target.value)} /></div>
      <div className="field"><label className="label">Partia ciała</label>
        <select className="inp" value={ex.group} onChange={(e) => setF("group", e.target.value)}>
          {MUSCLE_GROUPS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
        </select>
      </div>
      <div className="grid3">
        <div className="field"><label className="label">Serie</label><input type="number" className="inp" value={ex.sets} onChange={(e) => setF("sets", Number(e.target.value))} /></div>
        <div className="field"><label className="label">Powtórzenia</label><input type="number" className="inp" value={ex.reps} onChange={(e) => setF("reps", Number(e.target.value))} /></div>
        <div className="field"><label className="label">Czas (s, opcjonalnie)</label><input type="number" className="inp" value={ex.time} onChange={(e) => setF("time", Number(e.target.value))} /></div>
      </div>
      <div className="grid2">
        <div className="field"><label className="label">Przerwa (s)</label><input type="number" className="inp" value={ex.rest} onChange={(e) => setF("rest", Number(e.target.value))} /></div>
        <div className="field"><label className="label">Trudność</label>
          <select className="inp" value={ex.difficulty} onChange={(e) => setF("difficulty", e.target.value)}>{DIFFICULTIES.map((d) => <option key={d}>{d}</option>)}</select>
        </div>
      </div>
      <button className="btn" style={{ width: "100%", justifyContent: "center" }} onClick={() => ex.name.trim() && onSave(ex)}><Save size={16} /> Zapisz ćwiczenie</button>
    </Modal>
  );
}

function StrengthWorkoutBuilder({ exercises, onSave, onClose }) {
  const [name, setName] = useState("");
  const [warmup, setWarmup] = useState(5);
  const [groups, setGroups] = useState([]);
  const [exIds, setExIds] = useState([]);
  const toggleGroup = (g) => setGroups((gs) => gs.includes(g) ? gs.filter((x) => x !== g) : [...gs, g]);
  const toggleEx = (id) => setExIds((xs) => xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]);
  const filtered = groups.length ? exercises.filter((e) => groups.includes(e.group)) : exercises;
  return (
    <Modal title="Nowy trening siłowy" onClose={onClose}>
      <div className="field"><label className="label">Nazwa treningu</label><input className="inp" value={name} onChange={(e) => setName(e.target.value)} placeholder="np. Siła nóg — poniedziałek" /></div>
      <div className="field">
  <label className="label">
    Rozgrzewka (min)
  </label>

  <input
    type="number"
    min="0"
    className="inp"
    value={warmup}
    onChange={(e) =>
      setWarmup(Math.max(0, Number(e.target.value)))
    }
  />
</div>
      <div className="label">Partie ciała</div>
      <div className="row" style={{ flexWrap: "wrap", marginBottom: 10 }}>
        {MUSCLE_GROUPS.map((g) => <span key={g.id} className={"chip" + (groups.includes(g.id) ? " active" : "")} onClick={() => toggleGroup(g.id)}>{g.label}</span>)}
      </div>
      <div className="label">Ćwiczenia ({exIds.length} wybrane)</div>
      <div style={{ maxHeight: 240, overflowY: "auto" }}>
        {filtered.map((e) => (
          <div key={e.id} className="eventItem" style={{ cursor: "pointer", borderLeftColor: exIds.includes(e.id) ? "var(--accent)" : "var(--border)" }} onClick={() => toggleEx(e.id)}>
            <input type="checkbox" readOnly checked={exIds.includes(e.id)} />
            <div style={{ flex: 1 }}>{e.name} <span className="muted">({MUSCLE_GROUPS.find((m) => m.id === e.group)?.label})</span></div>
          </div>
        ))}
      </div>
      <button className="btn" style={{ width: "100%", justifyContent: "center", marginTop: 10 }}
       onClick={() =>
  name.trim() &&
  exIds.length &&
  onSave({
    id: uid(),
    name,
    groups,
    exIds,
    warmup: Number(warmup) || 0,
    preset: false
  })
} 
      }><Save size={16} /> Zapisz trening</button>
    </Modal>
  );
}

/* ============================== DIET TAB ============================== */

function computeMealMacros(meal, foodsDb) {
  return meal.foods.reduce((acc, f) => {
    const base = foodsDb.find((x) => x.id === f.id);
    if (!base) return acc;
    const mult = f.qty / 100;
    acc.kcal += base.kcal * mult;
    acc.protein += base.protein * mult;
    acc.carbs += base.carbs * mult;
    acc.fat += base.fat * mult;
    return acc;
  }, { kcal: 0, protein: 0, carbs: 0, fat: 0 });
}

function DietTab({ data, update }) {
  const [tab2, setTab2] = useState("log");
  const t = todayISO();

  const [mealSlot, setMealSlot] = useState("other");

  const MEAL_SLOTS = {
    breakfast: "Śniadanie",
    lunch: "Obiad",
    dinner: "Kolacja",
    snack: "Przekąska",
    preTraining: "Przed treningiem",
    postTraining: "Po treningu",
    preMatch: "Przed meczem",
    postMatch: "Po meczu",
    other: "Inne",
  };

  const [historyDate, setHistoryDate] = useState(t)
  const diaryToday = data.diary[t] || [];


  const totals = diaryToday.reduce((a, i) => ({ kcal: a.kcal + i.kcal, protein: a.protein + i.protein, carbs: a.carbs + i.carbs, fat: a.fat + i.fat }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
  const kcalTarget = data.profile.kcalTarget || 2600;
  const proteinTarget = data.profile.proteinTarget || 140;
  const carbsTarget = data.profile.carbsTarget || 340;
  const fatTarget = data.profile.fatTarget || 85;
  const allFoods = [...ALL_FOODS, ...data.foods];
  const allMeals = [...DEFAULT_MEALS, ...data.meals];

  const [search, setSearch] = useState("");
  const [activeCat, setActiveCat] = useState(null);
  const [showAddFood, setShowAddFood] = useState(false);
  const [showCustomFood, setShowCustomFood] = useState(false);
  const [showMealBuilder, setShowMealBuilder] = useState(false);
  const [showTargets, setShowTargets] = useState(false);
  const [showPhoto, setShowPhoto] = useState(false);
  const [showBarcode, setShowBarcode] = useState(false);
  const [barcodeProduct, setBarcodeProduct] = useState(null);

  const results = (search || activeCat)
    ? allFoods.filter((f) => (!search || f.name.toLowerCase().includes(search.toLowerCase())) && (!activeCat || f.category === activeCat)).slice(0, 80)
    : [];

  const addFoodToDiary = (food, qty, slot = mealSlot) => {
  const mult = qty / 100;

  update((d) => {
    d.diary[t] = [
      ...(d.diary[t] || []),
      {
        key: uid(),
        name: `${food.name} (${qty}g)`,
        slot,
        kcal: food.kcal * mult,
        protein: food.protein * mult,
        carbs: food.carbs * mult,
        fat: food.fat * mult,
      },
    ];
    return d;
  });
};
 const addMealToDiary = (meal) => {
  const m = computeMealMacros(meal, allFoods);

  const slot =
    meal.tags?.find((x) => MEAL_SLOTS[x]) ||
    (meal.tags?.includes("breakfast") ? "breakfast" : mealSlot);

  update((d) => {
    d.diary[t] = [
      ...(d.diary[t] || []),
      {
        key: uid(),
        name: meal.name,
        slot,
        ...m,
      },
    ];
    return d;
  });
};
  const removeDiaryItem = (key) => update((d) => { d.diary[t] = (d.diary[t] || []).filter((i) => i.key !== key); return d; });
  const toggleFavMeal = (id) => update((d) => {
    const i = d.meals.findIndex((m) => m.id === id);
    if (i >= 0) d.meals[i].favorite = !d.meals[i].favorite;
    return d;
  });
const waterToday = getWaterAmount(data, t);
const waterTarget = data.profile.waterTarget || 2200;

const addWater = (ml) =>
  update((d) => changeWater(d, t, ml));

const historyDiary = data.diary[historyDate] || [];

const weekDays = Array.from(
  { length: 7 },
  (_, i) => addDays(t, -6 + i)
);

const weekTotals = weekDays.reduce(
  (acc, date) => {
    const items = data.diary[date] || [];

    items.forEach((i) => {
      acc.kcal += Number(i.kcal || 0);
      acc.protein += Number(i.protein || 0);
      acc.carbs += Number(i.carbs || 0);
      acc.fat += Number(i.fat || 0);
    });

    return acc;
  },
  { kcal: 0, protein: 0, carbs: 0, fat: 0 }
);

const favoriteMeals = allMeals.filter((m) => m.favorite);

const groupedToday = Object.keys(MEAL_SLOTS).map((slot) => ({
  slot,
  items: diaryToday.filter((i) => (i.slot || "other") === slot),
}));

const nextTraining = data.events
  .filter(
    (e) =>
      e.date >= t &&
      (e.category === "football" || e.category === "strength")
  )
  .sort((a, b) =>
    (a.date + (a.time || "23:59")).localeCompare(
      b.date + (b.time || "23:59")
    )
  )[0];

const nextMatchForDiet = data.events
  .filter((e) => e.category === "match" && e.date >= t)
  .sort((a, b) =>
    (a.date + (a.time || "23:59")).localeCompare(
      b.date + (b.time || "23:59")
    )
  )[0];

const performanceMeals = allMeals.filter((m) => {
  if (nextMatchForDiet) {
    return m.tags?.includes("preMatch") || m.tags?.includes("postMatch");
  }

  if (nextTraining) {
    return m.tags?.includes("preTraining") || m.tags?.includes("postTraining");
  }

  return false;
});
  // suggestions based on schedule
  const now = new Date();
  const upcoming = data.events.filter((e) => e.date === t && e.time > `${pad(now.getHours())}:${pad(now.getMinutes())}`).sort((a, b) => a.time.localeCompare(b.time))[0];
  let suggestTag = null, suggestReason = "";
  if (upcoming) {
    const [h, m] = upcoming.time.split(":").map(Number);
    const evMinutes = h * 60 + m;
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const diffH = (evMinutes - nowMinutes) / 60;
    if (upcoming.category === "match" && diffH <= 3) { suggestTag = "preMatch"; suggestReason = `Masz mecz o ${upcoming.time} — lekkostrawny posiłek pomoże Ci być gotowym.`; }
    else if ((upcoming.category === "football" || upcoming.category === "strength") && diffH <= 2.5) { suggestTag = "preTraining"; suggestReason = `Trening za ${diffH.toFixed(1)}h — dobrze zjeść coś lekkostrawnego z węglowodanami.`; }
  }
  if (!suggestTag) {
    const hour = now.getHours();
    if (hour < 10) { suggestTag = "breakfast"; suggestReason = "Pora na śniadanie."; }
    else if (hour >= 18) { suggestTag = "dinner"; suggestReason = "Pora na kolację."; }
    else { suggestTag = "snack"; suggestReason = "Coś na przekąskę."; }
  }
  const suggestedMeals = allMeals.filter((m) => m.tags.includes(suggestTag));

  return (
    <div>
      <div className="card">
        <div className="between">
          <div className="cardTitle" style={{ marginBottom: 0 }}><Flame size={18} color="var(--accent2)" /> Dzisiejszy bilans</div>
          <button className="iconBtn" onClick={() => setShowTargets(true)} title="Ustaw cele"><Settings size={16} /></button>
        </div>
        <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6 }}>{Math.round(totals.kcal)} <span className="muted" style={{ fontSize: 14 }}>/ {kcalTarget} kcal</span></div>
        <div className="progressOuter" style={{ margin: "8px 0" }}><div className="progressInner" style={{ width: `${Math.min(100, (totals.kcal / kcalTarget) * 100)}%` }} /></div>
        <div className="between" style={{ fontSize: 12, marginBottom: 4 }}>
          <span className="muted">Pozostało do celu</span>
          <strong>{Math.max(0, Math.round(kcalTarget - totals.kcal))} kcal</strong>
        </div>
        <div className="grid3" style={{ marginTop: 8, gap: 10 }}>
          <div>
            <div className="muted" style={{ fontSize: 11 }}>Białko</div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{Math.round(totals.protein)}g <span className="muted" style={{ fontWeight: 400 }}>/{proteinTarget}g</span></div>
            <div className="progressOuter" style={{ height: 6, marginTop: 3 }}><div className="progressInner" style={{ width: `${Math.min(100, (totals.protein / proteinTarget) * 100)}%`, background: "var(--accent3)" }} /></div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 11 }}>Węgle</div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{Math.round(totals.carbs)}g <span className="muted" style={{ fontWeight: 400 }}>/{carbsTarget}g</span></div>
            <div className="progressOuter" style={{ height: 6, marginTop: 3 }}><div className="progressInner" style={{ width: `${Math.min(100, (totals.carbs / carbsTarget) * 100)}%`, background: "var(--accent)" }} /></div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 11 }}>Tłuszcz</div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{Math.round(totals.fat)}g <span className="muted" style={{ fontWeight: 400 }}>/{fatTarget}g</span></div>
            <div className="progressOuter" style={{ height: 6, marginTop: 3 }}><div className="progressInner" style={{ width: `${Math.min(100, (totals.fat / fatTarget) * 100)}%`, background: "var(--accent2)" }} /></div>
          </div>
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>Cele wspierają zdrowe odżywianie i energię do treningów — to nie narzędzie do restrykcji.</div>
      </div>
           <div className="card">
        <div className="between">
          <div className="cardTitle" style={{ marginBottom: 0 }}>
            💧 Woda
          </div>
          <strong>
            {(waterToday / 1000).toFixed(1)} / {(waterTarget / 1000).toFixed(1)} l
          </strong>
        </div>

        <div className="progressOuter" style={{ margin: "8px 0" }}>
          <div
            className="progressInner"
            style={{
              width: `${Math.min(100, (waterToday / waterTarget) * 100)}%`,
            }}
          />
        </div>

        <div className="row" style={{ flexWrap: "wrap" }}>
          {[150, 250, 500].map((ml) => (
            <button
              key={ml}
              className="btnGhost btnSmall"
              onClick={() => addWater(ml)}
            >
              +{ml} ml
            </button>
          ))}
        </div>
      </div>
    <div className="card" style={{ borderLeft: "4px solid var(--accent3)" }}>
  <div className="cardTitle" style={{ fontSize: 15 }}>
    💡 Przekąska na dziś
  </div>

  <div style={{ fontWeight: 700, fontSize: 16 }}>
    {dailySnack.name}
  </div>

  <div className="muted" style={{ marginTop: 5 }}>
    {dailySnack.kcal} kcal • B{dailySnack.protein} W{dailySnack.carbs} T{dailySnack.fat}
  </div>

  <div className="muted" style={{ marginTop: 6 }}>
    {dailySnack.note}
  </div>

  <button
    className="btnGhost btnSmall"
    style={{ marginTop: 10 }}
    onClick={() =>
      update((d) => {
        d.diary[t] = [
          ...(d.diary[t] || []),
          {
            key: uid(),
            name: dailySnack.name,
            slot: "snack",
            kcal: dailySnack.kcal,
            protein: dailySnack.protein,
            carbs: dailySnack.carbs,
            fat: dailySnack.fat,
          },
        ];
        return d;
      })
    }
  >
    ➕ Dodaj do dziennika
  </button>
</div>

     <div className="tabs">
  <button className={"tabBtn" + (tab2 === "log" ? " active" : "")} onClick={() => setTab2("log")}>
    Dziennik
  </button>

  <button className={"tabBtn" + (tab2 === "meals" ? " active" : "")} onClick={() => setTab2("meals")}>
    Posiłki
  </button>

  <button className={"tabBtn" + (tab2 === "history" ? " active" : "")} onClick={() => setTab2("history")}>
    Historia
  </button>
</div>

      {tab2 === "log" && (
        <div>
          <div className="card">
     <div className="row" style={{ marginBottom: 10 }}>
              <button className="btn" style={{ flex: 1, justifyContent: "center" }} onClick={() => setShowPhoto(true)}>📷 Zdjęcie posiłku (AI)</button>
              <button className="btnGhost" style={{ flex: 1, justifyContent: "center" }} onClick={() => setShowBarcode(true)}>📊 Skanuj kod</button>
            </div>
<div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
  Rodzaj posiłku
</div>

<div className="row" style={{ flexWrap: "wrap", marginBottom: 10 }}>
  {Object.entries(MEAL_SLOTS).map(([key, label]) => (
    <span
      key={key}
      className={"chip" + (mealSlot === key ? " active" : "")}
      onClick={() => setMealSlot(key)}
    >
      {label}
    </span>
  ))}
</div>
            <div className="row"><Search size={16} /><input className="inp" placeholder="Szukaj wśród ~1000 produktów…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <div className="row" style={{ flexWrap: "wrap", marginTop: 8 }}>
              {FOOD_CATS.map((c) => <span key={c} className={"chip" + (activeCat === c ? " active" : "")} onClick={() => setActiveCat(activeCat === c ? null : c)}>{c}</span>)}
            </div>
            {(search || activeCat) && <div style={{ maxHeight: 260, overflowY: "auto", marginTop: 8 }}>
              {results.length === 0 && <div className="muted" style={{ fontSize: 12, padding: 6 }}>Brak wyników.</div>}
              {results.map((f) => (
                <div key={f.id} className="foodResult" onClick={() => setShowAddFood(f)}>
                  <span>{f.name}</span><span className="muted">{f.kcal} kcal/100g</span>
                </div>
              ))}
            </div>}
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btnGhost btnSmall" onClick={() => setShowCustomFood(true)}><Plus size={13} /> Własny produkt</button>
            </div>
          </div>
          <div className="cardTitle">Dziś zjedzone</div>
          {diaryToday.length === 0 && <div className="listEmpty">Nic jeszcze nie dodano.</div>}
          {diaryToday.map((i) => (
            <div key={i.key} className="eventItem">
              <div style={{ flex: 1 }}><div>{i.name}</div><div className="muted" style={{ fontSize: 11 }}>{Math.round(i.kcal)} kcal • B{Math.round(i.protein)} W{Math.round(i.carbs)} T{Math.round(i.fat)}</div></div>
              <button className="btnDanger btnSmall" onClick={() => removeDiaryItem(i.key)}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      )}

      {tab2 === "meals" && (
        <div>
          <button className="btn" style={{ width: "100%", justifyContent: "center", marginBottom: 10 }} onClick={() => setShowMealBuilder(true)}><Plus size={16} /> Stwórz posiłek</button>
          {allMeals.map((m) => {
            const mm = computeMealMacros(m, allFoods);
            const isCustom = data.meals.some((x) => x.id === m.id);
            return (
              <div key={m.id} className="card">
                <div className="between">
                  <div style={{ fontWeight: 700 }}>{m.name}</div>
                  {isCustom && <button className="iconBtn" onClick={() => toggleFavMeal(m.id)}>{m.favorite ? <Star size={16} color="var(--accent)" /> : <StarOff size={16} />}</button>}
                </div>
                <div className="muted" style={{ fontSize: 12, margin: "4px 0" }}>{Math.round(mm.kcal)} kcal • B{Math.round(mm.protein)} W{Math.round(mm.carbs)} T{Math.round(mm.fat)}</div>
                <div className="row" style={{ flexWrap: "wrap" }}>{m.tags.map((tg) => <span key={tg} className="pill" style={{ background: "var(--accent3)" }}>{MEAL_TAGS[tg]}</span>)}</div>
                <button className="btnGhost btnSmall" style={{ marginTop: 8 }} onClick={() => addMealToDiary(m)}>Dodaj do dziennika</button>
              </div>
            );
          })}
        </div>
      )}
  {tab2 === "history" && (
  <div>
    <div className="card">
      <div className="between">
        <button
          className="btnGhost btnSmall"
          onClick={() => setHistoryDate(addDays(historyDate, -1))}
        >
          ←
        </button>

        <strong>{formatDatePL(historyDate)}</strong>

        <button
          className="btnGhost btnSmall"
          disabled={historyDate >= t}
          onClick={() => setHistoryDate(addDays(historyDate, 1))}
        >
          →
        </button>
      </div>
    </div>

    <div className="card">
      <div className="cardTitle">📊 Podsumowanie dnia</div>

      {historyDiary.length === 0 ? (
        <div className="listEmpty">Brak zapisanych posiłków tego dnia.</div>
      ) : (
        historyDiary.map((i) => (
          <div key={i.key} className="eventItem">
            <div style={{ flex: 1 }}>
              <div>{i.name}</div>
              <div className="muted" style={{ fontSize: 11 }}>
                {Math.round(i.kcal)} kcal • B{Math.round(i.protein)} W{Math.round(i.carbs)} T{Math.round(i.fat)}
              </div>
            </div>
          </div>
        ))
      )}
    </div>

    <div className="card">
      <div className="cardTitle">📈 Ostatnie 7 dni</div>

      <div className="grid2">
        <div>
          <div className="muted">Kalorie</div>
          <strong>{Math.round(weekTotals.kcal)} kcal</strong>
        </div>
        <div>
          <div className="muted">Białko</div>
          <strong>{Math.round(weekTotals.protein)} g</strong>
        </div>
        <div>
          <div className="muted">Węgle</div>
          <strong>{Math.round(weekTotals.carbs)} g</strong>
        </div>
        <div>
          <div className="muted">Tłuszcz</div>
          <strong>{Math.round(weekTotals.fat)} g</strong>
        </div>
      </div>
    </div>

    <div className="card">
      <div className="cardTitle">⭐ Ulubione posiłki</div>

      {favoriteMeals.length === 0 ? (
        <div className="muted">
          Nie masz jeszcze ulubionych posiłków.
        </div>
      ) : (
        favoriteMeals.map((m) => (
          <div key={m.id} className="eventItem">
            <div style={{ flex: 1 }}>{m.name}</div>
            <button
              className="btnGhost btnSmall"
              onClick={() => addMealToDiary(m)}
            >
              Dodaj
            </button>
          </div>
        ))
      )}
    </div>
  </div>
)}
      {showAddFood && <QtyModal food={showAddFood} onClose={() => setShowAddFood(false)} onAdd={(qty) => { addFoodToDiary(showAddFood, qty); setShowAddFood(false); }} />}
      {showCustomFood && <CustomFoodForm onClose={() => setShowCustomFood(false)} onSave={(f) => { update((d) => { d.foods.push(f); return d; }); setShowCustomFood(false); }} />}
      {showMealBuilder && <MealBuilder allFoods={allFoods} onClose={() => setShowMealBuilder(false)} onSave={(m) => { update((d) => { d.meals.push(m); return d; }); setShowMealBuilder(false); }} />}
      {showTargets && (
        <TargetsModal
          profile={data.profile}
          onClose={() => setShowTargets(false)}
          onSave={(vals) => { update((d) => { Object.assign(d.profile, vals); return d; }); setShowTargets(false); }}
        />
      )}
      {showPhoto && (
        <PhotoMealCapture
          profile={data.profile}
          onClose={() => setShowPhoto(false)}
          onAdd={(item) => {
            update((d) => { d.diary[t] = [...(d.diary[t] || []), { key: uid(), ...item }]; return d; });
            setShowPhoto(false);
          }}
        />
      )}
      {showBarcode && (
        <BarcodeScanner
          onClose={() => setShowBarcode(false)}
          onFound={(product) => {
            setShowBarcode(false);
            setBarcodeProduct(product);
          }}
        />
      )}
      {barcodeProduct && (
        <QtyModal
          food={barcodeProduct}
          onClose={() => setBarcodeProduct(null)}
          onAdd={(qty) => {
            const mult = qty / 100;
            update((d) => {
              if (!d.foods.some((food) => food.id === barcodeProduct.id)) d.foods.push(barcodeProduct);
              d.diary[t] = [...(d.diary[t] || []), {
                key: uid(), name: `${barcodeProduct.name} (${qty}g)`,
                kcal: barcodeProduct.kcal * mult, protein: barcodeProduct.protein * mult,
                carbs: barcodeProduct.carbs * mult, fat: barcodeProduct.fat * mult,
              }];
              return d;
            });
            setBarcodeProduct(null);
          }}
        />
      )}
    </div>
  );
}

function TargetsModal({ profile, onClose, onSave }) {
  const [v, setV] = useState({
    kcalTarget: profile.kcalTarget || 2600,
    proteinTarget: profile.proteinTarget || 140,
    carbsTarget: profile.carbsTarget || 340,
    fatTarget: profile.fatTarget || 85,
    waterTarget: profile.waterTarget || 2200,
  });
  const setF = (k, val) => setV((x) => ({ ...x, [k]: Number(val) }));
  return (
    <Modal title="Twoje cele żywieniowe" onClose={onClose}>
      <div className="muted" style={{ marginBottom: 10, fontSize: 12 }}>Ustaw dzienne cele dopasowane do Twoich treningów. To wsparcie, nie restrykcja — możesz je zmieniać w dowolnym momencie.</div>
      <div className="field"><label className="label">Kalorie (kcal)</label><input type="number" className="inp" value={v.kcalTarget} onChange={(e) => setF("kcalTarget", e.target.value)} /></div>
      <div className="grid3">
        <div className="field"><label className="label">Białko (g)</label><input type="number" className="inp" value={v.proteinTarget} onChange={(e) => setF("proteinTarget", e.target.value)} /></div>
        <div className="field"><label className="label">Węgle (g)</label><input type="number" className="inp" value={v.carbsTarget} onChange={(e) => setF("carbsTarget", e.target.value)} /></div>
        <div className="field"><label className="label">Tłuszcz (g)</label><input type="number" className="inp" value={v.fatTarget} onChange={(e) => setF("fatTarget", e.target.value)} /></div>
      </div>
      <div className="field"><label className="label">Woda (ml)</label><input type="number" min="1" className="inp" value={v.waterTarget} onChange={(e) => setF("waterTarget", e.target.value)} /></div>
      <button className="btn" style={{ width: "100%", justifyContent: "center", marginTop: 8 }} onClick={() => onSave(v)}><Save size={16} /> Zapisz cele</button>
    </Modal>
  );
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(",")[1]);
    r.onerror = () => reject(new Error("Nie udało się wczytać zdjęcia"));
    r.readAsDataURL(file);
  });
}

function PhotoMealCapture({ profile, onClose, onAdd }) {
  const [imgPreview, setImgPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  const analyze = async (file) => {
    setError(null); setResult(null); setLoading(true);
    try {
      const base64 = await fileToBase64(file);
      setImgPreview(`data:${file.type};base64,${base64}`);
      const text = await askAI(profile, {
        system: "Jesteś asystentem żywieniowym. Na podstawie zdjęcia posiłku oszacuj jego wartość odżywczą. Odpowiedz WYŁĄCZNIE czystym obiektem JSON, bez markdown, bez ```: {\"name\": string, \"kcal\": number, \"protein\": number, \"carbs\": number, \"fat\": number, \"note\": string}. Wartości to szacunek dla całej widocznej porcji. note to krótki, przyjazny komentarz po polsku (np. co rozpoznano).",
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: file.type || "image/jpeg", data: base64 } },
            { type: "text", text: "Oszacuj kalorie i makroskładniki tego posiłku." },
          ],
        }],
        maxTokens: 500,
      });
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      setResult({ name: parsed.name || "Posiłek ze zdjęcia", kcal: Number(parsed.kcal) || 0, protein: Number(parsed.protein) || 0, carbs: Number(parsed.carbs) || 0, fat: Number(parsed.fat) || 0, note: parsed.note || "" });
    } catch (e) {
      setError(e.code === "NO_PROVIDER"
        ? "Funkcja AI wymaga darmowego klucza Google Gemini albo klucza Anthropic — dodaj go w zakładce Profil, albo dodaj produkt ręcznie."
        : "Nie udało się rozpoznać posiłku. Spróbuj innego zdjęcia albo dodaj produkt ręcznie.");
    }
    setLoading(false);
  };

  const setR = (k, v) => setResult((r) => ({ ...r, [k]: Number(v) }));

  return (
    <Modal title="Rozpoznaj posiłek ze zdjęcia" onClose={onClose}>
      <div className="muted" style={{ marginBottom: 10, fontSize: 12 }}>Zrób zdjęcie talerza albo wybierz z galerii — AI oszacuje kalorie i makroskładniki. Wynik możesz poprawić przed dodaniem.</div>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }}
        onChange={(e) => e.target.files[0] && analyze(e.target.files[0])} />
      <button className="btn" style={{ width: "100%", justifyContent: "center" }} onClick={() => fileRef.current?.click()}>📷 Zrób / wybierz zdjęcie</button>

      {imgPreview && <img src={imgPreview} alt="Podgląd posiłku" style={{ width: "100%", borderRadius: 12, marginTop: 10, maxHeight: 220, objectFit: "cover" }} />}
      {loading && <div className="muted" style={{ marginTop: 10 }}>AI analizuje zdjęcie…</div>}
      {error && <div className="muted" style={{ marginTop: 10, color: "var(--accent2)" }}>{error}</div>}

      {result && (
        <div className="card" style={{ marginTop: 10, background: "var(--card2)" }}>
          <div className="field"><label className="label">Nazwa</label><input className="inp" value={result.name} onChange={(e) => setResult((r) => ({ ...r, name: e.target.value }))} /></div>
          <div className="grid2">
            <div className="field"><label className="label">Kalorie</label><input type="number" className="inp" value={result.kcal} onChange={(e) => setR("kcal", e.target.value)} /></div>
            <div className="field"><label className="label">Białko (g)</label><input type="number" className="inp" value={result.protein} onChange={(e) => setR("protein", e.target.value)} /></div>
            <div className="field"><label className="label">Węgle (g)</label><input type="number" className="inp" value={result.carbs} onChange={(e) => setR("carbs", e.target.value)} /></div>
            <div className="field"><label className="label">Tłuszcz (g)</label><input type="number" className="inp" value={result.fat} onChange={(e) => setR("fat", e.target.value)} /></div>
          </div>
          {result.note && <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{result.note}</div>}
          <button className="btn" style={{ width: "100%", justifyContent: "center" }}
            onClick={() => onAdd({ name: result.name, kcal: result.kcal, protein: result.protein, carbs: result.carbs, fat: result.fat })}>
            <Save size={16} /> Dodaj do dziennika
          </button>
        </div>
      )}
    </Modal>
  );
}

function BarcodeScanner({ onClose, onFound }) {
  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const [status, setStatus] = useState("Uruchamiam kamerę…");
  const [error, setError] = useState(null);
  const [manualCode, setManualCode] = useState("");
  const [loadingLookup, setLoadingLookup] = useState(false);

  const lookup = async (code) => {
    setLoadingLookup(true);
    setError(null);
    try {
      const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`);
      const json = await res.json();
      if (json.status !== 1 || !json.product) throw new Error("Nie znaleziono produktu");
      const p = json.product;
      const n = p.nutriments || {};
      const product = {
        id: "off_" + code,
        name: p.product_name || p.generic_name || `Produkt ${code}`,
        category: "Zeskanowane",
        kcal: Math.round(n["energy-kcal_100g"] || n["energy-kcal"] || 0),
        protein: +(n["proteins_100g"] || 0).toFixed(1),
        carbs: +(n["carbohydrates_100g"] || 0).toFixed(1),
        fat: +(n["fat_100g"] || 0).toFixed(1),
      };
      onFound(product);
    } catch (e) {
      setError("Nie znaleziono tego produktu w bazie OpenFoodFacts. Możesz dodać go ręcznie jako własny produkt.");
    }
    setLoadingLookup(false);
  };

  useEffect(() => {
    let stopped = false;
    let stream = null;
    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader();
        readerRef.current = reader;
        setStatus("Wyceluj w kod kreskowy produktu…");
        await reader.decodeFromVideoDevice(undefined, videoRef.current, (result) => {
          if (result && !stopped) {
            stopped = true;
            lookup(result.getText());
            try { reader.reset(); } catch (e) { /* ignoruj */ }
          }
        });
      } catch (e) {
        setError("Nie udało się uruchomić kamery. Możesz wpisać kod ręcznie poniżej.");
      }
    })();
    return () => {
      stopped = true;
      try { readerRef.current?.reset(); } catch (e) { /* ignoruj */ }
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks().forEach((tr) => tr.stop());
      }
    };
  }, []);

  return (
    <Modal title="Skanuj kod kreskowy" onClose={onClose}>
      <div className="muted" style={{ marginBottom: 10, fontSize: 12 }}>{status} Dane pobierane z darmowej, otwartej bazy OpenFoodFacts.</div>
      <div style={{ borderRadius: 12, overflow: "hidden", background: "#000" }}>
        <video ref={videoRef} style={{ width: "100%", display: "block", maxHeight: 280 }} muted playsInline />
      </div>
      {loadingLookup && <div className="muted" style={{ marginTop: 10 }}>Szukam produktu…</div>}
      {error && <div className="muted" style={{ marginTop: 10, color: "var(--accent2)" }}>{error}</div>}
      <div className="field" style={{ marginTop: 12 }}>
        <label className="label">Albo wpisz kod ręcznie</label>
        <div className="row">
          <input className="inp" value={manualCode} onChange={(e) => setManualCode(e.target.value)} placeholder="np. 5900259023082" />
          <button className="btn" onClick={() => manualCode.trim() && lookup(manualCode.trim())}><Search size={16} /></button>
        </div>
      </div>
    </Modal>
  );
}

function QtyModal({ food, onClose, onAdd }) {
  const [qty, setQty] = useState(100);
  const validQty = Number.isFinite(qty) && qty > 0;
  return (
    <Modal title={food.name} onClose={onClose}>
      <div className="field"><label className="label">Ilość (g)</label><input type="number" min="1" step="1" className="inp" value={qty} onChange={(e) => setQty(Number(e.target.value))} /></div>
      <div className="muted" style={{ marginBottom: 10 }}>{Math.round(food.kcal * qty / 100)} kcal • B{Math.round(food.protein * qty / 100)} W{Math.round(food.carbs * qty / 100)} T{Math.round(food.fat * qty / 100)}</div>
      <button className="btn" disabled={!validQty} style={{ width: "100%", justifyContent: "center" }} onClick={() => validQty && onAdd(qty)}>Dodaj do dziennika</button>
    </Modal>
  );
}

function CustomFoodForm({ onClose, onSave }) {
  const [f, setF] = useState({ id: uid(), name: "", kcal: 0, protein: 0, carbs: 0, fat: 0 });
  const setV = (k, v) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Modal title="Własny produkt (na 100g)" onClose={onClose}>
      <div className="field"><label className="label">Nazwa</label><input className="inp" value={f.name} onChange={(e) => setV("name", e.target.value)} /></div>
      <div className="grid2">
        <div className="field"><label className="label">Kalorie</label><input type="number" className="inp" value={f.kcal} onChange={(e) => setV("kcal", Number(e.target.value))} /></div>
        <div className="field"><label className="label">Białko (g)</label><input type="number" className="inp" value={f.protein} onChange={(e) => setV("protein", Number(e.target.value))} /></div>
        <div className="field"><label className="label">Węglowodany (g)</label><input type="number" className="inp" value={f.carbs} onChange={(e) => setV("carbs", Number(e.target.value))} /></div>
        <div className="field"><label className="label">Tłuszcz (g)</label><input type="number" className="inp" value={f.fat} onChange={(e) => setV("fat", Number(e.target.value))} /></div>
      </div>
      <button className="btn" style={{ width: "100%", justifyContent: "center" }} onClick={() => f.name.trim() && onSave(f)}><Save size={16} /> Zapisz produkt</button>
    </Modal>
  );
}

function MealBuilder({ allFoods, onClose, onSave }) {
  const [name, setName] = useState("");
  const [tags, setTags] = useState([]);
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState("");
  const results = search ? allFoods.filter((f) => f.name.toLowerCase().includes(search.toLowerCase())) : [];
  const addItem = (food) => setItems((it) => [...it, { id: food.id, qty: 100 }]);
  const updQty = (idx, qty) => setItems((it) => it.map((x, i) => i === idx ? { ...x, qty } : x));
  const removeItem = (idx) => setItems((it) => it.filter((_, i) => i !== idx));
  const toggleTag = (t) => setTags((ts) => ts.includes(t) ? ts.filter((x) => x !== t) : [...ts, t]);
  return (
    <Modal title="Nowy posiłek" onClose={onClose}>
      <div className="field"><label className="label">Nazwa posiłku</label><input className="inp" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="label">Kiedy jeść</div>
      <div className="row" style={{ flexWrap: "wrap", marginBottom: 10 }}>
        {Object.entries(MEAL_TAGS).map(([k, l]) => <span key={k} className={"chip" + (tags.includes(k) ? " active" : "")} onClick={() => toggleTag(k)}>{l}</span>)}
      </div>
      <div className="field"><label className="label">Dodaj produkty</label><input className="inp" placeholder="Szukaj…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      {results.map((f) => <div key={f.id} className="foodResult" onClick={() => addItem(f)}><span>{f.name}</span><Plus size={14} /></div>)}
      {items.map((it, idx) => {
        const base = allFoods.find((f) => f.id === it.id);
        return (
          <div key={idx} className="row" style={{ marginBottom: 6 }}>
            <span style={{ flex: 1 }}>{base?.name}</span>
            <input type="number" className="inp" style={{ width: 70 }} value={it.qty} onChange={(e) => updQty(idx, Number(e.target.value))} />
            <span className="muted">g</span>
            <button className="btnDanger btnSmall" onClick={() => removeItem(idx)}><Trash2 size={12} /></button>
          </div>
        );
      })}
      <button className="btn" style={{ width: "100%", justifyContent: "center", marginTop: 10 }}
        onClick={() => name.trim() && items.length && onSave({ id: uid(), name, foods: items, tags, favorite: false })}><Save size={16} /> Zapisz posiłek</button>
    </Modal>
  );
}

/* ============================== SCHOOL TAB ============================== */

const SCHOOL_TYPES = { test: "Sprawdzian", quiz: "Kartkówka", homework: "Zadanie domowe", project: "Projekt", presentation: "Prezentacja", other: "Inny termin" };
const IMPORTANCE = ["Niska", "Średnia", "Wysoka"];

function SchoolTab({ data, update }) {
  const [showForm, setShowForm] = useState(false);
  const t = todayISO();
  const daysLabel = (date) => {
  const days = diffDays(t, date);
  if (days === 0) return "Dzisiaj";
  if (days === 1) return "Jutro";
  if (days === 2) return "Za 2 dni";
  return `Za ${days} dni`;
};
  const sorted = [...data.schoolItems].sort((a, b) => a.date.localeCompare(b.date));
  const upcoming = sorted.filter((s) => diffDays(t, s.date) >= 0);
  const past = sorted.filter((s) => diffDays(t, s.date) < 0);

const markPrepared = (id) => {
  update((d) => {
    const item = d.schoolItems.find((s) => s.id === id);
    if (item) item.prepared = !item.prepared;
    return d;
  });
};

 const save = (item) => {
  update((d) => {
    d.schoolItems.push(item);

    d.events.push({
      id: uid(),
      title: `${SCHOOL_TYPES[item.type]}: ${item.name}`,
      date: item.date,
      time: "",
      duration: 0,
      description: item.description || "",
      category:
        item.type === "homework"
          ? "homework"
          : item.type === "test"
          ? "test"
          : item.type === "quiz"
          ? "quiz"
          : "school",
      reminder: false,
      schoolItem: true,
    });

    return d;
  });

  setShowForm(false);
};
  const remove = (id) => update((d) => { d.schoolItems = d.schoolItems.filter((s) => s.id !== id); return d; });

  return (
    <div>
      <button className="btn" style={{ width: "100%", justifyContent: "center", marginBottom: 12 }} onClick={() => setShowForm(true)}><Plus size={16} /> Dodaj termin</button>
      <div className="cardTitle"><GraduationCap size={18} /> Najbliższe</div>
      {upcoming.length === 0 && <div className="listEmpty">Brak nadchodzących terminów.</div>}
      {upcoming.map((s) => (
        <div key={s.id} className="card" style={{ borderLeft: `4px solid ${s.importance === "Wysoka" ? "#FF5A36" : s.importance === "Średnia" ? "#FFD23C" : "#5AA9FF"}` }}>
          <div className="between">
            <div>
              <div className="muted" style={{ fontSize: 12, fontWeight: 700, color: "var(--accent3)" }}>{s.subject.toUpperCase()}</div>
              <div style={{ fontWeight: 700 }}>{SCHOOL_TYPES[s.type]} — {s.name}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="muted" style={{ fontSize: 12 }}>{formatDatePL(s.date)}</div>
              <div style={{ fontWeight: 700, color: diffDays(t, s.date) <= 1 ? "var(--accent2)" : "var(--text)" }}>{daysLabel(s.date)}</div>
            </div>
          </div>
          {s.description && <div className="muted" style={{ marginTop: 6 }}>{s.description}</div>}
          <button className="btnDanger btnSmall" style={{ marginTop: 8 }} onClick={() => remove(s.id)}><Trash2 size={12} /> Usuń</button>
        </div>
      ))}
      {past.length > 0 && <>
        <div className="cardTitle" style={{ marginTop: 14, color: "var(--muted)" }}>Minione</div>
        {past.slice(-5).reverse().map((s) => (
          <div key={s.id} className="eventItem" style={{ opacity: 0.6 }}>
            <div style={{ flex: 1 }}>{s.subject} — {s.name}</div>
            <div className="muted" style={{ fontSize: 12 }}>{formatDatePL(s.date)}</div>
          </div>
        ))}
      </>}
      {showForm && <SchoolForm onSave={save} onClose={() => setShowForm(false)} />}
    </div>
  );
}

function SchoolForm({ onSave, onClose }) {
  const [s, setS] = useState({ id: uid(), subject: "", name: "", date: todayISO(), type: "test", importance: "Średnia", description: "" });
  const setF = (k, v) => setS((x) => ({ ...x, [k]: v }));
  return (
    <Modal title="Nowy termin szkolny" onClose={onClose}>
      <div className="field"><label className="label">Przedmiot</label><input className="inp" value={s.subject} onChange={(e) => setF("subject", e.target.value)} placeholder="np. Matematyka" /></div>
      <div className="field"><label className="label">Nazwa</label><input className="inp" value={s.name} onChange={(e) => setF("name", e.target.value)} placeholder="np. Funkcje kwadratowe" /></div>
      <div className="grid2">
        <div className="field"><label className="label">Typ</label>
          <select className="inp" value={s.type} onChange={(e) => setF("type", e.target.value)}>{Object.entries(SCHOOL_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </div>
        <div className="field"><label className="label">Termin</label><input type="date" className="inp" value={s.date} onChange={(e) => setF("date", e.target.value)} /></div>
      </div>
      <div className="field"><label className="label">Ważność</label>
        <select className="inp" value={s.importance} onChange={(e) => setF("importance", e.target.value)}>{IMPORTANCE.map((i) => <option key={i}>{i}</option>)}</select>
      </div>
      <div className="field"><label className="label">Opis</label><textarea className="inp" rows={2} value={s.description} onChange={(e) => setF("description", e.target.value)} /></div>
      <button className="btn" style={{ width: "100%", justifyContent: "center" }} onClick={() => s.subject.trim() && s.name.trim() && onSave(s)}><Save size={16} /> Zapisz</button>
    </Modal>
  );
}

/* ============================== HABITS TAB ============================== */

function HabitsTab({ data, update }) {
  const [newHabit, setNewHabit] = useState("");
  const [icon, setIcon] = useState("✅");
  const t = todayISO();
  const last14 = Array.from({ length: 14 }, (_, i) => addDays(t, -13 + i));

  const addHabit = () => {
    if (!newHabit.trim()) return;
    update((d) => { d.habits.push({ id: uid(), name: newHabit, icon }); return d; });
    setNewHabit("");
  };
  const removeHabit = (id) => update((d) => { d.habits = d.habits.filter((h) => h.id !== id); return d; });
  const toggle = (id, date) => update((d) => {
    const arr = d.habitLog[date] || [];
    d.habitLog[date] = arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id];
    return d;
  });
  const streak = (id) => {
    let s = 0;
    for (let i = 0; i < 60; i++) {
      const date = addDays(t, -i);
      if ((data.habitLog[date] || []).includes(id)) s++; else break;
    }
    return s;
  };

  return (
    <div>
      <div className="card">
        <div className="cardTitle"><ListChecks size={18} /> Nowy nawyk</div>
        <div className="row">
          <input className="inp" style={{ width: 60 }} value={icon} onChange={(e) => setIcon(e.target.value)} />
          <input className="inp" placeholder="np. Rozciąganie po treningu" value={newHabit} onChange={(e) => setNewHabit(e.target.value)} />
          <button className="btn" onClick={addHabit}><Plus size={16} /></button>
        </div>
      </div>
      {data.habits.map((h) => (
        <div key={h.id} className="card">
          <div className="between">
            <div className="row"><span style={{ fontSize: 20 }}>{h.icon}</span><b>{h.name}</b></div>
            <div className="row">
              <span className="pill" style={{ background: "var(--accent)" }}>🔥 {streak(h.id)} dni</span>
              <button className="btnDanger btnSmall" onClick={() => removeHabit(h.id)}><Trash2 size={12} /></button>
            </div>
          </div>
          <div className="row" style={{ marginTop: 8, gap: 4 }}>
            {last14.map((date) => {
              const done = (data.habitLog[date] || []).includes(h.id);
              return <div key={date} className={"habitDot" + (done ? " done" : "")} style={{ width: 22, height: 22, fontSize: 10 }}
                onClick={() => toggle(h.id, date)} title={date}>{done ? "✓" : ""}</div>;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
/* ============================== WEEKLY REPORT ============================== */

function WeeklyReportTab({ data }) {
  const t = todayISO();
  const weekStart = startOfWeek(t);
  const weekEnd = addDays(weekStart, 6);
  const prevStart = addDays(weekStart, -7);
  const prevEnd = addDays(weekStart, -1);

  const currentEvents = data.events.filter(
    (e) => e.date >= weekStart && e.date <= weekEnd
  );

  const previousEvents = data.events.filter(
    (e) => e.date >= prevStart && e.date <= prevEnd
  );

  const training = currentEvents.filter((e) =>
    ["football", "strength"].includes(e.category)
  );

  const previousTraining = previousEvents.filter((e) =>
    ["football", "strength"].includes(e.category)
  );

  const minutes = training.reduce((s, e) => s + (e.duration || 0), 0);
  const previousMinutes = previousTraining.reduce(
    (s, e) => s + (e.duration || 0),
    0
  );

  const matches = currentEvents.filter((e) => e.category === "match").length;
  const activeDays = new Set(training.map((e) => e.date)).size;

  const habitsDone = Object.entries(data.habitLog || {})
    .filter(([date]) => date >= weekStart && date <= weekEnd)
    .reduce((s, [, arr]) => s + arr.length, 0);

  const diff = minutes - previousMinutes;

  return (
    <div>
      <div className="card">
        <div className="cardTitle">📈 Raport tygodniowy</div>
        <div className="muted">
          {formatDatePL(weekStart)} – {formatDatePL(weekEnd)}
        </div>
      </div>

      <div className="grid2">
        <StatCard label="Minuty treningu" value={`${minutes} min`} icon="⚽" />
        <StatCard label="Aktywne dni" value={`${activeDays}/7`} icon="🔥" />
        <StatCard label="Mecze" value={matches} icon="🏆" />
        <StatCard label="Nawyki" value={habitsDone} icon="✅" />
      </div>

      <div className="card">
        <div className="cardTitle">📊 Porównanie z poprzednim tygodniem</div>

        <div className="eventItem">
          <span>Trening</span>
          <strong>
            {diff > 0 ? "+" : ""}
            {diff} min
          </strong>
        </div>

        <div className="eventItem">
          <span>Ten tydzień</span>
          <strong>{minutes} min</strong>
        </div>

        <div className="eventItem">
          <span>Poprzedni tydzień</span>
          <strong>{previousMinutes} min</strong>
        </div>
      </div>

      <div className="card">
        <div className="cardTitle">📝 Podsumowanie</div>

        <div style={{ lineHeight: 1.6 }}>
          {minutes === 0
            ? "W tym tygodniu nie ma jeszcze zapisanych treningów."
            : minutes > previousMinutes
            ? `Świetna robota! Trenowałeś o ${minutes - previousMinutes} min więcej niż w poprzednim tygodniu.`
            : minutes === previousMinutes
            ? "Utrzymałeś taki sam poziom aktywności jak w poprzednim tygodniu."
            : `W tym tygodniu było o ${previousMinutes - minutes} min mniej treningu. Pamiętaj o regeneracji i regularności.`}
        </div>
      </div>
    </div>
  );
}

/* ============================== OFFLINE TRAINING GENERATOR ============================== */

function TrainingGeneratorTab({ data }) {
  const [duration, setDuration] = useState(30);
  const [goal, setGoal] = useState("Technika");
  const [generated, setGenerated] = useState([]);

  const drills = data.drills || [];

 const generate = () => {
  const allDrills = Array.isArray(data.drills) ? data.drills : [];

  if (allDrills.length === 0) {
    setGenerated([]);
    alert("Nie masz jeszcze żadnych ćwiczeń w bibliotece.");
    return;
  }

  const goalMap = {
    "Technika": ["technika", "ball control", "kontrola", "prowadzenie"],
    "Drybling": ["drybling", "dryblingi", "zwody", "prowadzenie"],
    "Strzały": ["strzały", "strzał", "shooting", "finishing", "wykończenie"],
    "Szybkość": ["szybkość", "speed", "sprint", "przyspieszenie"],
    "Podania": ["podania", "podanie", "passing", "pass"]
  };

  const keywords = goalMap[goal] || [];

  const matching = allDrills.filter((drill) => {
    const text = `
      ${drill.name || ""}
      ${drill.category || ""}
      ${drill.description || ""}
      ${drill.tags || ""}
    `.toLowerCase();

    return keywords.some((keyword) => text.includes(keyword));
  });

  // Jeśli nie ma ćwiczeń pasujących do celu,
  // używamy wszystkich dostępnych ćwiczeń.
  const pool = matching.length > 0 ? matching : allDrills;

  // Losowanie ćwiczeń
  const shuffled = [...pool].sort(() => Math.random() - 0.5);

  let remaining = Number(duration) || 30;
  const result = [];

  for (const drill of shuffled) {
    if (remaining <= 0) break;

    const originalDuration = Number(drill.duration) || 5;
    const generatedDuration = Math.min(originalDuration, remaining);

    result.push({
      ...drill,
      generatedDuration
    });

    remaining -= generatedDuration;
  }

  setGenerated(result);
};

  // Jeśli nie znaleziono ćwiczeń dla celu,
  // generator korzysta ze wszystkich ćwiczeń.
  const pool = matching.length > 0 ? matching : allDrills;

  const shuffled = [...pool].sort(() => Math.random() - 0.5);

  let total = 0;
  const result = [];

  for (const drill of shuffled) {
    if (total >= duration) break;

    const drillDuration = Number(drill.duration) || 5;
    const remaining = duration - total;
    const mins = Math.min(drillDuration, remaining);

    result.push({
      ...drill,
      generatedDuration: mins,
    });

    total += mins;
  }

  setGenerated(result);
};

  return (
    <div>
      <div className="card">
        <div className="cardTitle">⚡ Generator treningu offline</div>
        <div className="muted">
          Działa lokalnie — nie korzysta z AI ani Netlify.
        </div>
      </div>

      <div className="card">
        <div className="field">
          <label className="label">Czas treningu</label>
          <div className="row" style={{ flexWrap: "wrap" }}>
            {[15, 30, 45, 60].map((x) => (
              <span
                key={x}
                className={"chip" + (duration === x ? " active" : "")}
                onClick={() => setDuration(x)}
              >
                {x} min
              </span>
            ))}
          </div>
        </div>

        <div className="field">
          <label className="label">Cel</label>
          <select
            className="inp"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
          >
            <option>Technika</option>
            <option>Drybling</option>
            <option>Strzały</option>
            <option>Szybkość</option>
            <option>Podania</option>
          </select>
        </div>

        <button className="btn" onClick={generate}>
          ⚡ Wygeneruj trening
        </button>
      </div>

      {generated.length > 0 && (
        <div className="card">
          <div className="cardTitle">Twój trening</div>

          {generated.map((d, i) => (
            <div key={i} className="eventItem">
              <div style={{ flex: 1 }}>
                <strong>{i + 1}. {d.name}</strong>
                <div className="muted">
                  {d.category || "Piłka"}
                </div>
              </div>

              <strong>{d.generatedDuration} min</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================== MATCH JOURNAL ============================== */

function MatchJournalTab({ data, update }) {
  const [opponent, setOpponent] = useState("");
  const [score, setScore] = useState("");
  const [minutes, setMinutes] = useState("");
  const [goals, setGoals] = useState("");
  const [assists, setAssists] = useState("");
  const [rating, setRating] = useState("");
  const [note, setNote] = useState("");

  const matches = data.matchJournal || [];

  const save = () => {
    if (!opponent.trim()) return;

    update((d) => {
      d.matchJournal = d.matchJournal || [];

      d.matchJournal.unshift({
        id: Date.now(),
        date: todayISO(),
        opponent: opponent.trim(),
        score,
        minutes: Number(minutes) || 0,
        goals: Number(goals) || 0,
        assists: Number(assists) || 0,
        rating: Number(rating) || 0,
        note: note.trim(),
      });

      return d;
    });

    setOpponent("");
    setScore("");
    setMinutes("");
    setGoals("");
    setAssists("");
    setRating("");
    setNote("");
  };

  return (
    <div>
      <div className="card">
        <div className="cardTitle">🏆 Dziennik meczowy</div>
        <div className="muted">
          Zapisuj swoje występy i obserwuj postęp.
        </div>
      </div>

      <div className="card">
        <div className="field">
          <label className="label">Przeciwnik</label>
          <input
            className="inp"
            value={opponent}
            onChange={(e) => setOpponent(e.target.value)}
            placeholder="np. Stal Mielec"
          />
        </div>

        <div className="grid2">
          <div className="field">
            <label className="label">Wynik</label>
            <input
              className="inp"
              value={score}
              onChange={(e) => setScore(e.target.value)}
              placeholder="2:1"
            />
          </div>

          <div className="field">
            <label className="label">Minuty</label>
            <input
              type="number"
              className="inp"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              placeholder="60"
            />
          </div>

          <div className="field">
            <label className="label">Gole</label>
            <input
              type="number"
              className="inp"
              value={goals}
              onChange={(e) => setGoals(e.target.value)}
              placeholder="0"
            />
          </div>

          <div className="field">
            <label className="label">Asysty</label>
            <input
              type="number"
              className="inp"
              value={assists}
              onChange={(e) => setAssists(e.target.value)}
              placeholder="0"
            />
          </div>

          <div className="field">
            <label className="label">Ocena</label>
            <input
              type="number"
              step="0.1"
              min="0"
              max="10"
              className="inp"
              value={rating}
              onChange={(e) => setRating(e.target.value)}
              placeholder="7.5"
            />
          </div>
        </div>

        <div className="field">
          <label className="label">Notatka</label>
          <textarea
            className="inp"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Co poszło dobrze? Co poprawić?"
          />
        </div>

        <button className="btn" onClick={save}>
          💾 Zapisz mecz
        </button>
      </div>

      <div className="card">
        <div className="cardTitle">Historia meczów</div>

        {matches.length === 0 && (
          <div className="muted">Nie masz jeszcze zapisanych meczów.</div>
        )}

        {matches.map((m) => (
          <div key={m.id} className="eventItem">
            <div style={{ flex: 1 }}>
              <strong>vs {m.opponent}</strong>
              <div className="muted">
                {m.date} • {m.score || "brak wyniku"}
              </div>
              <div style={{ marginTop: 4 }}>
                ⚽ {m.goals} goleń • 🎯 {m.assists} asysty • ⏱️ {m.minutes} min
              </div>
              {m.rating > 0 && (
                <div className="muted">Ocena: {m.rating}/10</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================== STATS TAB ============================== */

function StatsTab({ data, update }) {
  const t = todayISO();
  const last7 = Array.from({ length: 7 }, (_, i) => addDays(t, -6 + i));
  const chartData = last7.map((date) => {
    const evs = data.events.filter((e) => e.date === date);
    const footballMin = evs.filter((e) => e.category === "football").reduce((s, e) => s + (e.duration || 0), 0);
    const strengthMin = evs.filter((e) => e.category === "strength").reduce((s, e) => s + (e.duration || 0), 0);
    return { day: DAYS_PL[(fromISO(date).getDay() + 6) % 7], Piłka: footballMin, Siłownia: strengthMin };
  });
  const completedEvents = data.events.filter((e) => e.completed);

const totalFootball = completedEvents.filter(
  (e) => e.category === "football"
).length;

const totalStrength = completedEvents.filter(
  (e) => e.category === "strength"
).length;

const totalMatches = completedEvents.filter(
  (e) => e.category === "match"
).length;
  const totalMinutes = completedEvents
  .filter((e) => ["football", "strength"].includes(e.category))
  .reduce((s, e) => s + (e.duration || 0), 0);
  const habitsCompletion = Object.values(data.habitLog).reduce((s, arr) => s + arr.length, 0);
  const history = [...data.events].filter((e) => ["football", "strength", "match"].includes(e.category) && e.date <= t).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
  const thisWeekStart = startOfWeek(t);
  const thisWeekMinutes = data.events
  .filter(
    (e) =>
      e.date >= thisWeekStart &&
      e.date <= addDays(thisWeekStart, 6) &&
      ["football", "strength"].includes(e.category) &&
      e.completed
  )
  .reduce((s, e) => s + (e.duration || 0), 0);

const lastWeekStart = addDays(thisWeekStart, -7);

const lastWeekMinutes = data.events
  .filter(
    (e) =>
      e.date >= lastWeekStart &&
      e.date < thisWeekStart &&
      ["football", "strength"].includes(e.category) &&
      e.completed
  )
  .reduce((s, e) => s + (e.duration || 0), 0);
  const consistency = last7.filter((d) =>
  data.events.some(
    (e) =>
      e.date === d &&
      ["football", "strength"].includes(e.category) &&
      e.completed
  )
).length;
  const pieData = [
    { name: "Piłkarski", value: totalFootball, color: "#C6FF3D" },
    { name: "Siłowy", value: totalStrength, color: "#FF5A36" },
    { name: "Mecze", value: totalMatches, color: "#FFD23C" },
  ];

  return (
    <div>
      <div className="grid3">
        <StatCard label="Treningi piłkarskie" value={totalFootball} icon={<Trophy size={16} color="var(--accent)" />} />
        <StatCard label="Treningi siłowe" value={totalStrength} icon={<Dumbbell size={16} color="var(--accent2)" />} />
        <StatCard label="Mecze" value={totalMatches} icon={<Trophy size={16} color="#FFD23C" />} />
      </div>
      <div className="grid2">
        <StatCard label="Minuty treningów" value={totalMinutes} icon={<Clock size={16} color="var(--accent3)" />} />
        <StatCard label="Wykonane nawyki" value={habitsCompletion} icon={<Check size={16} color="var(--accent)" />} />
      </div>
      <div className="grid3">
        <StatCard label="Ten tydzień" value={`${thisWeekMinutes} min`} icon={<TrendingUp size={16} color="var(--accent)" />} />
        <StatCard label="Poprzedni tydzień" value={`${lastWeekMinutes} min`} icon={<RotateCcw size={16} color="var(--accent2)" />} />
        <StatCard label="Aktywne dni / 7" value={`${consistency}/7`} icon={<Flame size={16} color="#FFD23C" />} />
      </div>

      <div className="card">
        <div className="cardTitle"><Activity size={18} /> Aktywność w tygodniu (min)</div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="day" stroke="var(--muted)" fontSize={12} />
            <YAxis stroke="var(--muted)" fontSize={12} />
            <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)" }} />
            <Bar dataKey="Piłka" fill="#C6FF3D" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Siłownia" fill="#FF5A36" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="card">
        <div className="cardTitle">Rozkład aktywności</div>
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={75}>
              {pieData.map((p, i) => <Cell key={i} fill={p.color} />)}
            </Pie>
            <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)" }} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="card">
        <div className="cardTitle">Historia treningów</div>
        {history.length === 0 && <div className="listEmpty">Brak historii.</div>}
        {history.map((e) => (
  <div
    key={e.id}
    className="eventItem"
    style={{
      borderColor: CATEGORIES[e.category]?.color,
      opacity: e.completed ? 0.65 : 1,
    }}
  >
    <div style={{ flex: 1 }}>
      <div style={{
        textDecoration: e.completed ? "line-through" : "none"
      }}>
        {e.title}
      </div>

      <div className="muted" style={{ fontSize: 12 }}>
        {formatDatePL(e.date)}
      </div>
    </div>

    <EventStatusButton event={e} update={update} />
  </div>
))}
      </div>
    </div>
  );
}

function StatCard({ label, value, icon }) {
  return (
    <div className="card" style={{ textAlign: "center" }}>
      <div style={{ marginBottom: 4 }}>{icon}</div>
      <div style={{ fontSize: 22, fontWeight: 800 }}>{value}</div>
      <div className="muted" style={{ fontSize: 11 }}>{label}</div>
    </div>
  );
}

/* ============================== BADGES ============================== */

function BadgesTab({ data }) {
  const t = todayISO();
  const trainingEvents = data.events.filter(e => ["football","strength"].includes(e.category) && e.date <= t);
  const matchCount = data.events.filter(e => e.category === "match" && e.date <= t).length;
  const habitDays = Object.keys(data.habitLog).filter(d => (data.habitLog[d] || []).length >= data.habits.length && data.habits.length > 0).length;
  const activeDays = new Set(trainingEvents.map(e => e.date)).size;
  const waterDays = Object.entries(data.water).filter(([d,v]) => d <= t && v >= (data.profile.waterTarget || 2200)).length;
  const badges = [
    ["first", "Pierwszy krok", "Ukończ pierwszy trening", trainingEvents.length >= 1, "⚽"],
    ["ten", "10 treningów", "Ukończ 10 treningów", trainingEvents.length >= 10, "🔥"],
    ["match", "Meczowy", "Zapisz 5 meczów", matchCount >= 5, "🏆"],
    ["habits", "Mistrz nawyków", "Kompletny dzień nawyków", habitDays >= 1, "✅"],
    ["water", "Hydratacja", "Osiągnij cel wody przez 7 dni", waterDays >= 7, "💧"],
    ["active", "Regularność", "Bądź aktywny przez 14 różnych dni", activeDays >= 14, "📈"],
  ];
  const unlocked = badges.filter(b => b[3]).length;
  return <div>
    <div className="card" style={{background:"linear-gradient(135deg,var(--card),var(--card2))"}}>
      <div className="cardTitle"><Award size={18}/> Twoje odznaki</div>
      <div style={{fontSize:28,fontWeight:900}}>{unlocked}/{badges.length}</div>
      <div className="muted">Odblokowane osiągnięcia</div>
    </div>
    <div className="grid2">
      {badges.map(([id,name,desc,ok,icon]) => <div key={id} className="card" style={{opacity:ok?1:.55,borderColor:ok?"var(--accent)":"var(--border)"}}>
        <div style={{fontSize:34}}>{ok?icon:"🔒"}</div><div style={{fontWeight:800,marginTop:6}}>{name}</div><div className="muted" style={{fontSize:11}}>{desc}</div><div className="pill" style={{marginTop:8,background:ok?"var(--accent)":"var(--card2)",color:ok?"#0B1210":"var(--text)"}}>{ok?"Odblokowana":"Do zdobycia"}</div>
      </div>)}
    </div>
  </div>;
}

/* ============================== PROFILE TAB ============================== */

const EQUIPMENT_OPTIONS = ["Piłka", "Pachołki", "Drabinka koordynacyjna", "Hantle", "Guma oporowa", "Mata", "Siłownia zewnętrzna", "Karnet na siłownię", "Brak sprzętu"];
const POSITIONS = ["Bramkarz", "Obrońca", "Pomocnik", "Napastnik"];
const LEVELS = ["Początkujący", "Amator", "Zaawansowany", "Akademia klubowa"];

function ProfileTab({ data, update, onImport }) {
  const p = data.profile;
  const setP = (k, v) => update((d) => { d.profile[k] = v; return d; });
  const toggleEquip = (eq) => update((d) => {
    const arr = d.profile.equipment || [];
    d.profile.equipment = arr.includes(eq) ? arr.filter((x) => x !== eq) : [...arr, eq];
    return d;
  });
  const [notifStatus, setNotifStatus] = useState(typeof Notification !== "undefined" ? Notification.permission : "unsupported");
  const importRef = useRef(null);

  const requestNotif = async () => {
    try {
      await subscribeToPush();
      setNotifStatus("granted");
      alert("Gotowe! Za chwilę powinno przyjść testowe powiadomienie. 🎉");
    } catch (error) {
      if (typeof Notification === "undefined") setNotifStatus("unsupported");
      else setNotifStatus(Notification.permission);
      alert(error?.message || "Nie udało się włączyć powiadomień.");
    }
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `moje-centrum-kopia-${todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const importData = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        onImport(parsed);
      } catch (e) {
        alert("Nie udało się wczytać pliku kopii zapasowej — sprawdź, czy to poprawny plik JSON z tej appki.");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div>
      <div className="card" style={{background:"linear-gradient(135deg,var(--card),var(--card2))",overflow:"hidden",position:"relative"}}>
        <div style={{position:"absolute",right:-25,top:-25,fontSize:110,opacity:.08}}>⚽</div>
        <div className="row" style={{alignItems:"center"}}>
          <div style={{width:62,height:62,borderRadius:18,background:"var(--accent)",display:"grid",placeItems:"center",fontSize:30,color:"#0B1210",fontWeight:900}}>{p.name ? p.name.slice(0,1).toUpperCase() : "⚽"}</div>
          <div style={{flex:1}}><div style={{fontSize:20,fontWeight:850}}>{p.name || "Twój profil"}</div><div className="muted">{p.position || "Pozycja nieustawiona"} • {p.level}</div></div>
        </div>
        <div className="row" style={{marginTop:12,flexWrap:"wrap"}}>
          <span className="pill">🎯 {p.goals || "Ustaw swój cel"}</span>
          <span className="pill">🏃 {data.events.filter(e=>e.date>=startOfWeek(todayISO()) && e.date<=addDays(startOfWeek(todayISO()),6) && ["football","strength"].includes(e.category)).length} treningów w tym tyg.</span>
        </div>
      </div>
      <div className="card">
        <div className="cardTitle"><User size={18} /> Twój profil</div>
        <div className="field"><label className="label">Imię / nick</label><input className="inp" value={p.name} onChange={(e) => setP("name", e.target.value)} /></div>
        <div className="grid2">
          <div className="field"><label className="label">Pozycja</label>
            <select className="inp" value={p.position} onChange={(e) => setP("position", e.target.value)}>
              <option value="">Wybierz</option>{POSITIONS.map((x) => <option key={x}>{x}</option>)}
            </select>
          </div>
          <div className="field"><label className="label">Poziom</label>
            <select className="inp" value={p.level} onChange={(e) => setP("level", e.target.value)}>
              {LEVELS.map((x) => <option key={x}>{x}</option>)}
            </select>
          </div>
        </div>
        <div className="field"><label className="label">Cele treningowe</label><textarea className="inp" rows={2} value={p.goals} onChange={(e) => setP("goals", e.target.value)} placeholder="np. poprawić szybkość i wytrzymałość" /></div>
        <div className="field"><label className="label">Godziny szkoły</label><input className="inp" value={p.schoolHours} onChange={(e) => setP("schoolHours", e.target.value)} placeholder="np. 8:00–14:30" /></div>
        <div className="field"><label className="label">Dzienny cel kalorii (opcjonalnie)</label><input type="number" className="inp" value={p.kcalTarget || ""} onChange={(e) => setP("kcalTarget", Number(e.target.value))} placeholder="np. 2600" /></div>
        <div className="field"><label className="label">Dzienny cel wody (ml)</label><input type="number" className="inp" value={p.waterTarget || ""} onChange={(e) => setP("waterTarget", Number(e.target.value))} placeholder="np. 2000" /></div>
      </div>

      <div className="card">
        <div className="cardTitle"><Shirt size={18} /> Dostępny sprzęt</div>
        <div className="row" style={{ flexWrap: "wrap" }}>
          {EQUIPMENT_OPTIONS.map((eq) => <span key={eq} className={"chip" + ((p.equipment || []).includes(eq) ? " active" : "")} onClick={() => toggleEquip(eq)}>{eq}</span>)}
        </div>
      </div>

      <div className="card">
        <div className="cardTitle"><Bot size={18} /> AI (asystent i rozpoznawanie zdjęć)</div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          Wewnątrz Claude wszystko działa od razu. W zainstalowanej wersji poza Claude potrzebujesz jednego z kluczy poniżej —
          <b> Google Gemini jest darmowy</b> (bez karty płatniczej, klucz z <b>ai.google.dev</b>), Anthropic jest płatny po
          wykorzystaniu darmowego kredytu startowego (klucz z <b>console.anthropic.com</b>). Klucze zostają tylko na tym telefonie.
        </div>
        <div className="field">
  <label className="label">Klucz Google Gemini (darmowy, zalecany)</label>
  <div className="muted" style={{ fontSize: 12 }}>
    AI jest skonfigurowane przez serwer FootballOS.
  </div>
</div>

<div className="field">
  <label className="label">Klucz Anthropic (opcjonalnie, płatny)</label>
  <input
    type="password"
    className="inp"
    value={p.apiKey || ""}
    onChange={(e) => setP("apiKey", e.target.value)}
    placeholder="sk-ant-…"
  />
</div>
 </div>
      <div className="card">
        <div className="cardTitle"><Bell size={18} /> Powiadomienia o przypomnieniach</div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          Powiadomienia push działają także wtedy, gdy FootballOS nie jest aktualnie otwarty. Na iPhonie najpierw dodaj
          FootballOS do ekranu początkowego, a potem kliknij „Włącz powiadomienia”. Po zgodzie wyślemy testowe powiadomienie.
        </div>
        <div className="row">
          <span className="pill" style={{ background: notifStatus === "granted" ? "var(--accent)" : "var(--border)", color: notifStatus === "granted" ? "#0B1210" : "var(--text)" }}>
            {notifStatus === "granted" ? "Włączone" : notifStatus === "denied" ? "Zablokowane" : notifStatus === "unsupported" ? "Niewspierane" : "Nieustawione"}
          </span>
          {notifStatus !== "granted" && notifStatus !== "unsupported" && <button className="btnGhost btnSmall" onClick={requestNotif}>Włącz powiadomienia</button>}
        </div>
      </div>

      <div className="card">
        <div className="cardTitle"><Save size={18} /> Kopia zapasowa danych</div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Dane siedzą tylko na tym telefonie. Rób regularnie kopię zapasową, żeby ich nie stracić przy czyszczeniu danych przeglądarki.</div>
        <div className="row">
          <button className="btnGhost" onClick={exportData}>⬇️ Eksportuj kopię</button>
          <button className="btnGhost" onClick={() => importRef.current?.click()}>⬆️ Importuj kopię</button>
          <input ref={importRef} type="file" accept="application/json" style={{ display: "none" }} onChange={(e) => e.target.files[0] && importData(e.target.files[0])} />
        </div>
      </div>
    </div>
  );
}



 const ask = async (question, mode = "chat") => {
  if (!question.trim() || loading) return;

  setMessages((m) => [
    ...m,
    {
      role: "user",
      content: question
    }
  ]);

  setInput("");
  setLoading(true);

  try {
    let text = "";

    if (mode === "today") {
      const today = todayISO();

      const events = data.events
        .filter((e) => e.date === today)
        .sort((a, b) =>
          (a.time || "").localeCompare(b.time || "")
        );

      if (events.length > 0) {
        text =
          "Plan na dziś:\n\n" +
          events
            .map(
              (e) =>
                "• " +
                (e.time || "--:--") +
                " — " +
                e.title +
                (e.duration
                  ? " (" + e.duration + " min)"
                  : "")
            )
            .join("\n");
      } else {
        text = "Na dziś nie masz zaplanowanych wydarzeń.";
      }
    }

    else if (mode === "workout") {
      if (data.drills && data.drills.length > 0) {
        const drills = data.drills.slice(0, 4);

        text =
          "⚽ Proponowany trening:\n\n" +
          "1. Rozgrzewka — 10 min\n" +
          drills
            .map(
              (d, i) =>
                (i + 2) +
                ". " +
                d.name +
                " — " +
                (d.duration || 10) +
                " min"
            )
            .join("\n") +
          "\n\nNa koniec 5–10 min spokojnego schłodzenia.";
      } else {
        text =
          "⚽ Nie masz jeszcze zapisanych ćwiczeń piłkarskich.";
      }
    }

    else if (mode === "week") {
      const today = todayISO();
      const start = startOfWeek(today);
      const end = addDays(start, 6);

      const completed = data.events.filter(
        (e) =>
          e.date >= start &&
          e.date <= end &&
          ["football", "strength", "match"].includes(e.category) &&
          e.completed
      );

      const minutes = completed.reduce(
        (sum, e) => sum + (e.duration || 0),
        0
      );

      text =
        "📊 Analiza tygodnia\n\n" +
        "✅ Wykonane treningi/mecze: " +
        completed.length +
        "\n" +
        "⏱️ Łączny czas: " +
        minutes +
        " min\n\n" +
        "🎯 Cel: regularność i rozsądne rozłożenie treningów.";
    }

    else if (mode === "match") {
      const today = todayISO();

      const nextMatch = data.events
        .filter(
          (e) =>
            e.category === "match" &&
            e.date >= today
        )
        .sort((a, b) =>
          (a.date + (a.time || "")).localeCompare(
            b.date + (b.time || "")
          )
        )[0];

      if (nextMatch) {
        text =
          "🏆 Najbliższy mecz:\n\n" +
          "📅 " +
          nextMatch.date +
          "\n" +
          "🕐 " +
          (nextMatch.time || "brak godziny") +
          "\n" +
          "⚽ " +
          nextMatch.title +
          "\n\n" +
          "Postaw na regenerację i spokojne przygotowanie.";
      } else {
        text = "🏆 Nie masz obecnie zaplanowanego meczu.";
      }
    }

    else {
      const q = question.toLowerCase();

      if (q.includes("dzisiaj") || q.includes("dziś")) {
        text =
          "📅 Sprawdź zakładkę „Dzisiaj”, aby zobaczyć swój plan.";
      } else if (
        q.includes("trening") ||
        q.includes("ćwiczeni")
      ) {
        text =
          "⚽ Użyj przycisku „Generator treningu”, aby zobaczyć trening z zapisanych ćwiczeń.";
      } else if (q.includes("mecz")) {
        text =
          "🏆 Sprawdź najbliższy mecz w kalendarzu i zadbaj o regenerację przed nim.";
      } else if (
        q.includes("dieta") ||
        q.includes("jeść") ||
        q.includes("jedzenie")
      ) {
        text =
          "🍽️ Sprawdź zakładkę „Dieta”, aby zobaczyć swoje zapisane posiłki.";
      } else {
        text =
          "🤖 Tryb AI jest obecnie wyłączony.\n\n" +
          "Mogę jednak korzystać z danych zapisanych w FootballOS.";
      }
    }

    setMessages((m) => [
      ...m,
      {
        role: "assistant",
        content: text
      }
    ]);

  } catch (e) {
    console.error(e);

    setMessages((m) => [
      ...m,
      {
        role: "assistant",
        content: "Nie udało się przygotować odpowiedzi."
      }
    ]);

  } finally {
    setLoading(false);
  }
};
