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
 * An object holding the remote modification times of sync files.
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
 * Performs validation and push the sync file to the server.
 * 
 * @param {string} p path based on src directory
 */
sync.push = function (p) {
	const lastPush = sync.push.pushing[p] ? sync.push.pushing[p] : Promise.resolve();
	const pushProm = lastPush.then(async () => {
		const remoteP = paths.toRemotePath(p);
		if (!sync.containsPath(p)) {
			throw new Error("It's not a sync file! (" + p + ")");
		}
		const client = await ftp.pool.acquire();
		await client.upload(fs.createReadStream(paths.toSrc(p)), remoteP);
		await client.send("SITE CHMOD 666 " + remoteP);
		mtimes[p] = +await client.lastMod(p);
		await ftp.pool.release(client);
		// After this function returns, another pushing might be fired.
		// Therefore, checking is required to confirm that this is the last element in the queue.
		if (pushProm === sync.push.pushing[p]) {
			sync.push.pushing[p] = null;
		}
	});
	sync.push.pushing[p] = pushProm;
	return pushProm;
};

/**
 * Indicate the push running on each file
 * 
 * @type {Object<string, Promise<void> >}
 **/
sync.push.pushing = {};

/**
 * Pull one updated database wihtout any checking into src directory using atomic write
 * 
 * @param {string} p path based on src directory
 */
sync.pullOne = async function (p) {
	const remoteP = paths.toRemotePath(p);
	const client = await ftp.pool.acquire();
	const newmtime = +await client.lastMod(remoteP);
	if (newmtime > mtimes[p]) {
		const tmpFile = path.join(".sync", p);
		await fs.ensureDir(path.dirname(tmpFile));
		await client.download(fs.createWriteStream(tmpFile), remoteP);
		fs.move(tmpFile, paths.toSrc(p), {overwrite: true});
		mtimes[p] = newmtime;
		centralizedLog("Pulled database " + p);
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
	if (sync.pull.firstTime) centralizedLog("Begin first pulling");
	/** @type {Promise<void>[]} */
	const pullList = [];
	for (const p in mtimes) {
		pullList.push(sync.pullOne(p));
	}
	return Promise.all(pullList).then(fs.remove(".sync")).then(() => {
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