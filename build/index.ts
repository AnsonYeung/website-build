// Patching the global fs module
import gracefulFs = require("graceful-fs");
import fs = require("fs");
gracefulFs.gracefulify(fs);

import watch = require("./watch");
import sync = require("./sync");

// Start watching and syncing
watch(sync.setInterval.bind(sync, 1000));