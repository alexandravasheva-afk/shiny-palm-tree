// E2EE Crypto Utilities using Web Crypto API

// Convert ArrayBuffer to Base64 string asynchronously for better performance with large files
export async function arrayBufferToBase64(buffer: ArrayBuffer): Promise<string> {
  return new Promise((resolve) => {
    const blob = new Blob([buffer]);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      resolve(base64);
    };
    reader.readAsDataURL(blob);
  });
}

// Convert Base64 string to ArrayBuffer asynchronously
export async function base64ToArrayBuffer(base64: string): Promise<ArrayBuffer> {
  // Using atob and Uint8Array is very fast and avoids URL length limits of fetch()
  const binary_string = window.atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}

// Generate ECDH Key Pair
export async function generateKeyPair(): Promise<CryptoKeyPair> {
  return await window.crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    true, // extractable
    ['deriveKey', 'deriveBits']
  );
}

// Export Public Key to Base64 string (SPKI format)
export async function exportPublicKey(key: CryptoKey): Promise<string> {
  const exported = await window.crypto.subtle.exportKey('spki', key);
  return await arrayBufferToBase64(exported);
}

// Import Public Key from Base64 string (SPKI format)
export async function importPublicKey(base64Key: string): Promise<CryptoKey> {
  const buffer = await base64ToArrayBuffer(base64Key);
  return await window.crypto.subtle.importKey(
    'spki',
    buffer,
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    true,
    []
  );
}

// Export Private Key to Base64 string (PKCS8 format)
export async function exportPrivateKey(key: CryptoKey): Promise<string> {
  const exported = await window.crypto.subtle.exportKey('pkcs8', key);
  return await arrayBufferToBase64(exported);
}

// Import Private Key from Base64 string (PKCS8 format)
export async function importPrivateKey(base64Key: string): Promise<CryptoKey> {
  const buffer = await base64ToArrayBuffer(base64Key);
  return await window.crypto.subtle.importKey(
    'pkcs8',
    buffer,
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    true,
    ['deriveKey', 'deriveBits']
  );
}

// Derive shared AES-GCM key using our private key and their public key
export async function deriveSharedKey(privateKey: CryptoKey, publicKey: CryptoKey): Promise<CryptoKey> {
  return await window.crypto.subtle.deriveKey(
    {
      name: 'ECDH',
      public: publicKey,
    },
    privateKey,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false, // non-extractable
    ['encrypt', 'decrypt']
  );
}

// Encrypt a string message using the shared AES-GCM key (returns binary ciphertext and iv)
export async function encryptMessageBinary(sharedKey: CryptoKey, message: string): Promise<{ ciphertext: ArrayBuffer; iv: Uint8Array }> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const iv = window.crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for GCM

  const encryptedBuffer = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv,
    },
    sharedKey,
    data
  );

  return {
    ciphertext: encryptedBuffer,
    iv: iv,
  };
}

// Decrypt a message using the shared AES-GCM key (takes binary ciphertext and iv)
export async function decryptMessageBinary(sharedKey: CryptoKey, ciphertext: ArrayBuffer, iv: ArrayBuffer): Promise<string> {
  try {
    const decryptedBuffer = await window.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: new Uint8Array(iv),
      },
      sharedKey,
      ciphertext
    );

    const decoder = new TextDecoder();
    return decoder.decode(decryptedBuffer);
  } catch (e) {
    console.error('Decryption failed', e);
    return '[Decryption Failed]';
  }
}

// Hash a string (e.g. password) using SHA-256
export async function hashString(str: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Derive a symmetric key from a password using PBKDF2
export async function deriveKeyFromPassword(password: string, salt: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordData = encoder.encode(password);
  const saltData = encoder.encode(salt);

  const baseKey = await window.crypto.subtle.importKey(
    'raw',
    passwordData,
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return await window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltData,
      iterations: 100000,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// Encrypt data with a password
export async function encryptWithPassword(data: string, password: string): Promise<string> {
  const salt = 'safems-salt'; // In a real app, use a unique salt per user
  const key = await deriveKeyFromPassword(password, salt);
  const { ciphertext, iv } = await encryptMessageBinary(key, data);
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return await arrayBufferToBase64(combined.buffer);
}

// Decrypt data with a password
export async function decryptWithPassword(encryptedBase64: string, password: string): Promise<string> {
  try {
    const salt = 'safems-salt';
    const key = await deriveKeyFromPassword(password, salt);
    const combined = await base64ToArrayBuffer(encryptedBase64);
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    return await decryptMessageBinary(key, ciphertext, iv);
  } catch (e) {
    console.error('Password decryption failed', e);
    throw new Error('Invalid password or corrupted data');
  }
}
