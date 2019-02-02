/**
 * This file provides an pool and modifications for FTP
 */
const fs = require("fs-extra");
const ftp = require("basic-ftp");
const genericPool = require("generic-pool");
const path = require("path");
const paths = require("./paths");
const centralizedLog = require("./log");

const ftpConfig = fs.readJSONSync("data/ftp.json");

// The export object
const ftpModule = {};

/**
 * Same as the original `ftp.Client`, but modified to cope with problems with server.
 */
class MyClient extends ftp.Client {
	/**
	 * Recursively creates dir with 755 permission
	 * 
	 * @param {string} dir
	 */
	async ensureDirWithPerm(dir) {
		if (dir.startsWith("/"))
			await this.cd("/");
		const names = dir.split("/").filter(name => name !== "");
		for (const name of names) {
			await this.send("MKD " + name, true);
			await this.send("SITE CHMOD 755 " + name);
			await this.cd(name);
		}
	}

	/**
	 * Get adjusted last modified time
	 * 
	 * @param {string} p path based on src directory
	 * @returns {Promise<Date>}
	 */
	async lastMod(p) {
		try {
			const remoteP = ftpModule.toRemotePath(p);
			const mtime = await super.lastMod(remoteP);
			// Due to the misconfiguation of the server, the time needs to be adjusted
			return new Date(mtime.valueOf() - 8 * 60 * 60 * 1000);
		} catch (e) {
			if (e.code === 550) {
				return new Date(0);
			} else {
				throw e;
			}
		}
	}

	/**
	 * Check the existent of a remote file.
	 * This function must not be collinear with transfer of the file
	 * 
	 * @param {string} p path based on src directory
	 * @returns {Promise<boolean>}
	 */
	async checkExists(p) {
		try {
			const remoteP = ftpModule.toRemotePath(p);
			await this.cd(path.posix.dirname(remoteP));
			const fileList = await this.list();
			for (const fileInfo of fileList) {
				if (fileInfo.name === path.posix.basename(remoteP)) return true;
			}
			return false;
		} catch (e) {
			// We are unable to proceeds further
			if (e.code === 550) {
				// In case the directory does not exist
				return false;
			} else {
				// If it is another error, pass it upwards
				throw e;
			}
		}
	}
}

/**
 * @type {genericPool.Factory<MyClient>}
 */
const ftpFactory = {
	create: async function () {
		let client = new MyClient();
		if (exports.debug) {
			client.ftp.log = centralizedLog;
		}
		try {
			await client.access(ftpConfig);
		} catch (e) {
			await client.close();
			// if it fails to connect, let's just retry it!
			client = await ftpFactory.create();
		}
		return client;
	},

	destroy: client => Promise.resolve(client.close()),

	validate: client => client.send("NOOP").then(() => true, () => false)
};

const ftpPool = genericPool.createPool(ftpFactory, {
	min: 0,
	max: 100,
	testOnBorrow: true
});

// Indicate the start of FTP transfer
centralizedLog("FTP Pool initialized");

/** Whether to log `basic-ftp` debug info */
ftpModule.debug = false;

/** The FTP pool for public use */
ftpModule.pool = ftpPool;

/**
 * Converts a path to remote path
 * 
 * @param {string} p path based on src directory
 * @returns {string} remote path
 */
ftpModule.toRemotePath = function (p) {
	return path.posix.join("/", p.split(path.sep).join(path.posix.sep));
};

/**
 * Upload a file from config -> dest to the server
 * 
 * @param {string} p path based on src directory
 * @returns {Promise<void>}
 */
ftpModule.upload = async function (p) {
	const remoteP = ftpModule.toRemotePath(p);
	const client = await ftpPool.acquire();
	const rStream = fs.createReadStream(paths.toDest(p));
	try {
		const exist = await client.checkExists(p);
		await client.upload(rStream, remoteP);
		if (exist) {
			centralizedLog("Updated remote file " + p);
		} else {
			await client.send("SITE CHMOD 644 " + p);
			centralizedLog("Created " + p + " remotely");
		}
	} catch (e) {
		if (e.code === 550) {
			// Error ENOENT
			// Create missing directories recursively
			await client.ensureDirWithPerm(path.posix.dirname(remoteP));
			await client.upload(rStream, remoteP);
			await client.send("SITE CHMOD 644 " + remoteP);
			centralizedLog("Created " + p + " and missing directories remotely");
		} else {
			await ftpPool.release(client);
			throw e;
		}
	}
	await ftpPool.release(client);
};

module.exports = ftpModule;