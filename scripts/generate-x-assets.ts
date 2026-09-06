import sharp from "sharp";
import path from "node:path";

async function main() {
  const publicDir = path.join(process.cwd(), "public");

  // 1. Mark with circle safe-area padding (for X circular crop)
  // X avatar is displayed as a circle: a circle inside 800x800 has radius 400.
  // The mark should be centered with size ~420x420 so it never touches the circular crop edges.

  // X Avatar Dark (Deep Dark Background #121614)
  const avatarDarkSvg = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800">
    <rect width="800" height="800" fill="#121614" />
    <g transform="translate(175, 175) scale(4.5)">
      <circle cx="50" cy="50" r="36" fill="none" stroke="#f6f6f5" stroke-width="12" />
      <circle
        cx="50"
        cy="50"
        r="36"
        fill="none"
        stroke="#3bdf7a"
        stroke-width="12"
        stroke-linecap="round"
        stroke-dasharray="155.38 226.19"
        transform="rotate(-90 50 50)"
      />
      <circle cx="50" cy="50" r="7" fill="#f6f6f5" />
    </g>
  </svg>`;

  await sharp(Buffer.from(avatarDarkSvg))
    .png({ quality: 100 })
    .toFile(path.join(publicDir, "x-avatar-dark.png"));

  // X Avatar Light (Paper White Background #f7f7f5)
  const avatarLightSvg = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800">
    <rect width="800" height="800" fill="#f7f7f5" />
    <g transform="translate(175, 175) scale(4.5)">
      <circle cx="50" cy="50" r="36" fill="none" stroke="#22262a" stroke-width="12" />
      <circle
        cx="50"
        cy="50"
        r="36"
        fill="none"
        stroke="#3bdf7a"
        stroke-width="12"
        stroke-linecap="round"
        stroke-dasharray="155.38 226.19"
        transform="rotate(-90 50 50)"
      />
      <circle cx="50" cy="50" r="7" fill="#22262a" />
    </g>
  </svg>`;

  await sharp(Buffer.from(avatarLightSvg))
    .png({ quality: 100 })
    .toFile(path.join(publicDir, "x-avatar-light.png"));

  // X Avatar Pure Black (#000000)
  const avatarBlackSvg = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800">
    <rect width="800" height="800" fill="#000000" />
    <g transform="translate(175, 175) scale(4.5)">
      <circle cx="50" cy="50" r="36" fill="none" stroke="#ffffff" stroke-width="12" />
      <circle
        cx="50"
        cy="50"
        r="36"
        fill="none"
        stroke="#3bdf7a"
        stroke-width="12"
        stroke-linecap="round"
        stroke-dasharray="155.38 226.19"
        transform="rotate(-90 50 50)"
      />
      <circle cx="50" cy="50" r="7" fill="#ffffff" />
    </g>
  </svg>`;

  await sharp(Buffer.from(avatarBlackSvg))
    .png({ quality: 100 })
    .toFile(path.join(publicDir, "x-avatar-black.png"));

  // 2. X Header / Banner (1500x500) Dark
  const headerDarkSvg = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1500 500" width="1500" height="500">
    <rect width="1500" height="500" fill="#111614" />
    <!-- Background subtle circle decoration -->
    <circle cx="1300" cy="250" r="320" fill="none" stroke="#f6f6f5" stroke-width="40" opacity="0.04" />
    
    <g transform="translate(480, 180)">
      <!-- Mark -->
      <g transform="scale(1.2)">
        <circle cx="50" cy="50" r="36" fill="none" stroke="#f6f6f5" stroke-width="12" />
        <circle
          cx="50"
          cy="50"
          r="36"
          fill="none"
          stroke="#3bdf7a"
          stroke-width="12"
          stroke-linecap="round"
          stroke-dasharray="155.38 226.19"
          transform="rotate(-90 50 50)"
        />
        <circle cx="50" cy="50" r="7" fill="#f6f6f5" />
      </g>
      <!-- Wordmark -->
      <text x="145" y="76" font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="64" letter-spacing="-0.03em" fill="#f6f6f5">
        <tspan font-weight="600">spend</tspan><tspan font-weight="400">lens</tspan>
      </text>
    </g>

    <!-- Tagline -->
    <text x="750" y="320" text-anchor="middle" font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="20" letter-spacing="0.1em" fill="#3bdf7a" font-weight="500">
      AUDIT &amp; OBSERVABILITY LAYER FOR AI AGENTS ON ARC
    </text>
  </svg>`;

  await sharp(Buffer.from(headerDarkSvg))
    .png({ quality: 100 })
    .toFile(path.join(publicDir, "x-header-dark.png"));

  console.log("X (Twitter) profile avatars and headers generated successfully!");
}

main().catch(console.error);
