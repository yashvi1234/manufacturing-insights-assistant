import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { pool } from "./db.js";

const server = new McpServer({
    name: "manufacturing-server",
    version: "1.0.0",
})

function toolResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function toolError(message: string) {
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }], isError: true };
}

async function assertLineExists(lineId: number) {
  const check = await pool.query(`SELECT name FROM production_lines WHERE line_id = $1`, [lineId]);
  if (check.rows.length === 0) {
    throw new Error(`No production line found with line_id ${lineId}`);
  }
  return check.rows[0].name;
}

server.registerTool(
  "get_production_summary",
  {
    description: "Returns total units, defects, and efficiency for a date range",
    inputSchema: {
      start_date: z.string().describe("Start date, YYYY-MM-DD"),
      end_date: z.string().describe("End date, YYYY-MM-DD"),
    },
  },
  async ({ start_date, end_date }) => {
    try {
      if (new Date(start_date) > new Date(end_date)) {
         return toolError("start_date must be before end_date");
      }
      const result = await pool.query(
        `SELECT SUM(units_produced) AS total_units,
                SUM(defect_count) AS total_defects,
                ROUND(SUM(defect_count)::numeric / NULLIF(SUM(units_produced), 0) * 100, 2) AS defect_rate_pct
         FROM daily_metrics
         WHERE date BETWEEN $1 AND $2`,
        [start_date, end_date]
      );

      if (result.rows.length === 0) {
        return toolResult({ message: `No production summary for given ${start_date} and ${end_date}` });
      }

      return toolResult(result.rows[0]);
    } catch (err) {
      return toolError(`Failed to get production summary: ${(err as Error).message}`);
    }
  }
);

// 2. get_line_performance
server.registerTool(
  "get_line_performance",
  {
    description: "Returns metrics for a specific production line over a period",
    inputSchema: {
      line_id: z.number().int().describe("The production line ID"),
      period: z.enum(["week", "month", "quarter"]).describe("Time period to aggregate"),
    },
  },
  async ({ line_id, period }) => {
    try {
      const interval = period === "week" ? "7 days" : period === "month" ? "30 days" : "90 days";
      const lineCheck = await assertLineExists(line_id);
      const result = await pool.query(
        `SELECT SUM(units_produced) AS total_units,
                SUM(defect_count) AS total_defects,
                SUM(downtime_minutes) AS total_downtime
         FROM daily_metrics
         WHERE line_id = $1 AND date >= CURRENT_DATE - $2::interval`,
        [line_id, interval]
      );

      if (result.rows.length === 0) {
        return toolResult({ message: `No line data found for given ${period}` });
      }

      return toolResult({ line_name: lineCheck, period, ...result.rows[0] });
    } catch (err) {
      return toolError(`Failed to get line performance: ${(err as Error).message}`);
    }
  }
);

// 3. get_defect_trends
server.registerTool(
  "get_defect_trends",
  {
    description: "Returns defect breakdown by category over the last N days for a line",
    inputSchema: {
      line_id: z.number().int(),
      days: z.number().int().positive().describe("Number of past days to look at"),
    },
  },
  async ({ line_id, days }) => {
    try {
      await assertLineExists(line_id);
      const result = await pool.query(
        `SELECT defect_category, SUM(count) AS total
         FROM defect_types
         WHERE line_id = $1 AND detected_at >= CURRENT_DATE - ($2 || ' days')::interval
         GROUP BY defect_category
         ORDER BY total DESC`,
        [line_id, days]
      );
      if (result.rows.length === 0) {
        return toolResult({ message: `No defects found for line_id ${line_id} in the last ${days} days` });
      }
      return toolResult(result.rows);
    } catch (err) {
      return toolError(`Failed to get defect trends: ${(err as Error).message}`);
    }
  }
);

// 4. compare_lines
server.registerTool(
  "compare_lines",
  {
    description: "Compares multiple production lines on a given metric",
    inputSchema: {
      line_ids: z.array(z.number().int()).min(2).describe("Array of line IDs to compare"),
      metric: z.enum(["defect_rate", "efficiency", "downtime"]).describe("Metric to compare on"),
    },
  },
  async ({ line_ids, metric }) => {
    try {
      line_ids.forEach(async (line_id) => {
        await assertLineExists(line_id);
      })
      let result;
      if (metric === "efficiency") {
        result = await pool.query(
          `SELECT pl.name, ROUND(AVG(ss.efficiency_percentage), 2) AS value
           FROM shift_summary ss JOIN production_lines pl ON pl.line_id = ss.line_id
           WHERE ss.line_id = ANY($1) GROUP BY pl.name ORDER BY value DESC`,
          [line_ids]
        );
      } else if (metric === "downtime") {
        result = await pool.query(
          `SELECT pl.name, SUM(dm.downtime_minutes) AS value
           FROM daily_metrics dm JOIN production_lines pl ON pl.line_id = dm.line_id
           WHERE dm.line_id = ANY($1) GROUP BY pl.name ORDER BY value DESC`,
          [line_ids]
        );
      } else {
        result = await pool.query(
          `SELECT pl.name,
                  ROUND(SUM(dm.defect_count)::numeric / NULLIF(SUM(dm.units_produced), 0) * 100, 2) AS value
           FROM daily_metrics dm JOIN production_lines pl ON pl.line_id = dm.line_id
           WHERE dm.line_id = ANY($1) GROUP BY pl.name ORDER BY value DESC`,
          [line_ids]
        );
      }
      return toolResult({ metric, comparison: result.rows });
    } catch (err) {
      return toolError(`Failed to compare lines: ${(err as Error).message}`);
    }
  }
);

// 5. get_worst_performing_shifts
server.registerTool(
  "get_worst_performing_shifts",
  {
    description: "Returns the N worst shifts ranked by efficiency",
    inputSchema: {
      limit: z.number().int().positive().max(100).describe("Number of worst shifts to return"),
    },
  },
  async ({ limit }) => {
    try {
      const result = await pool.query(
        `SELECT pl.name, ss.shift_date, ss.shift_type, ss.efficiency_percentage
         FROM shift_summary ss JOIN production_lines pl ON pl.line_id = ss.line_id
         ORDER BY ss.efficiency_percentage ASC, ss.shift_date ASC, pl.name ASC
         LIMIT $1`,
        [limit]
      );
      return toolResult(result.rows);
    } catch (err) {
      return toolError(`Failed to get worst shifts: ${(err as Error).message}`);
    }
  }
);

server.registerTool(
  "run_custom_analytics",
  {
    description: "Answers a free-text manufacturing question by matching keywords to the right analytics query",
    inputSchema: {
      question: z.string().min(3).describe("A natural language question about production, defects, or efficiency"),
    },
  },
  async ({ question }) => {
    const q = question.toLowerCase();
    try {
      // Keyword routing — check more specific patterns before generic ones
      if (q.includes("defect") && (q.includes("categor") || q.includes("type"))) {
        const result = await pool.query(
          `SELECT defect_category, SUM(count) AS total FROM defect_types GROUP BY defect_category ORDER BY total DESC`
        );
        return toolResult({ interpreted_as: "top defect categories overall", data: result.rows });
      }

      if (q.includes("worst") && q.includes("shift")) {
        const result = await pool.query(
          `SELECT pl.name, ss.shift_date, ss.shift_type, ss.efficiency_percentage
           FROM shift_summary ss JOIN production_lines pl ON pl.line_id = ss.line_id
           ORDER BY ss.efficiency_percentage ASC, ss.shift_date ASC, pl.name ASC LIMIT 5`
        );
        return toolResult({ interpreted_as: "5 worst performing shifts", data: result.rows });
      }

      if (q.includes("defect") && q.includes("line")) {
        const result = await pool.query(
          `SELECT pl.name, SUM(dm.defect_count) AS total_defects
           FROM daily_metrics dm JOIN production_lines pl ON pl.line_id = dm.line_id
           GROUP BY pl.name ORDER BY total_defects DESC`
        );
        return toolResult({ interpreted_as: "total defects by line", data: result.rows });
      }

      if (q.includes("efficiency") || q.includes("trend")) {
        const result = await pool.query(
          `SELECT pl.name, DATE_TRUNC('month', ss.shift_date) AS month,
                  ROUND(AVG(ss.efficiency_percentage), 2) AS avg_efficiency
           FROM shift_summary ss JOIN production_lines pl ON pl.line_id = ss.line_id
           GROUP BY pl.name, month ORDER BY pl.name, month`
        );
        return toolResult({ interpreted_as: "monthly efficiency trend per line", data: result.rows });
      }

      if (q.includes("downtime")) {
        const result = await pool.query(
          `SELECT pl.name, SUM(dm.downtime_minutes) AS total_downtime
           FROM daily_metrics dm JOIN production_lines pl ON pl.line_id = dm.line_id
           GROUP BY pl.name ORDER BY total_downtime DESC`
        );
        return toolResult({ interpreted_as: "total downtime by line", data: result.rows });
      }

      return toolResult({
        message: "I couldn't match that question to a known analytics pattern. Try asking about defects, efficiency, downtime, or worst shifts.",
      });
    } catch (err) {
      return toolError(`run_custom_analytics failed: ${(err as Error).message}`);
    }
  }
);

async function main(){
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Time MCP server is running on stdio")
}

main().catch((err) => {
    console.error("Fatal error: ", err);
    process.exit(1);
})