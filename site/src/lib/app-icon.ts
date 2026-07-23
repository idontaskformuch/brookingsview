/**
 * PWA/app-ikoner (icon-*.png, favicon.ico) -- samma per-stad-bokstav-i-fyrkant
 * som favicon.svg, men rastrerad vid build-time med satori+sharp (samma verktyg
 * som og.ts) i stället för att lita på ett systeminstallerat typsnitt (Georgia).
 * Byggmiljön (GitHub Actions/Cloudflare) kan inte garanteras ha Georgia, så vi
 * återanvänder og.ts:s inbäddade Lora-font -- garanterat samma render oavsett
 * var bygget körs, precis av samma skäl som fonts-embedded.ts:s kommentar
 * beskriver för delningsbilderna.
 *
 * Färger/mått är tagna direkt ur de tidigare statiska PNG-filerna (navy
 * #0b2e55, brev #f4f6f7, hörnradie ~20.5% av bredden) så bytet till dynamisk
 * generering inte ändrar Brookings utseende.
 */
import satori from 'satori';
import sharp from 'sharp';
import { LORA_BOLD_BASE64 } from './fonts-embedded';
import { siteConfig } from './site-config';

const serif = Buffer.from(LORA_BOLD_BASE64, 'base64');

const NAVY = '#0b2e55';
const PAPER = '#f4f6f7';

/** Icke-maskable ikoner har rundade hörn med transparent bakgrund utanför
 * formen (som original-PNG:erna); maskable är alltid en fylld kvadrat, eftersom
 * OS:et själv klipper till sin egen mask och behöver hela ytan opak. */
export async function renderAppIconPng(size: number, maskable = false): Promise<Buffer> {
  const letter = siteConfig.brandLead.charAt(0).toUpperCase();
  const radius = maskable ? 0 : Math.round(size * (7 / 32));

  const svg = await satori(
    {
      type: 'div',
      props: {
        style: {
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: NAVY,
          borderRadius: radius,
          fontFamily: 'Lora',
        },
        children: [
          {
            type: 'div',
            props: {
              style: { display: 'flex', color: PAPER, fontSize: Math.round(size * 0.6), lineHeight: 1 },
              children: letter,
            },
          },
        ],
      },
    },
    { width: size, height: size, fonts: [{ name: 'Lora', data: serif, weight: 700, style: 'normal' }] },
  );

  return sharp(Buffer.from(svg)).png().toBuffer();
}
