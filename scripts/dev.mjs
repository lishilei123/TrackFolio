import { spawn, spawnSync } from "node:child_process";

const npmCommand = process.env.npm_execpath
  ? { command: process.execPath, prefix: [process.env.npm_execpath] }
  : { command: process.platform === "win32" ? "npm.cmd" : "npm", prefix: [] };
const children = new Set();

function runSync(args) {
  const result = spawnSync(npmCommand.command, [...npmCommand.prefix, ...args], {
    stdio: "inherit",
    shell: false,
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function run(name, args) {
  const child = spawn(npmCommand.command, [...npmCommand.prefix, ...args], {
    stdio: "inherit",
    shell: false,
  });
  children.add(child);

  child.on("error", (error) => {
    children.delete(child);
    if (shuttingDown) return;
    console.error(`${name} failed to start: ${error.message}`);
    shutdown(1);
  });

  child.on("exit", (code, signal) => {
    children.delete(child);
    if (shuttingDown) return;
    console.error(`${name} exited${signal ? ` with signal ${signal}` : ` with code ${code ?? 0}`}`);
    shutdown(code ?? 1);
  });

  return child;
}

let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill();
  setTimeout(() => process.exit(code), 100);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

runSync(["run", "build", "--workspace", "@trackfolio/web"]);
run("web watch", ["run", "watch", "--workspace", "@trackfolio/web"]);
run("server", ["run", "dev", "--workspace", "@trackfolio/server"]);
