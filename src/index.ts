import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({
    name: "time-server",
    version: "1.0.0",
})

server.registerTool(
    "get_current_time",
    {
        description: "Returns the current time stamp",
        inputSchema: {}
    },
    async () => ({
        content: [
            { type: "text", text: new Date().toISOString() }
        ]
    })
)

async function main(){
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Time MCP server is running on stdio")
}

main().catch((err) => {
    console.error("Fatal error: ", err);
    process.exit(1);
})