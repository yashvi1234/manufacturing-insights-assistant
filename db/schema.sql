CREATE TABLE production_lines (
    line_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    location VARCHAR(100) NOT NULL,
    capacity_per_hour INTEGER NOT NULL
);

CREATE TABLE daily_metrics (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    line_id INTEGER NOT NULL REFERENCES production_lines(line_id),
    units_produced INTEGER NOT NULL,
    defect_count INTEGER NOT NULL,
    downtime_minutes INTEGER NOT NULL,
    UNIQUE (date, line_id)
);

CREATE TABLE defect_types (
    defect_id SERIAL PRIMARY KEY,
    line_id INTEGER NOT NULL REFERENCES production_lines(line_id),
    defect_category VARCHAR(100) NOT NULL,
    count INTEGER NOT NULL,
    detected_at TIMESTAMP NOT NULL
);

CREATE TABLE shift_summary (
    shift_id SERIAL PRIMARY KEY,
    line_id INTEGER NOT NULL REFERENCES production_lines(line_id),
    shift_date DATE NOT NULL,
    shift_type VARCHAR(20) NOT NULL CHECK (shift_type IN ('morning', 'afternoon', 'night')),
    efficiency_percentage NUMERIC(5,2) NOT NULL
);

CREATE INDEX idx_daily_metrics_line_date ON daily_metrics(line_id, date);
CREATE INDEX idx_defect_types_line ON defect_types(line_id);
CREATE INDEX idx_shift_summary_line_date ON shift_summary(line_id, shift_date);