const bun = process.execPath;
const workers = [
  Bun.spawn([bun, "run", "--env-file=.env.local", "src/server/socket-server.ts"], { stdout: "inherit", stderr: "inherit" }),
  Bun.spawn([bun, "run", "--bun", "next", process.argv.includes("--production") ? "start" : "dev", ...(!process.argv.includes("--production") ? ["--webpack"] : []), "--hostname", "127.0.0.1"], { stdout: "inherit", stderr: "inherit" }),
];
function stop() { for (const worker of workers) worker.kill(); }
process.on("SIGINT", stop); process.on("SIGTERM", stop);
const exit = await Promise.race(workers.map(worker => worker.exited));
stop(); process.exit(exit);
export {};
