/**
 * XINNIX Cryptographic Layer v2.0
 * 
 * Ed25519 for identity (signing/verification)
 * X25519 for key exchange (Diffie-Hellman)
 * XSalsa20-Poly1305 for encrypted messaging
 * 
 * v2 changes:
 * - Client-side key generation ONLY (no server-side key exposure)
 * - Signed requests required for all write operations
 * - Challenge-response identity verification
 * - Key revocation support via signed revocation certificates
 */

import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import crypto from 'node:crypto';

const { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } = naclUtil;

export class XinnixIdentity {
  constructor(existing = null) {
    if (existing) {
      this.signingKeys = {
        publicKey: decodeBase64(existing.signingPublicKey),
        secretKey: decodeBase64(existing.signingSecretKey)
      };
      this.encryptionKeys = {
        publicKey: decodeBase64(existing.encryptionPublicKey),
        secretKey: decodeBase64(existing.encryptionSecretKey)
      };
      this.agentId = existing.agentId;
    } else {
      this.signingKeys = nacl.sign.keyPair();
      this.encryptionKeys = nacl.box.keyPair();
      this.agentId = Buffer.from(this.signingKeys.publicKey.slice(0, 16)).toString('hex');
    }
  }

  export() {
    return {
      agentId: this.agentId,
      signingPublicKey: encodeBase64(this.signingKeys.publicKey),
      signingSecretKey: encodeBase64(this.signingKeys.secretKey),
      encryptionPublicKey: encodeBase64(this.encryptionKeys.publicKey),
      encryptionSecretKey: encodeBase64(this.encryptionKeys.secretKey)
    };
  }

  publicProfile() {
    return {
      agentId: this.agentId,
      signingPublicKey: encodeBase64(this.signingKeys.publicKey),
      encryptionPublicKey: encodeBase64(this.encryptionKeys.publicKey)
    };
  }

  sign(message) {
    const msgBytes = decodeUTF8(typeof message === 'string' ? message : JSON.stringify(message));
    const signature = nacl.sign.detached(msgBytes, this.signingKeys.secretKey);
    return encodeBase64(signature);
  }

  static verify(message, signature, signingPublicKey) {
    try {
      const msgBytes = decodeUTF8(typeof message === 'string' ? message : JSON.stringify(message));
      const sigBytes = decodeBase64(signature);
      const pubBytes = decodeBase64(signingPublicKey);
      return nacl.sign.detached.verify(msgBytes, sigBytes, pubBytes);
    } catch {
      return false;
    }
  }

  encrypt(plaintext, recipientEncryptionPublicKey) {
    const nonce = nacl.randomBytes(nacl.box.nonceLength);
    const msgBytes = decodeUTF8(typeof plaintext === 'string' ? plaintext : JSON.stringify(plaintext));
    const recipientKey = decodeBase64(recipientEncryptionPublicKey);
    const encrypted = nacl.box(msgBytes, nonce, recipientKey, this.encryptionKeys.secretKey);
    return {
      nonce: encodeBase64(nonce),
      ciphertext: encodeBase64(encrypted),
      senderEncryptionPublicKey: encodeBase64(this.encryptionKeys.publicKey)
    };
  }

  decrypt(encryptedMsg) {
    const nonce = decodeBase64(encryptedMsg.nonce);
    const ciphertext = decodeBase64(encryptedMsg.ciphertext);
    const senderKey = decodeBase64(encryptedMsg.senderEncryptionPublicKey);
    const decrypted = nacl.box.open(ciphertext, nonce, senderKey, this.encryptionKeys.secretKey);
    if (!decrypted) throw new Error('Decryption failed - invalid key or tampered message');
    return encodeUTF8(decrypted);
  }

  static generateChallenge() {
    return encodeBase64(nacl.randomBytes(32));
  }

  // Create a signed request (for authenticated API calls)
  createSignedRequest(payload) {
    const request = {
      agentId: this.agentId,
      timestamp: Date.now(),
      nonce: encodeBase64(nacl.randomBytes(16)),
      payload
    };
    const canonical = JSON.stringify(request);
    return {
      ...request,
      signature: this.sign(canonical),
      signingPublicKey: encodeBase64(this.signingKeys.publicKey)
    };
  }

  // Verify a signed request from another agent
  static verifySignedRequest(request, maxAgeMs = 300000) {
    const { signature, signingPublicKey, ...rest } = request;
    if (!signature || !signingPublicKey) return { valid: false, reason: 'Missing signature or public key' };

    // Check timestamp freshness (default 5 min window)
    if (rest.timestamp && (Date.now() - rest.timestamp) > maxAgeMs) {
      return { valid: false, reason: 'Request expired' };
    }

    const canonical = JSON.stringify(rest);
    const valid = XinnixIdentity.verify(canonical, signature, signingPublicKey);
    if (!valid) return { valid: false, reason: 'Invalid signature' };

    // Derive agentId from public key to verify it matches claimed agentId
    const pubBytes = decodeBase64(signingPublicKey);
    const derivedId = Buffer.from(pubBytes.slice(0, 16)).toString('hex');
    if (rest.agentId && rest.agentId !== derivedId) {
      return { valid: false, reason: 'agentId does not match signing key' };
    }

    return { valid: true, agentId: derivedId };
  }

  // Create a key revocation certificate (signed proof that this key is dead)
  createRevocationCert(reason = 'Key compromised') {
    const cert = {
      type: 'XINNIX_REVOCATION',
      agentId: this.agentId,
      signingPublicKey: encodeBase64(this.signingKeys.publicKey),
      reason,
      revokedAt: Date.now()
    };
    const canonical = JSON.stringify(cert);
    cert.signature = this.sign(canonical);
    return cert;
  }

  // Verify a revocation certificate
  static verifyRevocationCert(cert) {
    const { signature, ...rest } = cert;
    if (rest.type !== 'XINNIX_REVOCATION') return false;
    const canonical = JSON.stringify(rest);
    return XinnixIdentity.verify(canonical, signature, rest.signingPublicKey);
  }

  createEnvelope(payload, type = 'message') {
    const envelope = {
      version: 'XINNIX/2.0',
      type,
      from: this.agentId,
      timestamp: Date.now(),
      payload
    };
    const canonical = JSON.stringify(envelope);
    envelope.signature = this.sign(canonical);
    envelope.signingPublicKey = encodeBase64(this.signingKeys.publicKey);
    return envelope;
  }

  static verifyEnvelope(envelope) {
    const { signature, signingPublicKey, ...rest } = envelope;
    const canonical = JSON.stringify(rest);
    return XinnixIdentity.verify(canonical, signature, signingPublicKey);
  }
}

export function deriveSharedSecret(mySecretKey, theirPublicKey) {
  const secret = nacl.box.before(
    decodeBase64(theirPublicKey),
    decodeBase64(mySecretKey)
  );
  return encodeBase64(secret);
}

export function hash(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export default XinnixIdentity;
