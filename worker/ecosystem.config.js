module.exports = {
  apps: [
    {
      name: "worker1",
      script: "./dist/app.js",
      env: {
        NODE_ENV: "docker",
      },
      args: "--mock --factor 0.5",
    },
    {
      name: "worker2",
      script: "./dist/app.js",
      env: {
        NODE_ENV: "docker",
      },
      args: "--mock",
    },
    {
      name: "cleaner",
      script: "./dist/aftercare/index.js",
    },
  ],
};
