// Generate the iOS app icon and launch images from the Steadwerk mark.
//
//   node scripts/generate-ios-assets.mjs
//
// Run it when the brand changes. It is not part of build:ios, because these are
// binary assets that belong in git and regenerating them on every build would
// churn the diff for no reason.
//
// WHY THIS EXISTS
//
// `npx cap add ios` ships Capacitor's own placeholder icon and a generic splash.
// Apple rejects placeholder artwork, and the three splash files Capacitor writes
// are byte-identical defaults, which is the giveaway.
//
// TWO RULES THAT WILL GET AN UPLOAD REJECTED
//
//   1. NO ALPHA CHANNEL on the app icon. App Store Connect rejects any icon with
//      transparency, at upload time rather than in review, with a message that
//      does not mention alpha. Every icon path below flattens onto solid
//      barnwood and strips the alpha channel explicitly.
//
//   2. NO ROUNDED CORNERS drawn by us. iOS applies its own superellipse mask. An
//      icon that arrives pre-rounded gets the mask applied on top and comes out
//      with visibly clipped corners. So the source SVG's rounded rect is NOT
//      used here; the icon is drawn full-bleed square.
//
// The launch image is deliberately plain: a centred mark on the same barnwood as
// the app's background_color. It shows for a fraction of a second before the
// webview paints, and anything more detailed reads as a flash of unrelated
// content.
import sharp from "sharp";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const BARNWOOD = "#23282D"; // --c-barnwood, matches the PWA manifest background_color
const AMBER = "#C97B2D"; // --c-amber, the truss stroke

const ICON = "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png";
const SPLASH_DIR = "ios/App/App/Assets.xcassets/Splash.imageset";

// The truss mark on its own, transparent, so it can be composited at any size.
// Same geometry as public/steadwerk-icon.svg and components/SteadwerkMark.
//
// stroke-width stays 40 regardless of the requested size: it is expressed in
// viewBox units, and the viewBox is what scales. Scaling it by hand as well
// would thicken the stroke quadratically.
const trussSvg = (size) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
       <path d="M112 160 L176 352 L256 192 L336 352 L400 160"
             fill="none" stroke="${AMBER}" stroke-width="40"
             stroke-linecap="square" stroke-linejoin="miter"/>
     </svg>`,
  );

async function flatOnBarnwood(size, markScale) {
  const markSize = Math.round(size * markScale);
  // Rendered straight at the target size rather than resized from 512, so the
  // stroke edges stay crisp instead of being resampled twice.
  const mark = await sharp(trussSvg(markSize)).png().toBuffer();
  const offset = Math.round((size - markSize) / 2);

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 3, // 3, not 4. No alpha channel, ever, on anything Apple ingests.
      background: BARNWOOD,
    },
  })
    .composite([{ input: mark, top: offset, left: offset }])
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer();
}

function write(path, buf) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
  console.log(`  ${path}  ${(buf.length / 1024).toFixed(1)} KB`);
}

console.log("App icon (1024x1024, opaque, square):");
// markScale 1.0, NOT a smaller "safe" inset. The mark already carries its own
// padding: the path spans 112..400 of a 512 viewBox, so it occupies 56% of the
// square on its own. Scaling below 1.0 compounds that padding and produces an
// icon visibly timider than public/pwa-512x512.png, which is the same artwork.
// Matching that file keeps one icon across the PWA, the web and the App Store,
// and iOS shrinks this to 29pt in Settings where a small mark becomes a smudge.
write(ICON, await flatOnBarnwood(1024, 1.0));

console.log("Launch image (2732x2732, opaque):");
// One image, written to all three filenames the generated Contents.json names.
// Capacitor's imageset declares 1x/2x/3x pointing at separate files; at this
// size a single square covers every device in both orientations, which is why
// Capacitor's own defaults were identical too.
const splash = await flatOnBarnwood(2732, 0.22);
for (const name of ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"]) {
  write(`${SPLASH_DIR}/${name}`, splash);
}

// Prove the two rules above actually held, rather than trusting that removeAlpha
// and channels:3 did what they claim. An icon that reaches App Store Connect with
// an alpha channel is rejected at upload.
const meta = await sharp(ICON).metadata();
console.log(
  `\nIcon check: ${meta.width}x${meta.height}, ${meta.channels} channels, ` +
    `alpha=${meta.hasAlpha}, space=${meta.space}`,
);
if (meta.hasAlpha || meta.width !== 1024 || meta.height !== 1024) {
  console.error("FAILED: the icon must be exactly 1024x1024 with no alpha channel.");
  process.exit(1);
}
console.log("Done.");
