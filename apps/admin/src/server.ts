import http from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import next from "next";
import { getAdminConfig } from "./lib/adminConfig";
import { getSupervisor } from "./lib/supervisor";

async function main(): Promise<void> {
    const config = getAdminConfig();
    const nextApp = next({
        dev: process.env.NODE_ENV !== "production",
        dir: resolve(fileURLToPath(new URL("..", import.meta.url))),
    });
    await nextApp.prepare();
    const handler = nextApp.getRequestHandler();
    const httpServer = http.createServer((request, response) => handler(request, response));

    await new Promise<void>((resolvePromise, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(config.port, config.host, () => resolvePromise());
    });
    console.log(`CaiCaiClaw admin listening on http://${config.host}:${config.port}`);

    let shuttingDown = false;
    const shutdown = async (signal: string): Promise<void> => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`[admin] received ${signal}, stopping agent`);
        await getSupervisor().shutdown();
        await new Promise<void>((resolvePromise) => httpServer.close(() => resolvePromise()));
        await nextApp.close();
    };

    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
    console.error(`[admin] startup failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
});
