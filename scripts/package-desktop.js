const path = require("path");

async function main() {
  const electronDist = process.env.ELECTRON_OVERRIDE_DIST_PATH;
  if (!electronDist) {
    throw new Error("ELECTRON_OVERRIDE_DIST_PATH is not set.");
  }

  const projectDir = path.resolve(__dirname, "..");
  const builderDir = path.join(projectDir, "build-tools", "node_modules", "electron-builder");

  let builder;
  try {
    builder = require(builderDir);
  } catch (error) {
    throw new Error("electron-builder is not installed in build-tools. Run npm install inside build-tools first.");
  }

  const { Platform, build } = builder;

  await build({
    targets: Platform.WINDOWS.createTarget(["portable", "nsis"]),
    projectDir,
    config: {
      electronDist,
      electronVersion: "41.1.0",
      directories: {
        output: "dist"
      }
    }
  });
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
