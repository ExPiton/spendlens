import sharp from "sharp";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";

async function main() {
  const publicDir = path.join(process.cwd(), "public");

  // Clean up any temporary qlmanage file if exists
  try {
    await unlink(path.join(publicDir, "logo.svg.png"));
  } catch {
    // ignore
  }

  // 1. Mark PNG (512x512 and 1024x1024)
  const markSvg = await readFile(path.join(publicDir, "mark.svg"));
  await sharp(markSvg)
    .resize(512, 512)
    .png({ quality: 100 })
    .toFile(path.join(publicDir, "mark.png"));

  await sharp(markSvg)
    .resize(192, 192)
    .png({ quality: 100 })
    .toFile(path.join(publicDir, "icon.png"));

  await sharp(markSvg)
    .resize(180, 180)
    .png({ quality: 100 })
    .toFile(path.join(publicDir, "apple-touch-icon.png"));

  // 2. Mark Monochrome PNG
  const markMonoSvg = await readFile(path.join(publicDir, "mark-monochrome.svg"));
  await sharp(markMonoSvg)
    .resize(512, 512)
    .png({ quality: 100 })
    .toFile(path.join(publicDir, "mark-monochrome.png"));

  // 3. Full Logo PNG (Light background / Dark ink text)
  const logoSvg = await readFile(path.join(publicDir, "logo.svg"));
  await sharp(logoSvg)
    .resize(840, 240)
    .png({ quality: 100 })
    .toFile(path.join(publicDir, "logo.png"));

  // 4. Full Logo Dark PNG (Dark background / Light paper text)
  const logoDarkSvg = await readFile(path.join(publicDir, "logo-dark.svg"));
  await sharp(logoDarkSvg)
    .resize(840, 240)
    .png({ quality: 100 })
    .toFile(path.join(publicDir, "logo-dark.png"));

  console.log("Successfully generated all PNG assets in public/!");
}

main().catch(console.error);
