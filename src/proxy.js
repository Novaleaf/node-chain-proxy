"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __assign = (this && this.__assign) || Object.assign || function(t) {
    for (var s, i = 1, n = arguments.length; i < n; i++) {
        s = arguments[i];
        for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
            t[p] = s[p];
    }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
var xlib = require("xlib");
//import slib = require("slib");
//import fsPromise = slib.file.fsPromise;
var _ = xlib.lodash;
var __ = xlib.lolo;
var Promise = xlib.promise.bluebird;
var log = new xlib.logging.Logger(__filename);
var async = require("async");
var net = require("net");
var http = require("http");
var https = require("https");
var fs = require("fs");
var path = require("path");
var events = require("events");
var WebSocket = require("ws");
var urlModule = require("url");
var semaphore = require("semaphore");
var ca = require("./ca");
var middleware;
(function (middleware) {
    middleware.gunzip = require('./middleware/gunzip');
    middleware.wildcard = require('./middleware/wildcard');
})(middleware = exports.middleware || (exports.middleware = {}));
/**
 * pipes a set of args through subscribed callbacks in a FIFO order.
invoker gets the final args transformed by all callbacks.
 */
var EventBroadcastPipe = (function () {
    function EventBroadcastPipe(name) {
        this.name = name;
        this._storage = [];
    }
    EventBroadcastPipe.prototype.subscribe = function (callback) {
        this._storage.push(callback);
    };
    EventBroadcastPipe.prototype.unsubscribe = function (callback) {
        return xlib.arrayHelper.removeFirst(this._storage, callback);
    };
    /**
     *  dispatch will be completed once all the subscribed callbacks  (executed in a sequential, FIFO order) have finished transforming the args.
    if any subscribed functions fail, the failure is returned immediately.
     * @param sender
     * @param args
     */
    EventBroadcastPipe.prototype.invoke = function (sender, initialArgs) {
        var _this = this;
        log.debug("start invoking " + xlib.reflection.getTypeName(this) + " " + this.name);
        return Promise.try(function () {
            var _looper = function (index, currentArgs) {
                return _this._storage[index](sender, currentArgs)
                    .then(function (resultingArgs) {
                    if (index === _this._storage.length - 1) {
                        return Promise.resolve(resultingArgs);
                    }
                    else {
                        return _looper(index + 1, resultingArgs);
                    }
                });
            };
            if (_this._storage.length === 0) {
                return Promise.resolve(initialArgs);
            }
            return _looper(0, initialArgs);
        }).finally(function () {
            log.debug("finish invoking " + xlib.reflection.getTypeName(_this) + " " + _this.name);
        });
    };
    return EventBroadcastPipe;
}());
exports.EventBroadcastPipe = EventBroadcastPipe;
/**
 *  like EventBroadcast but sends to the first subscribed callback (FIFO) and waits for it's Promise to resolve.
    if resolved success that value is returned to the invoker.
    otherwise (in the case of a failure) the next callback is tried.
 */
var EventBroadcastLimited = (function () {
    function EventBroadcastLimited(name) {
        this.name = name;
        this._storage = [];
    }
    EventBroadcastLimited.prototype.subscribe = function (callback) {
        this._storage.push(callback);
    };
    EventBroadcastLimited.prototype.unsubscribe = function (callback) {
        return xlib.arrayHelper.removeFirst(this._storage, callback);
    };
    /**
     *  dispatch will be completed once the first successfull subscribed function resolves (executed in a sequential, FIFO order)
    if all subscribed functions fail, the last failure is returned.
    if no subscribers are present, a resolved Promise with an undefined result is returned.
     * @param sender
     * @param args
     */
    EventBroadcastLimited.prototype.invoke = function (sender, args) {
        var _this = this;
        log.debug("start invoking " + xlib.reflection.getTypeName(this) + " " + this.name);
        return Promise.try(function () {
            var _looper = function (index) {
                return _this._storage[index](sender, args)
                    .catch(function (err) {
                    if (index === _this._storage.length - 1) {
                        return Promise.reject(err);
                    }
                    return _looper(index + 1);
                });
            };
            if (_this._storage.length === 0) {
                return Promise.resolve(undefined);
            }
            return _looper(0);
        }).finally(function () {
            log.debug("finish invoking " + xlib.reflection.getTypeName(_this) + " " + _this.name);
        });
    };
    return EventBroadcastLimited;
}());
exports.EventBroadcastLimited = EventBroadcastLimited;
/**
 *  round-trip event subscription system. (invoker sends message to subscribers, subscribers sends results to invoker)
 *
 */
var EventBroadcast = (function () {
    function EventBroadcast(name) {
        this.name = name;
        this._storage = [];
    }
    EventBroadcast.prototype.subscribe = function (callback) {
        this._storage.push(callback);
    };
    EventBroadcast.prototype.unsubscribe = function (callback) {
        return xlib.arrayHelper.removeFirst(this._storage, callback);
    };
    /**
     *  dispatch will not be completed until all subscriber functions resolve.
    if no subscribers are present, a resolved Promise with an empty array result is returned.
     * @param sender
     * @param args
     */
    EventBroadcast.prototype.invoke = function (sender, args) {
        var _this = this;
        log.debug("start invoking " + xlib.reflection.getTypeName(this) + " " + this.name);
        return Promise.try(function () {
            var results = [];
            _this._storage.forEach(function (callback) {
                var result = callback(sender, args);
                results.push(result);
            });
            var toReturn = Promise.all(results);
            return toReturn;
        }).finally(function () {
            log.debug("finish invoking " + xlib.reflection.getTypeName(_this) + " " + _this.name);
        });
    };
    return EventBroadcast;
}());
exports.EventBroadcast = EventBroadcast;
/**
 *  a one-directional event subscription system.  (subscribers don't impact invoker in any way)
 */
var ActionBroadcast = (function () {
    function ActionBroadcast(name) {
        this.name = name;
        this._storage = [];
    }
    ActionBroadcast.prototype.subscribe = function (callback) {
        this._storage.push(callback);
    };
    ActionBroadcast.prototype.unsubscribe = function (callback) {
        return xlib.arrayHelper.removeFirst(this._storage, callback);
    };
    /**
     * invokes all subscribed actions, in a LIFO fashion (last attached gets executed first)
     * @param sender
     * @param args
     */
    ActionBroadcast.prototype.invoke = function (sender, args) {
        log.debug("start invoking " + xlib.reflection.getTypeName(this) + " " + this.name);
        _.forEachRight(this._storage, function (callback) {
            callback(sender, args);
        });
        log.debug("finish invoking " + xlib.reflection.getTypeName(this) + " " + this.name);
    };
    return ActionBroadcast;
}());
exports.ActionBroadcast = ActionBroadcast;
var ProxyCallbacks = (function () {
    function ProxyCallbacks() {
        /** do not throw errors (or reject promises) from subscriber callbacks here, or it will disrupt internal proxy handling logic (see ```proxy.ctor.defaultCallbacks``` for details) */
        this.onError = new ActionBroadcast("onError");
        /** triggered when the context is created, before any other context specific events are triggered.
    check ctx.url.protocol to decide what events to bind.  http, https, or ws */
        this.onContextInitialize = new EventBroadcast("onContextInitialize");
        this.onWebSocketConnection = new EventBroadcast("onWebSocketConnection");
        this.onWebSocketFrame = new EventBroadcastPipe("onWebSocketFrame");
        this.onWebSocketSend = new EventBroadcastPipe("onWebSocketSend");
        this.onWebSocketMessage = new EventBroadcastPipe("onWebSocketMessage");
        /** do not throw errors (or reject promises) from subscriber callbacks here, or it will disrupt internal proxy handling logic (see ```proxy.ctor.defaultCallbacks``` for details) */
        this.onWebSocketClose = new EventBroadcastPipe("onWebSocketClose");
        this.onWebSocketError = new ActionBroadcast("onWebSocketError");
        this.onRequest = new EventBroadcast("onRequest");
        this.onRequestHeaders = new EventBroadcast("onRequestHeaders");
        this.onRequestData = new EventBroadcastPipe("onRequestData");
        this.onRequestEnd = new EventBroadcast("onRequestEnd");
        /** callback triggered by the ctx.proxyToServerRequest request when it's complete.   response is stored as ctx.serverToProxyResponse. */
        this.onResponse = new EventBroadcast("onResponse");
        this.onResponseHeaders = new EventBroadcast("onResponseHeaders");
        this.onResponseData = new EventBroadcastPipe("onResponseData");
        this.onResponseEnd = new EventBroadcast("onResponseEnd");
        /** allows retrying the request to upstream if desired (via the returned promise results), if so, the callbacks from ```onRequest``` onward will be retried.  */
        this.onProxyToUpstreamRequestError = new EventBroadcastLimited("onProxyToUpstreamRequestError");
        //proxy specific callbacks
        this.onConnect = new EventBroadcast("onConnect");
        this.onCertificateRequired = new EventBroadcastLimited("onCertificateRequired");
        this.onCertificateMissing = new EventBroadcastLimited("onCertificateMissing");
        //new handle authorization
        this.onAuth = new EventBroadcastLimited("onAuth");
        this.onContextDispose = new ActionBroadcast("onContextDispose");
    }
    return ProxyCallbacks;
}());
exports.ProxyCallbacks = ProxyCallbacks;
var ProxyBase = (function () {
    function ProxyBase() {
    }
    return ProxyBase;
}());
exports.ProxyBase = ProxyBase;
var ContextCallbacks = (function (_super) {
    __extends(ContextCallbacks, _super);
    function ContextCallbacks() {
        return _super !== null && _super.apply(this, arguments) || this;
    }
    return ContextCallbacks;
}(ProxyBase));
exports.ContextCallbacks = ContextCallbacks;
var Context = (function () {
    function Context(proxy) {
        this.proxy = proxy;
        /** how many attempts at connecting to upstream we have done.   can be greater than 1 if you hook ```proxy.callbacks.onProxyToUpstreamRequestError``` */
        this.proxyToUpstreamTries = 0;
        /** user defined tags, initially constructed in the proxy-internals.tx proxy.onRequest() callback, you can add what you like here.
         by default, will be undefined.  you can set it in your proxy.onRequest() callback*/
        this.tags = {};
        /** filters added by .addRequestFilter() */
        this.requestFilters = [];
        /** filters added by .addResponseFilter() */
        this.responseFilters = [];
        this.isDisposed = false;
        this.isClosed = false;
        this.lastError = undefined;
    }
    /**Adds a stream into the request body stream.
  
  Arguments
  
  stream - The read/write stream to add in the request body stream.
  Example
  
  ctx.addRequestFilter(zlib.createGunzip()); */
    Context.prototype.addRequestFilter = function (filter) {
        this.requestFilters.push(filter);
        return this;
    };
    /** Adds a stream into the response body stream.
  
  Arguments
  
  stream - The read/write stream to add in the response body stream.
  Example
  
  ctx.addResponseFilter(zlib.createGunzip()); */
    Context.prototype.addResponseFilter = function (filter) {
        this.responseFilters.push(filter);
        return this;
    };
    /**
     *  invoked internally (do not call this yourself!)
     */
    Context.prototype._dispose = function () {
        log.assert(this.isDisposed === false);
        this.isDisposed = true;
        this.clientToProxyRequest = undefined;
        this.clientToProxyWebSocket = undefined;
        this.proxyToClientResponse = undefined;
        this.proxyToServerRequest = undefined;
        this.proxyToServerRequestOptions = undefined;
        this.proxyToServerWebSocket = undefined;
        this.proxyToServerWebSocketOptions = undefined;
        this.requestFilters.length = 0;
        this.requestFilters = undefined;
        this.responseFilters.length = 0;
        this.responseFilters = undefined;
        this.serverToProxyResponse = undefined;
        this.tags = undefined;
    };
    return Context;
}());
exports.Context = Context;
///////////////////////////  END ICONTEXT CLASS
var Proxy = (function () {
    function Proxy(/** optional, override the default callbacks.  If you do this, be sure to call ```ctx.proxyToClientResponse.end()``` manually. */ defaultCallbacks) {
        var _this = this;
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
        this.callbacks = new ProxyCallbacks();
        this._attachedMods = [];
        if (defaultCallbacks == null) {
            //add our default callbacks.
            defaultCallbacks = new ProxyCallbacks();
            //if error detected, abort response with a 504 error.
            defaultCallbacks.onError.subscribe(function (sender, args) {
                if (args.ctx != null) {
                    utils.closeClientRequestWithErrorAndDispose(args.ctx, args.err, args.errorKind);
                }
            });
            defaultCallbacks.onContextDispose.subscribe(function (sender, args) {
                var ctx = args.ctx;
                log.assert(ctx.isDisposed === false);
                var downstreamComplete = new Promise(function (resolve) {
                    if (ctx.isClosed != true) {
                        log.assert(false, "why wasn't this closed yet?");
                        utils.closeClientRequestWithErrorAndDispose(ctx, new Error("context dispose and not yet closed"), "onContextDispose(), NOT_CLOSED");
                    }
                });
                //delete out everythign related to the context
                ctx._dispose();
            });
            //fork webSocketFrame messages for convenience.
            defaultCallbacks.onWebSocketFrame.subscribe(function (sender, args) {
                return Promise.try(function () {
                    if (_this.callbacks.onWebSocketSend._storage.length > 0 && args.fromServer !== true && args.type === "message") {
                        return _this.callbacks.onWebSocketSend.invoke(sender, args);
                    }
                    if (_this.callbacks.onWebSocketMessage._storage.length > 0 && args.fromServer === true && args.type === "message") {
                        return _this.callbacks.onWebSocketMessage.invoke(sender, args);
                    }
                    return Promise.resolve(args);
                }).then(function (args) {
                    //proxy.ts:522
                    var destWebSocket = args.fromServer ? args.ctx.clientToProxyWebSocket : args.ctx.proxyToServerWebSocket;
                    if (destWebSocket.readyState === WebSocket.OPEN) {
                        switch (args.type) {
                            case 'message':
                                destWebSocket.send(args.data, args.flags);
                                break;
                            case 'ping':
                                destWebSocket.ping(args.data, args.flags, false);
                                break;
                            case 'pong':
                                destWebSocket.pong(args.data, args.flags, false);
                                break;
                            default:
                                throw new xlib.exception.Exception("unknown websocket type \"" + args.type + "\" ", { data: { errorKind: "proxy.ctor.defaultCallbacks.onWebSocketFrame:pipe:error", args: args } });
                        }
                    }
                    else {
                        throw new xlib.exception.Exception('Cannot send ' + args.type + ' because ' + (args.fromServer ? 'clientToProxy' : 'proxyToServer') + ' WebSocket connection state is not OPEN', { data: { errorKind: "proxy.ctor.defaultCallbacks.onWebSocketFrame:pipe:error", args: args } });
                        //this.callbacks.onWebSocketError.invoke(this, { ctx: args.ctx, err: new Error('Cannot send ' + type + ' because ' + (fromServer ? 'clientToProxy' : 'proxyToServer') + ' WebSocket connection state is not OPEN'), errorKind:"proxy.ctor.defaultCallbacks.onWebSocketFrame:pipe:error" });
                    }
                    return args;
                });
            });
            var closeWebsocket_1 = function (ctx, code, data) {
                if (ctx.clientToProxyWebSocket.readyState !== ctx.proxyToServerWebSocket.readyState) {
                    if (ctx.clientToProxyWebSocket.readyState === WebSocket.CLOSED && ctx.proxyToServerWebSocket.readyState === WebSocket.OPEN) {
                        ctx.proxyToServerWebSocket.close(code, data);
                    }
                    else if (ctx.proxyToServerWebSocket.readyState === WebSocket.CLOSED && ctx.clientToProxyWebSocket.readyState === WebSocket.OPEN) {
                        ctx.clientToProxyWebSocket.close(code, data);
                    }
                }
            };
            defaultCallbacks.onWebSocketClose.subscribe(function (sender, args) {
                var ctx = args.ctx;
                if (!ctx.closedByServer && !ctx.closedByClient) {
                    ctx.closedByServer = args.closedByServer;
                    ctx.closedByClient = !args.closedByServer;
                    closeWebsocket_1(ctx, args.code, args.message);
                }
                else {
                    log.assert(false, "already closed, investigate and handle multiple calls to this fcn");
                }
                return Promise.resolve(args);
            });
            defaultCallbacks.onWebSocketError.subscribe(function (sender, args) {
                var ctx = args.ctx;
                log.error("proxy.defaultCallbacks.onWebSocketError", args);
                closeWebsocket_1(ctx);
            });
            defaultCallbacks.onCertificateRequired.subscribe(function (sender, args) {
                var hostname = args.hostname;
                return Promise.resolve({
                    keyFile: _this.sslCaDir + '/keys/' + hostname + '.key',
                    certFile: _this.sslCaDir + '/certs/' + hostname + '.pem',
                    hosts: [hostname]
                });
            });
            defaultCallbacks.onCertificateMissing.subscribe(function (sender, args) {
                var hosts = args.files.hosts || [args.info.hostname];
                return new Promise(function (resolve, reject) {
                    _this.ca.generateServerCertificateKeys(hosts, function (certPEM, privateKeyPEM) {
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
    Proxy.prototype.attachMod = function (mod) {
        var _this = this;
        //attach all callbacks from mod to our masterDispatcher
        _.forOwn(mod, function (dispatcher, key) {
            _.forEach(dispatcher._storage, function (callback) {
                log.info("attaching mod." + key + " to proxy._masterModDispatcher."); //  callback=`, dispatcher.);
                _this.callbacks[key].subscribe(callback);
            });
        });
        this._attachedMods.push(mod);
    };
    /** Starts the proxy listening on the given port..  example: proxy.listen({ port: 80 }); */
    Proxy.prototype.listen = function (options, callback) {
        var _this = this;
        if (options === void 0) { options = {}; }
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
        new ca.CA(this.sslCaDir, options.sslCaName, function (err, ca) {
            if (err) {
                if (callback == null) {
                    throw err;
                }
                return callback(err);
            }
            _this.ca = ca;
            _this.sslServers = {};
            _this.sslSemaphores = {};
            _this.httpServer = http.createServer();
            _this.httpServer.timeout = _this.timeout;
            //this.httpServer.on('error', this._onError.bind(this, 'HTTP_SERVER_ERROR'));
            _this.httpServer.on("error", function (err) { _this.callbacks.onError.invoke(_this, { err: err, errorKind: "proxy.httpServer.on('error')" }); });
            //this.httpServer.on('connect', this._onHttpServerConnect.bind(this));
            _this.httpServer.on("connect", function (req, socket, head, otherArg) {
                _this._onHttpServerConnect({ req: req, socket: socket, head: head, otherArg: otherArg, isSsl: false });
            });
            _this.httpServer.on('request', _this._onHttpServerRequest.bind(_this, false));
            _this.wsServer = new WebSocket.Server({ server: _this.httpServer });
            _this.wsServer.on('connection', _this._onWebSocketServerConnect.bind(_this, false));
            if (_this.forceSNI) {
                // start the single HTTPS server now
                _this._createHttpsServer({}, function (port, httpsServer, wssServer) {
                    if (!_this.silent) {
                        console.log('https server started on ' + port);
                    }
                    _this.httpsServer = httpsServer;
                    _this.wssServer = wssServer;
                    _this.httpsPort = port;
                    _this.httpServer.listen(_this.httpPort, callback);
                });
            }
            else {
                _this.httpServer.listen(_this.httpPort, callback);
            }
        });
        return this;
    };
    /**
     * creates a https server object and binds events for it.
     * @param options
     * @param callback
     */
    Proxy.prototype._createHttpsServer = function (options, callback) {
        var _this = this;
        var httpsServer = https.createServer(options);
        httpsServer.timeout = this.timeout; //exists: https://nodejs.org/api/https.html
        //httpsServer.on('error', this._onError.bind(this, 'HTTPS_SERVER_ERROR'));
        httpsServer.on("error", function (err) { _this.callbacks.onError.invoke(_this, { err: err, errorKind: "proxy.httpsServer.on('error')" }); });
        //httpsServer.on('clientError', this._onError.bind(this, 'HTTPS_CLIENT_ERROR'));
        httpsServer.on("error", function (err) { _this.callbacks.onError.invoke(_this, { err: err, errorKind: "proxy.httpsServer.on('clientError')" }); });
        //httpsServer.on('connect', this._onHttpServerConnect.bind(this));
        httpsServer.on("connect", function (req, socket, head, otherArg) {
            _this._onHttpServerConnect({ req: req, socket: socket, head: head, otherArg: otherArg, isSsl: true });
        });
        httpsServer.on('request', this._onHttpServerRequest.bind(this, true));
        var wssServer = new WebSocket.Server({ server: httpsServer });
        wssServer.on('connection', this._onWebSocketServerConnect.bind(this, true));
        var listenArgs = [function () {
                if (callback)
                    callback(httpsServer.address().port, httpsServer, wssServer);
            }];
        if (this.httpsPort && !options.hosts) {
            listenArgs.unshift(this.httpsPort);
        }
        httpsServer.listen.apply(httpsServer, listenArgs);
    };
    ;
    /** proxy.close
            Stops the proxy listening.
            
            Example
            
            proxy.close(); */
    Proxy.prototype.close = function () {
        var _this = this;
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
            (Object.keys(this.sslServers)).forEach(function (srvName) {
                var server = _this.sslServers[srvName].server;
                if (server)
                    server.close();
                delete _this.sslServers[srvName];
            });
        }
        return this;
    };
    ;
    ///**
    // * Add custom handler for CONNECT method
    // * @augments
    // *   - fn(req,socket,head,callback) be called on receiving CONNECT method
    // */
    //public onConnect(fn: (req: http.IncomingMessage, socket: net.Socket, head: any, callback: (error: Error | undefined) => void) => void) {
    //	this.onConnectHandlers.push(fn);
    //	return this;
    //};
    /**
     *  handle auth, if any callback for it is in place.
     * @param isSsl
     * @param head
     * @param req
     * @param socket
     * @param ctx
     */
    Proxy.prototype._handleAuth = function (args) {
        var _this = this;
        //handle auth
        return Promise.try(function () {
            //if (args.isSsl === false) {
            //	//http server, connect event won't send auth headers, need to do auth in the .onRequest event
            //	return Promise.resolve();
            //}
            //code based on checkin here: https://github.com/joeferner/node-http-mitm-proxy/commit/ac5f32961fa19a970270695b8e99913b07958525
            //and here: https://github.com/joeferner/node-http-mitm-proxy/commit/f657a9605baeda7c2678ab35808f7b2de1df59cb
            if (_this.callbacks.onAuth._storage.length === 0) {
                //no .onAuth() callbacks subscribed so ignore authentication
                return Promise.resolve();
            }
            //https, check for auth headers
            var head = args.head, req = args.req, socket = args.socket;
            if (req.headers["proxy-authorization"] == null) {
                // ctx.onResponseData((ctx,chunk,callback)=>{
                //     log.warn("NO AUTH  ctx.onResponseData",ctx, chunk.toString("utf8"));
                // })
                //writeHead docs: https://nodejs.org/api/http.html#http_response_writehead_statuscode_statusmessage_headers
                // ctx.proxyToClientResponse.writeHead(407,{"Proxy-authenticate":`Basic`});
                // ctx.proxyToClientResponse.end("No Auth!");
                //log.warn("HTTPS: NO AUTH!  rejecting in proxy.onConnect");
                //header pattern described here: https://gist.github.com/axefrog/3353609
                return Promise.reject(new Error("No Authentication Header Sent.")); //socket.end("HTTP/1.0 407 Proxy authentication required\nProxy-authenticate: Basic\r\n\r\nNoAuth!");
            }
            else {
                //not doing auth here, just making sure proper auth header is received.
                var authHeader = req.headers["proxy-authorization"];
                if (authHeader.indexOf("Basic ") !== 0) {
                    //return socket.end("HTTP/1.0 407 Proxy authentication required\nProxy-authenticate: Basic\r\n\r\nUnknown Auth type.  use Basic.");
                    return Promise.reject(new Error("Unknown Proxy Authentication type.  Use Basic."));
                }
                var toDecode = authHeader.substring("Basic ".length);
                var authDecoded = xlib.stringHelper.base64.decode(toDecode);
                // log.info("got auth for", {
                //     url: req.url,
                //     authDecoded,
                //     remote: req.connection.remoteAddress,
                //     remotePort: req.connection.remotePort,
                //     host: req.headers["host"],
                //     headers: req.headers,
                //     //test: req.connection.address(), req 
                // });
                // // // //log.warn("GOT AUTH!", { auth: req.headers["proxy-authorization"], authDecoded });
                //log.warn("GOT AUTH", (req.connection as any));
                //return config.onAuth(authDecoded, req);
                //return Promise.resolve();
                return _this.callbacks.onAuth.invoke(_this, __assign({ authPayload: authDecoded }, args));
            }
        }).catch(function (err) {
            var head = args.head, req = args.req, socket = args.socket;
            //log.error("onConnect auth processing error, sending error back to user",{err});
            socket.end("HTTP/1.0 407 Proxy authentication required\nProxy-authenticate: Basic\r\n\r\nError. " + err.message);
            err.isHandled = true;
            //callback(err);
            //return Promise.resolve();
            return Promise.reject(err);
        });
    };
    /**
     *  bound event to http(s) server connect events
     * @param args
     */
    Proxy.prototype._onHttpServerConnect = function (args) {
        var _this = this;
        log.warn("_onHttpServerConnect ", args.req.url);
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
        this.callbacks.onConnect.invoke(this, args)
            .then(function () {
            //handle auth, if any callback for it is in place.
            return _this._handleAuth(args);
        })
            .then(function () {
            var head = args.head, req = args.req, socket = args.socket;
            // we need first byte of data to detect if request is SSL encrypted
            if (!head || head.length === 0) {
                socket.once('data', _this._onHttpServerConnectData.bind(_this, req, socket));
                //socket.on("data", (req, socket) => {
                //	//JASONS HACK: test listening to https socket
                //	log.warn("socket.on.data...");//, { req, socket });
                //})
                socket.write('HTTP/1.1 200 OK\r\n');
                if (_this.keepAlive && req.headers['proxy-connection'] === 'keep-alive') {
                    socket.write('Proxy-Connection: keep-alive\r\n');
                    socket.write('Connection: keep-alive\r\n');
                }
                return socket.write('\r\n');
            }
            else {
                return _this._onHttpServerConnectData(req, socket, head);
            }
        })
            .catch(function (err) {
            _this.callbacks.onError.invoke(_this, { err: err, errorKind: "proxy._masterModDispatcher.onConnect() --> error", data: args });
            //return Promise.reject(err);
        });
    };
    Proxy.prototype._onHttpServerConnectData = function (req, socket, head) {
        var _this = this;
        //var this = this;
        log.warn("_onHttpServerConnectData about to pause socket", req.url);
        socket.pause();
        var makeConnection = function (port) {
            log.warn("about to makeConnection (net.connect and bind error and then tunnel)");
            // open a TCP connection to the remote host
            var conn = net.connect(port, function () {
                log.warn("net.connect made, about to tunnel", req.url); //{ port, conn, socket , req, head});
                // create a tunnel between the two hosts
                socket.pipe(conn);
                conn.pipe(socket);
                socket.emit('data', head);
                return socket.resume();
            });
            //conn.on('error', this._onError.bind(this, 'PROXY_TO_PROXY_SOCKET_ERROR'));
            conn.on("error", function (err) { _this.callbacks.onError.invoke(_this, { err: err, errorKind: "PROXY_TO_PROXY_SOCKET_ERROR", data: { port: port } }); });
        };
        var getHttpsServer = function (hostname, callback) {
            //this.onCertificateRequired(hostname, (err, files) => {
            return _this.callbacks.onCertificateRequired.invoke(_this, { hostname: hostname })
                .then(function (files) {
                log.warn("looking for https server for ", files);
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
                    'httpsOptions': ['keyFileExists', 'certFileExists', function (data, callback) {
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
                            }
                            else {
                                var info = {
                                    'hostname': hostname,
                                    'files': files,
                                    'data': data
                                };
                                return _this.callbacks.onCertificateMissing.invoke(_this, { info: info, files: files })
                                    .then(function (certData) {
                                    return callback(null, {
                                        key: certData.keyFileData,
                                        cert: certData.certFileData,
                                        hosts: certData.hosts
                                    });
                                })
                                    .catch(function (err) {
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
                }, undefined, function (err, results) {
                    if (err) {
                        return callback(err);
                    }
                    var hosts;
                    if (results.httpsOptions && results.httpsOptions.hosts && results.httpsOptions.hosts.length) {
                        hosts = results.httpsOptions.hosts;
                        if (hosts.indexOf(hostname) === -1) {
                            hosts.push(hostname);
                        }
                    }
                    else {
                        hosts = [hostname];
                    }
                    delete results.httpsOptions.hosts;
                    if (_this.forceSNI && !hostname.match(/^[\d\.]+$/)) {
                        if (!_this.silent) {
                            console.log('creating SNI context for ' + hostname);
                        }
                        hosts.forEach(function (host) {
                            _this.httpsServer.addContext(host, results.httpsOptions);
                            _this.sslServers[host] = { port: _this.httpsPort };
                        });
                        return callback(null, _this.httpsPort);
                    }
                    else {
                        if (!_this.silent) {
                            console.log('starting server for ' + hostname);
                        }
                        results.httpsOptions.hosts = hosts;
                        _this._createHttpsServer(results.httpsOptions, function (port, httpsServer, wssServer) {
                            if (!_this.silent) {
                                console.log('https server started for %s on %s', hostname, port);
                            }
                            var sslServer = {
                                server: httpsServer,
                                wsServer: wssServer,
                                port: port
                            };
                            hosts.forEach(function (host) {
                                _this.sslServers[hostname] = sslServer;
                            });
                            return callback(null, port);
                        });
                    }
                });
            });
        };
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
            sem.take(function () {
                if (_this.sslServers[hostname]) {
                    process.nextTick(sem.leave.bind(sem));
                    return makeConnection(_this.sslServers[hostname].port);
                }
                if (_this.sslServers[wilcardHost]) {
                    process.nextTick(sem.leave.bind(sem));
                    _this.sslServers[hostname] = {
                        port: _this.sslServers[wilcardHost]
                    };
                    return makeConnection(_this.sslServers[hostname].port);
                }
                getHttpsServer(hostname, function (err, port) {
                    log.warn("got port for https server, about to make connection", { err: err, port: port });
                    process.nextTick(sem.leave.bind(sem));
                    if (err) {
                        //return this._onError('OPEN_HTTPS_SERVER_ERROR', err);
                        return _this.callbacks.onError.invoke(_this, { err: err, errorKind: "OPEN_HTTPS_SERVER_ERROR", data: { req: req, socket: socket, head: head } });
                    }
                    return makeConnection(port);
                });
            });
        }
        else {
            log.warn("about to make connection for http server", { port: this.httpPort });
            return makeConnection(this.httpPort);
        }
    };
    ;
    //public onCertificateRequired(hostname: string, callback: (error: Error | undefined, certDetails: ICertificatePaths) => void) {
    //	//var this = this;
    //	callback(null, {
    //		keyFile: this.sslCaDir + '/keys/' + hostname + '.key',
    //		certFile: this.sslCaDir + '/certs/' + hostname + '.pem',
    //		hosts: [hostname]
    //	});
    //	return this;
    //};
    Proxy.prototype.onCertificateMissing = function (info, files, callback) {
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
    ;
    /**
     *  initial handshake for websocket connections
     * @param isSSL
     * @param ws
     */
    Proxy.prototype._onWebSocketServerConnect = function (isSSL, ws) {
        //var this = this;
        var _this = this;
        var ctx = new Context();
        ctx.isSSL = isSSL;
        ctx.clientToProxyWebSocket = ws;
        ctx.clientToProxyWebSocket.pause();
        var url;
        if (ctx.clientToProxyWebSocket.upgradeReq.url == '' || /^\//.test(ctx.clientToProxyWebSocket.upgradeReq.url)) {
            var hostPort = utils.parseHostAndPort(ctx.clientToProxyWebSocket.upgradeReq);
            url = (ctx.isSSL ? 'wss' : 'ws') + '://' + hostPort.host + (hostPort.port ? ':' + hostPort.port : '') + ctx.clientToProxyWebSocket.upgradeReq.url;
        }
        else {
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
        return this.callbacks.onContextInitialize.invoke(this, { ctx: ctx })
            .then(function () {
            //ctx.clientToProxyWebSocket.on('message', ctx._onWebSocketFrame.bind(ctx, ctx, 'message', false));
            //ctx.clientToProxyWebSocket.on('ping', ctx._onWebSocketFrame.bind(ctx, ctx, 'ping', false));
            //ctx.clientToProxyWebSocket.on('pong', ctx._onWebSocketFrame.bind(ctx, ctx, 'pong', false));
            //ctx.clientToProxyWebSocket.on('error', ctx._onWebSocketError.bind(ctx, ctx));
            //ctx.clientToProxyWebSocket.on('close', ctx._onWebSocketClose.bind(ctx, ctx, false));
            ctx.clientToProxyWebSocket.on('message', function (data, flags) { _this.callbacks.onWebSocketFrame.invoke(ctx.clientToProxyWebSocket, { ctx: ctx, type: "message", fromServer: false, flags: flags, data: data }); });
            ctx.clientToProxyWebSocket.on('ping', function (data, flags) { _this.callbacks.onWebSocketFrame.invoke(ctx.clientToProxyWebSocket, { ctx: ctx, type: "ping", fromServer: false, flags: flags, data: data }); });
            ctx.clientToProxyWebSocket.on('pong', function (data, flags) { _this.callbacks.onWebSocketFrame.invoke(ctx.clientToProxyWebSocket, { ctx: ctx, type: "pong", fromServer: false, flags: flags, data: data }); });
            ctx.clientToProxyWebSocket.on('error', function (err) { _this.callbacks.onWebSocketError.invoke(ctx.clientToProxyWebSocket, { ctx: ctx, err: err, errorKind: "ctx.clientToProxyWebSocket.on('error')" }); });
            ctx.clientToProxyWebSocket.on('close', function (code, message) { _this.callbacks.onWebSocketClose.invoke(ctx.clientToProxyWebSocket, { ctx: ctx, closedByServer: false, code: code, message: message }); });
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
            _this.callbacks.onWebSocketConnection.invoke(_this, { ctx: ctx })
                .then(function () {
                ctx.proxyToServerWebSocket = new WebSocket(ctx.proxyToServerWebSocketOptions.url, ctx.proxyToServerWebSocketOptions);
                ctx.proxyToServerWebSocket.on('message', function (data, flags) { _this.callbacks.onWebSocketFrame.invoke(ctx.proxyToServerWebSocket, { ctx: ctx, type: "message", fromServer: true, flags: flags, data: data }); });
                ctx.proxyToServerWebSocket.on('ping', function (data, flags) { _this.callbacks.onWebSocketFrame.invoke(ctx.proxyToServerWebSocket, { ctx: ctx, type: "ping", fromServer: true, flags: flags, data: data }); });
                ctx.proxyToServerWebSocket.on('pong', function (data, flags) { _this.callbacks.onWebSocketFrame.invoke(ctx.proxyToServerWebSocket, { ctx: ctx, type: "pong", fromServer: true, flags: flags, data: data }); });
                ctx.proxyToServerWebSocket.on('error', function (err) { _this.callbacks.onWebSocketError.invoke(ctx.proxyToServerWebSocket, { ctx: ctx, err: err, errorKind: "ctx.proxyToServerWebSocket.on('error')" }); });
                ctx.proxyToServerWebSocket.on('close', function (code, message) { _this.callbacks.onWebSocketClose.invoke(ctx.proxyToServerWebSocket, { ctx: ctx, closedByServer: true, code: code, message: message }); });
                ctx.proxyToServerWebSocket.on('open', function () {
                    if (ctx.clientToProxyWebSocket.readyState === WebSocket.OPEN) {
                        ctx.clientToProxyWebSocket.resume();
                    }
                });
            });
        });
    };
    Proxy.prototype._onHttpServerRequest = function (isSSL, clientToProxyRequest, proxyToClientResponse) {
        //var this = this;
        var _this = this;
        var ctx = new Context();
        ctx.isSSL = isSSL;
        ctx.clientToProxyRequest = clientToProxyRequest;
        ctx.proxyToClientResponse = proxyToClientResponse;
        try {
            var protocol = ctx.isSSL === true ? "https" : "http";
            var href = protocol + "://" + ctx.clientToProxyRequest.headers["host"] + ctx.clientToProxyRequest.url;
            ctx.url = urlModule.parse(href, true, true);
        }
        catch (ex) {
            //ignore / eat errors
        }
        ctx.clientToProxyRequest.pause();
        //////apply mods
        //this.mods.forEach((mod) => {
        //	ctx.use(mod);
        //});
        return this.callbacks.onContextInitialize.invoke(this, { ctx: ctx })
            .then(function () {
            //ctx.clientToProxyRequest.on('error', ctx._onError.bind(ctx, 'CLIENT_TO_PROXY_REQUEST_ERROR', ctx));
            ctx.clientToProxyRequest.on("error", function (err) { _this.callbacks.onError.invoke(_this, { err: err, errorKind: "CLIENT_TO_PROXY_REQUEST_ERROR", ctx: ctx }); });
            //ctx.proxyToClientResponse.on('error', ctx._onError.bind(ctx, 'PROXY_TO_CLIENT_RESPONSE_ERROR', ctx));
            ctx.proxyToClientResponse.on("error", function (err) { _this.callbacks.onError.invoke(_this, { err: err, errorKind: "PROXY_TO_CLIENT_RESPONSE_ERROR", ctx: ctx }); });
            //ctx.clientToProxyRequest.on("close", () => { this.callbacks.onError.invoke(this, { err: new Error("client prematurely closed the connection"), errorKind: "CLIENT_TO_PROXY_REQUEST_CLOSE", ctx }); });
            //ctx.clientToProxyRequest.on("end", (...args: any[]) => { log.error("ctx.clientToProxyRequest.on.end", args); });
            var hostPort = utils.parseHostAndPort(ctx.clientToProxyRequest, ctx.isSSL ? 443 : 80);
            var headers = {};
            for (var h in ctx.clientToProxyRequest.headers) {
                // don't forward proxy- headers
                if (!/^proxy\-/i.test(h)) {
                    //console.log(`testing and pass ${h}`);
                    headers[h] = ctx.clientToProxyRequest.headers[h];
                }
                else {
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
                agent: ctx.isSSL ? _this.httpsAgent : _this.httpAgent
            };
            //JASON EDIT: wrapping this._onRequest in a function to make recallable when upstream proxy errors.
            var callOnRequestHandlersThenMakeProxyRequest = function () {
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
                return _this.callbacks.onRequest.invoke(_this, { ctx: ctx })
                    .then(function () {
                    return _this.callbacks.onRequestHeaders.invoke(_this, { ctx: ctx });
                })
                    .then(function () {
                    //makeProxyToServerRequest() logic
                    var proto = (ctx.isSSL ? https : http);
                    ctx.proxyToServerRequest = proto.request(ctx.proxyToServerRequestOptions, proxyToServerResponseStarted);
                    //JASON EDIT: wacky binding scheme to simply call our new handleProxyToServerRequestError() function
                    //ctx.proxyToServerRequest.on('error', handleProxyToServerRequestError.bind(this, 'PROXY_TO_SERVER_REQUEST_ERROR', ctx));
                    ctx.proxyToServerRequest.on("error", function (err) {
                        //handleProxyToServerRequestError() logic
                        return _this.callbacks.onProxyToUpstreamRequestError.invoke(ctx.proxyToServerRequest, { ctx: ctx, err: err })
                            .then(function (onUpstreamErrorResults) {
                            if (onUpstreamErrorResults != null && onUpstreamErrorResults.retry === true) {
                                //retry logic
                                ctx.proxyToServerRequest.abort();
                                return callOnRequestHandlersThenMakeProxyRequest();
                            }
                            else {
                                //throw failure so we abort the request
                                return Promise.reject(new xlib.exception.Exception("onProxyToUpstreamRequestError with no retry", { innerException: err }));
                            }
                        }).catch(function (err) {
                            //failure logic
                            _this.callbacks.onError.invoke(_this, { err: err, errorKind: "PROXY_TO_SERVER_REQUEST_ERROR", ctx: ctx, });
                            //return Promise.reject(err);  //dont error otherwise it's unhandled.
                        });
                    });
                    //JASON EDIT: hack because we recall this, don't want stale "ProxyFinalRequestFilter" from our last call to makeProxyToServerRequest() (previous proxy attempt)
                    //ctx.requestFilters.push(new ProxyFinalRequestFilter(this, ctx));
                    var proxyFinalRequestFilter = new ProxyFinalRequestFilter(_this, ctx);
                    var prevRequestPipeElem = ctx.clientToProxyRequest;
                    ctx.requestFilters.forEach(function (filter) {
                        //filter.on('error', ctx._onError.bind(ctx, 'REQUEST_FILTER_ERROR', ctx));
                        filter.on("error", function (err) { _this.callbacks.onError.invoke(filter, { err: err, errorKind: "REQUEST_FILTER_ERROR", ctx: ctx }); });
                        try {
                            prevRequestPipeElem = prevRequestPipeElem.pipe(filter);
                        }
                        catch (ex) {
                            console.log("why error oh WHY?!?!?", ex, prevRequestPipeElem.pipe, prevRequestPipeElem);
                        }
                    });
                    //JASON EDIT: hack because we recall this, don't want stale "ProxyFinalRequestFilter" from our last call to makeProxyToServerRequest() (previous proxy attempt)
                    try {
                        prevRequestPipeElem.pipe(proxyFinalRequestFilter); //JASON HACK:  pipe mismatch typings for .end function
                    }
                    catch (ex) {
                        console.log("why error oh WHY DEUX?!?!?", ex, prevRequestPipeElem.pipe, prevRequestPipeElem);
                    }
                    ctx.clientToProxyRequest.resume();
                });
            };
            /**
             *  callback triggered by the ctx.proxyToServerRequest request when it starts getting a response from the upstream server.   response is stored as ctx.serverToProxyResponse.
             * @param serverToProxyResponse
             */
            var proxyToServerResponseStarted = function (serverToProxyResponse) {
                //serverToProxyResponse.on('error', ctx._onError.bind(ctx, 'SERVER_TO_PROXY_RESPONSE_ERROR', ctx));
                serverToProxyResponse.on("error", function (err) { _this.callbacks.onError.invoke(_this, { err: err, errorKind: "SERVER_TO_PROXY_RESPONSE_ERROR", ctx: ctx }); });
                console.warn("ctx.serverToProxyResponse.pause();");
                serverToProxyResponse.pause();
                ctx.serverToProxyResponse = serverToProxyResponse;
                return _this.callbacks.onResponse.invoke(_this, { ctx: ctx })
                    .catch(function (err) {
                    _this.callbacks.onError.invoke(_this, { err: err, errorKind: "ON_RESPONSE_ERROR", ctx: ctx, });
                    return Promise.reject(err);
                })
                    .then(function () {
                    //maniupate our response from upstream and pipe it to the client
                    ctx.serverToProxyResponse.headers['transfer-encoding'] = 'chunked';
                    delete ctx.serverToProxyResponse.headers['content-length'];
                    if (_this.keepAlive) {
                        if (ctx.clientToProxyRequest.headers['proxy-connection']) {
                            ctx.serverToProxyResponse.headers['proxy-connection'] = 'keep-alive';
                            ctx.serverToProxyResponse.headers['connection'] = 'keep-alive';
                        }
                    }
                    else {
                        ctx.serverToProxyResponse.headers['connection'] = 'close';
                    }
                    return _this.callbacks.onResponseHeaders.invoke(_this, { ctx: ctx })
                        .catch(function (err) {
                        _this.callbacks.onError.invoke(_this, { err: err, errorKind: "ON_RESPONSEHEADERS_ERROR", ctx: ctx, });
                        return Promise.reject(err);
                    })
                        .then(function () {
                        //send headers and statusCode from upstream to client
                        log.assert(ctx.proxyToClientResponse.headersSent === false, "headers already sent before upstream can set, why?");
                        ctx.proxyToClientResponse.writeHead(ctx.serverToProxyResponse.statusCode, utils.filterAndCanonizeHeaders(ctx.serverToProxyResponse.headers));
                        ctx.responseFilters.push(new ProxyFinalResponseFilter(_this, ctx));
                        var prevResponsePipeElem = ctx.serverToProxyResponse;
                        ctx.responseFilters.forEach(function (filter) {
                            //filter.on('error', ctx._onError.bind(ctx, 'RESPONSE_FILTER_ERROR', ctx));
                            filter.on("error", function (err) { _this.callbacks.onError.invoke(_this, { err: err, errorKind: "RESPONSE_FILTER_ERROR", ctx: ctx }); });
                            prevResponsePipeElem = prevResponsePipeElem.pipe(filter);
                        });
                        console.warn("ctx.serverToProxyResponse.resume();");
                        return ctx.serverToProxyResponse.resume();
                    });
                });
            };
            return callOnRequestHandlersThenMakeProxyRequest();
        });
    };
    return Proxy;
}());
exports.Proxy = Proxy;
var ProxyFinalRequestFilter = (function (_super) {
    __extends(ProxyFinalRequestFilter, _super);
    function ProxyFinalRequestFilter(proxy, ctx) {
        var _this = _super.call(this) || this;
        _this.proxy = proxy;
        _this.ctx = ctx;
        _this.currentExecution = Promise.resolve();
        events.EventEmitter.call(_this);
        _this.writable = true;
        return _this;
    }
    ProxyFinalRequestFilter.prototype.write = function (chunk) {
        ////const this = this;
        //this.ctx._onRequestData(this.ctx, chunk, (err, chunk) => {
        //	if (err) {
        //		//return this.ctx._onError('ON_REQUEST_DATA_ERROR', this.ctx, err);
        //		this.proxy.callbacks.onError.invoke(this, { err, errorKind: "ON_REQUEST_DATA_ERROR", ctx: this.ctx, });
        var _this = this;
        //		return Promise.reject(err);
        //	}
        //	if (chunk) {
        //		return this.ctx.proxyToServerRequest.write(chunk);
        //	}
        //});
        console.warn("ProxyFinalRequestFilter.write.attachPromise");
        this.currentExecution = this.currentExecution.then(function () {
            console.warn("ProxyFinalRequestFilter.write");
            return _this.proxy.callbacks.onRequestData.invoke(_this.proxy, { ctx: _this.ctx, chunk: chunk })
                .then(function (args) {
                if (args.chunk) {
                    return args.ctx.proxyToServerRequest.write(args.chunk);
                }
            })
                .catch(function (err) {
                _this.proxy.callbacks.onError.invoke(_this, { err: err, errorKind: "ON_REQUEST_DATA_ERROR", ctx: _this.ctx, });
                return Promise.reject(err);
            });
        });
        return true;
    };
    ;
    ProxyFinalRequestFilter.prototype.close = function () {
        var _this = this;
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        ctx.clientToProxyRequest.on("close", function () { _this.callbacks.onError.invoke(_this, { err: new Error("client prematurely closed the connection"), errorKind: "CLIENT_TO_PROXY_REQUEST_CLOSE", ctx: ctx }); });
    };
    ProxyFinalRequestFilter.prototype.end = function (chunk) {
        var _this = this;
        console.warn("ProxyFinalRequestFilter.end.attachPromise");
        this.currentExecution = this.currentExecution.then(function () {
            console.warn("ProxyFinalRequestFilter.end.write");
            return Promise.try(function () {
                if (chunk != null) {
                    //if end had a chunk, do our normal request-data workflow firstly
                    return _this.proxy.callbacks.onRequestData.invoke(_this.proxy, { ctx: _this.ctx, chunk: chunk });
                }
            })
                .then(function () {
                return _this.proxy.callbacks.onRequestEnd.invoke(_this.proxy, { ctx: _this.ctx });
            }).catch(function (err) {
                _this.proxy.callbacks.onError.invoke(_this, { err: err, errorKind: "ON_REQUEST_END_ERROR", ctx: _this.ctx, });
                return Promise.reject(err);
            });
            ////////const this = this;
            //////if (chunk) {
            //////	console.warn("ProxyFinalRequestFilter.end.write");
            //////	//return this.ctx._onRequestData(this.ctx, chunk, (err, chunk) => {
            //////	//	if (err) {
            //////	//		//return this.ctx._onError('ON_REQUEST_DATA_ERROR', this.ctx, err);
            //////	//		this.proxy.callbacks.onError.invoke(this, { err, errorKind: "ON_REQUEST_DATA_ERROR", ctx: this.ctx, });
            //////	//		return Promise.reject(err);
            //////	//	}
            //////	//	return this.ctx._onRequestEnd(this.ctx, (err) => {
            //////	//		if (err) {
            //////	//			//return this.ctx._onError('ON_REQUEST_END_ERROR', this.ctx, err);
            //////	//			this.proxy.callbacks.onError.invoke(this, { err, errorKind: "ON_REQUEST_END_ERROR", ctx: this.ctx, });
            //////	//			return Promise.reject(err);
            //////	//		}
            //////	//		return this.ctx.proxyToServerRequest.end(chunk);
            //////	//	});
            //////	//});
            //////	return this.proxy.callbacks.onRequestData.invoke(this.proxy, { ctx: this.ctx, chunk })
            //////		.then((args) => {
            //////			return this.proxy.callbacks.onRequestEnd.invoke(this.proxy, { ctx: this.ctx })
            //////				.then((args) => {
            //////					return new Promise((resolve) => { this.ctx.proxyToServerRequest.end(chunk, resolve); });
            //////				})
            //////		})
            //////		.catch((err) => {
            //////			this.proxy.callbacks.onError.invoke(this, { err, errorKind: "ON_REQUEST_END_ERROR", ctx: this.ctx, });
            //////			return Promise.reject(err);
            //////		})
            //////} else {
            //////	console.warn("ProxyFinalRequestFilter.end.end");
            //////	//return this.ctx._onRequestEnd(this.ctx, (err) => {
            //////	//	if (err) {
            //////	//		//return this.ctx._onError('ON_REQUEST_END_ERROR', this.ctx, err);
            //////	//		this.proxy.callbacks.onError.invoke(this, { err, errorKind: "ON_REQUEST_END_ERROR", ctx: this.ctx, });
            //////	//		return Promise.reject(err);
            //////	//	}
            //////	//	return this.ctx.proxyToServerRequest.end(chunk || undefined);
            //////	//});
            //////	return this.proxy.callbacks.onRequestEnd.invoke(this.proxy, { ctx: this.ctx })
            //////		.then((args) => {
            //////			return new Promise((resolve) => { this.ctx.proxyToServerRequest.end(undefined, resolve); });
            //////		}).catch((err) => {
            //////			this.proxy.callbacks.onError.invoke(this, { err, errorKind: "ON_REQUEST_END_ERROR", ctx: this.ctx, });
            //////			return Promise.reject(err);
            //////		})
            //////}
        });
    };
    ;
    return ProxyFinalRequestFilter;
}(events.EventEmitter));
var ProxyFinalResponseFilter = (function (_super) {
    __extends(ProxyFinalResponseFilter, _super);
    function ProxyFinalResponseFilter(proxy, ctx) {
        var _this = _super.call(this) || this;
        _this.proxy = proxy;
        _this.ctx = ctx;
        /** acts as a semaphore, restricting execution to 1 code path at a time */
        _this.currentExecution = Promise.resolve();
        events.EventEmitter.call(_this);
        _this.writable = true;
        return _this;
    }
    ProxyFinalResponseFilter.prototype.write = function (chunk) {
        var _this = this;
        console.warn("ProxyFinalResponseFilter.write.attachPromise");
        this.currentExecution = this.currentExecution.then(function () {
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
            return _this.proxy.callbacks.onResponseData.invoke(_this.proxy, { ctx: _this.ctx, chunk: chunk })
                .then(function (args) {
                if (args.chunk) {
                    console.warn("ProxyFinalResponseFilter.write.actualWrite");
                    return args.ctx.proxyToClientResponse.write(args.chunk);
                }
            })
                .catch(function (err) {
                _this.proxy.callbacks.onError.invoke(_this, { err: err, errorKind: "ON_RESPONSE_DATA_ERROR", ctx: _this.ctx, });
                return Promise.reject(err);
            });
        });
        return true;
    };
    ;
    ProxyFinalResponseFilter.prototype.end = function (chunk) {
        //const this = this;
        var _this = this;
        console.warn("ProxyFinalResponseFilter.end.attachPromise");
        this.currentExecution = this.currentExecution.then(function () {
            console.warn("ProxyFinalResponseFilter.end.write");
            return Promise.try(function () {
                //if end had a chunk, do our normal response-data workflow firstly
                if (chunk != null) {
                    return _this.proxy.callbacks.onResponseData.invoke(_this.proxy, { ctx: _this.ctx, chunk: chunk });
                }
            })
                .then(function () {
                return _this.proxy.callbacks.onResponseEnd.invoke(_this.proxy, { ctx: _this.ctx });
            })
                .then(function () {
                console.warn("ProxyFinalResponseFilter.end.write.actualEnd");
                return utils.closeClientRequestAndDispose({
                    ctx: _this.ctx
                });
            })
                .catch(function (err) {
                _this.proxy.callbacks.onError.invoke(_this, { err: err, errorKind: "ON_RESPONSE_END_ERROR", ctx: _this.ctx, });
                return Promise.reject(err);
            });
            //.then(() => {
            //	return this.proxy.callbacks.onContextDispose.invoke(this, { ctx: this.ctx });
            //})
            //if (chunk) {
            //	console.warn("ProxyFinalResponseFilter.end.write");
            //	//return this.ctx._onResponseData(this.ctx, chunk, (err, chunk) => {
            //	//	if (err) {
            //	//		//return this.ctx._onError('ON_RESPONSE_DATA_ERROR', this.ctx, err);
            //	//		this.proxy.callbacks.onError.invoke(this, { err, errorKind: "ON_RESPONSE_DATA_ERROR", ctx: this.ctx, });
            //	//		return Promise.reject(err);
            //	//	}
            //	//	return this.ctx._onResponseEnd(this.ctx, (err) => {
            //	//		if (err) {
            //	//			//return this.ctx._onError('ON_RESPONSE_END_ERROR', this.ctx, err);
            //	//			this.proxy.callbacks.onError.invoke(this, { err, errorKind: "ON_RESPONSE_END_ERROR", ctx: this.ctx, });
            //	//			return Promise.reject(err);
            //	//		}
            //	//		return this.ctx.proxyToClientResponse.end(chunk || undefined);
            //	//	});
            //	//});
            //	return this.proxy.callbacks.onResponseData.invoke(this.proxy, { ctx: this.ctx, chunk })
            //		.then((args) => {
            //			return this.proxy.callbacks.onResponseEnd.invoke(this.proxy, { ctx: this.ctx })
            //				.then((args) => {
            //					console.warn("ProxyFinalResponseFilter.end.write.actualEnd");
            //					return new Promise((resolve) => {
            //						this.ctx.proxyToClientResponse.end(chunk, resolve);
            //					});
            //				})
            //		})
            //		.catch((err) => {
            //			this.proxy.callbacks.onError.invoke(this, { err, errorKind: "ON_RESPONSE_END_ERROR", ctx: this.ctx, });
            //			return Promise.reject(err);
            //		})
            //} else {
            //	console.warn("ProxyFinalResponseFilter.end.end");
            //	//return this.ctx._onResponseEnd(this.ctx, (err) => {
            //	//	if (err) {
            //	//		//return this.ctx._onError('ON_RESPONSE_END_ERROR', this.ctx, err);
            //	//		this.proxy.callbacks.onError.invoke(this, { err, errorKind: "ON_RESPONSE_END_ERROR", ctx: this.ctx, });
            //	//		return Promise.reject(err);
            //	//	}
            //	//	return this.ctx.proxyToClientResponse.end(chunk || undefined);
            //	//});
            //	return this.proxy.callbacks.onResponseEnd.invoke(this.proxy, { ctx: this.ctx })
            //		.then((args) => {
            //			console.warn("ProxyFinalResponseFilter.end.end.actualEnd");
            //			return new Promise((resolve, reject) => {
            //				this.ctx.proxyToClientResponse.end(undefined, resolve);
            //			});
            //		}).catch((err) => {
            //			this.proxy.callbacks.onError.invoke(this, { err, errorKind: "ON_RESPONSE_END_ERROR", ctx: this.ctx, });
            //			//return Promise.reject(err);
            //		})
            //		.finally(() => {
            //			if (this.ctx.isDisposed !== true) {
            //				return this.proxy.callbacks.onContextDispose.invoke(this, { ctx: this.ctx });
            //			}
            //		})
            //}
        });
    };
    ;
    return ProxyFinalResponseFilter;
}(events.EventEmitter));
;
//util.inherits(ProxyFinalResponseFilter, events.EventEmitter);
/**
 *  misc internal helper functions
 */
var utils;
(function (utils) {
    function closeClientRequestWithErrorAndDispose(ctx, err, errorKind) {
        //return new Promise((resolve) => {
        //	log.error("utils.closeClientRequestWithError() triggered.  If ctx exists, will close with 504 error.", { errorKind, err }, err);
        //	if (ctx == null) {
        //		return resolve();
        //	}
        //	if (ctx.proxyToClientResponse && !ctx.proxyToClientResponse.headersSent) {
        //		ctx.proxyToClientResponse.writeHead(504, 'Proxy Error');
        //	} else {
        //		log.warn("last utils.closeClientRequestWithError() triggered after already ctx headers sent", { errorKind, err });
        //	}
        //	if (ctx.proxyToClientResponse && !ctx.proxyToClientResponse.finished) {
        //		return ctx.proxyToClientResponse.end('' + errorKind + ': ' + err, 'utf8', resolve);
        //	} else {
        //		log.warn("last utils.closeClientRequestWithError() triggered after already ctx is finished", { errorKind, err });
        //		resolve();
        //	}
        //});
        ctx.lastError = { err: err, errorKind: errorKind };
        var message = "Proxy Error, closeClientRequestWithError():  " + errorKind + ":  " + __.JSONX.inspectStringify(err);
        return closeClientRequestAndDispose({
            ctx: ctx,
            statusCode: 504,
            statusReason: errorKind,
            headers: { "scaleproxy-message": xlib.stringHelper.toId(message) },
            bodyMessage: message,
        });
    }
    utils.closeClientRequestWithErrorAndDispose = closeClientRequestWithErrorAndDispose;
    /**
     * close the client request/response (and upstream)
     * @param ctx
     * @param
     * @param
     * @param
     */
    function closeClientRequestAndDispose(args) {
        var _this = this;
        var ctx = args.ctx;
        if (ctx.isClosed === true) {
            log.assert(false, "already closed");
            return Promise.reject("already closed");
        }
        ctx.isClosed = true;
        return new Promise(function (resolve, reject) {
            //close upstream
            if (ctx.proxyToServerRequest !== null) {
                ctx.proxyToServerRequest.abort();
            }
            if (ctx.proxyToClientResponse != null && ctx.proxyToClientResponse.finished !== true) {
                //close out downstream connection
                if (ctx.proxyToClientResponse.headersSent !== true) {
                    log.assert(args.statusCode != null, "headers not sent and you didn't specify a status code");
                    //if(ctx.proxyToClientResponse.args.statusC
                    log.warn("closing and writing head", args);
                    ctx.proxyToClientResponse.writeHead(args.statusCode, args.statusReason, args.headers);
                }
                else {
                    log.assert(args.statusCode == null, "headers already sent");
                }
                ctx.proxyToClientResponse.end(args.bodyMessage, resolve);
                return;
            }
            else {
                log.assert(false, "already closed or not yet open");
                reject(new Error("already closed or not yet open"));
                return;
            }
        })
            .then(function () {
            return ctx.proxy.callbacks.onContextDispose.invoke(ctx.proxy, { ctx: _this.ctx });
        });
    }
    utils.closeClientRequestAndDispose = closeClientRequestAndDispose;
    function parseHostAndPort(req, defaultPort) {
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
    }
    utils.parseHostAndPort = parseHostAndPort;
    ;
    function parseHost(hostString, defaultPort) {
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
    }
    utils.parseHost = parseHost;
    ;
    function filterAndCanonizeHeaders(originalHeaders) {
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
    }
    utils.filterAndCanonizeHeaders = filterAndCanonizeHeaders;
    ;
})(utils || (utils = {}));
//# sourceMappingURL=proxy.js.map