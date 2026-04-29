import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { app } from 'electron'

// package.json name stays lowercase for npm; userData folder name uses this
app.setName('Genie')

// --- Configuration Constants ---
const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16 // For AES, this is always 16
const SALT_LENGTH = 16 // For KDF
const AUTH_TAG_LENGTH = 16 // For GCM

// scrypt is memory-hard and available in all node versions
// N=16384 r=8 p=1 uses ~16MB RAM per derivation, good enough for local app
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 }
const KEY_LENGTH = 32

// --- Path Management ---
// Centralize path knowledge here for the store's use.
const BASE_PATH = app.getPath('userData')
const CHATS_DIR = path.join(BASE_PATH, 'chats')

// Ensure directories exist on startup
if (!fs.existsSync(CHATS_DIR)) {
  fs.mkdirSync(CHATS_DIR, { recursive: true })
}

const PATHS = {
  masterKey: path.join(BASE_PATH, 'master.key'),
  manifest: path.join(BASE_PATH, 'manifest.json.enc')
}

class SecureStore {
  constructor() {
    this.dek = null // The Data Encryption Key, held in RAM only
  }

  /**
   * Checks if the master key file exists, indicating if setup has run.
   */
  isSetup() {
    return fs.existsSync(PATHS.masterKey)
  }

  /**
   * Checks if the DEK is loaded into memory.
   */
  isLocked() {
    return this.dek === null
  }

  /**
   * Initial setup for a new user. Creates the master key.
   * @param {string} password - The user's chosen password.
   * @returns {boolean} - True on success.
   */
  setup(password) {
    if (this.isSetup()) return false // Don't allow overwrite

    // 1. Create a random Data Encryption Key (DEK)
    const dek = crypto.randomBytes(32)

    // 2. Create a random salt for the KDF
    const salt = crypto.randomBytes(SALT_LENGTH)

    // 3. Derive the Key Encryption Key (KEK) from the password
    const kek = crypto.scryptSync(password, salt, KEY_LENGTH, SCRYPT_OPTIONS)

    // 4. Encrypt the DEK with the KEK
    const iv = crypto.randomBytes(IV_LENGTH)
    const cipher = crypto.createCipheriv(ALGORITHM, kek, iv)
    const encryptedDEK = Buffer.concat([cipher.update(dek), cipher.final()])
    const authTag = cipher.getAuthTag()

    // 5. Write master.key file: salt + iv + authTag + encryptedDEK
    fs.writeFileSync(PATHS.masterKey, Buffer.concat([salt, iv, authTag, encryptedDEK]))

    // 6. Keep the DEK in memory for the current session
    this.dek = dek
    return true
  }

  /**
   * Unlocks the store by decrypting the DEK with the user's password.
   * @param {string} password - The password to try.
   * @returns {boolean} - True on success, false on failure.
   */
  unlock(password) {
    if (!this.isSetup()) return false

    try {
      // 1. Read the master key file
      const masterKeyBuffer = fs.readFileSync(PATHS.masterKey)

      // 2. Extract parts: salt, iv, authTag, encryptedDEK
      const salt = masterKeyBuffer.subarray(0, SALT_LENGTH)
      const iv = masterKeyBuffer.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH)
      const authTag = masterKeyBuffer.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH)
      const encryptedDEK = masterKeyBuffer.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH)

      // 3. Re-derive the KEK from the provided password
      const kek = crypto.scryptSync(password, salt, KEY_LENGTH, SCRYPT_OPTIONS)

      // 4. Attempt to decrypt the DEK
      const decipher = crypto.createDecipheriv(ALGORITHM, kek, iv)
      decipher.setAuthTag(authTag)
      const decryptedDEK = Buffer.concat([decipher.update(encryptedDEK), decipher.final()])

      // 5. If decryption succeeds, store the DEK in memory
      this.dek = decryptedDEK
      return true
    } catch (error) {
      // If decryption fails (wrong password), the final() call throws an error.
      this.dek = null
      console.error("Unlock failed:", error.message)
      return false
    }
  }

  /**
   * Loads and decrypts a data file.
   * @param {string} type - e.g., 'manifest', 'chat'.
   * @param {string} [id] - The chat ID, if loading a chat.
   * @returns {object | null} - The decrypted JSON object or null on failure.
   */
  load(type, id) {
    if (this.isLocked()) return null

    const filepath = (type === 'manifest') ? PATHS.manifest : path.join(CHATS_DIR, `${id}.json.enc`);

    if (!fs.existsSync(filepath)) return null

    try {
      const fileBuffer = fs.readFileSync(filepath)
      const iv = fileBuffer.subarray(0, IV_LENGTH)
      const authTag = fileBuffer.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
      const encryptedData = fileBuffer.subarray(IV_LENGTH + AUTH_TAG_LENGTH)

      const decipher = crypto.createDecipheriv(ALGORITHM, this.dek, iv)
      decipher.setAuthTag(authTag)
      const decryptedJson = Buffer.concat([decipher.update(encryptedData), decipher.final()]).toString('utf8')

      return JSON.parse(decryptedJson)
    } catch (error) {
      console.error(`Failed to load/decrypt ${filepath}:`, error)
      return null
    }
  }

  /**
   * Encrypts and saves a data file.
   * @param {string} type - e.g., 'manifest', 'chat'.
   * @param {object} data - The JSON object to save.
   * @param {string} [id] - The chat ID, if saving a chat. 
   * @returns {boolean} - True on success.
   */
  save(type, data, id) {
    if (this.isLocked()) return false

    const filepath = (type === 'manifest') ? PATHS.manifest : path.join(CHATS_DIR, `${id}.json.enc`);
    const jsonData = JSON.stringify(data)

    try {
      const iv = crypto.randomBytes(IV_LENGTH)
      const cipher = crypto.createCipheriv(ALGORITHM, this.dek, iv)
      const encryptedData = Buffer.concat([cipher.update(jsonData), cipher.final()])
      const authTag = cipher.getAuthTag()

      fs.writeFileSync(filepath, Buffer.concat([iv, authTag, encryptedData]))
      return true
    } catch (error) {
      console.error(`Failed to save/encrypt ${filepath}:`, error)
      return false
    }
  }
  // re-encrypt DEK with a new password, keeps everything else intact
  changePassword(oldPassword, newPassword) {
    if (this.isLocked()) return false
    if (!this.unlock(oldPassword)) return false

    const salt = crypto.randomBytes(SALT_LENGTH)
    const kek = crypto.scryptSync(newPassword, salt, KEY_LENGTH, SCRYPT_OPTIONS)
    const iv = crypto.randomBytes(IV_LENGTH)
    const cipher = crypto.createCipheriv(ALGORITHM, kek, iv)
    const encryptedDEK = Buffer.concat([cipher.update(this.dek), cipher.final()])
    const authTag = cipher.getAuthTag()

    fs.writeFileSync(PATHS.masterKey, Buffer.concat([salt, iv, authTag, encryptedDEK]))
    return true
  }

  // nuke everything - master key, manifest, all chats
  deleteAll() {
    this.dek = null
    try { fs.unlinkSync(PATHS.masterKey) } catch (e) { /* may not exist */ }
    try { fs.unlinkSync(PATHS.manifest) } catch (e) { /* may not exist */ }
    const chatFiles = fs.readdirSync(CHATS_DIR)
    for (const f of chatFiles) {
      try { fs.unlinkSync(path.join(CHATS_DIR, f)) } catch (e) { /* skip */ }
    }
  }
}

// Export a single instance for the app to use
export const db = new SecureStore()