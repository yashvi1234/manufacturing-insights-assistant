import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/manufacturing",
});

const LINES = [
  { name: "Line A", location: "Plant 1 - Bay 1", capacity: 500 },
  { name: "Line B", location: "Plant 1 - Bay 2", capacity: 450 },
  { name: "Line C", location: "Plant 2 - Bay 1", capacity: 600 },
  { name: "Line D", location: "Plant 2 - Bay 2", capacity: 400 },
  { name: "Line E", location: "Plant 3 - Bay 1", capacity: 550 },
];

const DEFECT_CATEGORIES = ["surface_scratch", "dimensional_error", "material_flaw", "assembly_misalign", "electrical_fault"];
const SHIFT_TYPES = ["morning", "afternoon", "night"] as const;

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min: number, max: number, decimals = 2) {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
}

async function seed() {
  console.log("Seeding production_lines...");
  const lineIds: number[] = [];
  for (const line of LINES) {
    const res = await pool.query(
      `INSERT INTO production_lines (name, location, capacity_per_hour) VALUES ($1, $2, $3) RETURNING line_id`,
      [line.name, line.location, line.capacity]
    );
    lineIds.push(res.rows[0].line_id);
  }

  const today = new Date();
  const startDate = new Date();
  startDate.setMonth(today.getMonth() - 6);

  console.log("Seeding daily_metrics, defect_types, shift_summary...");

  for (const lineId of lineIds) {
    const line = LINES[lineIds.indexOf(lineId)];
    // give each line a "quality tier" so data isn't uniformly random — some lines are just worse
    const baseDefectRate = randFloat(0.01, 0.06);
    const baseDowntimeRisk = randFloat(0.5, 3);

    const d = new Date(startDate);
    while (d <= today) {
      const dateStr = d.toISOString().slice(0, 10);
      const dailyCapacity = line.capacity * 8; // 8hr day
      const unitsProduced = Math.round(dailyCapacity * randFloat(0.75, 1.0));
      const defectCount = Math.round(unitsProduced * baseDefectRate * randFloat(0.5, 1.5));
      const downtimeMinutes = Math.round(randFloat(0, 60) * baseDowntimeRisk);

      await pool.query(
        `INSERT INTO daily_metrics (date, line_id, units_produced, defect_count, downtime_minutes)
         VALUES ($1, $2, $3, $4, $5)`,
        [dateStr, lineId, unitsProduced, defectCount, downtimeMinutes]
      );

      // occasional defect_types entries tied to this day
      if (defectCount > 0 && Math.random() < 0.7) {
        const category = DEFECT_CATEGORIES[randInt(0, DEFECT_CATEGORIES.length - 1)];
        await pool.query(
          `INSERT INTO defect_types (line_id, defect_category, count, detected_at) VALUES ($1, $2, $3, $4)`,
          [lineId, category, randInt(1, defectCount), new Date(d)]
        );
      }

      // 3 shifts per day
      for (const shiftType of SHIFT_TYPES) {
        await pool.query(
          `INSERT INTO shift_summary (line_id, shift_date, shift_type, efficiency_percentage) VALUES ($1, $2, $3, $4)`,
          [lineId, dateStr, shiftType, randFloat(60, 98)]
        );
      }

      d.setDate(d.getDate() + 1);
    }
  }

  console.log("Seed complete.");
  await pool.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});