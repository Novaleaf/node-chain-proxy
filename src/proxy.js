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
Object.defineProperty(exports, "__esModule", { value: true });
var xlib = require("xlib");
//import slib = require("slib");
//import fsPromise = slib.file.fsPromise;
var _ = xlib.lodash;
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
 *  encapsulates logic implementing a Promise based Event subscription system.
 *
 */
var EventDispatcher = (function () {
    function EventDispatcher() {
        this._storage = [];
    }
    EventDispatcher.prototype.subscribe = function (callback) {
        this._storage.push(callback);
    };
    EventDispatcher.prototype.unsubscribe = function (callback) {
        return xlib.arrayHelper.removeFirst(this._storage, callback);
    };
    /**
     *  dispatch will not be completed until all subscriber functions resolve.
     * @param sender
     * @param args
     */
    EventDispatcher.prototype.invoke = function (sender, args) {
        var results = [];
        this._storage.forEach(function (callback) {
            var result = callback(sender, args);
            results.push(result);
        });
        var toReturn = Promise.all(results);
        return toReturn;
    };
    return EventDispatcher;
}());
exports.EventDispatcher = EventDispatcher;
var ActionDispatcher = (function () {
    function ActionDispatcher() {
        this._storage = [];
    }
    ActionDispatcher.prototype.subscribe = function (callback) {
        this._storage.push(callback);
    };
    ActionDispatcher.prototype.unsubscribe = function (callback) {
        return xlib.arrayHelper.removeFirst(this._storage, callback);
    };
    /**
     * invokes all subscribed actions, in a LIFO fashion (last attached gets executed first)
     * @param sender
     * @param args
     */
    ActionDispatcher.prototype.invoke = function (sender, args) {
        _.forEachRight(this._storage, function (callback) {
            callback(sender, args);
        });
    };
    return ActionDispatcher;
}());
exports.ActionDispatcher = ActionDispatcher;
var Mod = (function () {
    function Mod() {
        this.onError = new ActionDispatcher();
    }
    return Mod;
}());
exports.Mod = Mod;
var ProxyBase = (function () {
    function ProxyBase() {
        ///////////  move from Proxy
        ////////////////  end
        //	public onErrorHandlers: ((context: IContext, err?: Error, errorKind?: string) => void)[] = [];
        //	public onError(/**Adds a function to the list of functions to get called if an error occures.
        //Arguments
        //fn(ctx, err, errorKind) - The function to be called on an error.*/fn: (context: IContext, err?: Error, errorKind?: string) => void) {
        //		this.onErrorHandlers.push(fn);
        //		return this;
        //	};
        this.onWebSocketConnectionHandlers = [];
        /** shared storage for .onWebSocketSend() and .onWebSocketMessage() and .onWebSocketFrame() */
        this.onWebSocketFrameHandlers = [];
        this.onWebSocketCloseHandlers = [];
        this.onWebSocketErrorHandlers = [];
        this.onRequestHandlers = [];
        this.onRequestHeadersHandlers = [];
        this.onRequestDataHandlers = [];
        this.onRequestEndHandlers = [];
        this.onResponseHandlers = [];
        this.onResponseHeadersHandlers = [];
        this.onResponseDataHandlers = [];
        this.onResponseEndHandlers = [];
    }
    ProxyBase.prototype.onWebSocketConnection = function (fn) {
        this.onWebSocketConnectionHandlers.push(fn);
        return this;
    };
    ;
    ProxyBase.prototype.onWebSocketSend = function (fn) {
        this.onWebSocketFrameHandlers.push(function (ctx, type, fromServer, data, flags, callback) {
            if (!fromServer && type === 'message')
                return this(ctx, data, flags, callback);
            else
                callback(null, data, flags);
        }.bind(fn));
        return this;
    };
    ;
    ProxyBase.prototype.onWebSocketMessage = function (fn) {
        this.onWebSocketFrameHandlers.push(function (ctx, type, fromServer, data, flags, callback) {
            if (fromServer && type === 'message')
                return this(ctx, data, flags, callback);
            else
                callback(null, data, flags);
        }.bind(fn));
        return this;
    };
    ;
    ProxyBase.prototype.onWebSocketFrame = function (fn) {
        this.onWebSocketFrameHandlers.push(fn);
        return this;
    };
    ;
    ProxyBase.prototype.onWebSocketClose = function (fn) {
        this.onWebSocketCloseHandlers.push(fn);
        return this;
    };
    ;
    ProxyBase.prototype.onWebSocketError = function (fn) {
        this.onWebSocketErrorHandlers.push(fn);
        return this;
    };
    ;
    /** Adds a function to get called at the beginning of a request.
           
           Arguments
           
           fn(ctx, callback) - The function that gets called on each request.
           Example
           
           proxy.onRequest(function(ctx, callback) {
             console.log('REQUEST:', ctx.clientToProxyRequest.url);
             return callback();
           }); */
    ProxyBase.prototype.onRequest = function (fn) {
        this.onRequestHandlers.push(fn);
        return this;
    };
    ;
    ProxyBase.prototype.onRequestHeaders = function (fn) {
        this.onRequestHeadersHandlers.push(fn);
        return this;
    };
    ;
    ProxyBase.prototype.onRequestData = function (fn) {
        this.onRequestDataHandlers.push(fn);
        return this;
    };
    ;
    ProxyBase.prototype.onRequestEnd = function (fn) {
        this.onRequestEndHandlers.push(fn);
        return this;
    };
    ;
    /** Adds a function to get called at the beginning of the response.
    
    Arguments
    
    fn(ctx, callback) - The function that gets called on each response.
    Example
    
    proxy.onResponse(function(ctx, callback) {
      console.log('BEGIN RESPONSE');
      return callback();
    }); */
    ProxyBase.prototype.onResponse = function (fn) {
        this.onResponseHandlers.push(fn);
        return this;
    };
    ;
    ProxyBase.prototype.onResponseHeaders = function (fn) {
        this.onResponseHeadersHandlers.push(fn);
        return this;
    };
    ;
    ProxyBase.prototype.onResponseData = function (fn) {
        this.onResponseDataHandlers.push(fn);
        return this;
    };
    ;
    ProxyBase.prototype.onResponseEnd = function (fn) {
        this.onResponseEndHandlers.push(fn);
        return this;
    };
    ;
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
    ProxyBase.prototype.use = function (mod) {
        //if (mod.onError) {
        //	this.onError(mod.onError);
        //}
        if (mod.onRequest) {
            this.onRequest(mod.onRequest);
        }
        if (mod.onRequestHeaders) {
            this.onRequestHeaders(mod.onRequestHeaders);
        }
        if (mod.onRequestData) {
            this.onRequestData(mod.onRequestData);
        }
        if (mod.onResponse) {
            this.onResponse(mod.onResponse);
        }
        if (mod.onResponseHeaders) {
            this.onResponseHeaders(mod.onResponseHeaders);
        }
        if (mod.onResponseData) {
            this.onResponseData(mod.onResponseData);
        }
        if (mod.onWebSocketConnection) {
            this.onWebSocketConnection(mod.onWebSocketConnection);
        }
        if (mod.onWebSocketSend) {
            this.onWebSocketFrame(function (ctx, type, fromServer, data, flags, callback) {
                if (!fromServer && type === 'message')
                    return this(ctx, data, flags, callback);
                else
                    callback(null, data, flags);
            }.bind(mod.onWebSocketSend));
        }
        if (mod.onWebSocketMessage) {
            this.onWebSocketFrame(function (ctx, type, fromServer, data, flags, callback) {
                if (fromServer && type === 'message')
                    return this(ctx, data, flags, callback);
                else
                    callback(null, data, flags);
            }.bind(mod.onWebSocketMessage));
        }
        if (mod.onWebSocketFrame) {
            this.onWebSocketFrame(mod.onWebSocketFrame);
        }
        if (mod.onWebSocketClose) {
            this.onWebSocketClose(mod.onWebSocketClose);
        }
        if (mod.onWebSocketError) {
            this.onWebSocketError(mod.onWebSocketError);
        }
        return this;
    };
    ;
    return ProxyBase;
}());
exports.ProxyBase = ProxyBase;
var ContextCallbacks = (function (_super) {
    __extends(ContextCallbacks, _super);
    function ContextCallbacks() {
        return _super !== null && _super.apply(this, arguments) || this;
    }
    /** Jason Port notes: belongs on Proxy.  internally enumerates ctx handlers */
    ContextCallbacks.prototype._onRequest = function (ctx, callback) {
        log.assert(this === ctx, "assume same obj");
        async.forEach(this.onRequestHandlers, function (fn, callback) {
            return fn(ctx, callback);
        }, callback);
    };
    ;
    /** Jason Port notes: belongs on Proxy.  internally enumerates ctx handlers */
    ContextCallbacks.prototype._onWebSocketConnection = function (ctx, callback) {
        log.assert(this === ctx, "assume same obj");
        async.forEach(this.onWebSocketConnectionHandlers, function (fn, callback) {
            return fn(ctx, callback);
        }, callback);
    };
    ;
    /** Jason Port notes: belongs on Proxy.  internally enumerates ctx handlers */
    ContextCallbacks.prototype._onWebSocketFrame = function (ctx, type, fromServer, data, flags) {
        var _this = this;
        log.assert(this === ctx, "assume same obj");
        //var this = this;
        async.forEach(this.onWebSocketFrameHandlers, function (fn, fnDoneCallback) {
            return fn(ctx, type, fromServer, data, flags, function (err, newData, newFlags) {
                if (err) {
                    return fnDoneCallback(err);
                }
                data = newData;
                flags = newFlags;
                return fnDoneCallback(null, data, flags);
            });
        }, function (err) {
            if (err) {
                return _this._onWebSocketError(ctx, err);
            }
            var destWebSocket = fromServer ? ctx.clientToProxyWebSocket : ctx.proxyToServerWebSocket;
            if (destWebSocket.readyState === WebSocket.OPEN) {
                switch (type) {
                    case 'message':
                        destWebSocket.send(data, flags);
                        break;
                    case 'ping':
                        destWebSocket.ping(data, flags, false);
                        break;
                    case 'pong':
                        destWebSocket.pong(data, flags, false);
                        break;
                }
            }
            else {
                _this._onWebSocketError(ctx, new Error('Cannot send ' + type + ' because ' + (fromServer ? 'clientToProxy' : 'proxyToServer') + ' WebSocket connection state is not OPEN'));
            }
        });
    };
    ;
    /** Jason Port notes: belongs on Proxy.  internally enumerates ctx handlers */
    ContextCallbacks.prototype._onWebSocketClose = function (ctx, closedByServer, code, message) {
        var _this = this;
        log.assert(this === ctx, "assume same obj");
        //var this = this;
        if (!ctx.closedByServer && !ctx.closedByClient) {
            ctx.closedByServer = closedByServer;
            ctx.closedByClient = !closedByServer;
            async.forEach(this.onWebSocketCloseHandlers, function (fn, fnDoneCallback) {
                return fn(ctx, code, message, function (err, newCode, newMessage) {
                    if (err) {
                        return fnDoneCallback(err);
                    }
                    code = newCode;
                    message = newMessage;
                    return fnDoneCallback(null, code, message);
                });
            }, function (err) {
                if (err) {
                    return _this._onWebSocketError(ctx, err);
                }
                if (ctx.clientToProxyWebSocket.readyState !== ctx.proxyToServerWebSocket.readyState) {
                    if (ctx.clientToProxyWebSocket.readyState === WebSocket.CLOSED && ctx.proxyToServerWebSocket.readyState === WebSocket.OPEN) {
                        ctx.proxyToServerWebSocket.close(code, message);
                    }
                    else if (ctx.proxyToServerWebSocket.readyState === WebSocket.CLOSED && ctx.clientToProxyWebSocket.readyState === WebSocket.OPEN) {
                        ctx.clientToProxyWebSocket.close(code, message);
                    }
                }
            });
        }
    };
    ;
    /** Jason Port notes: belongs on Proxy.  internally enumerates ctx handlers */
    ContextCallbacks.prototype._onWebSocketError = function (ctx, err) {
        log.assert(this === ctx, "assume same obj");
        this.onWebSocketErrorHandlers.forEach(function (handler) {
            return handler(ctx, err);
        });
        //if (ctx) {
        //	ctx.onWebSocketErrorHandlers.forEach(function (handler) {
        //		return handler(ctx, err);
        //	});
        //}
        if (ctx.proxyToServerWebSocket && ctx.clientToProxyWebSocket.readyState !== ctx.proxyToServerWebSocket.readyState) {
            if (ctx.clientToProxyWebSocket.readyState === WebSocket.CLOSED && ctx.proxyToServerWebSocket.readyState === WebSocket.OPEN) {
                ctx.proxyToServerWebSocket.close();
            }
            else if (ctx.proxyToServerWebSocket.readyState === WebSocket.CLOSED && ctx.clientToProxyWebSocket.readyState === WebSocket.OPEN) {
                ctx.clientToProxyWebSocket.close();
            }
        }
    };
    ;
    /** Jason Port notes: belongs on Proxy.  internally enumerates ctx handlers */
    ContextCallbacks.prototype._onRequestData = function (ctx, chunk, callback) {
        log.assert(this === ctx, "assume same obj");
        //var this = this;
        async.forEach(this.onRequestDataHandlers, function (fn, callback) {
            return fn(ctx, chunk, function (err, newChunk) {
                if (err) {
                    return callback(err);
                }
                chunk = newChunk;
                return callback(null, newChunk);
            });
        }, function (err) {
            if (err) {
                return ctx._onError('ON_REQUEST_DATA_ERROR', ctx, err);
            }
            return callback(null, chunk);
        });
    };
    ;
    /** Jason Port notes: belongs on Proxy.  internally enumerates ctx handlers */
    ContextCallbacks.prototype._onRequestEnd = function (ctx, callback) {
        log.assert(this === ctx, "assume same obj");
        //var this = this;
        async.forEach(this.onRequestEndHandlers, function (fn, callback) {
            return fn(ctx, callback);
        }, function (err) {
            if (err) {
                return ctx._onError('ON_REQUEST_END_ERROR', ctx, err);
            }
            return callback(null);
        });
    };
    ;
    /** Jason Port notes: belongs on Proxy.  internally enumerates ctx handlers */
    ContextCallbacks.prototype._onResponse = function (ctx, callback) {
        log.assert(this === ctx, "assume same obj");
        async.forEach(this.onResponseHandlers, function (fn, callback) {
            return fn(ctx, callback);
        }, callback);
    };
    ;
    /** JASONS TODO: does this need to enumerate ctx handlers too?  (see other handlers) */
    ContextCallbacks.prototype._onRequestHeaders = function (ctx, callback) {
        log.assert(this === ctx, "assume same obj");
        async.forEach(this.onRequestHeadersHandlers, function (fn, callback) {
            return fn(ctx, callback);
        }, callback);
    };
    ;
    /** JASONS TODO: does this need to enumerate ctx handlers too?  (see other handlers) */
    ContextCallbacks.prototype._onResponseHeaders = function (ctx, callback) {
        log.assert(this === ctx, "assume same obj");
        async.forEach(this.onResponseHeadersHandlers, function (fn, callback) {
            return fn(ctx, callback);
        }, callback);
    };
    ;
    /** Jason Port notes: belongs on Proxy.  internally enumerates ctx handlers */
    ContextCallbacks.prototype._onResponseData = function (ctx, chunk, callback) {
        log.assert(this === ctx, "assume same obj");
        //var this = this;
        async.forEach(this.onResponseDataHandlers, function (fn, callback) {
            return fn(ctx, chunk, function (err, newChunk) {
                if (err) {
                    return callback(err);
                }
                chunk = newChunk;
                return callback(null, newChunk);
            });
        }, function (err) {
            if (err) {
                return ctx._onError('ON_RESPONSE_DATA_ERROR', ctx, err);
            }
            return callback(null, chunk);
        });
    };
    ;
    /** Jason Port notes: belongs on Proxy.  internally enumerates ctx handlers */
    ContextCallbacks.prototype._onResponseEnd = function (ctx, callback) {
        log.assert(this === ctx, "assume same obj");
        //var this = this;
        async.forEach(this.onResponseEndHandlers, function (fn, callback) {
            return fn(ctx, callback);
        }, function (err) {
            if (err) {
                return ctx._onError('ON_RESPONSE_END_ERROR', ctx, err);
            }
            return callback(null);
        });
    };
    ;
    return ContextCallbacks;
}(ProxyBase));
exports.ContextCallbacks = ContextCallbacks;
var IContext = (function (_super) {
    __extends(IContext, _super);
    function IContext() {
        var _this = _super !== null && _super.apply(this, arguments) || this;
        /** filters added by .addRequestFilter() */
        _this.requestFilters = [];
        /** filters added by .addResponseFilter() */
        _this.responseFilters = [];
        return _this;
    }
    /**Adds a stream into the request body stream.
  
  Arguments
  
  stream - The read/write stream to add in the request body stream.
  Example
  
  ctx.addRequestFilter(zlib.createGunzip()); */
    IContext.prototype.addRequestFilter = function (filter) {
        this.requestFilters.push(filter);
        return this;
    };
    /** Adds a stream into the response body stream.
  
  Arguments
  
  stream - The read/write stream to add in the response body stream.
  Example
  
  ctx.addResponseFilter(zlib.createGunzip()); */
    IContext.prototype.addResponseFilter = function (filter) {
        this.responseFilters.push(filter);
        return this;
    };
    return IContext;
}(ContextCallbacks));
exports.IContext = IContext;
///////////////////////////  END ICONTEXT CLASS
var Proxy = (function () {
    function Proxy(overrideDefaultMod) {
        /** triggered when the context is created, before any other context specific events are triggered.
        check ctx.url.protocol to decide what events to bind.  http, https, or ws */
        this.onContextInitialize = new EventDispatcher();
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
        this._masterModDispatcher = new Mod();
        this._attachedMods = [];
        /** hook all mods to be attached to context when created */
        this.mods = [];
        this.onConnectHandlers = [];
        if (overrideDefaultMod == null) {
            //add our default callbacks.
            overrideDefaultMod = new Mod();
            overrideDefaultMod.onError.subscribe(function (sender, args) {
                log.error("defaultMod.onError() triggered.  If ctx exists, will close with 504 error.", { sender: sender, args: args });
                if (args.ctx) {
                    if (args.ctx.proxyToClientResponse && !args.ctx.proxyToClientResponse.headersSent) {
                        args.ctx.proxyToClientResponse.writeHead(504, 'Proxy Error');
                    }
                    else {
                        log.warn("last defaultMod.onError() triggered after already ctx headers sent", { sender: sender, args: args });
                    }
                    if (args.ctx.proxyToClientResponse && !args.ctx.proxyToClientResponse.finished) {
                        args.ctx.proxyToClientResponse.end('' + args.errorKind + ': ' + args.err, 'utf8');
                    }
                    else {
                        log.warn("last defaultMod.onError() triggered after already ctx is finished", { sender: sender, args: args });
                    }
                }
            });
        }
        this.attachMod(overrideDefaultMod);
    }
    Proxy.prototype.attachMod = function (mod) {
        var _this = this;
        //attach all callbacks from mod to our masterDispatcher
        _.forOwn(mod, function (dispatcher, key) {
            _.forEach(dispatcher._storage, function (callback) {
                log.info("attaching mod." + key + " to proxy._masterModDispatcher");
                _this._masterModDispatcher[key].subscribe(callback);
            });
        });
        this._attachedMods.push(mod);
    };
    Proxy.prototype.use = function (mod) {
        if (mod.onCertificateRequired) {
            this.onCertificateRequired = mod.onCertificateRequired;
        }
        if (mod.onCertificateMissing) {
            this.onCertificateMissing = mod.onCertificateMissing;
        }
        if (mod.onConnect) {
            this.onConnect(mod.onConnect);
        }
        //return super.use(mod);
        this.mods.push(mod);
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
            _this.httpServer.on("error", function (err) { _this._masterModDispatcher.onError.invoke(_this, { err: err, errorKind: "proxy.httpServer.on('error')" }); });
            _this.httpServer.on('connect', _this._onHttpServerConnect.bind(_this));
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
    Proxy.prototype._createHttpsServer = function (options, callback) {
        var _this = this;
        var httpsServer = https.createServer(options);
        httpsServer.timeout = this.timeout; //exists: https://nodejs.org/api/https.html
        //httpsServer.on('error', this._onError.bind(this, 'HTTPS_SERVER_ERROR'));
        httpsServer.on("error", function (err) { _this._masterModDispatcher.onError.invoke(_this, { err: err, errorKind: "proxy.httpsServer.on('error')" }); });
        //httpsServer.on('clientError', this._onError.bind(this, 'HTTPS_CLIENT_ERROR'));
        httpsServer.on("error", function (err) { _this._masterModDispatcher.onError.invoke(_this, { err: err, errorKind: "proxy.httpsServer.on('clientError')" }); });
        httpsServer.on('connect', this._onHttpServerConnect.bind(this));
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
    /**
     * Add custom handler for CONNECT method
     * @augments
     *   - fn(req,socket,head,callback) be called on receiving CONNECT method
     */
    Proxy.prototype.onConnect = function (fn) {
        this.onConnectHandlers.push(fn);
        return this;
    };
    ;
    Proxy.prototype._onHttpServerConnect = function (req, socket, head) {
        //var this = this;
        var _this = this;
        // you can forward HTTPS request directly by adding custom CONNECT method handler
        return async.forEach(this.onConnectHandlers, function (fn, callback) {
            return fn.call(_this, req, socket, head, callback);
        }, function (err) {
            if (err) {
                //return this._onError('ON_CONNECT_ERROR', err);
                return _this._masterModDispatcher.onError.invoke(_this, { err: err, errorKind: "proxy._masterModDispatcher.onConnect() --> error", data: { req: req, socket: socket, head: head } });
            }
            // we need first byte of data to detect if request is SSL encrypted
            if (!head || head.length === 0) {
                socket.once('data', _this._onHttpServerConnectData.bind(_this, req, socket));
                socket.on("data", function (req, socket) {
                    //JASONS HACK: test listening to https socket
                    log.warn("socket.on.data", { req: req, socket: socket });
                });
                socket.write('HTTP/1.1 200 OK\r\n');
                if (_this.keepAlive && req.headers['proxy-connection'] === 'keep-alive') {
                    socket.write('Proxy-Connection: keep-alive\r\n');
                    socket.write('Connection: keep-alive\r\n');
                }
                return socket.write('\r\n');
            }
            else {
                _this._onHttpServerConnectData(req, socket, head);
            }
        });
    };
    Proxy.prototype._onHttpServerConnectData = function (req, socket, head) {
        //var this = this;
        var _this = this;
        socket.pause();
        var makeConnection = function (port) {
            // open a TCP connection to the remote host
            var conn = net.connect(port, function () {
                // create a tunnel between the two hosts
                socket.pipe(conn);
                conn.pipe(socket);
                socket.emit('data', head);
                return socket.resume();
            });
            //conn.on('error', this._onError.bind(this, 'PROXY_TO_PROXY_SOCKET_ERROR'));
            conn.on("error", function (err) { _this._masterModDispatcher.onError.invoke(_this, { err: err, errorKind: "PROXY_TO_PROXY_SOCKET_ERROR", data: { port: port } }); });
        };
        var getHttpsServer = function (hostname, callback) {
            _this.onCertificateRequired(hostname, function (err, files) {
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
                                return _this.onCertificateMissing(info, files, function (err, files) {
                                    if (err) {
                                        return callback(err);
                                    }
                                    return callback(null, {
                                        key: files.keyFileData,
                                        cert: files.certFileData,
                                        hosts: files.hosts
                                    });
                                });
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
                    process.nextTick(sem.leave.bind(sem));
                    if (err) {
                        //return this._onError('OPEN_HTTPS_SERVER_ERROR', err);
                        return _this._masterModDispatcher.onError.invoke(_this, { err: err, errorKind: "OPEN_HTTPS_SERVER_ERROR", data: { req: req, socket: socket, head: head } });
                    }
                    return makeConnection(port);
                });
            });
        }
        else {
            return makeConnection(this.httpPort);
        }
    };
    ;
    Proxy.prototype.onCertificateRequired = function (hostname, callback) {
        //var this = this;
        callback(null, {
            keyFile: this.sslCaDir + '/keys/' + hostname + '.key',
            certFile: this.sslCaDir + '/certs/' + hostname + '.pem',
            hosts: [hostname]
        });
        return this;
    };
    ;
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
        var ctx = new IContext();
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
        ////apply mods
        this.mods.forEach(function (mod) {
            ctx.use(mod);
        });
        return this.onContextInitialize.invoke(this, { ctx: ctx })
            .then(function () {
            ctx.clientToProxyWebSocket.on('message', ctx._onWebSocketFrame.bind(ctx, ctx, 'message', false));
            ctx.clientToProxyWebSocket.on('ping', ctx._onWebSocketFrame.bind(ctx, ctx, 'ping', false));
            ctx.clientToProxyWebSocket.on('pong', ctx._onWebSocketFrame.bind(ctx, ctx, 'pong', false));
            ctx.clientToProxyWebSocket.on('error', ctx._onWebSocketError.bind(ctx, ctx));
            ctx.clientToProxyWebSocket.on('close', ctx._onWebSocketClose.bind(ctx, ctx, false));
            return ctx._onWebSocketConnection(ctx, function (err) {
                if (err) {
                    return ctx._onWebSocketError(ctx, err);
                }
                return makeProxyToServerWebSocket();
            });
            function makeProxyToServerWebSocket() {
                ctx.proxyToServerWebSocket = new WebSocket(ctx.proxyToServerWebSocketOptions.url, ctx.proxyToServerWebSocketOptions);
                ctx.proxyToServerWebSocket.on('message', ctx._onWebSocketFrame.bind(ctx, ctx, 'message', true));
                ctx.proxyToServerWebSocket.on('ping', ctx._onWebSocketFrame.bind(ctx, ctx, 'ping', true));
                ctx.proxyToServerWebSocket.on('pong', ctx._onWebSocketFrame.bind(ctx, ctx, 'pong', true));
                ctx.proxyToServerWebSocket.on('error', ctx._onWebSocketError.bind(ctx, ctx));
                ctx.proxyToServerWebSocket.on('close', ctx._onWebSocketClose.bind(ctx, ctx, true));
                ctx.proxyToServerWebSocket.on('open', function () {
                    if (ctx.clientToProxyWebSocket.readyState === WebSocket.OPEN) {
                        ctx.clientToProxyWebSocket.resume();
                    }
                });
            }
        });
    };
    Proxy.prototype._onHttpServerRequest = function (isSSL, clientToProxyRequest, proxyToClientResponse) {
        //var this = this;
        var _this = this;
        var ctx = new IContext();
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
        ////apply mods
        this.mods.forEach(function (mod) {
            ctx.use(mod);
        });
        return this.onContextInitialize.invoke(this, { ctx: ctx })
            .then(function () {
            //ctx.clientToProxyRequest.on('error', ctx._onError.bind(ctx, 'CLIENT_TO_PROXY_REQUEST_ERROR', ctx));
            ctx.clientToProxyRequest.on("error", function (err) { _this._masterModDispatcher.onError.invoke(_this, { err: err, errorKind: "CLIENT_TO_PROXY_REQUEST_ERROR", ctx: ctx }); });
            //ctx.proxyToClientResponse.on('error', ctx._onError.bind(ctx, 'PROXY_TO_CLIENT_RESPONSE_ERROR', ctx));
            ctx.proxyToClientResponse.on("error", function (err) { _this._masterModDispatcher.onError.invoke(_this, { err: err, errorKind: "PROXY_TO_CLIENT_RESPONSE_ERROR", ctx: ctx }); });
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
                return ctx._onRequest(ctx, function (err) {
                    if (err) {
                        //return ctx._onError('ON_REQUEST_ERROR', ctx, err);
                        return _this._masterModDispatcher.onError.invoke(_this, { err: err, errorKind: "ON_REQUEST_ERROR", ctx: ctx, });
                    }
                    return ctx._onRequestHeaders(ctx, function (err) {
                        if (err) {
                            //return ctx._onError('ON_REQUESTHEADERS_ERROR', ctx, err);
                            return _this._masterModDispatcher.onError.invoke(_this, { err: err, errorKind: "ON_REQUESTHEADERS_ERROR", ctx: ctx, });
                        }
                        return makeProxyToServerRequest();
                    });
                });
            };
            //JASON EDIT:  helper to handle errors from proxyToServerRequest (retry them)
            var handleProxyToServerRequestError = function (kind, ctx, err) {
                ctx.tags.failedUpstreamCalls++;
                console.log("ERRRRRRRRRRRRRR!!!!!\n\n\n!!!!!\n\n\n", ctx.tags.failedUpstreamCalls, ctx.tags.uri);
                if (ctx.tags.retryProxyRequest === true) {
                    return callOnRequestHandlersThenMakeProxyRequest();
                }
                else {
                    //ctx._onError('PROXY_TO_SERVER_REQUEST_ERROR', ctx, err);						
                    return _this._masterModDispatcher.onError.invoke(_this, { err: err, errorKind: "PROXY_TO_SERVER_REQUEST_ERROR", ctx: ctx, });
                }
            };
            var makeProxyToServerRequest = function () {
                var proto = (ctx.isSSL ? https : http);
                ctx.proxyToServerRequest = proto.request(ctx.proxyToServerRequestOptions, proxyToServerRequestComplete);
                //JASON EDIT: wacky binding scheme to simply call our new handleProxyToServerRequestError() function
                ctx.proxyToServerRequest.on('error', handleProxyToServerRequestError.bind(_this, 'PROXY_TO_SERVER_REQUEST_ERROR', ctx));
                //JASON EDIT: hack because we recall this, don't want stale "ProxyFinalRequestFilter" from our last call to makeProxyToServerRequest() (previous proxy attempt)
                //ctx.requestFilters.push(new ProxyFinalRequestFilter(this, ctx));
                var proxyFinalRequestFilter = new ProxyFinalRequestFilter(_this, ctx);
                var prevRequestPipeElem = ctx.clientToProxyRequest;
                ctx.requestFilters.forEach(function (filter) {
                    //filter.on('error', ctx._onError.bind(ctx, 'REQUEST_FILTER_ERROR', ctx));
                    filter.on("error", function (err) { _this._masterModDispatcher.onError.invoke(_this, { err: err, errorKind: "REQUEST_FILTER_ERROR", ctx: ctx }); });
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
            };
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
            var proxyToServerRequestComplete = function (serverToProxyResponse) {
                //serverToProxyResponse.on('error', ctx._onError.bind(ctx, 'SERVER_TO_PROXY_RESPONSE_ERROR', ctx));
                serverToProxyResponse.on("error", function (err) { _this._masterModDispatcher.onError.invoke(_this, { err: err, errorKind: "SERVER_TO_PROXY_RESPONSE_ERROR", ctx: ctx }); });
                serverToProxyResponse.pause();
                ctx.serverToProxyResponse = serverToProxyResponse;
                return ctx._onResponse(ctx, function (err) {
                    if (err) {
                        //return ctx._onError('ON_RESPONSE_ERROR', ctx, err);
                        return _this._masterModDispatcher.onError.invoke(_this, { err: err, errorKind: "ON_RESPONSE_ERROR", ctx: ctx, });
                    }
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
                    return ctx._onResponseHeaders(ctx, function (err) {
                        if (err) {
                            //return ctx._onError('ON_RESPONSEHEADERS_ERROR', ctx, err);
                            return _this._masterModDispatcher.onError.invoke(_this, { err: err, errorKind: "ON_RESPONSEHEADERS_ERROR", ctx: ctx, });
                        }
                        ctx.proxyToClientResponse.writeHead(ctx.serverToProxyResponse.statusCode, utils.filterAndCanonizeHeaders(ctx.serverToProxyResponse.headers));
                        ctx.responseFilters.push(new ProxyFinalResponseFilter(_this, ctx));
                        var prevResponsePipeElem = ctx.serverToProxyResponse;
                        ctx.responseFilters.forEach(function (filter) {
                            //filter.on('error', ctx._onError.bind(ctx, 'RESPONSE_FILTER_ERROR', ctx));
                            filter.on("error", function (err) { _this._masterModDispatcher.onError.invoke(_this, { err: err, errorKind: "RESPONSE_FILTER_ERROR", ctx: ctx }); });
                            prevResponsePipeElem = prevResponsePipeElem.pipe(filter);
                        });
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
        events.EventEmitter.call(_this);
        _this.writable = true;
        return _this;
    }
    ProxyFinalRequestFilter.prototype.write = function (chunk) {
        var _this = this;
        //const this = this;
        this.ctx._onRequestData(this.ctx, chunk, function (err, chunk) {
            if (err) {
                //return this.ctx._onError('ON_REQUEST_DATA_ERROR', this.ctx, err);
                return _this.proxy._masterModDispatcher.onError.invoke(_this, { err: err, errorKind: "ON_REQUEST_DATA_ERROR", ctx: _this.ctx, });
            }
            if (chunk) {
                return _this.ctx.proxyToServerRequest.write(chunk);
            }
        });
        return true;
    };
    ;
    ProxyFinalRequestFilter.prototype.end = function (chunk) {
        var _this = this;
        //const this = this;
        if (chunk) {
            return this.ctx._onRequestData(this.ctx, chunk, function (err, chunk) {
                if (err) {
                    //return this.ctx._onError('ON_REQUEST_DATA_ERROR', this.ctx, err);
                    return _this.proxy._masterModDispatcher.onError.invoke(_this, { err: err, errorKind: "ON_REQUEST_DATA_ERROR", ctx: _this.ctx, });
                }
                return _this.ctx._onRequestEnd(_this.ctx, function (err) {
                    if (err) {
                        //return this.ctx._onError('ON_REQUEST_END_ERROR', this.ctx, err);
                        return _this.proxy._masterModDispatcher.onError.invoke(_this, { err: err, errorKind: "ON_REQUEST_END_ERROR", ctx: _this.ctx, });
                    }
                    return _this.ctx.proxyToServerRequest.end(chunk);
                });
            });
        }
        else {
            return this.ctx._onRequestEnd(this.ctx, function (err) {
                if (err) {
                    //return this.ctx._onError('ON_REQUEST_END_ERROR', this.ctx, err);
                    return _this.proxy._masterModDispatcher.onError.invoke(_this, { err: err, errorKind: "ON_REQUEST_END_ERROR", ctx: _this.ctx, });
                }
                return _this.ctx.proxyToServerRequest.end(chunk || undefined);
            });
        }
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
        events.EventEmitter.call(_this);
        _this.writable = true;
        return _this;
    }
    ProxyFinalResponseFilter.prototype.write = function (chunk) {
        var _this = this;
        //const this = this;
        this.ctx._onResponseData(this.ctx, chunk, function (err, chunk) {
            if (err) {
                //return this.ctx._onError('ON_RESPONSE_DATA_ERROR', this.ctx, err);
                return _this.proxy._masterModDispatcher.onError.invoke(_this, { err: err, errorKind: "ON_RESPONSE_DATA_ERROR", ctx: _this.ctx, });
            }
            if (chunk) {
                return _this.ctx.proxyToClientResponse.write(chunk);
            }
        });
        return true;
    };
    ;
    ProxyFinalResponseFilter.prototype.end = function (chunk) {
        var _this = this;
        //const this = this;
        if (chunk) {
            return this.ctx._onResponseData(this.ctx, chunk, function (err, chunk) {
                if (err) {
                    //return this.ctx._onError('ON_RESPONSE_DATA_ERROR', this.ctx, err);
                    return _this.proxy._masterModDispatcher.onError.invoke(_this, { err: err, errorKind: "ON_RESPONSE_DATA_ERROR", ctx: _this.ctx, });
                }
                return _this.ctx._onResponseEnd(_this.ctx, function (err) {
                    if (err) {
                        //return this.ctx._onError('ON_RESPONSE_END_ERROR', this.ctx, err);
                        return _this.proxy._masterModDispatcher.onError.invoke(_this, { err: err, errorKind: "ON_RESPONSE_END_ERROR", ctx: _this.ctx, });
                    }
                    return _this.ctx.proxyToClientResponse.end(chunk || undefined);
                });
            });
        }
        else {
            return this.ctx._onResponseEnd(this.ctx, function (err) {
                if (err) {
                    //return this.ctx._onError('ON_RESPONSE_END_ERROR', this.ctx, err);
                    return _this.proxy._masterModDispatcher.onError.invoke(_this, { err: err, errorKind: "ON_RESPONSE_END_ERROR", ctx: _this.ctx, });
                }
                return _this.ctx.proxyToClientResponse.end(chunk || undefined);
            });
        }
    };
    ;
    return ProxyFinalResponseFilter;
}(events.EventEmitter));
;
//util.inherits(ProxyFinalResponseFilter, events.EventEmitter);
var utils;
(function (utils) {
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