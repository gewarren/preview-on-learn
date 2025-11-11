// Simple encryption utility for GitHub tokens
// Uses Web Crypto API for AES-GCM encryption

class TokenEncryption {
    constructor() {
        this.algorithm = 'AES-GCM';
        this.keyLength = 256;
    }

    // Generate a random encryption key.
    async generateKey() {
        return await crypto.subtle.generateKey(
            {
                name: this.algorithm,
                length: this.keyLength
            },
            true, // extractable
            ['encrypt', 'decrypt']
        );
    }

    // Derive a key from a password (browser session ID or similar).
    async deriveKeyFromPassword(password) {
        const encoder = new TextEncoder();
        const data = encoder.encode(password);

        // Import the password as raw key material.
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            data,
            'PBKDF2',
            false,
            ['deriveBits', 'deriveKey']
        );

        // Derive the key.
        return await crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: encoder.encode('preview-on-learn-salt'), // Static salt for simplicity
                iterations: 100000,
                hash: 'SHA-256'
            },
            keyMaterial,
            {
                name: this.algorithm,
                length: this.keyLength
            },
            false,
            ['encrypt', 'decrypt']
        );
    }

    // Get a consistent encryption key for this browser session.
    async getEncryptionKey() {
        // Use a combination of user agent and a static string as password.
        const password = navigator.userAgent + 'preview-on-learn-key-2025';
        return await this.deriveKeyFromPassword(password);
    }

    // Encrypt a token.
    async encryptToken(token) {
        try {
            const key = await this.getEncryptionKey();
            const encoder = new TextEncoder();
            const data = encoder.encode(token);

            // Generate a random initialization vector.
            const iv = crypto.getRandomValues(new Uint8Array(12));

            // Encrypt the data.
            const encryptedData = await crypto.subtle.encrypt(
                {
                    name: this.algorithm,
                    iv: iv
                },
                key,
                data
            );

            // Combine IV and encrypted data.
            const combined = new Uint8Array(iv.length + encryptedData.byteLength);
            combined.set(iv, 0);
            combined.set(new Uint8Array(encryptedData), iv.length);

            // Convert to base64 for storage.
            return btoa(String.fromCharCode(...combined));
        } catch (error) {
            console.error('Error encrypting token:', error);
            throw new Error('Failed to encrypt token');
        }
    }

    // Decrypt a token.
    async decryptToken(encryptedToken) {
        try {
            const key = await this.getEncryptionKey();

            // Convert from base64.
            const combined = new Uint8Array(
                atob(encryptedToken).split('').map(char => char.charCodeAt(0))
            );

            // Extract IV and encrypted data.
            const iv = combined.slice(0, 12);
            const encryptedData = combined.slice(12);

            // Decrypt the data.
            const decryptedData = await crypto.subtle.decrypt(
                {
                    name: this.algorithm,
                    iv: iv
                },
                key,
                encryptedData
            );

            // Convert back to string.
            const decoder = new TextDecoder();
            return decoder.decode(decryptedData);
        } catch (error) {
            console.error('Error decrypting token:', error);
            throw new Error('Failed to decrypt token');
        }
    }
}

// Export a singleton instance.
export const tokenEncryption = new TokenEncryption();
