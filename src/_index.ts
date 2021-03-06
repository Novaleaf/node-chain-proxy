//specify xlib config options, without requiring environmental config
(global as any)._xlibConfigDefaults = {
	...{
		logLevel: "WARN",
		envLevel: "PROD",
		isTest: "FALSE",
		isDev: "FALSE",
		sourceMapSupport: true,
		startupMessageSuppress: true,
	} as typeof _xlibConfigDefaults,
	...(global as any)._xlibConfigDefaults,
};

import xlib = require("xlib");
import proxy = require("./proxy");
export = proxy;





