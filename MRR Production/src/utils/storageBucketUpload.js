// src/utils/storageBucketUpload.js
import { supabase } from "./supabase";

/**
 * Converts a Base64 Image String into a raw binary Blob/File object 
 * so it can be uploaded cleanly via standard multi-part boundary streams.
 */
function base64ToBlob(base64Data, contentType = "image/jpeg") {
  const byteCharacters = atob(base64Data.split(",")[1]);
  const byteArrays = [];

  for (let offset = 0; offset < byteCharacters.length; offset += 512) {
    const slice = byteCharacters.slice(offset, offset + 512);
    const byteNumbers = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) {
      byteNumbers[i] = slice.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    byteArrays.push(byteArray);
  }

  return new Blob(byteArrays, { type: contentType });
}

/**
 * Uploads a base64 compressed string to a Supabase Storage bucket, under the caller's
 * company folder. The `<companyId>/` prefix is what the storage RLS policies in
 * supabase/05_storage.sql key on — without it the upload is rejected, so companyId is
 * required, not optional.
 * @returns {Promise<string>} The public CDN URL of the uploaded object.
 */
export async function uploadPhotoToBucket(bucketName, companyId, fileId, base64String) {
  if (!base64String) return null;
  if (!companyId) {
    // Fail loud rather than write to an unscoped path the policies would reject with
    // a confusing "row-level security" error further down.
    throw new Error("uploadPhotoToBucket: companyId is required (tenant-scoped storage).");
  }

  try {
    const imageBlob = base64ToBlob(base64String, "image/jpeg");
    const filePath = `${companyId}/${fileId}_${Date.now()}.jpg`;

    // 1. Dispatch binary file payload straight out to your object storage bucket tier
    const { data, error } = await supabase.storage
      .from(bucketName)
      .upload(filePath, imageBlob, {
        cacheControl: "3600",
        upsert: true,
        contentType: "image/jpeg"
      });

    if (error) throw error;

    // 2. Fetch the newly compiled public edge routing CDN resource link URL
    const { data: { publicUrl } } = supabase.storage
      .from(bucketName)
      .getPublicUrl(filePath);

    return publicUrl; // Mapped as a lightweight short string (e.g., https://xyz.supabase.co/...)
  } catch (err) {
    console.error(`[Storage Engine Exception] Failed to commit asset to bucket ${bucketName}:`, err);
    throw err;
  }
}

/**
 * Uploads a raw File straight through, for anything that is not a compressed photo.
 *
 * uploadPhotoToBucket above cannot do this job: it base64-decodes in a loop and hardcodes
 * image/jpeg, which for a 100 MB training video means holding roughly 130 MB of base64
 * plus the decoded copy in memory and then mislabelling the result as a JPEG. Files that
 * arrive from an <input type="file"> are already Blobs and need none of that.
 *
 * `upsert: false` because the path from mediaObjectPath is unique per upload; a collision
 * here means a bug worth surfacing rather than silently overwriting someone's clip.
 *
 * @returns {Promise<{ url: string, path: string }>} public CDN URL and the object path,
 *          the latter so a later delete can remove the file and not just the row.
 */
export async function uploadFileToBucket(bucketName, filePath, file) {
  if (!file) throw new Error("uploadFileToBucket: no file given.");
  if (!filePath) throw new Error("uploadFileToBucket: filePath is required (tenant-scoped storage).");

  const { error } = await supabase.storage.from(bucketName).upload(filePath, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || "application/octet-stream",
  });
  if (error) throw error;

  const { data: { publicUrl } } = supabase.storage.from(bucketName).getPublicUrl(filePath);
  return { url: publicUrl, path: filePath };
}

/** Removes an uploaded object. Best-effort: used to avoid orphaning a file when the
 *  metadata insert that should have followed the upload fails. */
export async function removeFromBucket(bucketName, filePath) {
  if (!filePath) return;
  const { error } = await supabase.storage.from(bucketName).remove([filePath]);
  if (error) console.error(`[Storage] Could not remove ${bucketName}/${filePath}:`, error);
}