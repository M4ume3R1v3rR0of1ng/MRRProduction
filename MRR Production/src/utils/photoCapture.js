// Getting a photo from the person using the app, natively where we can.
//
// WHY THIS EXISTS
//
// On the web, `<input type="file" accept="image/*">` is the whole story. It also
// works inside the iOS app — WKWebView hands it to the system picker — which is
// exactly the problem: an app that only ever does what the website does is what
// App Store Review Guideline 4.2 rejects as "minimum functionality". Crews
// photograph roofs, trucks and damaged parts on job sites, so the camera is the
// most honest native capability this product has. Wiring it properly is both a
// better experience and the argument that the iOS build deserves to exist.
//
// WHAT IT RETURNS
//
// A File, or null when the person backed out. A File specifically, because that
// is what compressImg() in utils/helpers.js already takes, and every existing
// caller feeds it there. Reusing that path means the native camera and the web
// picker produce byte-identical output: same max dimension, same JPEG quality,
// same error messages, one place to change any of it. A second pipeline for
// native photos would drift, and the drift would land in job cost reports and
// stored evidence.
//
// WHY BASE64 AND NOT A URI
//
// The plugin can hand back a file:// URI, which would be lighter. But turning
// that into a File means fetch()ing it, and the production CSP in public/_headers
// pins connect-src to self plus Supabase. A fetch to a file:// or data: URL is
// governed by that same directive, so it would work in dev and fail in the
// shipped app. Base64 crosses the bridge as a plain string and never touches the
// network stack, so CSP has no opinion about it.
import { IS_IOS_APP } from "./platform";

// True when a real camera is reachable. The UI uses this to decide whether to
// show the hidden file input at all, so the web build keeps its existing markup
// untouched rather than rendering a control that cannot work.
export const HAS_NATIVE_CAMERA = IS_IOS_APP;

// iOS reports a cancel by throwing. There is no error code, only message text,
// and it differs between the camera sheet and the photo library. Treating a
// cancel as a failure would toast "couldn't get that photo" at someone who
// simply changed their mind, so match loosely and stay silent.
function isCancellation(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("cancel") || msg.includes("no image picked");
}

// base64 -> File, without fetch(). See the CSP note above.
function base64ToFile(base64, format) {
  const type = `image/${format === "jpg" ? "jpeg" : format || "jpeg"}`;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], `photo.${format || "jpeg"}`, { type });
}

/**
 * Ask for a photo using the native camera.
 *
 * Only call this when HAS_NATIVE_CAMERA is true; on the web it resolves to null
 * so a caller that forgets still degrades to "nothing happened" rather than
 * throwing into a click handler.
 *
 * @returns {Promise<File|null>} null when cancelled, or when not on iOS.
 */
export async function capturePhoto() {
  if (!IS_IOS_APP) return null;

  // Dynamic import on purpose. IS_IOS_APP folds to false at build time on the
  // web, so this branch is dead code there and Rollup drops the plugin out of
  // the web bundle entirely rather than shipping it to every browser.
  const { Camera, CameraResultType, CameraSource } = await import("@capacitor/camera");

  try {
    const photo = await Camera.getPhoto({
      // CameraSource.Prompt shows the native "Take Photo / Choose From Library"
      // sheet. Forcing the camera outright would be wrong: a supervisor writing
      // up a job at the end of the day is attaching a shot taken hours earlier.
      source: CameraSource.Prompt,
      resultType: CameraResultType.Base64,
      // compressImg re-encodes anyway, so this only needs to be good enough to
      // survive the resize. 90 keeps the bridge payload sane on a phone that
      // shoots 12MP without visibly costing anything after the downscale.
      quality: 90,
      // The app crops nothing and shows the photo as taken. Handing someone
      // Apple's crop UI would imply an edit we then ignore.
      allowEditing: false,
      // We store our own compressed copy. Writing a duplicate into their camera
      // roll is not ours to decide, and it would also require another Info.plist
      // permission string.
      saveToGallery: false,
    });

    if (!photo?.base64String) return null;
    return base64ToFile(photo.base64String, photo.format);
  } catch (err) {
    if (isCancellation(err)) return null;
    throw err;
  }
}
