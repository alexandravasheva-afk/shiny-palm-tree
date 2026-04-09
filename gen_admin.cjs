
const crypto = require('crypto');

async function generateAdminData() {
  const password = 'Platon2026';
  const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
  
  // Generate ECDH key pair in SPKI and PKCS8 formats
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' }
  });
  
  const publicKeyBase64 = publicKey.toString('base64');
  const privateKeyBase64 = privateKey.toString('base64');
  
  // PBKDF2 to derive key from password
  const salt = 'safems-salt';
  const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  
  // Encrypt private key with AES-256-GCM
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  // We need to encrypt the BASE64 string of the private key, because the client expects a string after decryption
  const dataToEncrypt = privateKeyBase64;
  
  let encrypted = cipher.update(dataToEncrypt, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const tag = cipher.getAuthTag();
  
  // Combine IV + Ciphertext + Tag
  const combined = Buffer.concat([iv, encrypted, tag]);
  const encryptedPrivateKey = combined.toString('base64');
  
  console.log(JSON.stringify({
    passwordHash,
    publicKeyBase64,
    encryptedPrivateKey
  }, null, 2));
}

generateAdminData();
