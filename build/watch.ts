/**
 * This file provides a function to watch all files in src directory without any exception.
 * 
 * This file handles the `data\local_mtimes.json` to enable a faster startup speed.
 * All files except those in `data\.sync` will be recorded
 */
import fs = require("fs-extra");
import paths = require("./paths");
import chokidar = require("chokidar");
import centralizedLog = require("./log");
import sync = require("./sync");
import ftp = require("./ftp");
import build = require("./build");

/**
 * Location of `data\local_mtimes.json`
 */
const mtimesLoc = "data/local_mtimes.json";

/**
 * The temporarily variable to access `data\local_mtimes.json`
 **/
const mtimes: { [s: string]: number; } = fs.readJSONSync(mtimesLoc);


/**
 * The variable to access the status of the file being built
 **/
const building: { [s: string]: Promise<void>; } = {};

/**
 * Call a method on a ftp instance.
 */
const ftpSend = async function (name: string, ...args: any[]) {
	const client: any = await ftp.pool.acquire();
	try {
		await client[name](...args);
	} catch (e) {
		// always clean up when fails
		await ftp.pool.release(client);
		throw e;
	}
	await ftp.pool.release(client);
};

const eventFuncTable: { [s: string]: string[]; } = {
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
const onChange = function (event: string, p: string) {
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
					centralizedLog("\x1b[91mError\x1b[0m at " + p + "\n" + e);
				});
			}
			break;
		case "unlink":
		case "addDir":
		case "unlinkDir":
			{
				const strs = eventFuncTable[event];
				const nfs: (typeof fs & {[s: string]: any}) = fs;
				const start = async () => {
					await Promise.all([
						ftpSend(strs[0], paths.toRemotePath(build.pathToDest(p))),
						nfs[strs[1]](paths.toDest(build.pathToDest(p)))
					]);
					if (event !== "addDir") {
						// Only do it noisily when a file is deleted
						centralizedLog(strs[2] + p);
					}
				};
				if (event === "unlink") {
					let prevProm = building[p] ? building[p] : Promise.resolve();
					building[p] = prevProm.then(async () => {
						await start();
						delete mtimes[p];
						await fs.writeJSON(mtimesLoc, mtimes);
					}).catch(e => {
						centralizedLog("\x1b[91mError\x1b[0m at removing " + p + "\n" + e);
					});
				} else {
					await start();
				}
			}
			break;
		default:
			centralizedLog("Unhandled event - " + event + " for " + p);
		}
	})().catch(
		// Catch all errors along the way
		reason => {
			centralizedLog("\x1b[91mError\x1b[0m at \x1b[35m" + event + "\x1b[0m " + p + "\n" + reason);
		}
	);
};

/**
 * Start watching for file changes
 */
export = function (onReady: () => any) {
	centralizedLog(">>> Building the source code");
	const options: chokidar.WatchOptions = {
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