'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
var xlib = require("xlib");
var Promise = xlib.promise.bluebird;
/**
 * group1: subdomain
 * group2: domain.ext
 * exclude short domains (length < 4) to avoid catching double extensions (ex: net.au, co.uk, ...)
 */
var HOSTNAME_REGEX = /^(.+)(\.[^\.]{4,}(\.[^\.]{1,3})*\.[^\.]+)$/;
module.exports = {
    onCertificateRequired: function (hostname) {
        var rootHost = hostname;
        if (HOSTNAME_REGEX.test(hostname)) {
            rootHost = hostname.replace(/^[^\.]+\./, '');
        }
        return Promise.resolve({
            keyFile: this.sslCaDir + '/keys/_.' + rootHost + '.key',
            certFile: this.sslCaDir + '/certs/_.' + rootHost + '.pem',
            hosts: ['*.' + rootHost, rootHost]
        });
        //return this;
    }
};
//# sourceMappingURL=wildcard.js.map