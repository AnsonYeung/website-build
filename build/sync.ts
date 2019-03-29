/**
 * This file is responsible for synchronizing the remote modifiable.
 * 
 * It maintains the `data/.sync` file.
 * This file never touches the config -> dest directory,
 * instead it directly changes the src directory.
 * 
 * Therefore, files present in `data/.sync` must be present in 
 * the `.gitignore` file.
 */
import fs = require("fs-extra");
import path = require("path");
import paths = require("./paths");
import minimatch = require("minimatch");
import ftp = require("./ftp");
import matchOptions = require("./matchOptions");
import centralizedLog = require("./log");
import pify = require("pify");
const glob = pify(require("glob"));

/**
 * An array of Minimatch objects
 */
const minimatchs: minimatch.IMinimatch[] = [];

/**
 * An object holding the remote modification times of sync files.
 */
const mtimes: { [s: string]: number; } = {};

/**
 * Initialize the `matches` Minimatch array synchronously.
 * Let node.js collect the memory after use.
 */
const load: Promise<void> = (function () {
	const readLine = require("readline");
	const syncFileP = "data/.sync";
	const reader = readLine.createInterface({
		input: fs.createReadStream(syncFileP)
	});
	let globCount = 0, globCb: (() => void) = null;
	reader.on("line", function (globPattern: string) {
		globCount++;
		minimatchs.push(new minimatch.Minimatch(globPattern, matchOptions));
		glob(globPattern, matchOptions).then((paths: string[]) => {
			globCount--;
			paths.forEach(p => {
				mtimes[p.split(path.posix.sep).join(path.sep)] = 0;
			});
			if (globCb && globCount === 0) {
				globCb();
				globCb = null;
			}
		});
	});
	return new Promise<void>(resolve => {
		reader.on("close", () => {
			if (globCount === 0) {
				resolve();
			} else {
				globCb = resolve;
			}
		});
	});
})();

export async function containsPath(p: string): Promise<boolean> {
	await load;
	for (const minimatchObj of minimatchs) {
		if (minimatchObj.match(p)) return true;
	}
	return false;
};

/**
 * Indicate the push running on each file
 **/
const pushing: { [s: string]: Promise<void>; } = {};

/**
 * Performs validation and push the sync file to the server.
 */
export function push(p: string) {
	const lastPush = pushing[p] ? pushing[p] : Promise.resolve();
	const pushProm = lastPush.then(async () => {
		const remoteP = paths.toRemotePath(p);
		if (!containsPath(p)) {
			throw new Error("It's not a sync file! (" + p + ")");
		}
		const client = await ftp.pool.acquire();
		await client.upload(fs.createReadStream(paths.toSrc(p)), remoteP);
		await client.send("SITE CHMOD 666 " + remoteP);
		mtimes[p] = +await client.lastMod(p);
		await ftp.pool.release(client);
		// After this function returns, another pushing might be fired.
		// Therefore, checking is required to confirm that this is the last element in the queue.
		if (pushProm === pushing[p]) {
			pushing[p] = null;
		}
	});
	pushing[p] = pushProm;
	return pushProm;
};

/**
 * Pull one updated database wihtout any checking into src directory using atomic write
 */
export async function pullOne(p: string) {
	const remoteP = paths.toRemotePath(p);
	const client = await ftp.pool.acquire();
	const newmtime = +await client.lastMod(remoteP);
	if (newmtime > mtimes[p]) {
		const tmpFile = path.join(".sync", p);
		await fs.ensureDir(path.dirname(tmpFile));
		await client.download(fs.createWriteStream(tmpFile), remoteP);
		fs.move(tmpFile, paths.toSrc(p), {overwrite: true});
		mtimes[p] = newmtime;
		centralizedLog("\x1b[35mPulled database\x1b[0m " + p);
	}
	await ftp.pool.release(client);
};

/** Indicate whether a pull is running already */
let pullRunning = false;

/** Indicate whether it is a first run */
let pullFirstTime = true;

/**
 * Pull all updated database into src directory
 */
export async function pull() {
	// Check pulling
	if (pullRunning) return Promise.resolve();
	// Check pushing
	for (const s in pushing) {
		if (pushing[s]) return Promise.resolve();
	}
	pullRunning = true;
	if (pullFirstTime) centralizedLog("\x1b[47m\x1b[30mBegin first pulling\x1b[0m");
	/** @type {Promise<void>[]} */
	const pullList: Promise<void>[] = [];
	for (const p in mtimes) {
		pullList.push(pullOne(p));
	}
	await Promise.all(pullList);
	await fs.remove(".sync");
	pullRunning = false;
	if (pullFirstTime) {
		centralizedLog("\x1b[47m\x1b[30mEnd first pulling\x1b[0m");
		pullFirstTime = false;
	}
};

let intHandle: NodeJS.Timeout = null;

/**
 * Set an interval to run pull
 */
export async function setInterval(interval: number) {
	await load;
	if (intHandle) {
		throw new Error("There is already an interval running");
	}
	intHandle = global.setInterval(function () {
		pull().catch(e => {
			throw e;
		});
	}, interval);
};

/**
 * Clears an interval previously set
 */
export function clearInterval() {
	if (!intHandle) {
		throw new Error("There is currently no interval");
	}
	global.clearInterval(intHandle);
	intHandle = null;
};