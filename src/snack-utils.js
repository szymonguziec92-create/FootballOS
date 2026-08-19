const DAILY_SNACKS = [
  {
    id: "banana-yogurt-oats",
    name: "Banan + jogurt + płatki",
    kcal: 320,
    protein: 14,
    carbs: 52,
    fat: 7,
    tags: ["snack", "preTraining"],
    note: "Dobry wybór na energię i trochę białka."
  },
  {
    id: "bread-cheese-banana",
    name: "Kanapka z serem + banan",
    kcal: 360,
    protein: 13,
    carbs: 48,
    fat: 13,
    tags: ["snack"],
    note: "Prosta przekąska z węglowodanami i tłuszczem."
  },
  {
    id: "oats-milk-honey",
    name: "Owsianka na mleku z miodem",
    kcal: 340,
    protein: 12,
    carbs: 55,
    fat: 8,
    tags: ["snack", "breakfast"],
    note: "Łatwa do zjedzenia przekąska z energią na dalszą część dnia."
  },
  {
    id: "yogurt-nuts-fruit",
    name: "Jogurt + orzechy + owoc",
    kcal: 330,
    protein: 12,
    carbs: 28,
    fat: 17,
    tags: ["snack"],
    note: "Połączenie białka, węglowodanów i tłuszczu."
  },
  {
    id: "toast-peanut-banana",
    name: "Tost z masłem orzechowym + banan",
    kcal: 390,
    protein: 12,
    carbs: 49,
    fat: 17,
    tags: ["snack", "preTraining"],
    note: "Bardziej energetyczna opcja przed aktywnością."
  },
  {
    id: "skyr-banana",
    name: "Skyr + banan",
    kcal: 240,
    protein: 19,
    carbs: 34,
    fat: 2,
    tags: ["snack", "postTraining"],
    note: "Lekka przekąska z większą ilością białka."
  },
  {
    id: "cereal-milk-fruit",
    name: "Płatki z mlekiem + owoc",
    kcal: 310,
    protein: 11,
    carbs: 53,
    fat: 7,
    tags: ["snack", "breakfast"],
    note: "Prosta opcja, gdy potrzebujesz szybko coś zjeść."
  }
];

function dayNumber(date = new Date()) {
  const start = new Date(2026, 0, 1);
  const now = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor((now - start) / 86400000);
}

export function getDailySnack(indexDate = new Date()) {
  const index = ((dayNumber(indexDate) % DAILY_SNACKS.length) + DAILY_SNACKS.length) % DAILY_SNACKS.length;
  return DAILY_SNACKS[index];
}

export function getDailySnackPool() {
  return DAILY_SNACKS;
}

export function getDietSummary(diary = [], kcalTarget = 0) {
  const totals = diary.reduce((acc, item) => {
    acc.kcal += Number(item?.kcal || 0);
    acc.protein += Number(item?.protein || 0);
    acc.carbs += Number(item?.carbs || 0);
    acc.fat += Number(item?.fat || 0);
    return acc;
  }, { kcal: 0, protein: 0, carbs: 0, fat: 0 });

  return {
    ...totals,
    kcalTarget: Number(kcalTarget) || 0,
    kcalRemaining: Math.max(0, (Number(kcalTarget) || 0) - totals.kcal),
  };
}
