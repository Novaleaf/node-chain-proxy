////////////   generates the root cert used for impersonating HTTPS servers (mitm)

import FS = require('fs');
import path = require('path');
import Forge = require('node-forge');
import pki = Forge.pki;
import mkdirp = require('mkdirp');
import async = require('async');

var CAattrs = [{
	name: 'commonName',
	value: 'ChainProxyCA'
}, {
	name: 'countryName',
	value: 'Internet'
}, {
	shortName: 'ST',
	value: 'Internet'
}, {
	name: 'localityName',
	value: 'Internet'
}, {
	name: 'organizationName',
	value: 'Chain Proxy CA'
}, {
	shortName: 'OU',
	value: 'CA'
}];

var CAextensions = [{
	name: 'basicConstraints',
	cA: true
}, {
	name: 'keyUsage',
	keyCertSign: true,
	digitalSignature: true,
	nonRepudiation: true,
	keyEncipherment: true,
	dataEncipherment: true
}, {
	name: 'extKeyUsage',
	serverAuth: true,
	clientAuth: true,
	codeSigning: true,
	emailProtection: true,
	timeStamping: true
}, {
	name: 'nsCertType',
	client: true,
	server: true,
	email: true,
	objsign: true,
	sslCA: true,
	emailCA: true,
	objCA: true
}, {
	name: 'subjectKeyIdentifier'
}];

var ServerAttrs = [{
	name: 'countryName',
	value: 'Internet'
}, {
	shortName: 'ST',
	value: 'Internet'
}, {
	name: 'localityName',
	value: 'Internet'
}, {
	name: 'organizationName',
	value: 'Chain Proxy CA'
}, {
	shortName: 'OU',
	value: 'Chain Proxy Server Certificate'
}];

var ServerExtensions: any = [{
	name: 'basicConstraints',
	cA: false
}, {
	name: 'keyUsage',
	keyCertSign: false,
	digitalSignature: true,
	nonRepudiation: false,
	keyEncipherment: true,
	dataEncipherment: true
}, {
	name: 'extKeyUsage',
	serverAuth: true,
	clientAuth: true,
	codeSigning: false,
	emailProtection: false,
	timeStamping: false
}, {
	name: 'nsCertType',
	client: true,
	server: true,
	email: false,
	objsign: false,
	sslCA: false,
	emailCA: false,
	objCA: false
}, {
	name: 'subjectKeyIdentifier'
}];


export class CA {

	public certsFolder: string;
	public keysFolder: string;

	public CAcert: pki.Certificate;
	public CAkeys: pki.KeyPair;

	constructor(public baseCAFolder: string, callback: (err: Error | undefined, ca: CA) => void) {

		const _self = this;
		_self.certsFolder = path.join(baseCAFolder, 'certs');
		_self.keysFolder = path.join(baseCAFolder, 'keys');

		async.series([
			mkdirp.bind(null, _self.baseCAFolder),
			mkdirp.bind(null, _self.certsFolder),
			mkdirp.bind(null, _self.keysFolder),

			function (callback) {
				FS.exists(path.join(_self.certsFolder, 'ca.pem'), function (exists) {
					if (exists) {
						_self.loadCA(callback);
					} else {
						_self.generateCA(callback);
					}
				});
			}
		], function (err: Error) {
			if (err) {
				return callback(err, undefined);
			}
			return callback(null, _self);
		});
	}
	public randomSerialNumber() {
		// generate random 16 bytes hex string
		var sn = '';
		for (var i = 0; i < 4; i++) {
			sn += ('00000000' + Math.floor(Math.random() * Math.pow(256, 4)).toString(16)).slice(-8);
		}
		return sn;
	}

	public generateCA(callback) {
		var self = this;
		pki.rsa.generateKeyPair({ bits: 2048 }, function (err, keys) {
			if (err) {
				return callback(err);
			}
			var cert: pki.Certificate = pki.createCertificate();
			cert.publicKey = keys.publicKey;
			cert.serialNumber = self.randomSerialNumber();
			cert.validity.notBefore = new Date();
			cert.validity.notBefore.setDate(cert.validity.notBefore.getDate() - 1);
			cert.validity.notAfter = new Date();
			cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 20);
			cert.setSubject(CAattrs);
			cert.setIssuer(CAattrs);
			cert.setExtensions(CAextensions);
			cert.sign(keys.privateKey, Forge.md.sha256.create());
			self.CAcert = cert;
			self.CAkeys = keys;
			async.parallel([
				FS.writeFile.bind(null, path.join(self.certsFolder, 'ca.pem'), pki.certificateToPem(cert)),
				FS.writeFile.bind(null, path.join(self.keysFolder, 'ca.private.key'), pki.privateKeyToPem(keys.privateKey)),
				FS.writeFile.bind(null, path.join(self.keysFolder, 'ca.public.key'), pki.publicKeyToPem(keys.publicKey))
			], callback);
		});
	};

	public loadCA(callback) {
		var self = this;
		async.auto({
			certPEM: function (callback) {
				FS.readFile(path.join(self.certsFolder, 'ca.pem'), 'utf-8', callback);
			},
			keyPrivatePEM: function (callback) {
				FS.readFile(path.join(self.keysFolder, 'ca.private.key'), 'utf-8', callback);
			},
			keyPublicPEM: function (callback) {
				FS.readFile(path.join(self.keysFolder, 'ca.public.key'), 'utf-8', callback);
			}
		}, undefined, function (err, results) {
			if (err) {
				return callback(err);
			}
			self.CAcert = pki.certificateFromPem(results.certPEM);
			self.CAkeys = {
				privateKey: pki.privateKeyFromPem(results.keyPrivatePEM),
				publicKey: pki.publicKeyFromPem(results.keyPublicPEM)
			};
			return callback();
		});
	};

	public generateServerCertificateKeys(hosts: string | string[], cb) {
		var self = this;
		if (typeof (hosts) === "string") hosts = [hosts];
		var mainHost = hosts[0];
		var keysServer = pki.rsa.generateKeyPair(1024);
		var certServer = pki.createCertificate();
		certServer.publicKey = keysServer.publicKey;
		certServer.serialNumber = this.randomSerialNumber();
		certServer.validity.notBefore = new Date();
		certServer.validity.notBefore.setDate(certServer.validity.notBefore.getDate() - 1);
		certServer.validity.notAfter = new Date();
		certServer.validity.notAfter.setFullYear(certServer.validity.notBefore.getFullYear() + 2);
		var attrsServer = ServerAttrs.slice(0);
		attrsServer.unshift({
			name: 'commonName',
			value: mainHost
		})
		certServer.setSubject(attrsServer);
		certServer.setIssuer(this.CAcert.issuer.attributes);
		certServer.setExtensions(ServerExtensions.concat([{
			name: 'subjectAltName',
			altNames: hosts.map(function (host) {
				if (host.match(/^[\d\.]+$/)) {
					return { type: 7, ip: host };
				}
				return { type: 2, value: host };
			})
		}]));
		certServer.sign(this.CAkeys.privateKey, Forge.md.sha256.create());
		var certPem = pki.certificateToPem(certServer);
		var keyPrivatePem = pki.privateKeyToPem(keysServer.privateKey)
		var keyPublicPem = pki.publicKeyToPem(keysServer.publicKey)
		FS.writeFile(this.certsFolder + '/' + mainHost.replace(/\*/g, '_') + '.pem', certPem, function (error) {
			if (error) console.error("Failed to save certificate to disk in " + self.certsFolder, error);
		});
		FS.writeFile(this.keysFolder + '/' + mainHost.replace(/\*/g, '_') + '.key', keyPrivatePem, function (error) {
			if (error) console.error("Failed to save private key to disk in " + self.keysFolder, error);
		});
		FS.writeFile(this.keysFolder + '/' + mainHost.replace(/\*/g, '_') + '.public.key', keyPublicPem, function (error) {
			if (error) console.error("Failed to save public key to disk in " + self.keysFolder, error);
		});
		// returns synchronously even before files get written to disk
		cb(certPem, keyPrivatePem);
	};

	public getCACertPath() {
		return this.certsFolder + '/ca.pem';
	};

}
