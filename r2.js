// ============================================================
// Cloudflare R2 Storage Module (S3-compatible)
// Handles PDF uploads for Special Order documents
// ============================================================
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');

// ── Configuration ───────────────────────────────────────────
const R2_ACCOUNT_ID     = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID  = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME    = process.env.R2_BUCKET_NAME || 'leave-form-uploads';

// R2 is optional – if not configured, PDFs stay as base64 in the DB
const r2Enabled = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY);

let s3Client = null;

if (r2Enabled) {
    s3Client = new S3Client({
        region: 'auto',
        endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: R2_ACCESS_KEY_ID,
            secretAccessKey: R2_SECRET_ACCESS_KEY,
        },
    });
    console.log('[R2] Cloudflare R2 storage enabled ✓');
} else {
    console.log('[R2] R2 not configured – PDFs will be stored as base64 in the database');
}

// ── Upload a file to R2 ─────────────────────────────────────
/**
 * Upload a buffer or base64 string to R2.
 * @param {Buffer|string} body       – file content (Buffer) or base64 string
 * @param {string}        fileName   – original file name
 * @param {string}        contentType – MIME type (default: application/pdf)
 * @param {string}        [folder]   – optional folder prefix (e.g. 'so-documents')
 * @returns {Promise<{key: string, url: string}|null>}  null if R2 not enabled
 */
async function uploadFile(body, fileName, contentType = 'application/pdf', folder = 'so-documents') {
    if (!r2Enabled) return null;

    // Convert base64 to Buffer if needed
    let buffer = body;
    if (typeof body === 'string') {
        // Strip data URI prefix if present  (e.g. "data:application/pdf;base64,...")
        const base64Data = body.includes(',') ? body.split(',')[1] : body;
        buffer = Buffer.from(base64Data, 'base64');
    }

    // Generate unique key
    const ext = fileName.split('.').pop() || 'pdf';
    const uniqueName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
    const key = `${folder}/${uniqueName}`;

    await s3Client.send(new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentType: contentType,
    }));

    console.log(`[R2] Uploaded: ${key} (${buffer.length} bytes)`);
    return { key, size: buffer.length };
}

// ── Get a pre-signed download URL ───────────────────────────
/**
 * Generate a temporary pre-signed URL for downloading a file.
 * @param {string} key        – R2 object key
 * @param {number} expiresIn  – URL lifetime in seconds (default: 1 hour)
 * @returns {Promise<string|null>}  null if R2 not enabled
 */
async function getFileUrl(key, expiresIn = 3600) {
    if (!r2Enabled) return null;

    const command = new GetObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
    });
    return await getSignedUrl(s3Client, command, { expiresIn });
}

// ── Delete a file from R2 ───────────────────────────────────
async function deleteFile(key) {
    if (!r2Enabled) return;

    await s3Client.send(new DeleteObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
    }));
    console.log(`[R2] Deleted: ${key}`);
}

// ── Check if R2 is available ────────────────────────────────
function isEnabled() {
    return r2Enabled;
}

module.exports = {
    uploadFile,
    getFileUrl,
    deleteFile,
    isEnabled,
};
