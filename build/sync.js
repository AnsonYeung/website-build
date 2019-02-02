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
const fs = require("fs-extra");
const path = require("path");
const paths = require("./paths");
const minimatch = require("minimatch");
const pify = require("pify");
const glob = pify(require("glob"));
const ftp = require("./ftp");
const matchOptions = require("./matchOptions");
const centralizedLog = require("./log");

// The export object of this file
const sync = {};

/**
 * An array of Minimatch objects
 * 
 * @type {import("minimatch").IMinimatch[]}
 */
const minimatchs = [];

/**
 * An object holding the remote modification times of files.
 * 
 * @type {Object<string, number>}
 */
const mtimes = {};

/**
 * Initialize the `matches` Minimatch array synchronously.
 * Let node.js collect the memory after use.
 * @type {Promise<void>}
 */
const load = (function () {
	const readLine = require("readline");
	const syncFileP = "data/.sync";
	const reader = readLine.createInterface({
		input: fs.createReadStream(syncFileP)
	});
	let globCount = 0, globCb = null;
	reader.on("line", function (globPattern) {
		globCount++;
		minimatchs.push(new minimatch.Minimatch(globPattern, matchOptions));
		glob(globPattern, matchOptions).then(paths => {
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
	return new Promise(resolve => {
		reader.on("close", () => {
			if (globCount === 0) {
				resolve();
			} else {
				globCb = resolve;
			}
		});
	});
})();

/**
 * @param {string} p path based on src directory
 * @returns {Promise<boolean>}
 */
sync.containsPath = async function (p) {
	await load;
	for (const minimatchObj of minimatchs) {
		if (minimatchObj.match(p)) return true;
	}
	return false;
};

/**
 * Performs validation and push the file to the server.
 * 
 * @param {string} p path based on src directory
 */
sync.push = async function (p) {
	if (sync.push.pushing[p]) return;
	sync.push.pushing[p] = true;
	await load;
	const remoteP = ftp.toRemotePath(p);
	if (!sync.containsPath(p)) {
		throw new Error("It's not a sync file! (" + p + ")");
	}
	const client = await ftp.pool.acquire();
	await client.upload(fs.createReadStream(paths.toSrc(p)), remoteP);
	await client.send("SITE CHMOD 666 " + remoteP);
	mtimes[p] = +await client.lastMod(p);
	await ftp.pool.release(client);
	sync.push.pushing[p] = false;
};

/**
 * Indicate whether a push is running
 * 
 * @type {Object<string, boolean>}
 **/
sync.push.pushing = {};

/**
 * Pull one updated database into src directory using atomic write
 * 
 * @param {string} p path based on src directory
 */
sync.pullOne = async function (p) {
	const remoteP = ftp.toRemotePath(p);
	const client = await ftp.pool.acquire();
	try {
		if ((await client.lastMod(remoteP)).valueOf() > mtimes[p]) {
			const tmpFile = path.join(".sync", p);
			await fs.ensureDir(path.dirname(tmpFile));
			await client.download(fs.createWriteStream(tmpFile), remoteP);
			fs.move(tmpFile, paths.toSrc(p), {overwrite: true});
			mtimes[p] = +await client.lastMod(remoteP);
			centralizedLog("Pulled database " + p);
		}
	} catch (e) {
		await ftp.pool.release(client);
		throw e;
	}
	await ftp.pool.release(client);
};

/**
 * Pull all updated database into src directory
 */
sync.pull = function () {
	// Check pulling
	if (sync.pull.running) return;
	// Check pushing
	for (const s in sync.push.pushing) {
		if (sync.push.pushing[s])
			return;
	}
	sync.pull.running = true;
	if (sync.pull.firstTime) {
		centralizedLog("Begin first pulling");
	}
	/** @type {Promise<void>[]} */
	const pullList = [];
	for (const p in mtimes) {
		pullList.push(sync.pullOne(p));
	}
	return Promise.all(pullList).then(() => {
		sync.pull.running = false;
		if (sync.pull.firstTime) {
			centralizedLog("End first pulling");
			sync.pull.firstTime = false;
		}
	});
};

/** Indicate whether a pull is running already */
sync.pull.running = false;

/** Indicate whether it is a first run */
sync.pull.firstTime = true;

/**
 * Set an interval to run sync.pull
 * 
 * @param {number} interval
 */
sync.setInterval = async function (interval) {
	await load;
	if (sync.setInterval.handle) {
		throw new Error("There is already an interval running");
	}
	sync.setInterval.handle = setInterval(sync.pull, interval);
};

/** @type {NodeJS.Timeout} */
sync.setInterval.handle = null;

/**
 * Clears an interval previously set
 */
sync.clearInterval = function () {
	if (!sync.setInterval.handle) {
		throw new Error("There is currently no interval");
	}
	clearInterval(sync.setInterval.handle);
	sync.setInterval.handle = null;
};

module.exports = sync;