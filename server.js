const { startServer } = require("./app-server");

const port = Number(process.env.PORT || 3000);

startServer({ port })
  .then(({ url }) => {
    console.log(`Media Converter Lab is running at ${url}`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
