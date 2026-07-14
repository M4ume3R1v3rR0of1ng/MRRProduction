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