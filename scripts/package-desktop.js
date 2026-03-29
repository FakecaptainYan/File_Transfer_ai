const path = require("path");

function normalizePlatform(input) {
  const normalized = String(input || process.platform).toLowerCase();

  if (normalized === "darwin" || normalized === "mac" || normalized === "macos" || normalized === "osx") {
    return "mac";
  }

  if (normalized === "win" || normalized === "win32" || normalized === "windows") {
    return "win";
  }

  return normalized;
}

function getTarget(platformName, Platform) {
  if (platformName === "mac") {
    return Platform.MAC.createTarget(["dmg", "zip"]);
  }

  if (platformName === "win") {
    return Platform.WINDOWS.createTarget(["portable", "nsis"]);
  }

  throw new Error(`Unsupported build target: ${platformName}`);
}

function getElectronVersion(projectDir) {
  const packageJsonPath = path.join(projectDir, "package.json");
  const packageJson = require(packageJsonPath);
  return String(packageJson.devDependencies?.electron || "")
    .replace(/^[^\d]*/, "")
    .trim();
}

async function main() {
  let builder;
  try {
    builder = require("electron-builder");
  } catch (_error) {
    throw new Error("electron-builder is not installed. Run npm install before packaging the desktop app.");
  }

  const projectDir = path.resolve(__dirname, "..");
  const { Platform, build } = builder;
  const platformName = normalizePlatform(process.argv[2]);
  const electronDist = process.env.ELECTRON_OVERRIDE_DIST_PATH;
  const config = {
    directories: {
      output: "dist"
    }
  };

  if (electronDist) {
    config.electronDist = electronDist;
    config.electronVersion = getElectronVersion(projectDir);
  }

  await build({
    targets: getTarget(platformName, Platform),
    projectDir,
    config
  });
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
