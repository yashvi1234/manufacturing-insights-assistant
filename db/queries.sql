-- 1. Total defects by line
SELECT pl.name, SUM(dm.defect_count) AS total_defects
FROM daily_metrics dm
JOIN production_lines pl ON pl.line_id = dm.line_id
GROUP BY pl.name
ORDER BY total_defects DESC;

-- 2. Efficiency trend over time (monthly average per line)
SELECT pl.name, DATE_TRUNC('month', ss.shift_date) AS month,
       ROUND(AVG(ss.efficiency_percentage), 2) AS avg_efficiency
FROM shift_summary ss
JOIN production_lines pl ON pl.line_id = ss.line_id
GROUP BY pl.name, month
ORDER BY pl.name, month;

-- 3. Worst performing shift (single worst instance)
SELECT pl.name, ss.shift_date, ss.shift_type, ss.efficiency_percentage
FROM shift_summary ss
JOIN production_lines pl ON pl.line_id = ss.line_id
ORDER BY ss.efficiency_percentage ASC
LIMIT 1;

-- 4. Top defect categories overall
SELECT defect_category, SUM(count) AS total
FROM defect_types
GROUP BY defect_category
ORDER BY total DESC;

-- 5. Line performance summary (units, defects, downtime, defect rate)
SELECT pl.name,
       SUM(dm.units_produced) AS total_units,
       SUM(dm.defect_count) AS total_defects,
       ROUND(SUM(dm.defect_count)::numeric / NULLIF(SUM(dm.units_produced), 0) * 100, 2) AS defect_rate_pct,
       SUM(dm.downtime_minutes) AS total_downtime_minutes
FROM daily_metrics dm
JOIN production_lines pl ON pl.line_id = dm.line_id
GROUP BY pl.name
ORDER BY defect_rate_pct DESC;

-- 6. Worst performing shifts, ranked (top N)
SELECT pl.name, ss.shift_date, ss.shift_type, ss.efficiency_percentage
FROM shift_summary ss
JOIN production_lines pl ON pl.line_id = ss.line_id
ORDER BY ss.efficiency_percentage ASC
LIMIT 10;