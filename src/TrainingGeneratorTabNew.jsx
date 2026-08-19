import React, { useState } from "react";
import { generateFootballTraining, makeFootballTrainingEvent } from "./training-utils.js";

export default function TrainingGeneratorTabNew({ data, update }) {
  const [duration, setDuration] = useState(30);
  const [goal, setGoal] = useState("Technika");
  const [generated, setGenerated] = useState([]);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState("17:00");
  const [title, setTitle] = useState("Gotowy trening piłkarski");
  const [added, setAdded] = useState(false);

  const drills = data?.drills || [];

  const generate = () => {
    const result = generateFootballTraining(drills, duration, goal);
    setGenerated(result);
    setAdded(false);
  };

  const addToCalendar = () => {
    if (!generated.length || !update) return;

    const totalDuration = generated.reduce(
      (sum, drill) => sum + (Number(drill.generatedDuration) || 0),
      0
    );

    const event = makeFootballTrainingEvent({
      title: title.trim() || "Gotowy trening piłkarski",
      date,
      time,
      duration: totalDuration || duration,
      drills: generated,
    });

    update((d) => {
      d.events = Array.isArray(d.events) ? d.events : [];
      d.events.push(event);
      return d;
    });

    setAdded(true);
  };

  return (
    <div>
      <div className="card">
        <div className="cardTitle">⚡ Generator treningu</div>
        <div className="muted">
          Wybierz czas i cel, a aplikacja ułoży trening z Twoich ćwiczeń.
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
                style={{ cursor: "pointer" }}
              >
                {x} min
              </span>
            ))}
          </div>
        </div>

        <div className="field">
          <label className="label">Cel</label>
          <select className="inp" value={goal} onChange={(e) => setGoal(e.target.value)}>
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
            <div key={d.id || i} className="eventItem">
              <div style={{ flex: 1 }}>
                <strong>{i + 1}. {d.name}</strong>
                <div className="muted">{d.category || "Piłka"}</div>
              </div>
              <strong>{d.generatedDuration} min</strong>
            </div>
          ))}

          <div className="field" style={{ marginTop: 12 }}>
            <label className="label">Nazwa treningu</label>
            <input
              className="inp"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="grid2">
            <div className="field">
              <label className="label">Data</label>
              <input
                type="date"
                className="inp"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="field">
              <label className="label">Godzina</label>
              <input
                type="time"
                className="inp"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
          </div>

          <button className="btn" onClick={addToCalendar}>
            📅 Dodaj trening do kalendarza
          </button>

          {added && (
            <div className="muted" style={{ marginTop: 8 }}>
              ✓ Trening został dodany do kalendarza.
            </div>
          )}
        </div>
      )}

      {!drills.length && (
        <div className="card">
          <div className="muted">
            Nie masz jeszcze ćwiczeń piłkarskich w bibliotece. Dodaj kilka ćwiczeń w zakładce Trening, a generator będzie mógł z nich układać gotowe treningi.
          </div>
        </div>
      )}
    </div>
  );
}
