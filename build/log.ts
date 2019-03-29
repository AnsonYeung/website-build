/**
 * Logs the msg into the console and prints the time.
 * This should be used as a drop-in replacement of console.log
 */
export = function (msg: string) {
	// eslint-disable-next-line no-console
	console.log("[" + new Date().toLocaleTimeString() + "] " + msg);
};
