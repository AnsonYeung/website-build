/**
 * Logs the msg into the console and prints the time.
 * This should be used as a drop-in replacement of console.log
 * 
 * @param {string} msg the message to log
 */
module.exports = function (msg) {
	// eslint-disable-next-line no-console
	console.log("[" + new Date().toLocaleTimeString() + "] " + msg);
};
