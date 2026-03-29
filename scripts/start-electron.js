const path = require("path");
const { spawn } = require("child_process");

function getElectronExecutable() {
  const override = process.env.ELECTRON_OVERRIDE_DIST_PATH;
  if (!override) {
    throw new Error("ELECTRON_OVERRIDE_DIST_PATH is not set.");
  }

  return process.platform === "win32"
    ? path.join(override, "electron.exe")
    : path.join(override, "electron");
}

function main() {
  const electronExecutable = getElectronExecutable();
  const appRoot = path.resolve(__dirname, "..");
  const extraArgs = process.argv.slice(2);
  const spawnArgs = extraArgs.length > 0 && extraArgs.every((arg) => arg.startsWith("-"))
    ? extraArgs
    : [appRoot, ...extraArgs];
  const child = spawn(electronExecutable, spawnArgs, {
    stdio: "inherit",
    windowsHide: false
  });

  child.on("error", (error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });

  child.on("exit", (code) => {
    process.exitCode = code ?? 0;
  });
}

main();
