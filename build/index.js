// Patching the global fs module
const gracefulFs = require("graceful-fs");
const fs = require("fs");
gracefulFs.gracefulify(fs);

const watch = require("./watch");
const sync = require("./sync");

// Start watching and syncing
watch(sync.setInterval.bind(sync, 1000));