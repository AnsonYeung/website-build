/**
 * This file provides a function to watch all files in src directory without any exception.
 * 
 * This file handles the `data\local_mtimes.json` to enable a faster startup speed.
 * All files except those in `data\.sync` will be recorded
 */
const fs = require("fs-extra");
const paths = require("./paths");
const chokidar = require("chokidar");
const centralizedLog = require("./log");
const sync = require("./sync");
const ftp = require("./ftp");
const build = require("./build");

/**
 * Location of `data\local_mtimes.json`
 */
const mtimesLoc = "data/local_mtimes.json";

/**
 * The temporarily variable to access `data\local_mtimes.json`
 * @type {Object<string, number>}
 **/
const mtimes = fs.readJSONSync(mtimesLoc);

/**
 * Call a method on a ftp instance.
 * 
 * @param {string} name the method to call
 * @param {...any} args
 */
const ftpSend = async function (name, ...args) {
	const client = await ftp.pool.acquire();
	try {
		await client[name](...args);
	} catch (e) {
		// always clean up when fails
		await ftp.pool.release(client);
		throw e;
	}
	await ftp.pool.release(client);
};

/**
 * @type {Object<string, string[]>}
 */
const eventFuncTable = {
	"addDir": [
		"ensureDir",
		"ensureDir",
		"Created directory "
	],
	"unlink": [
		"remove",
		"remove",
		"Removed file "
	],
	"unlinkDir": [
		"removeDir",
		"remove",
		"Removed directory "
	]
};

/**
 * Fired when a file is changed in src directory
 */
const onChange = function (event, p) {
	(async () => {
		switch (event) {
		case "add":
		case "change":
			{
				const mtime = (await fs.stat(paths.toSrc(p))).mtimeMs;
				if (!mtimes[p] || mtimes[p] < mtime) {
					if (await sync.containsPath(p)) {
						await sync.push(p);
						centralizedLog("Pushed database " + p);
					} else {
						if (event === "add") {
							centralizedLog("Added " + p);
						} else {
							centralizedLog("Changed " + p);
						}
						await build.auto(p);
						centralizedLog("Built " + p);
						await ftp.upload(build.pathToDest(p));
					}
					mtimes[p] = mtime;
					await fs.writeJSON(mtimesLoc, mtimes);
				}
			}
			break;
		case "addDir":
		case "unlink":
		case "unlinkDir":
			{
				const strs = eventFuncTable[event];
				await Promise.all([
					ftpSend(strs[0], paths.toRemotePath(p)),
					fs[strs[1]](paths.toDest(p))
				]);
				if (event === "unlink") {
					delete mtimes[p];
					await fs.writeJSON(mtimesLoc, mtimes);
				}
				if (event !== "addDir") {
					// Only do it noisily when a file is deleted
					centralizedLog(strs[2] + p);
				}
			}
			break;
		default:
			centralizedLog("Unhandled event - " + event + " for " + p);
		}
	})().catch(
		// Catch all errors along the way
		reason => {
			centralizedLog("Error at " + p);
			// eslint-disable-next-line no-console
			console.dir(reason);
		}
	);
};

/**
 * Start watching for file changes
 * @param {()=>void} onReady
 */
const watch = function (onReady) {
	centralizedLog(">>> Building the source code");
	/** @type {import("chokidar").WatchOptions}*/
	const options = {
		cwd: paths.src,
		ignored: [".git/**"]
	};
	chokidar.watch("./", options)
		.on("all", onChange)
		.on("ready", onReady);
};

module.exports = watch;