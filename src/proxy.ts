import xlib = require("xlib");
//import slib = require("slib");
//import fsPromise = slib.file.fsPromise;

import _ = xlib.lodash;
import __ = xlib.lolo;
import Promise = xlib.promise.bluebird;
let log = new xlib.logging.Logger(__filename);


import async = require('async');
import net = require('net');
import http = require('http');
import https = require('https');
import util = require('util');
import fs = require('fs');
import path = require('path');
import events = require('events');
import WebSocket = require('ws');
import urlModule = require('url');
import os = require('os');
import semaphore = require('semaphore');

import ca = require('./ca');

export module middleware {
	export const gunzip = require('./middleware/gunzip');
	export const wildcard = require('./middleware/wildcard');
}
export interface ICertificatePaths {
	keyFile: string;
	certFile: string;
	hosts: string[];
}
export interface ICertificateData {
	keyFileData: string;
	certFileData: string;
	hosts: string[];
}
export interface ICertificateMissingHint {
	hostname: string;
	files: ICertificatePaths;
	data: { keyFileExists: boolean; certFileExists: boolean; };
}



/**
 * pipes a set of args through subscribed callbacks in a FIFO order.
invoker gets the final args transformed by all callbacks.
 */
export class EventBroadcastPipe<TSender, TArgs>{


	public _storage: ((sender: TSender, args: TArgs) => Promise<TArgs>)[] = [];
	public subscribe(callback: ((sender: TSender, args: TArgs) => Promise<TArgs>)) {
		this._storage.push(callback);
	}
	public unsubscribe(callback: ((sender: TSender, args: TArgs) => Promise<TArgs>)): boolean {
		return xlib.arrayHelper.removeFirst(this._storage, callback);
	}

	/**
	 *  dispatch will be completed once all the subscribed callbacks  (executed in a sequential, FIFO order) have finished transforming the args.
	if any subscribed functions fail, the failure is returned immediately.
	 * @param sender
	 * @param args
	 */
	public invoke(sender: TSender, initialArgs: TArgs): Promise<TArgs> {
		const _looper = (index: number, currentArgs: TArgs): Promise<TArgs> => {
			return this._storage[index](sender, currentArgs)
				.then((resultingArgs) => {
					if (index === this._storage.length - 1) {
						return Promise.resolve(resultingArgs);
					} else {
						return _looper(index + 1, resultingArgs);
					}
				});
		}

		if (this._storage.length === 0) {
			return Promise.resolve(initialArgs);
		}
		return _looper(0, initialArgs);
	}
}


/**
 *  like EventBroadcast but sends to the first subscribed callback (FIFO) and waits for it's Promise to resolve.
	if resolved success that value is returned to the invoker.
	otherwise (in the case of a failure) the next callback is tried.
 */
export class EventBroadcastLimited<TSender, TArgs, TResult>{




	public _storage: ((sender: TSender, args: TArgs) => Promise<TResult>)[] = [];
	public subscribe(callback: ((sender: TSender, args: TArgs) => Promise<TResult>)) {
		this._storage.push(callback);
	}
	public unsubscribe(callback: ((sender: TSender, args: TArgs) => Promise<TResult>)): boolean {
		return xlib.arrayHelper.removeFirst(this._storage, callback);
	}

	/**
	 *  dispatch will be completed once the first successfull subscribed function resolves (executed in a sequential, FIFO order)
	if all subscribed functions fail, the last failure is returned.
	if no subscribers are present, a resolved Promise with an undefined result is returned.
	 * @param sender
	 * @param args
	 */
	public invoke(sender: TSender, args: TArgs): Promise<TResult> {
		const _looper = (index: number): Promise<TResult> => {
			return this._storage[index](sender, args)
				.catch((err) => {
					if (index === this._storage.length - 1) {
						return Promise.reject(err);
					}
					return _looper(index + 1);
				});
		}
		if (this._storage.length === 0) {
			return Promise.resolve(undefined);
		}
		return _looper(0);
	}
}


/**
 *  round-trip event subscription system. (invoker sends message to subscribers, subscribers sends results to invoker)
 * 
 */
export class EventBroadcast<TSender, TArgs, TResult>  {

	public _storage: ((sender: TSender, args: TArgs) => Promise<TResult>)[] = [];
	public subscribe(callback: ((sender: TSender, args: TArgs) => Promise<TResult>)) {
		this._storage.push(callback);
	}
	public unsubscribe(callback: ((sender: TSender, args: TArgs) => Promise<TResult>)): boolean {
		return xlib.arrayHelper.removeFirst(this._storage, callback);
	}

	/**
	 *  dispatch will not be completed until all subscriber functions resolve.
	if no subscribers are present, a resolved Promise with an empty array result is returned.
	 * @param sender
	 * @param args
	 */
	public invoke(sender: TSender, args: TArgs): Promise<TResult[]> {
		let results: Promise<TResult>[] = [];

		this._storage.forEach((callback) => {
			let result = callback(sender, args);
			results.push(result);
		});

		let toReturn = Promise.all(results);
		return toReturn;
	}
}
/**
 *  a one-directional event subscription system.  (subscribers don't impact invoker in any way)
 */
export class ActionBroadcast<TSender, TArgs>  {

	public _storage: ((sender: TSender, args: TArgs) => void)[] = [];
	public subscribe(callback: ((sender: TSender, args: TArgs) => void)) {
		this._storage.push(callback);
	}
	public unsubscribe(callback: ((sender: TSender, args: TArgs) => void)): boolean {
		return xlib.arrayHelper.removeFirst(this._storage, callback);
	}
	/**
	 * invokes all subscribed actions, in a LIFO fashion (last attached gets executed first)
	 * @param sender
	 * @param args
	 */
	public invoke(sender: TSender, args: TArgs): void {
		_.forEachRight(this._storage, (callback) => {
			callback(sender, args);
		});
	}
}



export class ProxyCallbacks {

	/** do not throw errors (or reject promises) from subscriber callbacks here, or it will disrupt internal proxy handling logic (see ```proxy.ctor.defaultCallbacks``` for details) */
	public onError = new ActionBroadcast<Proxy | ProxyFinalRequestFilter | ProxyFinalResponseFilter, { ctx?: IContext; err: Error; errorKind: string, data?: any }>();

	/** triggered when the context is created, before any other context specific events are triggered. 
check ctx.url.protocol to decide what events to bind.  http, https, or ws */
	public onContextInitialize = new EventBroadcast<Proxy, { ctx: IContext; }, void>();

	public onWebSocketConnection = new EventBroadcast<Proxy, { ctx: IContext }, void>();
	public onWebSocketFrame = new EventBroadcastPipe<WebSocket, { ctx: IContext;/** known types: "message" */ type: "message" | "ping" | "pong";/** true is from upstreamToProxy, false means from clientToProxy */ fromServer: boolean; data: any; flags: { binary: boolean }; }>();

	public onWebSocketSend = new EventBroadcastPipe<WebSocket, { ctx: IContext;/** known types: "message" */ type: any;/**  */ fromServer: boolean; data: any; flags: any; }>();
	public onWebSocketMessage = new EventBroadcastPipe<WebSocket, { ctx: IContext;/** known types: "message" */ type: any;/**  */ fromServer: boolean; data: any; flags: any; }>();

	/** do not throw errors (or reject promises) from subscriber callbacks here, or it will disrupt internal proxy handling logic (see ```proxy.ctor.defaultCallbacks``` for details) */
	public onWebSocketClose = new EventBroadcastPipe<WebSocket, { ctx: IContext; /** if false, closed by client.*/closedByServer: boolean, code: number; message: string; }>();
	public onWebSocketError = new ActionBroadcast<Proxy | WebSocket, { ctx: IContext; err: Error, errorKind: string; }>();
	public onRequest = new EventBroadcast<Proxy, { ctx: IContext }, void>();
	public onRequestHeaders = new EventBroadcast<Proxy, { ctx: IContext }, void>();
	public onRequestData = new EventBroadcastPipe<Proxy, { ctx: IContext, chunk: Buffer }>();
	public onRequestEnd = new EventBroadcast<Proxy, { ctx: IContext }, void>();

	/** callback triggered by the ctx.proxyToServerRequest request when it's complete.   response is stored as ctx.serverToProxyResponse. */
	public onResponse = new EventBroadcast<Proxy, { ctx: IContext }, void>();
	public onResponseHeaders = new EventBroadcast<Proxy, { ctx: IContext }, void>();
	public onResponseData = new EventBroadcastPipe<Proxy, { ctx: IContext, chunk: Buffer }>();
	public onResponseEnd = new EventBroadcast<Proxy, { ctx: IContext }, void>();

	/** allows retrying the request to upstream if desired (via the returned promise results), if so, the callbacks from ```onRequest``` onward will be retried.  */
	public onProxyToUpstreamRequestError = new EventBroadcastLimited<http.ClientRequest, { ctx: IContext; err: Error; }, { retry?: boolean; }>();


	//proxy specific callbacks
	public onConnect = new EventBroadcast<Proxy, { req: http.IncomingMessage; socket: net.Socket; head: Buffer; isSsl: boolean; otherArg: any; }, void>();


	public onCertificateRequired = new EventBroadcastLimited<Proxy, { hostname: string }, ICertificatePaths>();
	public onCertificateMissing = new EventBroadcastLimited<Proxy, { info: ICertificateMissingHint, files: ICertificatePaths},ICertificateData>()

}

/** configuration options you pass to the .listen() method*/
export interface IProxyListenOptions {
	/**port - The port or named socket to listen on (default: 8080).*/
	port?: number;
	/**host - The hostname or local address to listen on.*/
	host?: string;
	/** - Path to the certificates cache directory (default: process.cwd() + '/.http-mitm-proxy')*/
	sslCaDir?: string;
	/**  - if set to true, nothing will be written to console (default: false) */
	silent?: boolean;
	/**  - enable HTTP persistent connection*/
	keepAlive?: boolean;
	/**  - The number of milliseconds of inactivity before a socket is presumed to have timed out. Defaults to no timeout. */
	timeout?: number;
	/**  - The http.Agent to use when making http requests. Useful for chaining proxys. (default: internal Agent) */
	httpAgent?: http.Agent;
	/** - The https.Agent to use when making https requests. Useful for chaining proxys. (default: internal Agent) */
	httpsAgent?: https.Agent;
	/** - force use of SNI by the client. Allow node-http-mitm-proxy to handle all HTTPS requests with a single internal server. */
	forceSNI?: boolean;
	/**  - The port or named socket for https server to listen on. (forceSNI must be enabled) */
	httpsPort?: number;
	/** if a new CA cert needs to be generated (not existing in given ```sslCaDir```) what name should it use.
	if not specified, the name "Chain Proxy" is used. */
	sslCaName?: string;
}

export abstract class ProxyBase {

	///////////  move from Proxy


	////////////////  end


	//	public onErrorHandlers: ((context: IContext, err?: Error, errorKind?: string) => void)[] = [];
	//	public onError(/**Adds a function to the list of functions to get called if an error occures.

	//Arguments

	//fn(ctx, err, errorKind) - The function to be called on an error.*/fn: (context: IContext, err?: Error, errorKind?: string) => void) {
	//		this.onErrorHandlers.push(fn);
	//		return this;
	//	};

	//public onWebSocketConnectionHandlers: ((ctx: IContext, callback: (error: Error | undefined) => void) => void)[] = [];
	///** shared storage for .onWebSocketSend() and .onWebSocketMessage() and .onWebSocketFrame() */
	//public onWebSocketFrameHandlers: ((ctx: IContext, type: any, fromServer: boolean, message: any, flags: any, callback: (err: Error | undefined, message: any, flags: any) => void) => void)[] = [];

	//public onWebSocketCloseHandlers: ((ctx: IContext, code: any, message: any, callback: (err: Error | undefined, code: any, message: any) => void) => void)[] = [];
	//public onWebSocketErrorHandlers: ((ctx: IContext, err: Error | undefined) => void)[] = [];

	//public onRequestHandlers: ((ctx: IContext, callback: (error: Error | undefined) => void) => void)[] = [];
	//public onRequestHeadersHandlers: ((ctx: IContext, callback: (error: Error | undefined) => void) => void)[] = [];

	//public onRequestDataHandlers: ((ctx: IContext, chunk: Buffer, callback: (error?: Error, chunk?: Buffer) => void) => void)[] = [];
	//public onRequestEndHandlers: ((ctx: IContext, callback: (error: Error | undefined) => void) => void)[] = [];
	//public onResponseHandlers: ((ctx: IContext, callback: (error: Error | undefined) => void) => void)[] = [];
	//public onResponseHeadersHandlers: ((ctx: IContext, callback: (error: Error | undefined) => void) => void)[] = [];
	//public onResponseDataHandlers: ((ctx: IContext, chunk: Buffer, callback: (error?: Error, chunk?: Buffer) => void) => void)[] = [];
	//public onResponseEndHandlers: ((ctx: IContext, callback: (error: Error | undefined) => void) => void)[] = [];





	//public onWebSocketConnection(fn: (ctx: IContext, callback: (error: Error | undefined) => void) => void) {
	//	this.onWebSocketConnectionHandlers.push(fn);
	//	return this;
	//};

	//public onWebSocketSend(fn: (ctx: IContext, message: any, flags: any, callback: (err: Error | undefined, message: any, flags: any) => void) => void) {
	//	this.onWebSocketFrameHandlers.push(function (ctx, type, fromServer, data, flags, callback) {
	//		if (!fromServer && type === 'message') return this(ctx, data, flags, callback);
	//		else callback(null, data, flags);
	//	}.bind(fn));
	//	return this;
	//};

	//public onWebSocketMessage(fn: (ctx: IContext, message: any, flags: any, callback: (err: Error | undefined, message: any, flags: any) => void) => void) {
	//	this.onWebSocketFrameHandlers.push(function (ctx, type, fromServer, data, flags, callback) {
	//		if (fromServer && type === 'message') return this(ctx, data, flags, callback);
	//		else callback(null, data, flags);
	//	}.bind(fn));
	//	return this;
	//};

	//public onWebSocketFrame(fn: (ctx: IContext, type: any, fromServer: boolean, message: any, flags: any, callback: (err: Error | undefined, message: any, flags: any) => void) => void) {
	//	this.onWebSocketFrameHandlers.push(fn);
	//	return this;
	//};

	//public onWebSocketClose(fn: (ctx: IContext, code: any, message: any, callback: (err: Error | undefined, code: any, message: any) => void) => void) {
	//	this.onWebSocketCloseHandlers.push(fn);
	//	return this;
	//};

	//public onWebSocketError(fn: (ctx: IContext, err: Error | undefined) => void) {
	//	this.onWebSocketErrorHandlers.push(fn);
	//	return this;
	//};

	///** Adds a function to get called at the beginning of a request.

	//	   Arguments

	//	   fn(ctx, callback) - The function that gets called on each request.
	//	   Example

	//	   proxy.onRequest(function(ctx, callback) {
	//		 console.log('REQUEST:', ctx.clientToProxyRequest.url);
	//		 return callback();
	//	   }); */
	//public onRequest(fn: (ctx: IContext, callback: (error: Error | undefined) => void) => void) {
	//	this.onRequestHandlers.push(fn);
	//	return this;
	//};

	//public onRequestHeaders(fn: (ctx: IContext, callback: (error: Error | undefined) => void) => void) {
	//	this.onRequestHeadersHandlers.push(fn);
	//	return this;
	//};

	//public onRequestData(fn: (ctx: IContext, chunk: Buffer, callback: (error?: Error, chunk?: Buffer) => void) => void) {
	//	this.onRequestDataHandlers.push(fn);
	//	return this;
	//};

	//public onRequestEnd(fn: (ctx: IContext, callback: (error: Error | undefined) => void) => void) {
	//	this.onRequestEndHandlers.push(fn);
	//	return this;
	//};

	///** Adds a function to get called at the beginning of the response.

	//Arguments

	//fn(ctx, callback) - The function that gets called on each response.
	//Example

	//proxy.onResponse(function(ctx, callback) {
	//  console.log('BEGIN RESPONSE');
	//  return callback();
	//}); */
	//public onResponse(fn: (ctx: IContext, callback: (error: Error | undefined) => void) => void) {
	//	this.onResponseHandlers.push(fn);
	//	return this;
	//};

	//public onResponseHeaders(fn: (ctx: IContext, callback: (error: Error | undefined) => void) => void) {
	//	this.onResponseHeadersHandlers.push(fn);
	//	return this;
	//};

	//public onResponseData(fn: (ctx: IContext, chunk: Buffer, callback: (error?: Error, chunk?: Buffer) => void) => void) {
	//	this.onResponseDataHandlers.push(fn);
	//	return this;
	//};

	//public onResponseEnd(fn: (ctx: IContext, callback: (error: Error | undefined) => void) => void) {
	//	this.onResponseEndHandlers.push(fn);
	//	return this;
	//};



	//public _onError(kind, ctx, err) {
	//	log.assert(this === ctx, "assume same object");
	//	ctx.onErrorHandlers.forEach(function (handler) {
	//		return handler(ctx, err, kind);
	//	});
	//	if (ctx.proxyToClientResponse && !ctx.proxyToClientResponse.headersSent) {
	//		ctx.proxyToClientResponse.writeHead(504, 'Proxy Error  (ctx._onError() invoked)');
	//	}
	//	if (ctx.proxyToClientResponse && !ctx.proxyToClientResponse.finished) {
	//		ctx.proxyToClientResponse.end('' + kind + ': ' + err, 'utf8');
	//	}

	//	//this.onErrorHandlers.forEach(function (handler) {
	//	//	return handler(ctx, err, kind);
	//	//});
	//	//if (ctx) {
	//	//	ctx.onErrorHandlers.forEach(function (handler) {
	//	//		return handler(ctx, err, kind);
	//	//	});
	//	//	if (ctx.proxyToClientResponse && !ctx.proxyToClientResponse.headersSent) {
	//	//		ctx.proxyToClientResponse.writeHead(504, 'Proxy Error');
	//	//	}
	//	//	if (ctx.proxyToClientResponse && !ctx.proxyToClientResponse.finished) {
	//	//		ctx.proxyToClientResponse.end('' + kind + ': ' + err, 'utf8');
	//	//	}
	//	//}
	//};


	/** Adds a module into the proxy. Modules encapsulate multiple life cycle processing functions into one object.
  
			  Arguments
  
			  module - The module to add. Modules contain a hash of functions to add.
			  Example
  
			  proxy.use({
			  onError: function(ctx, err) { },
			  onCertificateRequired: function(hostname, callback) { return callback(); },
			  onCertificateMissing: function(ctx, files, callback) { return callback(); },
			  onRequest: function(ctx, callback) { return callback(); },
			  onRequestData: function(ctx, chunk, callback) { return callback(null, chunk); },
			  onResponse: function(ctx, callback) { return callback(); },
			  onResponseData: function(ctx, chunk, callback) { return callback(null, chunk); },
			  onWebSocketConnection: function(ctx, callback) { return callback(); },
			  onWebSocketSend: function(ctx, message, flags, callback) { return callback(null, message, flags); },
			  onWebSocketMessage: function(ctx, message, flags, callback) { return callback(null, message, flags); },
			  onWebSocketError: function(ctx, err) {  },
			  onWebSocketClose: function(ctx, code, message, callback) {  },
			  });
			  node-http-mitm-proxy provide some ready to use modules:
  
			  Proxy.gunzip Gunzip response filter (uncompress gzipped content before onResponseData and compress back after)
			  Proxy.wildcard Generates wilcard certificates by default (so less certificates are generated) */
	//public use(mod) {
	//	//if (mod.onError) {
	//	//	this.onError(mod.onError);
	//	//}

	//	if (mod.onRequest) {
	//		this.onRequest(mod.onRequest);
	//	}
	//	if (mod.onRequestHeaders) {
	//		this.onRequestHeaders(mod.onRequestHeaders);
	//	}
	//	if (mod.onRequestData) {
	//		this.onRequestData(mod.onRequestData);
	//	}
	//	if (mod.onResponse) {
	//		this.onResponse(mod.onResponse);
	//	}
	//	if (mod.onResponseHeaders) {
	//		this.onResponseHeaders(mod.onResponseHeaders);
	//	}
	//	if (mod.onResponseData) {
	//		this.onResponseData(mod.onResponseData);
	//	}
	//	if (mod.onWebSocketConnection) {
	//		this.onWebSocketConnection(mod.onWebSocketConnection);
	//	}
	//	if (mod.onWebSocketSend) {
	//		this.onWebSocketFrame(function (ctx, type, fromServer, data, flags, callback) {
	//			if (!fromServer && type === 'message') return this(ctx, data, flags, callback);
	//			else callback(null, data, flags);
	//		}.bind(mod.onWebSocketSend));
	//	}
	//	if (mod.onWebSocketMessage) {
	//		this.onWebSocketFrame(function (ctx, type, fromServer, data, flags, callback) {
	//			if (fromServer && type === 'message') return this(ctx, data, flags, callback);
	//			else callback(null, data, flags);
	//		}.bind(mod.onWebSocketMessage));
	//	}
	//	if (mod.onWebSocketFrame) {
	//		this.onWebSocketFrame(mod.onWebSocketFrame);
	//	}
	//	if (mod.onWebSocketClose) {
	//		this.onWebSocketClose(mod.onWebSocketClose);
	//	}
	//	if (mod.onWebSocketError) {
	//		this.onWebSocketError(mod.onWebSocketError);
	//	}
	//	return this;
	//};
}


export abstract class ContextCallbacks extends ProxyBase {


	///** Jason Port notes: belongs on Proxy.  internally enumerates ctx handlers */
	//public _onRequest(ctx: IContext, callback) {
	//	log.assert(this === ctx as any, "assume same obj");


	//	async.forEach(this.onRequestHandlers, function (fn, callback) {
	//		return fn(ctx, callback);
	//	}, callback);
	//};

	///** Jason Port notes: belongs on Proxy.  internally enumerates ctx handlers */
	//public _onWebSocketConnection(ctx, callback) {
	//	log.assert(this === ctx as any, "assume same obj");
	//	async.forEach(this.onWebSocketConnectionHandlers, function (fn, callback) {
	//		return fn(ctx, callback);
	//	}, callback);
	//};
	///** Jason Port notes: belongs on Proxy.  internally enumerates ctx handlers */
	//public _onWebSocketFrame(ctx, type, fromServer, data, flags) {
	//	log.assert(this === ctx as any, "assume same obj");
	//	//var this = this;
	//	async.forEach(
	//		this.onWebSocketFrameHandlers,
	//		(fn, fnDoneCallback: (err: Error | null, newData?: any, newFlags?: any) => void) => {
	//			return fn(ctx, type, fromServer, data, flags, (err, newData, newFlags) => {
	//				if (err) {
	//					return fnDoneCallback(err);
	//				}
	//				data = newData;
	//				flags = newFlags;
	//				return fnDoneCallback(null, data, flags);
	//			});
	//		},
	//		(err) => {
	//			if (err) {
	//				return this._onWebSocketError(ctx, err);
	//			}
	//			var destWebSocket = fromServer ? ctx.clientToProxyWebSocket : ctx.proxyToServerWebSocket;
	//			if (destWebSocket.readyState === WebSocket.OPEN) {
	//				switch (type) {
	//					case 'message': destWebSocket.send(data, flags);
	//						break;
	//					case 'ping': destWebSocket.ping(data, flags, false);
	//						break;
	//					case 'pong': destWebSocket.pong(data, flags, false);
	//						break;
	//				}
	//			} else {
	//				this._onWebSocketError(ctx, new Error('Cannot send ' + type + ' because ' + (fromServer ? 'clientToProxy' : 'proxyToServer') + ' WebSocket connection state is not OPEN'));
	//			}
	//		});
	//};
	/** Jason Port notes: belongs on Proxy.  internally enumerates ctx handlers */
	//public _onWebSocketClose(ctx, closedByServer, code, message) {
	//	log.assert(this === ctx as any, "assume same obj");
	//	//var this = this;
	//	if (!ctx.closedByServer && !ctx.closedByClient) {
	//		ctx.closedByServer = closedByServer;
	//		ctx.closedByClient = !closedByServer;

	//		async.forEach(
	//			this.onWebSocketCloseHandlers,
	//			(fn, fnDoneCallback: (err: Error | null, newCode?: any, newMessage?: any) => void) => {
	//				return fn(ctx, code, message, (err, newCode, newMessage) => {
	//					if (err) {
	//						return fnDoneCallback(err);
	//					}
	//					code = newCode;
	//					message = newMessage;
	//					return fnDoneCallback(null, code, message);
	//				});
	//			},
	//			(err) => {
	//				if (err) {
	//					return this._onWebSocketError(ctx, err);
	//				}
	//				if (ctx.clientToProxyWebSocket.readyState !== ctx.proxyToServerWebSocket.readyState) {
	//					if (ctx.clientToProxyWebSocket.readyState === WebSocket.CLOSED && ctx.proxyToServerWebSocket.readyState === WebSocket.OPEN) {
	//						ctx.proxyToServerWebSocket.close(code, message);
	//					} else if (ctx.proxyToServerWebSocket.readyState === WebSocket.CLOSED && ctx.clientToProxyWebSocket.readyState === WebSocket.OPEN) {
	//						ctx.clientToProxyWebSocket.close(code, message);
	//					}
	//				}
	//			});
	//	}
	//};
	///** Jason Port notes: belongs on Proxy.  internally enumerates ctx handlers */
	//public _onWebSocketError(ctx, err) {
	//	log.assert(this === ctx as any, "assume same obj");
	//	this.onWebSocketErrorHandlers.forEach(function (handler) {
	//		return handler(ctx, err);
	//	});
	//	//if (ctx) {
	//	//	ctx.onWebSocketErrorHandlers.forEach(function (handler) {
	//	//		return handler(ctx, err);
	//	//	});
	//	//}
	//	if (ctx.proxyToServerWebSocket && ctx.clientToProxyWebSocket.readyState !== ctx.proxyToServerWebSocket.readyState) {
	//		if (ctx.clientToProxyWebSocket.readyState === WebSocket.CLOSED && ctx.proxyToServerWebSocket.readyState === WebSocket.OPEN) {
	//			ctx.proxyToServerWebSocket.close();
	//		} else if (ctx.proxyToServerWebSocket.readyState === WebSocket.CLOSED && ctx.clientToProxyWebSocket.readyState === WebSocket.OPEN) {
	//			ctx.clientToProxyWebSocket.close();
	//		}
	//	}
	//};
	///** Jason Port notes: belongs on Proxy.  internally enumerates ctx handlers */
	//public _onRequestData(ctx, chunk, callback) {
	//	log.assert(this === ctx as any, "assume same obj");
	//	//var this = this;
	//	async.forEach(this.onRequestDataHandlers, (fn, callback: (err: Error | null, newChunk?: Buffer) => void) => {
	//		return fn(ctx, chunk, (err, newChunk) => {
	//			if (err) {
	//				return callback(err);
	//			}
	//			chunk = newChunk;
	//			return callback(null, newChunk);
	//		});
	//	}, (err) => {
	//		if (err) {
	//			return ctx._onError('ON_REQUEST_DATA_ERROR', ctx, err);
	//		}
	//		return callback(null, chunk);
	//	});
	//};
	///** Jason Port notes: belongs on Proxy.  internally enumerates ctx handlers */
	//public _onRequestEnd(ctx, callback) {
	//	log.assert(this === ctx as any, "assume same obj");
	//	//var this = this;
	//	async.forEach(this.onRequestEndHandlers, (fn, callback) => {
	//		return fn(ctx, callback);
	//	}, (err) => {
	//		if (err) {
	//			return ctx._onError('ON_REQUEST_END_ERROR', ctx, err);
	//		}
	//		return callback(null);
	//	});
	//};
	///** Jason Port notes: belongs on Proxy.  internally enumerates ctx handlers */
	//public _onResponse(ctx, callback) {
	//	log.assert(this === ctx as any, "assume same obj");
	//	async.forEach(this.onResponseHandlers, function (fn, callback) {
	//		return fn(ctx, callback);
	//	}, callback);
	//};

	///** JASONS TODO: does this need to enumerate ctx handlers too?  (see other handlers) */
	//public _onRequestHeaders(ctx, callback) {
	//	log.assert(this === ctx as any, "assume same obj");
	//	async.forEach(this.onRequestHeadersHandlers, function (fn, callback) {
	//		return fn(ctx, callback);
	//	}, callback);
	//};

	///** JASONS TODO: does this need to enumerate ctx handlers too?  (see other handlers) */
	//public _onResponseHeaders(ctx, callback) {
	//	log.assert(this === ctx as any, "assume same obj");
	//	async.forEach(this.onResponseHeadersHandlers, function (fn, callback) {
	//		return fn(ctx, callback);
	//	}, callback);
	//};

	///** Jason Port notes: belongs on Proxy.  internally enumerates ctx handlers */
	//public _onResponseData(ctx, chunk, callback) {
	//	log.assert(this === ctx as any, "assume same obj");
	//	//var this = this;
	//	async.forEach(this.onResponseDataHandlers, (fn, callback: (err: Error | null, newChunk?: Buffer) => void) => {
	//		return fn(ctx, chunk, (err, newChunk) => {
	//			if (err) {
	//				return callback(err);
	//			}
	//			chunk = newChunk;
	//			return callback(null, newChunk);
	//		});
	//	}, (err) => {
	//		if (err) {
	//			return ctx._onError('ON_RESPONSE_DATA_ERROR', ctx, err);
	//		}
	//		return callback(null, chunk);
	//	});
	//};

	///** Jason Port notes: belongs on Proxy.  internally enumerates ctx handlers */
	//public _onResponseEnd(ctx, callback) {
	//	log.assert(this === ctx as any, "assume same obj");
	//	//var this = this;
	//	async.forEach(this.onResponseEndHandlers, (fn, callback) => {
	//		return fn(ctx, callback);
	//	}, (err) => {
	//		if (err) {
	//			return ctx._onError('ON_RESPONSE_END_ERROR', ctx, err);
	//		}
	//		return callback(null);
	//	});
	//};


}



export class IContext extends ContextCallbacks {
	/** options sent to WebSocket when connecting.   set by Proxy._onWebSocketServerConnect() (internal code, when a websocket connects) and you can override via proxy.onWebSocketConnection().
	undefined and unused if not a websocket connection */
	public proxyToServerWebSocketOptions: { url: string } & WebSocket.IClientOptions;// { url: string, agent: http.Agent | https.Agent, headers: { [key: string]: string } };

	/** undocumented, allows adjusting the request in callbacks (such as .onRequest()) before sending  upstream (to proxy or target host)..  
	 * FYI these values seem pre-populated with defaults based on the request, you can modify them to change behavior. */
	public proxyToServerRequestOptions: {
		/** ex: "GET" */
		method: string;
		/** ex: "/success.txt" */
		path: string;

		/** example: "detectportal.firefox.com" */
		host: string;
		port: null;
		headers: { [key: string]: string };
		agent: http.Agent;

	};
	/** set by Proxy._onWebSocketServerConnect().   */
	public isSSL: boolean;

	/** instance of WebSocket object from https://github.com/websockets/ws  set by Proxy._onWebSocketServerConnect() */
	public clientToProxyWebSocket: WebSocket;

	/** instance of WebSocket object from https://github.com/websockets/ws */
	public proxyToServerWebSocket: WebSocket;

	/** may be set to true/false when dealing with websockets. */
	public closedByServer: boolean;
	/** may be set to true/false when dealing with websockets. */
	public closedByClient: boolean;


	clientToProxyRequest: http.IncomingMessage;
	proxyToClientResponse: http.ServerResponse;
	proxyToServerRequest: http.ClientRequest;
	serverToProxyResponse: http.IncomingMessage;

	/** how many attempts at connecting to upstream we have done.   can be greater than 1 if you hook ```proxy.callbacks.onProxyToUpstreamRequestError``` */
	public proxyToUpstreamTries = 0;
	/** user defined tags, initially constructed in the proxy-internals.tx proxy.onRequest() callback, you can add what you like here. 
	 by default, will be undefined.  you can set it in your proxy.onRequest() callback*/
	tags: any

	/** set when constructing the context (prior to proxy.onRequest() being called)  */
	public url: urlModule.Url;


	/** filters added by .addRequestFilter() */
	public requestFilters: any[] = [];

	/** filters added by .addResponseFilter() */
	public responseFilters: any[] = [];

	/**Adds a stream into the request body stream.
  
  Arguments
  
  stream - The read/write stream to add in the request body stream.
  Example
  
  ctx.addRequestFilter(zlib.createGunzip()); */
	public addRequestFilter(filter: any) {
		this.requestFilters.push(filter);
		return this;
	}
	/** Adds a stream into the response body stream.
  
  Arguments
  
  stream - The read/write stream to add in the response body stream.
  Example
  
  ctx.addResponseFilter(zlib.createGunzip()); */
	public addResponseFilter(filter: any) {
		this.responseFilters.push(filter);
		return this;
	}
}

///////////////////////////  END ICONTEXT CLASS
export class Proxy {



	//	protected onErrorHandlers: ((err?: Error, errorKind?: string) => void)[] = [];
	//	public onError(/**Adds a function to the list of functions to get called if an error occures.

	//Arguments

	//fn(ctx, err, errorKind) - The function to be called on an error.*/fn: (err?: Error, errorKind?: string) => void) {
	//		this.onErrorHandlers.push(fn);
	//		return this;
	//	};
	//	public _onError(kind: string, err: Error) {
	//		this.onErrorHandlers.forEach(function (handler) {
	//			return handler(err, kind);
	//		});
	//	};


	public callbacks = new ProxyCallbacks();
	private _attachedMods: ProxyCallbacks[] = [];

	public attachMod(mod: ProxyCallbacks) {

		//attach all callbacks from mod to our masterDispatcher
		_.forOwn(mod, (dispatcher, key) => {
			_.forEach(dispatcher._storage, (callback) => {
				log.info(`attaching mod.${key} to proxy._masterModDispatcher.  callback=`,callback);
				this.callbacks[key].subscribe(callback)
			});
		});
		this._attachedMods.push(mod);
	}

	constructor(/** optional, override the default callbacks.  If you do this, be sure to call ```ctx.proxyToClientResponse.end()``` manually. */defaultCallbacks?: ProxyCallbacks) {
		if (defaultCallbacks == null) {
			//add our default callbacks.
			defaultCallbacks = new ProxyCallbacks();
			//if error detected, abort response with a 504 error.
			defaultCallbacks.onError.subscribe((sender, args) => {
				utils.closeClientRequestWithError(args.ctx, args.err, args.errorKind);

			});

			//fork webSocketFrame messages for convenience.
			defaultCallbacks.onWebSocketFrame.subscribe((sender, args) => {
				return Promise.try(() => {
					if (this.callbacks.onWebSocketSend._storage.length > 0 && args.fromServer !== true && args.type === "message") {
						return this.callbacks.onWebSocketSend.invoke(sender, args);
					}
					if (this.callbacks.onWebSocketMessage._storage.length > 0 && args.fromServer === true && args.type === "message") {
						return this.callbacks.onWebSocketMessage.invoke(sender, args);
					}
					return Promise.resolve(args);
				}).then((args) => {
					//proxy.ts:522
					var destWebSocket = args.fromServer ? args.ctx.clientToProxyWebSocket : args.ctx.proxyToServerWebSocket;
					if (destWebSocket.readyState === WebSocket.OPEN) {
						switch (args.type) {
							case 'message': destWebSocket.send(args.data, args.flags);
								break;
							case 'ping': destWebSocket.ping(args.data, args.flags, false);
								break;
							case 'pong': destWebSocket.pong(args.data, args.flags, false);
								break;
							default:
								throw new xlib.exception.Exception(`unknown websocket type "${args.type}" `, { data: { errorKind: "proxy.ctor.defaultCallbacks.onWebSocketFrame:pipe:error", args } });
						}
					} else {
						throw new xlib.exception.Exception('Cannot send ' + args.type + ' because ' + (args.fromServer ? 'clientToProxy' : 'proxyToServer') + ' WebSocket connection state is not OPEN', { data: { errorKind: "proxy.ctor.defaultCallbacks.onWebSocketFrame:pipe:error", args } });

						//this.callbacks.onWebSocketError.invoke(this, { ctx: args.ctx, err: new Error('Cannot send ' + type + ' because ' + (fromServer ? 'clientToProxy' : 'proxyToServer') + ' WebSocket connection state is not OPEN'), errorKind:"proxy.ctor.defaultCallbacks.onWebSocketFrame:pipe:error" });
					}
					return args;
				});
			});

			const closeWebsocket = (ctx: IContext, code?: any, data?: any) => {
				if (ctx.clientToProxyWebSocket.readyState !== ctx.proxyToServerWebSocket.readyState) {
					if (ctx.clientToProxyWebSocket.readyState === WebSocket.CLOSED && ctx.proxyToServerWebSocket.readyState === WebSocket.OPEN) {
						ctx.proxyToServerWebSocket.close(code, data);
					} else if (ctx.proxyToServerWebSocket.readyState === WebSocket.CLOSED && ctx.clientToProxyWebSocket.readyState === WebSocket.OPEN) {
						ctx.clientToProxyWebSocket.close(code, data);
					}
				}
			}

			defaultCallbacks.onWebSocketClose.subscribe((sender, args) => {
				const ctx = args.ctx;

				if (!ctx.closedByServer && !ctx.closedByClient) {
					ctx.closedByServer = args.closedByServer;
					ctx.closedByClient = !args.closedByServer;

					closeWebsocket(ctx, args.code, args.message);

				} else {
					log.assert(false, "already closed, investigate and handle multiple calls to this fcn");
				}
				return Promise.resolve(args);

			});

			defaultCallbacks.onWebSocketError.subscribe((sender, args) => {
				const ctx = args.ctx;
				log.error("proxy.defaultCallbacks.onWebSocketError", args);


				closeWebsocket(ctx);
			});

			defaultCallbacks.onCertificateRequired.subscribe((sender, args) => {

				const hostname = args.hostname;

				return Promise.resolve({
					keyFile: this.sslCaDir + '/keys/' + hostname + '.key',
					certFile: this.sslCaDir + '/certs/' + hostname + '.pem',
					hosts: [hostname]
				});
			
			});

			defaultCallbacks.onCertificateMissing.subscribe((sender, args) => {
				var hosts = args.files.hosts || [args.info.hostname];
				return new Promise<ICertificateData>((resolve, reject) => {
					this.ca.generateServerCertificateKeys(hosts, function (certPEM, privateKeyPEM) {
						return resolve({
							certFileData: certPEM,
							keyFileData: privateKeyPEM,
							hosts: hosts
						});
					});
				});
			});
		}



		this.attachMod(defaultCallbacks);





	}
	//public use(mod: any) {



	//	if (mod.onCertificateRequired) {
	//		this.onCertificateRequired = mod.onCertificateRequired;
	//	}
	//	if (mod.onCertificateMissing) {
	//		this.onCertificateMissing = mod.onCertificateMissing;
	//	}
	//	//if (mod.onConnect) {
	//	//	this.onConnect(mod.onConnect);
	//	//}
	//	//return super.use(mod);
	//	this.mods.push(mod);
	//}
	///** hook all mods to be attached to context when created */
	//public mods: any[] = [];

	//public onConnectHandlers: ((req: http.IncomingMessage, socket: net.Socket, head: any, callback: (error: Error | undefined) => void) => void)[] = [];


	public options: IProxyListenOptions;
	public silent: boolean;
	public httpPort: number;
	public timeout: number;
	public keepAlive: boolean;
	public httpAgent: http.Agent;
	public httpsAgent: https.Agent;
	public forceSNI: boolean;
	public httpsPort?: number;
	public sslCaDir: string;

	// class properties set in .listen()
	private ca: ca.CA;
	private sslServers: any;
	private sslSemaphores: any;
	private httpServer: http.Server;
	private httpsServer: https.Server;
	private wsServer: WebSocket.Server;
	//???
	private wssServer: any;
	/** Starts the proxy listening on the given port..  example: proxy.listen({ port: 80 }); */
	public listen(options: IProxyListenOptions = {}, callback?: (err?: Error) => void) {

		if (options.sslCaName == null) {
			options.sslCaName = "Chain Proxy";
		}

		//var this = this;

		this.options = options;
		this.silent = !!options.silent;
		this.httpPort = options.port || 8080;
		this.timeout = options.timeout || 0;
		this.keepAlive = !!options.keepAlive;
		this.httpAgent = typeof (options.httpAgent) !== "undefined" ? options.httpAgent : new http.Agent({ keepAlive: this.keepAlive });
		this.httpsAgent = typeof (options.httpsAgent) !== "undefined" ? options.httpsAgent : new https.Agent({ keepAlive: this.keepAlive });
		this.forceSNI = !!options.forceSNI;

		if (this.forceSNI && !this.silent) {
			console.log('SNI enabled. Clients not supporting SNI may fail');
		}
		this.httpsPort = this.forceSNI ? options.httpsPort : undefined;
		this.sslCaDir = options.sslCaDir || path.resolve(process.cwd(), '.certstore');
		new ca.CA(this.sslCaDir, options.sslCaName, (err, ca) => {
			if (err) {
				if (callback == null) {
					throw err;
				}
				return callback(err);
			}
			this.ca = ca;
			this.sslServers = {};
			this.sslSemaphores = {};
			this.httpServer = http.createServer();
			this.httpServer.timeout = this.timeout;
			//this.httpServer.on('error', this._onError.bind(this, 'HTTP_SERVER_ERROR'));
			this.httpServer.on("error", (err) => { this.callbacks.onError.invoke(this, { err, errorKind: "proxy.httpServer.on('error')" }); });

			//this.httpServer.on('connect', this._onHttpServerConnect.bind(this));
			this.httpServer.on("connect", (req: http.IncomingMessage, socket: net.Socket, head: any, otherArg: any) => {
				this._onHttpServerConnect({ req, socket, head, otherArg, isSsl: false });
			});
			this.httpServer.on('request', this._onHttpServerRequest.bind(this, false));
			this.wsServer = new WebSocket.Server({ server: this.httpServer });
			this.wsServer.on('connection', this._onWebSocketServerConnect.bind(this, false));
			if (this.forceSNI) {
				// start the single HTTPS server now
				this._createHttpsServer({}, (port, httpsServer, wssServer) => {
					if (!this.silent) {
						console.log('https server started on ' + port);
					}
					this.httpsServer = httpsServer;
					this.wssServer = wssServer;
					this.httpsPort = port;
					this.httpServer.listen(this.httpPort, callback);
				});
			} else {
				this.httpServer.listen(this.httpPort, callback);
			}
		});
		return this;
	}

	private _createHttpsServer(options, callback) {
		var httpsServer = https.createServer(options);
		(httpsServer as any).timeout = this.timeout; //exists: https://nodejs.org/api/https.html
		//httpsServer.on('error', this._onError.bind(this, 'HTTPS_SERVER_ERROR'));
		httpsServer.on("error", (err) => { this.callbacks.onError.invoke(this, { err, errorKind: "proxy.httpsServer.on('error')" }); });
		//httpsServer.on('clientError', this._onError.bind(this, 'HTTPS_CLIENT_ERROR'));
		httpsServer.on("error", (err) => { this.callbacks.onError.invoke(this, { err, errorKind: "proxy.httpsServer.on('clientError')" }); });
		//httpsServer.on('connect', this._onHttpServerConnect.bind(this));
		this.httpServer.on("connect", (req: http.IncomingMessage, socket: net.Socket, head: Buffer, otherArg: any) => {
			this._onHttpServerConnect({ req, socket, head, otherArg, isSsl: true });
		})
		httpsServer.on('request', this._onHttpServerRequest.bind(this, true));
		var wssServer = new WebSocket.Server({ server: httpsServer });
		wssServer.on('connection', this._onWebSocketServerConnect.bind(this, true));
		var listenArgs: any[] = [function () {
			if (callback) callback(httpsServer.address().port, httpsServer, wssServer);
		}];
		if (this.httpsPort && !options.hosts) {
			listenArgs.unshift(this.httpsPort);
		}
		httpsServer.listen.apply(httpsServer, listenArgs);
	};



	/** proxy.close
			Stops the proxy listening.
			
			Example
			
			proxy.close(); */
	public close() {
		//var this = this;
		this.httpServer.close();
		delete this.httpServer;
		if (this.httpsServer) {
			this.httpsServer.close();
			delete this.httpsServer;
			delete this.wssServer;
			delete this.sslServers;
		}
		if (this.sslServers) {
			(Object.keys(this.sslServers)).forEach((srvName) => {
				var server = this.sslServers[srvName].server;
				if (server) server.close();
				delete this.sslServers[srvName];
			});
		}
		return this;
	};

	///**
	// * Add custom handler for CONNECT method
	// * @augments
	// *   - fn(req,socket,head,callback) be called on receiving CONNECT method
	// */
	//public onConnect(fn: (req: http.IncomingMessage, socket: net.Socket, head: any, callback: (error: Error | undefined) => void) => void) {
	//	this.onConnectHandlers.push(fn);
	//	return this;
	//};




	private _onHttpServerConnect(args: { req: http.IncomingMessage; socket: net.Socket; head: Buffer; isSsl: boolean; otherArg: any; }) {
		////var this = this;

		//// you can forward HTTPS request directly by adding custom CONNECT method handler
		//return async.forEach(this.onConnectHandlers, (fn: Function, callback) => {
		//	return fn.call(this, req, socket, head, callback)
		//}, (err: Error) => {
		//	if (err) {
		//		//return this._onError('ON_CONNECT_ERROR', err);
		//		return this.callbacks.onError.invoke(this, { err, errorKind: "proxy._masterModDispatcher.onConnect() --> error", data: { req, socket, head } });
		//	}
		//	// we need first byte of data to detect if request is SSL encrypted
		//	if (!head || head.length === 0) {
		//		socket.once('data', this._onHttpServerConnectData.bind(this, req, socket));
		//		socket.on("data", (req, socket) => {
		//			//JASONS HACK: test listening to https socket
		//			log.warn("socket.on.data", { req, socket });
		//		})
		//		socket.write('HTTP/1.1 200 OK\r\n');
		//		if (this.keepAlive && req.headers['proxy-connection'] === 'keep-alive') {
		//			socket.write('Proxy-Connection: keep-alive\r\n');
		//			socket.write('Connection: keep-alive\r\n');
		//		}
		//		return socket.write('\r\n');
		//	} else {
		//		this._onHttpServerConnectData(req, socket, head)
		//	}
		//	})

		return this.callbacks.onConnect.invoke(this, args)
			.then(() => {
				const { head, req, socket } = args;

				// we need first byte of data to detect if request is SSL encrypted
				if (!head || head.length === 0) {
					socket.once('data', this._onHttpServerConnectData.bind(this, req, socket));
					socket.on("data", (req, socket) => {
						//JASONS HACK: test listening to https socket
						log.warn("socket.on.data", { req, socket });
					})
					socket.write('HTTP/1.1 200 OK\r\n');
					if (this.keepAlive && req.headers['proxy-connection'] === 'keep-alive') {
						socket.write('Proxy-Connection: keep-alive\r\n');
						socket.write('Connection: keep-alive\r\n');
					}
					return socket.write('\r\n');
				} else {
					this._onHttpServerConnectData(req, socket, head)
				}
			})
			.catch((err) => {
				this.callbacks.onError.invoke(this, { err, errorKind: "proxy._masterModDispatcher.onConnect() --> error", data: args });
				return Promise.reject(err);
			});
	}


	private _onHttpServerConnectData(req, socket, head) {
		//var this = this;

		socket.pause();


		const makeConnection = (port) => {
			// open a TCP connection to the remote host
			var conn = net.connect(port, function () {
				// create a tunnel between the two hosts
				socket.pipe(conn);
				conn.pipe(socket);
				socket.emit('data', head);
				return socket.resume();
			});
			//conn.on('error', this._onError.bind(this, 'PROXY_TO_PROXY_SOCKET_ERROR'));
			conn.on("error", (err) => { this.callbacks.onError.invoke(this, { err, errorKind: "PROXY_TO_PROXY_SOCKET_ERROR", data: { port } }); });

		}


		const getHttpsServer = (hostname, callback) => {

			//this.onCertificateRequired(hostname, (err, files) => {
			return this.callbacks.onCertificateRequired.invoke(this, { hostname })
				.then((files) => {

					async.auto({
						'keyFileExists': function (callback) {

							return fs.exists(files.keyFile, function (exists) {
								return callback(null, exists);
							});
						},
						'certFileExists': function (callback) {
							return fs.exists(files.certFile, function (exists) {
								return callback(null, exists);
							});
						},
						'httpsOptions': ['keyFileExists', 'certFileExists', (data: { keyFileExists: boolean; certFileExists: boolean; }, callback) => {
							if (data.keyFileExists && data.certFileExists) {
								return fs.readFile(files.keyFile, function (err, keyFileData) {
									if (err) {
										return callback(err);
									}

									return fs.readFile(files.certFile, function (err, certFileData) {
										if (err) {
											return callback(err);
										}

										return callback(null, {
											key: keyFileData,
											cert: certFileData,
											hosts: files.hosts
										});
									});
								});
							} else {
								var info = {
									'hostname': hostname,
									'files': files,
									'data': data
								};

								return this.callbacks.onCertificateMissing.invoke(this, { info, files })
									.then((certData) => {										
										return callback(null, {
											key: certData.keyFileData,
											cert: certData.certFileData,
											hosts: certData.hosts
										});
									})
									.catch((err) => {
										return callback(err);
									});

								//return this.onCertificateMissing(info, files, function (err, files) {
									
								//	if (err) {
								//		return callback(err);
								//	}

								//	return callback(null, {
								//		key: files.keyFileData,
								//		cert: files.certFileData,
								//		hosts: files.hosts
								//	});
								//});
							}
						}]
					}, undefined, (err, results) => {
						if (err) {
							return callback(err);
						}
						var hosts;
						if (results.httpsOptions && results.httpsOptions.hosts && results.httpsOptions.hosts.length) {
							hosts = results.httpsOptions.hosts;
							if (hosts.indexOf(hostname) === -1) {
								hosts.push(hostname);
							}
						} else {
							hosts = [hostname];
						}
						delete results.httpsOptions.hosts;
						if (this.forceSNI && !hostname.match(/^[\d\.]+$/)) {
							if (!this.silent) {
								console.log('creating SNI context for ' + hostname);
							}
							hosts.forEach((host) => {
								this.httpsServer.addContext(host, results.httpsOptions);
								this.sslServers[host] = { port: this.httpsPort };
							});
							return callback(null, this.httpsPort);
						} else {
							if (!this.silent) {
								console.log('starting server for ' + hostname);
							}
							results.httpsOptions.hosts = hosts;
							this._createHttpsServer(results.httpsOptions, (port, httpsServer, wssServer) => {
								if (!this.silent) {
									console.log('https server started for %s on %s', hostname, port);
								}
								var sslServer = {
									server: httpsServer,
									wsServer: wssServer,
									port: port
								};
								hosts.forEach((host) => {
									this.sslServers[hostname] = sslServer;
								});
								return callback(null, port);
							});
						}
					});
				});
		
		}

		/*
		* Detect TLS from first bytes of data
		* Inspired from https://gist.github.com/tg-x/835636
		* used heuristic:
		* - an incoming connection using SSLv3/TLSv1 records should start with 0x16
		* - an incoming connection using SSLv2 records should start with the record size
		*   and as the first record should not be very big we can expect 0x80 or 0x00 (the MSB is a flag)
		* - everything else is considered to be unencrypted
		*/
		if (head[0] == 0x16 || head[0] == 0x80 || head[0] == 0x00) {
			// URL is in the form 'hostname:port'
			var hostname = req.url.split(':', 2)[0];
			var sslServer = this.sslServers[hostname];
			if (sslServer) {
				return makeConnection(sslServer.port);
			}
			var wilcardHost = hostname.replace(/[^\.]+\./, '*.');
			var sem = this.sslSemaphores[wilcardHost];
			if (!sem) {
				sem = this.sslSemaphores[wilcardHost] = semaphore(1);
			}
			sem.take(() => {
				if (this.sslServers[hostname]) {
					process.nextTick(sem.leave.bind(sem));
					return makeConnection(this.sslServers[hostname].port);
				}
				if (this.sslServers[wilcardHost]) {
					process.nextTick(sem.leave.bind(sem));
					this.sslServers[hostname] = {
						port: this.sslServers[wilcardHost]
					};
					return makeConnection(this.sslServers[hostname].port);
				}
				getHttpsServer(hostname, (err: Error, port) => {
					process.nextTick(sem.leave.bind(sem));
					if (err) {
						//return this._onError('OPEN_HTTPS_SERVER_ERROR', err);
						return this.callbacks.onError.invoke(this, { err, errorKind: "OPEN_HTTPS_SERVER_ERROR", data: { req, socket, head } });
					}
					return makeConnection(port);
				});
			});
		} else {
			return makeConnection(this.httpPort);
		}



	};


	//public onCertificateRequired(hostname: string, callback: (error: Error | undefined, certDetails: ICertificatePaths) => void) {
	//	//var this = this;
	//	callback(null, {
	//		keyFile: this.sslCaDir + '/keys/' + hostname + '.key',
	//		certFile: this.sslCaDir + '/certs/' + hostname + '.pem',
	//		hosts: [hostname]
	//	});
	//	return this;
	//};

	public onCertificateMissing(info: ICertificateMissingHint, files: any, callback: (error: Error | undefined, certDetails: ICertificateData) => void) {
		var hosts = files.hosts || [info.hostname];
		this.ca.generateServerCertificateKeys(hosts, function (certPEM, privateKeyPEM) {
			callback(null, {
				certFileData: certPEM,
				keyFileData: privateKeyPEM,
				hosts: hosts
			});
		});
		return this;
	};

	/**
	 *  initial handshake for websocket connections 
	 * @param isSSL
	 * @param ws
	 */
	private _onWebSocketServerConnect(isSSL, ws) {
		//var this = this;

		var ctx = new IContext();
		ctx.isSSL = isSSL;
		ctx.clientToProxyWebSocket = ws;


		ctx.clientToProxyWebSocket.pause();

		var url;
		if (ctx.clientToProxyWebSocket.upgradeReq.url == '' || /^\//.test(ctx.clientToProxyWebSocket.upgradeReq.url)) {
			var hostPort = utils.parseHostAndPort(ctx.clientToProxyWebSocket.upgradeReq);
			url = (ctx.isSSL ? 'wss' : 'ws') + '://' + hostPort.host + (hostPort.port ? ':' + hostPort.port : '') + ctx.clientToProxyWebSocket.upgradeReq.url;
		} else {
			url = ctx.clientToProxyWebSocket.upgradeReq.url;
		}
		ctx.url = urlModule.parse(url, true, true);



		var ptosHeaders = {};
		var ctopHeaders = ctx.clientToProxyWebSocket.upgradeReq.headers;
		for (var key in ctopHeaders) {
			if (key.indexOf('sec-websocket') !== 0) {
				ptosHeaders[key] = ctopHeaders[key];
			}
		}


		ctx.proxyToServerWebSocketOptions = {
			url: url,
			agent: ctx.isSSL ? this.httpsAgent : this.httpAgent,
			headers: ptosHeaders,

			//bugfix not fully configured websocket options.   see https://github.com/joeferner/node-http-mitm-proxy/issues/120
			protocol: ctx.clientToProxyWebSocket.protocol,
			protocolVersion: ctx.clientToProxyWebSocket.protocolVersion,
		};

		//////apply mods
		//this.mods.forEach((mod) => {
		//	ctx.use(mod);
		//});

		return this.callbacks.onContextInitialize.invoke(this, { ctx })
			.then(() => {

				//ctx.clientToProxyWebSocket.on('message', ctx._onWebSocketFrame.bind(ctx, ctx, 'message', false));
				//ctx.clientToProxyWebSocket.on('ping', ctx._onWebSocketFrame.bind(ctx, ctx, 'ping', false));
				//ctx.clientToProxyWebSocket.on('pong', ctx._onWebSocketFrame.bind(ctx, ctx, 'pong', false));
				//ctx.clientToProxyWebSocket.on('error', ctx._onWebSocketError.bind(ctx, ctx));
				//ctx.clientToProxyWebSocket.on('close', ctx._onWebSocketClose.bind(ctx, ctx, false));

				ctx.clientToProxyWebSocket.on('message', (data, flags) => { this.callbacks.onWebSocketFrame.invoke(ctx.clientToProxyWebSocket, { ctx, type: "message", fromServer: false, flags, data }); });
				ctx.clientToProxyWebSocket.on('ping', (data, flags) => { this.callbacks.onWebSocketFrame.invoke(ctx.clientToProxyWebSocket, { ctx, type: "ping", fromServer: false, flags, data }); });
				ctx.clientToProxyWebSocket.on('pong', (data, flags) => { this.callbacks.onWebSocketFrame.invoke(ctx.clientToProxyWebSocket, { ctx, type: "pong", fromServer: false, flags, data }); });
				ctx.clientToProxyWebSocket.on('error', (err) => { this.callbacks.onWebSocketError.invoke(ctx.clientToProxyWebSocket, { ctx, err, errorKind: "ctx.clientToProxyWebSocket.on('error')" }); });
				ctx.clientToProxyWebSocket.on('close', (code, message) => { this.callbacks.onWebSocketClose.invoke(ctx.clientToProxyWebSocket, { ctx, closedByServer: false, code, message }); });



				//return ctx._onWebSocketConnection(ctx, (err) => {
				//	if (err) {
				//		return ctx._onWebSocketError(ctx, err);
				//	}
				//	return makeProxyToServerWebSocket();
				//});

				//function makeProxyToServerWebSocket() {
				//	ctx.proxyToServerWebSocket = new WebSocket(ctx.proxyToServerWebSocketOptions.url, ctx.proxyToServerWebSocketOptions);
				//	ctx.proxyToServerWebSocket.on('message', ctx._onWebSocketFrame.bind(ctx, ctx, 'message', true));
				//	ctx.proxyToServerWebSocket.on('ping', ctx._onWebSocketFrame.bind(ctx, ctx, 'ping', true));
				//	ctx.proxyToServerWebSocket.on('pong', ctx._onWebSocketFrame.bind(ctx, ctx, 'pong', true));
				//	ctx.proxyToServerWebSocket.on('error', ctx._onWebSocketError.bind(ctx, ctx));
				//	ctx.proxyToServerWebSocket.on('close', ctx._onWebSocketClose.bind(ctx, ctx, true));
				//	ctx.proxyToServerWebSocket.on('open', function () {
				//		if (ctx.clientToProxyWebSocket.readyState === WebSocket.OPEN) {
				//			ctx.clientToProxyWebSocket.resume();
				//		}
				//	});
				//}
				this.callbacks.onWebSocketConnection.invoke(this, { ctx })
					.then(() => {
						ctx.proxyToServerWebSocket = new WebSocket(ctx.proxyToServerWebSocketOptions.url, ctx.proxyToServerWebSocketOptions);


						ctx.proxyToServerWebSocket.on('message', (data, flags) => { this.callbacks.onWebSocketFrame.invoke(ctx.proxyToServerWebSocket, { ctx, type: "message", fromServer: true, flags, data }); });
						ctx.proxyToServerWebSocket.on('ping', (data, flags) => { this.callbacks.onWebSocketFrame.invoke(ctx.proxyToServerWebSocket, { ctx, type: "ping", fromServer: true, flags, data }); });
						ctx.proxyToServerWebSocket.on('pong', (data, flags) => { this.callbacks.onWebSocketFrame.invoke(ctx.proxyToServerWebSocket, { ctx, type: "pong", fromServer: true, flags, data }); });
						ctx.proxyToServerWebSocket.on('error', (err) => { this.callbacks.onWebSocketError.invoke(ctx.proxyToServerWebSocket, { ctx, err, errorKind: "ctx.proxyToServerWebSocket.on('error')" }); });
						ctx.proxyToServerWebSocket.on('close', (code, message) => { this.callbacks.onWebSocketClose.invoke(ctx.proxyToServerWebSocket, { ctx, closedByServer: true, code, message }); });
						ctx.proxyToServerWebSocket.on('open', function () {
							if (ctx.clientToProxyWebSocket.readyState === WebSocket.OPEN) {
								ctx.clientToProxyWebSocket.resume();
							}
						});
					});
			});
	}

	private _onHttpServerRequest(isSSL, clientToProxyRequest, proxyToClientResponse) {
		//var this = this;


		var ctx = new IContext();
		ctx.isSSL = isSSL;
		ctx.clientToProxyRequest = clientToProxyRequest;
		ctx.proxyToClientResponse = proxyToClientResponse;

		try {
			let protocol = ctx.isSSL === true ? "https" : "http";
			let href = `${protocol}://${ctx.clientToProxyRequest.headers["host"]}${ctx.clientToProxyRequest.url}`;
			ctx.url = urlModule.parse(href, true, true);
		} catch (ex) {
			//ignore / eat errors
		}

		ctx.clientToProxyRequest.pause();

		//////apply mods
		//this.mods.forEach((mod) => {
		//	ctx.use(mod);
		//});

		return this.callbacks.onContextInitialize.invoke(this, { ctx })
			.then(() => {

				//ctx.clientToProxyRequest.on('error', ctx._onError.bind(ctx, 'CLIENT_TO_PROXY_REQUEST_ERROR', ctx));
				ctx.clientToProxyRequest.on("error", (err) => { this.callbacks.onError.invoke(this, { err, errorKind: "CLIENT_TO_PROXY_REQUEST_ERROR", ctx }); });
				//ctx.proxyToClientResponse.on('error', ctx._onError.bind(ctx, 'PROXY_TO_CLIENT_RESPONSE_ERROR', ctx));
				ctx.proxyToClientResponse.on("error", (err) => { this.callbacks.onError.invoke(this, { err, errorKind: "PROXY_TO_CLIENT_RESPONSE_ERROR", ctx }); });


				var hostPort = utils.parseHostAndPort(ctx.clientToProxyRequest, ctx.isSSL ? 443 : 80);
				var headers = {};
				for (var h in ctx.clientToProxyRequest.headers) {

					// don't forward proxy- headers
					if (!/^proxy\-/i.test(h)) {
						//console.log(`testing and pass ${h}`);
						headers[h] = ctx.clientToProxyRequest.headers[h];
					} else {
						//console.log(`testing and FAIL!!!!!!!!!!!!! ${h}`);
					}
				}
				//fix ajax requests, see: https://github.com/joeferner/node-http-mitm-proxy/issues/111#issuecomment-298185361
				if (headers["transfer-encoding"] === "chunked") {
					//console.log("\n\n  CHUNKED!!!!!  deleting content-length !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!  \n\n\n", headers);
					delete headers['content-length'];
				}


				ctx.proxyToServerRequestOptions = {
					method: ctx.clientToProxyRequest.method,
					path: ctx.clientToProxyRequest.url,
					host: hostPort.host,
					port: hostPort.port,
					headers: headers,
					agent: ctx.isSSL ? this.httpsAgent : this.httpAgent
				};

				//JASON EDIT: wrapping this._onRequest in a function to make recallable when upstream proxy errors.
				const callOnRequestHandlersThenMakeProxyRequest = () => {
					//return ctx._onRequest(ctx, (err) => {
					//	if (err) {
					//		//return ctx._onError('ON_REQUEST_ERROR', ctx, err);
					//		return this.callbacks.onError.invoke(this, { err, errorKind: "ON_REQUEST_ERROR", ctx, });
					//	}
					//	return ctx._onRequestHeaders(ctx, (err) => {
					//		if (err) {
					//			//return ctx._onError('ON_REQUESTHEADERS_ERROR', ctx, err);

					//			return this.callbacks.onError.invoke(this, { err, errorKind: "ON_REQUESTHEADERS_ERROR", ctx, });
					//		}
					//		return makeProxyToServerRequest();
					//	});
					//});

					ctx.proxyToUpstreamTries++;
					return this.callbacks.onRequest.invoke(this, { ctx })
						.then(() => {
							return this.callbacks.onRequestHeaders.invoke(this, { ctx });
						})
						.then(() => {
							//makeProxyToServerRequest() logic
							var proto: typeof http = (ctx.isSSL ? https : http) as any;
							ctx.proxyToServerRequest = proto.request(ctx.proxyToServerRequestOptions, proxyToServerRequestComplete);
							//JASON EDIT: wacky binding scheme to simply call our new handleProxyToServerRequestError() function
							//ctx.proxyToServerRequest.on('error', handleProxyToServerRequestError.bind(this, 'PROXY_TO_SERVER_REQUEST_ERROR', ctx));
							ctx.proxyToServerRequest.on("error", (err) => {
								//handleProxyToServerRequestError() logic
								return this.callbacks.onProxyToUpstreamRequestError.invoke(ctx.proxyToServerRequest, { ctx, err })
									.then((onUpstreamErrorResults) => {
										if (onUpstreamErrorResults != null && onUpstreamErrorResults.retry === true) {
											//retry logic
											ctx.proxyToServerRequest.abort();
											return callOnRequestHandlersThenMakeProxyRequest();
										} else {
											//throw failure so we abort the request
											return Promise.reject(new xlib.exception.Exception("onProxyToUpstreamRequestError with no retry", { innerException: err }));
										}
									}).catch((err) => {
										//failure logic
										this.callbacks.onError.invoke(this, { err, errorKind: "PROXY_TO_SERVER_REQUEST_ERROR", ctx, });
										//return Promise.reject(err);  //dont error otherwise it's unhandled.
									});
							});


							//JASON EDIT: hack because we recall this, don't want stale "ProxyFinalRequestFilter" from our last call to makeProxyToServerRequest() (previous proxy attempt)
							//ctx.requestFilters.push(new ProxyFinalRequestFilter(this, ctx));
							var proxyFinalRequestFilter = new ProxyFinalRequestFilter(this, ctx);
							var prevRequestPipeElem = ctx.clientToProxyRequest;
							ctx.requestFilters.forEach((filter) => {
								//filter.on('error', ctx._onError.bind(ctx, 'REQUEST_FILTER_ERROR', ctx));
								filter.on("error", (err) => { this.callbacks.onError.invoke(filter, { err, errorKind: "REQUEST_FILTER_ERROR", ctx }); });
								try {
									prevRequestPipeElem = prevRequestPipeElem.pipe(filter);
								} catch (ex) {
									console.log("why error oh WHY?!?!?", ex, prevRequestPipeElem.pipe, prevRequestPipeElem);
								}
							});
							//JASON EDIT: hack because we recall this, don't want stale "ProxyFinalRequestFilter" from our last call to makeProxyToServerRequest() (previous proxy attempt)
							try {
								prevRequestPipeElem.pipe(proxyFinalRequestFilter as any); //JASON HACK:  pipe mismatch typings for .end function
							} catch (ex) {
								console.log("why error oh WHY DEUX?!?!?", ex, prevRequestPipeElem.pipe, prevRequestPipeElem);
							}
							ctx.clientToProxyRequest.resume();
						})

				}

				////JASON EDIT:  helper to handle errors from proxyToServerRequest (retry them)
				//const handleProxyToServerRequestError = (kind, ctx, err) => {
				//	ctx.tags.failedUpstreamCalls++;
				//	console.log("ERRRRRRRRRRRRRR!!!!!\n\n\n!!!!!\n\n\n", ctx.tags.failedUpstreamCalls, ctx.tags.uri)
				//	if (ctx.tags.retryProxyRequest === true) {
				//		return callOnRequestHandlersThenMakeProxyRequest();
				//	} else {
				//		//ctx._onError('PROXY_TO_SERVER_REQUEST_ERROR', ctx, err);						
				//		return this.callbacks.onError.invoke(this, { err, errorKind: "PROXY_TO_SERVER_REQUEST_ERROR", ctx, });
				//	}
				//}


				//const makeProxyToServerRequest = () => {
				//	var proto: typeof http = (ctx.isSSL ? https : http) as any;
				//	ctx.proxyToServerRequest = proto.request(ctx.proxyToServerRequestOptions, proxyToServerRequestComplete);
				//	//JASON EDIT: wacky binding scheme to simply call our new handleProxyToServerRequestError() function
				//	ctx.proxyToServerRequest.on('error', handleProxyToServerRequestError.bind(this, 'PROXY_TO_SERVER_REQUEST_ERROR', ctx));
				//	//JASON EDIT: hack because we recall this, don't want stale "ProxyFinalRequestFilter" from our last call to makeProxyToServerRequest() (previous proxy attempt)
				//	//ctx.requestFilters.push(new ProxyFinalRequestFilter(this, ctx));
				//	var proxyFinalRequestFilter = new ProxyFinalRequestFilter(this, ctx);
				//	var prevRequestPipeElem = ctx.clientToProxyRequest;
				//	ctx.requestFilters.forEach((filter) => {
				//		//filter.on('error', ctx._onError.bind(ctx, 'REQUEST_FILTER_ERROR', ctx));
				//		filter.on("error", (err) => { this.callbacks.onError.invoke(this, { err, errorKind: "REQUEST_FILTER_ERROR", ctx }); });
				//		try {
				//			prevRequestPipeElem = prevRequestPipeElem.pipe(filter);
				//		} catch (ex) {
				//			console.log("why error oh WHY?!?!?", ex, prevRequestPipeElem.pipe, prevRequestPipeElem);
				//		}
				//	});
				//	//JASON EDIT: hack because we recall this, don't want stale "ProxyFinalRequestFilter" from our last call to makeProxyToServerRequest() (previous proxy attempt)
				//	try {
				//		prevRequestPipeElem.pipe(proxyFinalRequestFilter as any); //JASON HACK:  pipe mismatch typings for .end function
				//	} catch (ex) {
				//		console.log("why error oh WHY DEUX?!?!?", ex, prevRequestPipeElem.pipe, prevRequestPipeElem);
				//	}
				//	ctx.clientToProxyRequest.resume();
				//}


				// private _onError(kind, ctx, err) {
				//   this.onErrorHandlers.forEach(function (handler) {
				//     return handler(ctx, err, kind);
				//   });
				//   if (ctx) {
				//     ctx.onErrorHandlers.forEach(function (handler) {
				//       return handler(ctx, err, kind);
				//     });
				//     //JASON EDIT: allow retrying failed proxy calls
				//     ctx.tags.failedUpstreamCalls++;
				//     if (ctx.tags.retryProxyRequest === true) {
				//       // ctx.onResponseDataHandlers.length = 0;
				//       // ctx.onResponseEndHandlers.length = 0;
				//       makeProxyToServerRequest();
				//     } else {
				//       if (ctx.proxyToClientResponse && !ctx.proxyToClientResponse.headersSent) {
				//         ctx.proxyToClientResponse.writeHead(504, 'Proxy Error');
				//       }
				//       if (ctx.proxyToClientResponse && !ctx.proxyToClientResponse.finished) {
				//         ctx.proxyToClientResponse.end('' + kind + ': ' + err, 'utf8');
				//       }
				//     }
				//   }
				// };


				/**
				 *  callback triggered by the ctx.proxyToServerRequest request when it's complete.   response is stored as ctx.serverToProxyResponse.
				 * @param serverToProxyResponse
				 */
				const proxyToServerRequestComplete = (serverToProxyResponse: http.IncomingMessage) => {
					//serverToProxyResponse.on('error', ctx._onError.bind(ctx, 'SERVER_TO_PROXY_RESPONSE_ERROR', ctx));
					serverToProxyResponse.on("error", (err) => { this.callbacks.onError.invoke(this, { err, errorKind: "SERVER_TO_PROXY_RESPONSE_ERROR", ctx }); });
					console.warn("ctx.serverToProxyResponse.pause();");
					serverToProxyResponse.pause();
					ctx.serverToProxyResponse = serverToProxyResponse;




					//return ctx._onResponse(ctx, (err) => {
					//	if (err) {
					//		//return ctx._onError('ON_RESPONSE_ERROR', ctx, err);
					//		this.callbacks.onError.invoke(this, { err, errorKind: "ON_RESPONSE_ERROR", ctx, });
					//		return Promise.reject(err);
					//	}
					//	ctx.serverToProxyResponse.headers['transfer-encoding'] = 'chunked';
					//	delete ctx.serverToProxyResponse.headers['content-length'];
					//	if (this.keepAlive) {
					//		if (ctx.clientToProxyRequest.headers['proxy-connection']) {
					//			ctx.serverToProxyResponse.headers['proxy-connection'] = 'keep-alive';
					//			ctx.serverToProxyResponse.headers['connection'] = 'keep-alive';
					//		}
					//	} else {
					//		ctx.serverToProxyResponse.headers['connection'] = 'close';
					//	}
					//	return ctx._onResponseHeaders(ctx, (err) => {
					//		if (err) {
					//			//return ctx._onError('ON_RESPONSEHEADERS_ERROR', ctx, err);
					//			this.callbacks.onError.invoke(this, { err, errorKind: "ON_RESPONSEHEADERS_ERROR", ctx, });

					//			return Promise.reject(err);
					//		}
					//		ctx.proxyToClientResponse.writeHead(ctx.serverToProxyResponse.statusCode, utils.filterAndCanonizeHeaders(ctx.serverToProxyResponse.headers));
					//		ctx.responseFilters.push(new ProxyFinalResponseFilter(this, ctx));
					//		var prevResponsePipeElem = ctx.serverToProxyResponse;
					//		ctx.responseFilters.forEach((filter) => {
					//			//filter.on('error', ctx._onError.bind(ctx, 'RESPONSE_FILTER_ERROR', ctx));
					//			filter.on("error", (err) => { this.callbacks.onError.invoke(this, { err, errorKind: "RESPONSE_FILTER_ERROR", ctx }); });
					//			prevResponsePipeElem = prevResponsePipeElem.pipe(filter);
					//		});
					//		return ctx.serverToProxyResponse.resume();
					//	});
					//});


					return this.callbacks.onResponse.invoke(this, { ctx })
						.catch((err) => {
							this.callbacks.onError.invoke(this, { err, errorKind: "ON_RESPONSE_ERROR", ctx, });
							return Promise.reject(err);
						})
						.then(() => {

							//maniupate our response from upstream and pipe it to the client

							ctx.serverToProxyResponse.headers['transfer-encoding'] = 'chunked';
							delete ctx.serverToProxyResponse.headers['content-length'];
							if (this.keepAlive) {
								if (ctx.clientToProxyRequest.headers['proxy-connection']) {
									ctx.serverToProxyResponse.headers['proxy-connection'] = 'keep-alive';
									ctx.serverToProxyResponse.headers['connection'] = 'keep-alive';
								}
							} else {
								ctx.serverToProxyResponse.headers['connection'] = 'close';
							}
							return this.callbacks.onResponseHeaders.invoke(this, { ctx })
								.catch((err) => {
									this.callbacks.onError.invoke(this, { err, errorKind: "ON_RESPONSEHEADERS_ERROR", ctx, });
									return Promise.reject(err);
								})
								.then(() => {
									ctx.proxyToClientResponse.writeHead(ctx.serverToProxyResponse.statusCode, utils.filterAndCanonizeHeaders(ctx.serverToProxyResponse.headers));
									ctx.responseFilters.push(new ProxyFinalResponseFilter(this, ctx));
									var prevResponsePipeElem = ctx.serverToProxyResponse;
									ctx.responseFilters.forEach((filter) => {
										//filter.on('error', ctx._onError.bind(ctx, 'RESPONSE_FILTER_ERROR', ctx));
										filter.on("error", (err) => { this.callbacks.onError.invoke(this, { err, errorKind: "RESPONSE_FILTER_ERROR", ctx }); });
										prevResponsePipeElem = prevResponsePipeElem.pipe(filter);
									});
									console.warn("ctx.serverToProxyResponse.resume();");
									return ctx.serverToProxyResponse.resume();
								})
						})


				}

				return callOnRequestHandlersThenMakeProxyRequest();

			});

	}
}

class ProxyFinalRequestFilter extends events.EventEmitter {
	public writable: boolean;

	constructor(public proxy: Proxy, public ctx: IContext) {
		super();
		events.EventEmitter.call(this);
		this.writable = true;
	}
	public write(chunk) {
		////const this = this;
		//this.ctx._onRequestData(this.ctx, chunk, (err, chunk) => {
		//	if (err) {
		//		//return this.ctx._onError('ON_REQUEST_DATA_ERROR', this.ctx, err);
		//		this.proxy.callbacks.onError.invoke(this, { err, errorKind: "ON_REQUEST_DATA_ERROR", ctx: this.ctx, });

		//		return Promise.reject(err);
		//	}
		//	if (chunk) {
		//		return this.ctx.proxyToServerRequest.write(chunk);
		//	}
		//});
		console.warn("ProxyFinalRequestFilter.write");
		this.proxy.callbacks.onRequestData.invoke(this.proxy, { ctx: this.ctx, chunk })
			.then((args) => {

				if (args.chunk) {
					return args.ctx.proxyToServerRequest.write(args.chunk);
				}
			})
			.catch((err) => {
				this.proxy.callbacks.onError.invoke(this, { err, errorKind: "ON_REQUEST_DATA_ERROR", ctx: this.ctx, });
				return Promise.reject(err);
			})


		return true;
	};


	public end(chunk) {

		
		//const this = this;
		if (chunk) {
			console.warn("ProxyFinalRequestFilter.end.write");
			//return this.ctx._onRequestData(this.ctx, chunk, (err, chunk) => {
			//	if (err) {
			//		//return this.ctx._onError('ON_REQUEST_DATA_ERROR', this.ctx, err);
			//		this.proxy.callbacks.onError.invoke(this, { err, errorKind: "ON_REQUEST_DATA_ERROR", ctx: this.ctx, });
			//		return Promise.reject(err);
			//	}

			//	return this.ctx._onRequestEnd(this.ctx, (err) => {
			//		if (err) {
			//			//return this.ctx._onError('ON_REQUEST_END_ERROR', this.ctx, err);
			//			this.proxy.callbacks.onError.invoke(this, { err, errorKind: "ON_REQUEST_END_ERROR", ctx: this.ctx, });
			//			return Promise.reject(err);
			//		}
			//		return this.ctx.proxyToServerRequest.end(chunk);
			//	});
			//});

			return this.proxy.callbacks.onRequestData.invoke(this.proxy, { ctx: this.ctx, chunk })
				.then((args) => {
					return this.proxy.callbacks.onRequestEnd.invoke(this.proxy, { ctx: this.ctx })
						.then((args) => {
							return this.ctx.proxyToServerRequest.end(chunk);
						})
				})
				.catch((err) => {
					this.proxy.callbacks.onError.invoke(this, { err, errorKind: "ON_REQUEST_END_ERROR", ctx: this.ctx, });
					return Promise.reject(err);
				})




		} else {
			console.warn("ProxyFinalRequestFilter.end.end");
			//return this.ctx._onRequestEnd(this.ctx, (err) => {
			//	if (err) {
			//		//return this.ctx._onError('ON_REQUEST_END_ERROR', this.ctx, err);
			//		this.proxy.callbacks.onError.invoke(this, { err, errorKind: "ON_REQUEST_END_ERROR", ctx: this.ctx, });
			//		return Promise.reject(err);
			//	}
			//	return this.ctx.proxyToServerRequest.end(chunk || undefined);
			//});

			return this.proxy.callbacks.onRequestEnd.invoke(this.proxy, { ctx: this.ctx })
				.then((args) => {
					return this.ctx.proxyToServerRequest.end();
				}).catch((err) => {
					this.proxy.callbacks.onError.invoke(this, { err, errorKind: "ON_REQUEST_END_ERROR", ctx: this.ctx, });
					return Promise.reject(err);
				})

		}
	};
}

class ProxyFinalResponseFilter extends events.EventEmitter {

	public writable: boolean;

	constructor(public proxy: Proxy, public ctx: IContext) {
		super();
		events.EventEmitter.call(this);
		this.writable = true;
	}
	public write(chunk) {
		
		console.warn("ProxyFinalResponseFilter.write");
		////const this = this;
		//this.ctx._onResponseData(this.ctx, chunk, (err, chunk) => {
		//	if (err) {
		//		//return this.ctx._onError('ON_RESPONSE_DATA_ERROR', this.ctx, err);
		//		this.proxy.callbacks.onError.invoke(this, { err, errorKind: "ON_RESPONSE_DATA_ERROR", ctx: this.ctx, });
		//		return Promise.reject(err);
		//	}
		//	if (chunk) {
		//		return this.ctx.proxyToClientResponse.write(chunk);
		//	}
		//});

		this.proxy.callbacks.onResponseData.invoke(this.proxy, { ctx: this.ctx, chunk })
			.then((args) => {

				if (args.chunk) {
					console.warn("ProxyFinalResponseFilter.write.actualWrite");
					return args.ctx.proxyToClientResponse.write(args.chunk);
				}
			})
			.catch((err) => {
				this.proxy.callbacks.onError.invoke(this, { err, errorKind: "ON_RESPONSE_DATA_ERROR", ctx: this.ctx, });
				return Promise.reject(err);
			});


		return true;
	};

	public end(chunk) {
		//const this = this;
		if (chunk) {
			console.warn("ProxyFinalResponseFilter.end.write");
			//return this.ctx._onResponseData(this.ctx, chunk, (err, chunk) => {
			//	if (err) {
			//		//return this.ctx._onError('ON_RESPONSE_DATA_ERROR', this.ctx, err);
			//		this.proxy.callbacks.onError.invoke(this, { err, errorKind: "ON_RESPONSE_DATA_ERROR", ctx: this.ctx, });
			//		return Promise.reject(err);
			//	}

			//	return this.ctx._onResponseEnd(this.ctx, (err) => {
			//		if (err) {
			//			//return this.ctx._onError('ON_RESPONSE_END_ERROR', this.ctx, err);
			//			this.proxy.callbacks.onError.invoke(this, { err, errorKind: "ON_RESPONSE_END_ERROR", ctx: this.ctx, });
			//			return Promise.reject(err);
			//		}
			//		return this.ctx.proxyToClientResponse.end(chunk || undefined);
			//	});
			//});


			return this.proxy.callbacks.onResponseData.invoke(this.proxy, { ctx: this.ctx, chunk })
				.then((args) => {
					return this.proxy.callbacks.onResponseEnd.invoke(this.proxy, { ctx: this.ctx })
						.then((args) => {
							console.warn("ProxyFinalResponseFilter.end.write.actualEnd");
							return this.ctx.proxyToClientResponse.end(chunk);
						})
				})
				.catch((err) => {
					this.proxy.callbacks.onError.invoke(this, { err, errorKind: "ON_RESPONSE_END_ERROR", ctx: this.ctx, });
					return Promise.reject(err);
				})



		} else {

			console.warn("ProxyFinalResponseFilter.end.end");
			//return this.ctx._onResponseEnd(this.ctx, (err) => {
			//	if (err) {
			//		//return this.ctx._onError('ON_RESPONSE_END_ERROR', this.ctx, err);
			//		this.proxy.callbacks.onError.invoke(this, { err, errorKind: "ON_RESPONSE_END_ERROR", ctx: this.ctx, });
			//		return Promise.reject(err);
			//	}
			//	return this.ctx.proxyToClientResponse.end(chunk || undefined);
			//});
			return this.proxy.callbacks.onResponseEnd.invoke(this.proxy, { ctx: this.ctx })
				.then((args) => {
					console.warn("ProxyFinalResponseFilter.end.end.actualEnd");
					return this.ctx.proxyToClientResponse.end();
				}).catch((err) => {
					this.proxy.callbacks.onError.invoke(this, { err, errorKind: "ON_RESPONSE_END_ERROR", ctx: this.ctx, });
					return Promise.reject(err);
				})

		}
	};

};
//util.inherits(ProxyFinalResponseFilter, events.EventEmitter);



module utils {

	export function closeClientRequestWithError(ctx: IContext, err: Error, errorKind: string) {

		
		log.error("utils.closeClientRequestWithError() triggered.  If ctx exists, will close with 504 error.", { errorKind, err }, err);
		if (ctx != null) {
			if (ctx.proxyToClientResponse && !ctx.proxyToClientResponse.headersSent) {
				ctx.proxyToClientResponse.writeHead(504, 'Proxy Error');
			} else {
				log.warn("last utils.closeClientRequestWithError() triggered after already ctx headers sent", { errorKind, err });
			}
			if (ctx.proxyToClientResponse && !ctx.proxyToClientResponse.finished) {
				ctx.proxyToClientResponse.end('' + errorKind + ': ' + err, 'utf8');
			} else {
				log.warn("last utils.closeClientRequestWithError() triggered after already ctx is finished", { errorKind, err });
			}
		}

		log.warn("also abort other active connections, like serverToProxyRequest/Response");
		log.warn("also abort other active connections, like serverToProxyRequest/Response");
		log.warn("also abort other active connections, like serverToProxyRequest/Response");
		log.warn("also abort other active connections, like serverToProxyRequest/Response");
	}
	export function parseHostAndPort(req: http.IncomingMessage, defaultPort?: number) {
		var host = req.headers.host;
		if (!host) {
			return null;
		}
		var hostPort = parseHost(host, defaultPort);

		// this handles paths which include the full url. This could happen if it's a proxy
		var m = req.url.match(/^http:\/\/([^\/]*)\/?(.*)$/);
		if (m) {
			var parsedUrl = urlModule.parse(req.url);
			hostPort.host = parsedUrl.hostname;
			hostPort.port = parsedUrl.port;
			req.url = parsedUrl.path;
		}

		return hostPort;
	};

	export function parseHost(hostString, defaultPort) {
		var m = hostString.match(/^http:\/\/(.*)/);
		if (m) {
			var parsedUrl = urlModule.parse(hostString);
			return {
				host: parsedUrl.hostname,
				port: parsedUrl.port
			};
		}

		var hostPort = hostString.split(':');
		var host = hostPort[0];
		var port = hostPort.length === 2 ? +hostPort[1] : defaultPort;

		return {
			host: host,
			port: port
		};
	};

	export function filterAndCanonizeHeaders(originalHeaders) {
		var headers = {};
		for (var key in originalHeaders) {
			var canonizedKey = key.trim();
			if (/^public\-key\-pins/i.test(canonizedKey)) {
				// HPKP header => filter
				continue;
			}
			headers[canonizedKey] = originalHeaders[key];
		}
		return headers;
	};
}