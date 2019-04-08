/**
 * This file provides an pool and modifications for FTP
 */
import fs = require("fs-extra");
import ftp = require("basic-ftp");
import genericPool = require("generic-pool");
import path = require("path");
import paths = require("./paths");
import centralizedLog = require("./log");

const ftpConfig: ftp.AccessOptions = fs.readJSONSync("data/ftp.json");

/**
 * Same as the original `ftp.Client`, but modified to cope with problems with server.
 */
class MyClient extends ftp.Client {
	/**
	 * Recursively creates dir with 755 permission
	 */
	async ensureDirWithPerm(dir: string) {
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
	 */
	async lastMod(p: string): Promise<Date> {
		try {
			const remoteP = paths.toRemotePath(p);
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
	 */
	async checkExists(p: string): Promise<boolean> {
		try {
			const remoteP = paths.toRemotePath(p);
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

/** Whether to log `basic-ftp` debug info */
export let debug = false;

const ftpFactory: genericPool.Factory<MyClient> = {
	create: async function () {
		let client = new MyClient();
		if (debug) {
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

/** The FTP pool for public use */
export const pool = genericPool.createPool(ftpFactory, {
	min: 0,
	max: 100,
	testOnBorrow: true
});

// Indicate the start of FTP transfer
centralizedLog("FTP Pool initialized");

/**
 * Upload a file from config -> dest to the server
 */
export async function upload(p: string): Promise<void> {
	const remoteP = paths.toRemotePath(p);
	const client = await pool.acquire();
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
			centralizedLog("Created " + p + " (and missing directories) remotely");
		} else {
			await pool.release(client);
			throw e;
		}
	}
	await pool.release(client);
};