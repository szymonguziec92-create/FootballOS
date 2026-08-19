// FootballOS – helpery do gotowych treningów
// Ten plik jest przygotowany do podłączenia do App.jsx.

export function generateFootballTraining(drills = [], duration = 30, goal = "Technika") {
  const safeDuration = Math.max(5, Number(duration) || 30);
  const wanted = String(goal || "").trim().toLowerCase();

  const matching = drills.filter((d) => {
    const category = String(d?.category || "").toLowerCase();
    const name = String(d?.name || "").toLowerCase();
    return !wanted || category.includes(wanted) || name.includes(wanted);
  });

  const pool = matching.length ? matching : drills;
  if (!pool.length) return [];

  // Stabilne losowanie bez mutowania data.drills.
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const result = [];
  let total = 0;

  for (const drill of shuffled) {
    if (total >= safeDuration) break;
    const remaining = safeDuration - total;
    const drillDuration = Math.max(1, Number(drill?.duration) || 5);
    const minutes = Math.min(drillDuration, remaining);

    result.push({
      ...drill,
      generatedDuration: minutes,
    });
    total += minutes;
  }

  return result;
}

export function makeFootballTrainingEvent({ title = "Gotowy trening piłkarski", date, time = "17:00", duration = 30, drills = [] }) {
  return {
    id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
    title,
    date,
    time,
    duration: Number(duration) || 30,
    description: "Gotowy trening piłkarski",
    category: "football",
    reminder: false,
    reminderMinutes: 30,
    drillIds: drills.map((d) => d.id).filter(Boolean),
    exerciseIds: [],
    trainingPlan: drills.map((d, index) => ({
      type: index === 0 ? "warmup" : "drill",
      order: index,
      drillId: d.id,
      name: d.name,
      duration: Number(d.generatedDuration || d.duration) || 5,
    })),
    completed: false,
  };
}

export function makeStrengthTrainingEvent({ title = "Gotowy trening siłowy", date, time = "17:00", duration = 45, exercises = [] }) {
  return {
    id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
    title,
    date,
    time,
    duration: Number(duration) || 45,
    description: "Gotowy trening siłowy",
    category: "strength",
    reminder: false,
    reminderMinutes: 30,
    drillIds: [],
    exerciseIds: exercises.map((e) => e.id).filter(Boolean),
    trainingPlan: exercises.map((e, index) => ({
      type: index === 0 ? "warmup" : "exercise",
      order: index,
      exerciseId: e.id,
      name: e.name,
      duration: Number(e.duration) || 5,
      sets: Number(e.sets) || 3,
      reps: Number(e.reps) || 10,
    })),
    completed: false,
  };
}

export function normalizeWaterAmount(amount) {
  const value = Number(amount);
  return Number.isFinite(value) && value > 0 ? value : 0;
}
