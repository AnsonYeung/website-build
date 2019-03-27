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
 * The variable to access the status of the file being built
 * @type {Object<string, Promise<void> >}
 **/
const building = {};

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
		"\x1b[31mRemoved file\x1b[0m "
	],
	"unlinkDir": [
		"removeDir",
		"remove",
		"\x1b[31mRemoved directory\x1b[0m "
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
				if (event === "add") {
					centralizedLog("\x1b[32mAdd event:\x1b[0m " + p);
				} else {
					centralizedLog("\x1b[32mChange event:\x1b[0m " + p);
				}
				const prevProm = building[p] ? building[p] : Promise.resolve();
				building[p] = prevProm.then(async () => {
					const mtime = (await fs.stat(paths.toSrc(p))).mtimeMs;
					if (!mtimes[p] || mtimes[p] < mtime) {
						if (await sync.containsPath(p)) {
							await sync.push(p);
							centralizedLog("\x1b[35mPushed database\x1b[0m " + p);
						} else {
							await build.auto(p);
							centralizedLog("Built " + p);
							await ftp.upload(build.pathToDest(p));
						}
						mtimes[p] = mtime;
						await fs.writeJSON(mtimesLoc, mtimes);
					}
				}).catch(e => {
					throw e;
				});
			}
			break;
		case "unlink":
		case "addDir":
		case "unlinkDir":
			{
				const strs = eventFuncTable[event];
				const start = () => {
					return Promise.all([
						ftpSend(strs[0], paths.toRemotePath(p)),
						fs[strs[1]](paths.toDest(p))
					]);
				};
				if (event === "unlink") {
					let prevProm = building[p] ? building[p] : Promise.resolve();
					const addToQueue = function () {
						prevProm.then(async () => {
							if (prevProm === building[p]) {
								await start();
								delete mtimes[p];
								delete building[p];
								await fs.writeJSON(mtimesLoc, mtimes);
							} else {
								prevProm = building[p];
								addToQueue();
							}
						});
					};
					addToQueue();
				} else {
					await start();
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
			throw reason;
		}
	);
};

/**
 * Start watching for file changes
 * @param {()=>any} onReady
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
		.on("ready", function () {
			const cb = onReady();
			if (cb instanceof Promise) {
				cb.catch(e => {
					throw e;
				});
			}
		});
};

module.exports = watch;