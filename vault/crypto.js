// All crypto uses the browser's built-in Web Crypto API — no external libraries.
// PIN → PBKDF2 key → AES-GCM encrypt/decrypt stored data.

const enc = new TextEncoder();
const dec = new TextDecoder();

async function pinToKey(pin, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function hashPin(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await pinToKey(pin, salt);
  // Encrypt a known sentinel to verify PIN later
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode('VAULT_OK'));
  return {
    salt: b64(salt),
    iv: b64(iv),
    ct: b64(new Uint8Array(ct))
  };
}

export async function verifyPin(pin, stored) {
  try {
    const salt = unb64(stored.salt);
    const iv = unb64(stored.iv);
    const ct = unb64(stored.ct);
    const key = await pinToKey(pin, salt);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return dec.decode(plain) === 'VAULT_OK';
  } catch { return false; }
}

export async function encryptData(pin, storedHash, data) {
  const salt = unb64(storedHash.salt);
  const key = await pinToKey(pin, salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(data)));
  return { iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}

export async function decryptData(pin, storedHash, blob) {
  const salt = unb64(storedHash.salt);
  const key = await pinToKey(pin, salt);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.ct)
  );
  return JSON.parse(dec.decode(plain));
}

function b64(buf) {
  return btoa(String.fromCharCode(...buf));
}
function unb64(str) {
  return new Uint8Array([...atob(str)].map(c => c.charCodeAt(0)));
}
