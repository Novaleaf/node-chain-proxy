/// <reference types="node" />
/// <reference types="ws" />
import net = require('net');
import http = require('http');
import https = require('https');
import WebSocket = require('ws');
import url = require('url');
export declare module middleware {
    const gunzip: any;
    const wildcard: any;
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
    data: {
        keyFileExists: boolean;
        certFileExists: boolean;
    };
}
export interface IProxyOptions {
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
}
export declare abstract class ProxyBase<TTags> {
    protected onErrorHandlers: ((context: IContext<TTags>, err?: Error, errorKind?: string) => void)[];
    protected onWebSocketConnectionHandlers: ((ctx: IContext<TTags>, callback: (error: Error | undefined) => void) => void)[];
    /** shared storage for .onWebSocketSend() and .onWebSocketMessage() and .onWebSocketFrame() */
    protected onWebSocketFrameHandlers: ((ctx: IContext<TTags>, type: any, fromServer: boolean, message: any, flags: any, callback: (err: Error | undefined, message: any, flags: any) => void) => void)[];
    protected onWebSocketCloseHandlers: ((ctx: IContext<TTags>, code: any, message: any, callback: (err: Error | undefined, code: any, message: any) => void) => void)[];
    protected onWebSocketErrorHandlers: ((ctx: IContext<TTags>, err: Error | undefined) => void)[];
    protected onRequestHandlers: ((ctx: IContext<TTags>, callback: (error: Error | undefined) => void) => void)[];
    protected onRequestHeadersHandlers: ((ctx: IContext<TTags>, callback: (error: Error | undefined) => void) => void)[];
    protected onRequestDataHandlers: ((ctx: IContext<TTags>, chunk: Buffer, callback: (error?: Error, chunk?: Buffer) => void) => void)[];
    protected onRequestEndHandlers: ((ctx: IContext<TTags>, callback: (error: Error | undefined) => void) => void)[];
    protected onResponseHandlers: ((ctx: IContext<TTags>, callback: (error: Error | undefined) => void) => void)[];
    protected onResponseHeadersHandlers: ((ctx: IContext<TTags>, callback: (error: Error | undefined) => void) => void)[];
    onResponseDataHandlers: ((ctx: IContext<TTags>, chunk: Buffer, callback: (error?: Error, chunk?: Buffer) => void) => void)[];
    onResponseEndHandlers: ((ctx: IContext<TTags>, callback: (error: Error | undefined) => void) => void)[];
    onError(/**Adds a function to the list of functions to get called if an error occures.
    
    Arguments
    
    fn(ctx, err, errorKind) - The function to be called on an error.*/ fn: (context: IContext<TTags>, err?: Error, errorKind?: string) => void): this;
    onWebSocketConnection(fn: (ctx: IContext<TTags>, callback: (error: Error | undefined) => void) => void): this;
    onWebSocketSend(fn: (ctx: IContext<TTags>, message: any, flags: any, callback: (err: Error | undefined, message: any, flags: any) => void) => void): this;
    onWebSocketMessage(fn: (ctx: IContext<TTags>, message: any, flags: any, callback: (err: Error | undefined, message: any, flags: any) => void) => void): this;
    onWebSocketFrame(fn: (ctx: IContext<TTags>, type: any, fromServer: boolean, message: any, flags: any, callback: (err: Error | undefined, message: any, flags: any) => void) => void): this;
    onWebSocketClose(fn: (ctx: IContext<TTags>, code: any, message: any, callback: (err: Error | undefined, code: any, message: any) => void) => void): this;
    onWebSocketError(fn: (ctx: IContext<TTags>, err: Error | undefined) => void): this;
    /** Adds a function to get called at the beginning of a request.
           
           Arguments
           
           fn(ctx, callback) - The function that gets called on each request.
           Example
           
           proxy.onRequest(function(ctx, callback) {
             console.log('REQUEST:', ctx.clientToProxyRequest.url);
             return callback();
           }); */
    onRequest(fn: (ctx: IContext<TTags>, callback: (error: Error | undefined) => void) => void): this;
    onRequestHeaders(fn: (ctx: IContext<TTags>, callback: (error: Error | undefined) => void) => void): this;
    onRequestData(fn: (ctx: IContext<TTags>, chunk: Buffer, callback: (error?: Error, chunk?: Buffer) => void) => void): this;
    onRequestEnd(fn: (ctx: IContext<TTags>, callback: (error: Error | undefined) => void) => void): this;
    /** Adds a function to get called at the beginning of the response.
    
    Arguments
    
    fn(ctx, callback) - The function that gets called on each response.
    Example
    
    proxy.onResponse(function(ctx, callback) {
      console.log('BEGIN RESPONSE');
      return callback();
    }); */
    onResponse(fn: (ctx: IContext<TTags>, callback: (error: Error | undefined) => void) => void): this;
    onResponseHeaders(fn: (ctx: IContext<TTags>, callback: (error: Error | undefined) => void) => void): this;
    onResponseData(fn: (ctx: IContext<TTags>, chunk: Buffer, callback: (error?: Error, chunk?: Buffer) => void) => void): this;
    onResponseEnd(fn: (ctx: IContext<TTags>, callback: (error: Error | undefined) => void) => void): this;
    _onError(kind: any, ctx: any, err: any): void;
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
    use(mod: any): this;
}
export declare class IContext<TTags> extends ProxyBase<TTags> {
    /** options sent to WebSocket when connecting.   set by Proxy._onWebSocketServerConnect() (internal code, when a websocket connects) and you can override via proxy.onWebSocketConnection().
    undefined and unused if not a websocket connection */
    proxyToServerWebSocketOptions: {
        url: string;
    } & WebSocket.IClientOptions;
    /** undocumented, allows adjusting the request in callbacks (such as .onRequest()) before sending  upstream (to proxy or target host)..
     * FYI these values seem pre-populated with defaults based on the request, you can modify them to change behavior. */
    proxyToServerRequestOptions: {
        /** ex: "GET" */
        method: string;
        /** ex: "/success.txt" */
        path: string;
        /** example: "detectportal.firefox.com" */
        host: string;
        port: null;
        headers: {
            [key: string]: string;
        };
        agent: http.Agent;
    };
    /** set by Proxy._onWebSocketServerConnect().   */
    isSSL: boolean;
    /** instance of WebSocket object from https://github.com/websockets/ws  set by Proxy._onWebSocketServerConnect() */
    clientToProxyWebSocket: WebSocket;
    /** instance of WebSocket object from https://github.com/websockets/ws */
    proxyToServerWebSocket: WebSocket;
    /** may be set to true/false when dealing with websockets. */
    closedByServer: boolean;
    clientToProxyRequest: http.IncomingMessage;
    proxyToClientResponse: http.ServerResponse;
    proxyToServerRequest: http.ClientRequest;
    serverToProxyResponse: http.IncomingMessage;
    /** user defined tags, initially constructed in the proxy-internals.tx proxy.onRequest() callback, you can add what you like here.
     by default, will be undefined.  you can set it in your proxy.onRequest() callback*/
    tags: TTags;
    /** set when constructing the context (prior to proxy.onRequest() being called)  */
    url: url.Url;
    /** filters added by .addRequestFilter() */
    requestFilters: any[];
    /** filters added by .addResponseFilter() */
    responseFilters: any[];
    /**Adds a stream into the request body stream.
  
  Arguments
  
  stream - The read/write stream to add in the request body stream.
  Example
  
  ctx.addRequestFilter(zlib.createGunzip()); */
    addRequestFilter(filter: any): this;
    /** Adds a stream into the response body stream.
  
  Arguments
  
  stream - The read/write stream to add in the response body stream.
  Example
  
  ctx.addResponseFilter(zlib.createGunzip()); */
    addResponseFilter(filter: any): this;
}
export declare class Proxy<TTags> extends ProxyBase<TTags> {
    use(mod: any): this;
    onConnectHandlers: ((req: http.IncomingMessage, socket: net.Socket, head: any, callback: (error: Error | undefined) => void) => void)[];
    options: IProxyOptions;
    silent: boolean;
    httpPort: number;
    timeout: number;
    keepAlive: boolean;
    httpAgent: http.Agent;
    httpsAgent: https.Agent;
    forceSNI: boolean;
    httpsPort?: number;
    sslCaDir: string;
    private ca;
    private sslServers;
    private sslSemaphores;
    private httpServer;
    private httpsServer;
    private wsServer;
    private wssServer;
    /** Starts the proxy listening on the given port..  example: proxy.listen({ port: 80 }); */
    listen(options?: IProxyOptions, callback?: (err?: Error) => void): this;
    private _createHttpsServer(options, callback);
    /** proxy.close
            Stops the proxy listening.
            
            Example
            
            proxy.close(); */
    close(): this;
    /**
     * Add custom handler for CONNECT method
     * @augments
     *   - fn(req,socket,head,callback) be called on receiving CONNECT method
     */
    onConnect(fn: (req: http.IncomingMessage, socket: net.Socket, head: any, callback: (error: Error | undefined) => void) => void): this;
    private _onHttpServerConnect(req, socket, head);
    private _onHttpServerConnectData(req, socket, head);
    onCertificateRequired(hostname: string, callback: (error: Error | undefined, certDetails: ICertificatePaths) => void): this;
    onCertificateMissing(info: ICertificateMissingHint, files: any, callback: (error: Error | undefined, certDetails: ICertificateData) => void): this;
    private _onWebSocketServerConnect(isSSL, ws);
    private _onHttpServerRequest(isSSL, clientToProxyRequest, proxyToClientResponse);
    /** Jason Port notes: belongs on Proxy.  internally enumerates ctx handlers */
    private _onRequest(ctx, callback);
    /** Jason Port notes: belongs on Proxy.  internally enumerates ctx handlers */
    private _onWebSocketConnection(ctx, callback);
    /** Jason Port notes: belongs on Proxy.  internally enumerates ctx handlers */
    private _onWebSocketFrame(ctx, type, fromServer, data, flags);
    /** Jason Port notes: belongs on Proxy.  internally enumerates ctx handlers */
    private _onWebSocketClose(ctx, closedByServer, code, message);
    /** Jason Port notes: belongs on Proxy.  internally enumerates ctx handlers */
    private _onWebSocketError(ctx, err);
    /** Jason Port notes: belongs on Proxy.  internally enumerates ctx handlers */
    _onRequestData(ctx: any, chunk: any, callback: any): void;
    /** Jason Port notes: belongs on Proxy.  internally enumerates ctx handlers */
    _onRequestEnd(ctx: any, callback: any): void;
    /** Jason Port notes: belongs on Proxy.  internally enumerates ctx handlers */
    private _onResponse(ctx, callback);
    /** JASONS TODO: does this need to enumerate ctx handlers too?  (see other handlers) */
    private _onRequestHeaders(ctx, callback);
    /** JASONS TODO: does this need to enumerate ctx handlers too?  (see other handlers) */
    private _onResponseHeaders(ctx, callback);
    /** Jason Port notes: belongs on Proxy.  internally enumerates ctx handlers */
    _onResponseData(ctx: any, chunk: any, callback: any): void;
    /** Jason Port notes: belongs on Proxy.  internally enumerates ctx handlers */
    _onResponseEnd(ctx: any, callback: any): void;
}
