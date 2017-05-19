import Forge = require('node-forge');
import pki = Forge.pki;
export declare class CA {
    baseCAFolder: string;
    certsFolder: string;
    keysFolder: string;
    CAcert: pki.Certificate;
    CAkeys: pki.KeyPair;
    constructor(baseCAFolder: string, callback: (err: Error | undefined, ca: CA) => void);
    randomSerialNumber(): string;
    generateCA(callback: any): void;
    loadCA(callback: any): void;
    generateServerCertificateKeys(hosts: string | string[], cb: any): void;
    getCACertPath(): string;
}
