/*!
 * rsa-compat
 * Copyright(c) 2016 AJ ONeal <aj@daplie.com> https://daplie.com
 * Apache-2.0 OR MIT (and hence also MPL 2.0)
*/
'use strict';

var RSA = {};
var NOBJ = {};

function create(deps) {
  var crypto = require('crypto');

  deps = deps || {};
  deps.NOBJ = {};
  deps.RSA = RSA;

  try {
    RSA._URSA = require('ursa');
  } catch(e) {
    // ignore
  }

  RSA.utils = require('./lib/key-utils.js');
  RSA.utils.toWebsafeBase64 = function (b64) {
    return b64.replace(/[+]/g, "-").replace(/\//g, "_").replace(/=/g,"");
  };

  RSA.utils._forgeBytesToBuf = function (bytes) {
    var forge = require("node-forge");
    return new Buffer(forge.util.bytesToHex(bytes), "hex");
  };
  RSA._internal = require('./lib/node');//.create(deps);

  RSA._thumbprintInput = function (n, e) {
    // #L147 const rsaThumbprintTemplate = `{"e":"%s","kty":"RSA","n":"%s"}`
    return new Buffer('{"e":"'+ e + '","kty":"RSA","n":"'+ n +'"}', 'ascii');
  };
  RSA.thumbprint = function (keypair) {
    var publicKeyJwk = RSA.exportPublicJwk(keypair);

    if (!publicKeyJwk.e || !publicKeyJwk.n) {
      throw new Error("You must provide an RSA jwk with 'e' and 'n' (the public components)");
    }

    var input = RSA._thumbprintInput(publicKeyJwk.n, publicKeyJwk.e);
    var base64Digest = crypto.createHash('sha256').update(input).digest('base64');

    return RSA.utils.toWebsafeBase64(base64Digest);
  };

  RSA.generateKeypair = function (length, exponent, options, cb) {
    if (!RSA._URSA && /arm|mips/i.test(require('os').arch) && !RSA._SLOW_WARN) {
      console.warn("================================================================");
      console.warn("                         WARNING");
      console.warn("================================================================");
      console.warn("");
      console.warn("WARNING: You are generating an RSA key using pure JavaScript on");
      console.warn("         a VERY SLOW cpu. This could take DOZENS of minutes!");
      console.warn("");
      console.warn("         We recommend installing a C compiler and 'ursa'");
      console.warn("");
      console.warn("EXAMPLE:");
      console.warn("");
      console.warn("        sudo apt-get install build-essential && npm install ursa");
      console.warn("");
      console.warn("================================================================");
      RSA._SLOW_WARN = true;
    }
    var keypair = {
      privateKeyPem: undefined
    , publicKeyPem: undefined
    , privateKeyJwk: undefined
    , publicKeyJwk: undefined
    , _ursa: undefined
    , _ursaPublic: undefined
    , _forge: undefined
    , _forgePublic: undefined
    };

    options = options || NOBJ;

    RSA._internal.generateKeypair(length, exponent, options, function (err, keys) {
      if (false !== options.jwk || options.thumbprint) {
        keypair.privateKeyJwk = RSA._internal.exportPrivateJwk(keys);
        if (options.public) {
          keypair.publicKeyJwk = RSA._internal.exportPublicJwk(keys);
        }
      }

      if (options.pem) {
        keypair.privateKeyPem = RSA._internal.exportPrivatePem(keys);
        if (options.public) {
          keypair.publicKeyPem = RSA._internal.exportPublicPem(keys);
        }
      }

      if (options.thumprint) {
        keypair.thumbprint = RSA.thumbprint(keypair);
      }

      if (options.internal) {
        //keypair._ursa = undefined;
        //keypair._forge = undefined;
        keypair._ursa = keys._ursa;
        keypair._forge = keys._forge;
      }

      cb(null, keypair);
      return;
    });
  };

  RSA.import = function (keypair/*, options*/) {
    keypair = RSA._internal.import(keypair, { internal: true });
    keypair = RSA._internal.importForge(keypair, { internal: true });
    //options = options || NOBJ; // ignore
    if (keypair.privateKeyJwk || keypair.privateKeyPem || keypair._ursa || keypair._forge) {
      keypair.privateKeyJwk = RSA._internal.exportPrivateJwk(keypair, { internal: true });
      //keypair.privateKeyPem = RSA._internal.exportPrivatePem(keypair, { internal: true });
      return keypair;
    }

    if (keypair.publicKeyJwk || keypair.publicKeyPem || keypair._ursaPublic || keypair._forgePublic) {
      keypair.publicKeyJwk = RSA._internal.exportPublicJwk(keypair, { internal: true });
      //keypair.publicKeyPem = RSA._internal.exportPublicPem(keypair, { internal: true });
      return keypair;
    }

    throw new Error('found neither private nor public keypair in any supported format');
  };

  RSA._ursaGenerateSig = function (keypair, sha256Buf) {
    var sig = keypair._ursa.sign('sha256', sha256Buf);
    var sig64 = RSA.utils.toWebsafeBase64(sig.toString('base64'));

    return sig64;
  };
  RSA._forgeGenerateSig = function (keypair, sha256Buf) {
    var forge = require('node-forge');
    var bufF = forge.util.createBuffer(sha256Buf.toString('binary'), 'binary');
    var md = {
      algorithm: 'sha256'
    , blockLength: 64
    , digestLength: 20
    , digest: function () {
        return bufF;
      }
    };
    var sigF = keypair._forge.sign(md);
    var sig64 = RSA.utils.toWebsafeBase64(
      new Buffer(forge.util.bytesToHex(sigF), "hex").toString('base64')
    );

    return sig64;
  };

  RSA.signJws = RSA.generateJws = RSA.generateSignatureJws = RSA.generateSignatureJwk =
  function (keypair, payload, nonce) {
    keypair = RSA._internal.import(keypair);
    keypair = RSA._internal.importForge(keypair);
    keypair.publicKeyJwk = RSA.exportPublicJwk(keypair);

    // Compute JWS signature
    var protectedHeader = "";
    if (nonce) {
      protectedHeader = JSON.stringify({nonce: nonce});
    }
    var protected64 = RSA.utils.toWebsafeBase64(new Buffer(protectedHeader).toString('base64'));
    var payload64 = RSA.utils.toWebsafeBase64(payload.toString('base64'));
    var raw = protected64 + "." + payload64;
    var sha256Buf = crypto.createHash('sha256').update(raw).digest();
    var sig64;

    if (RSA._URSA) {
      sig64 = RSA._ursaGenerateSig(keypair, sha256Buf);
    } else {
      sig64 = RSA._forgeGenerateSig(keypair, sha256Buf);
    }

    return {
      header: {
        alg: "RS256"
      , jwk: keypair.publicKeyJwk
      }
    , protected: protected64
    , payload: payload64
    , signature: sig64
    };
  };

  //
  // Generate CSR
  //
  RSA._generateCsrForge = function (keypair, names) {
    var forge = require('node-forge');
    keypair = RSA._internal.importForge(keypair);

    // Create and sign the CSR
    var csr = forge.pki.createCertificationRequest();
    csr.publicKey = keypair._forgePublic;
    // TODO should the commonName be shift()ed off so that it isn't also in altNames?
    // http://stackoverflow.com/questions/5935369/ssl-how-do-common-names-cn-and-subject-alternative-names-san-work-together
    csr.setSubject([{ name: 'commonName', value: names[0] }]);

    var sans = names.map(function (name) {
      return { type: 2, value: name };
    });
    csr.setAttributes([{
      name: 'extensionRequest',
      extensions: [{name: 'subjectAltName', altNames: sans}]
    }]);

    // TODO wrap with node crypto (as done for signature)
    csr.sign(keypair._forge, forge.md.sha256.create());

    return csr;
  };
  RSA.generateCsrAsn1 = function (keypair, names) {
    var forge = require('node-forge');
    var csr = RSA._generateCsrForge(keypair, names);
    var asn1 = forge.pki.certificationRequestToAsn1(csr);

    return RSA.utils._forgeBytesToBuf(asn1);
  };
  RSA.generateCsrPem = function (keypair, names) {
    var forge = require('node-forge');
    var csr = RSA._generateCsrForge(keypair, names);
    return forge.pki.certificationRequestToPem(csr);
  };
  RSA.generateCsrDer = function (keypair, names) {
    var forge = require('node-forge');
    var csr = RSA._generateCsrForge(keypair, names);
    var asn1 = forge.pki.certificationRequestToAsn1(csr);
    var der = forge.asn1.toDer(asn1);

    return RSA.utils._forgeBytesToBuf(der);
  };
  RSA.generateCsrDerWeb64 =RSA.generateCsrWeb64 = function (keypair, names) {
    var buf = RSA.generateCsrDer(keypair, names);
    var b64 = buf.toString('base64');
    var web64 = RSA.utils.toWebsafeBase64(b64);
    return web64;
  };

  RSA.exportPrivateKey = RSA._internal.exportPrivatePem;
  RSA.exportPublicKey = RSA._internal.exportPublicPem;
  RSA.exportPrivatePem = RSA._internal.exportPrivatePem;
  RSA.exportPublicPem = RSA._internal.exportPublicPem;

  RSA.exportPrivateJwk = RSA._internal.exportPrivateJwk;
  RSA.exportPublicJwk = RSA._internal.exportPublicJwk;

  return RSA;
}

module.exports.RSA = create(/*require('./lib/node')*/);
//module.exports.RSA.create = create;
