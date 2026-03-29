const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

function getElectronExecutableFromOverride(overridePath) {
  const candidates = process.platform === "win32"
    ? [path.join(overridePath, "electron.exe")]
    : process.platform === "darwin"
      ? [
          path.join(overridePath, "Electron.app", "Contents", "MacOS", "Electron"),
          path.join(overridePath, "electron")
        ]
      : [path.join(overridePath, "electron")];

  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function getElectronExecutable() {
  const override = process.env.ELECTRON_OVERRIDE_DIST_PATH;
  if (override) {
    return getElectronExecutableFromOverride(override);
  }

  try {
    return require("electron");
  } catch (_error) {
    throw new Error("Electron is not installed. Run npm install before starting the desktop app.");
  }
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
