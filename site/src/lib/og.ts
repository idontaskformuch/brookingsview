/**
 * Delningsbilder (Open Graph) -- en unik bild per story, genererad vid build.
 *
 * Varför per story och inte en statisk: en delad länk på Facebook eller i ett
 * sms konkurrerar med allt annat i flödet. En bild som visar SJÄLVA RUBRIKEN
 * gör att läsaren ser vad hen klickar på innan hen klickar. En generisk
 * logotypbild gör alla länkar identiska och därmed osynliga.
 *
 * Genereras med satori (JSX-liknande layout -> SVG) och sharp (SVG -> PNG).
 * Allt sker vid build-time, så det kostar ingenting per besökare och kräver
 * ingen extern tjänst. Typsnitten ligger i src/fonts/ (OFL-licensierade,
 * fritt distribuerbara) i stället för att hämtas från Google Fonts under
 * bygget -- ett nätverksanrop mindre som kan fallera i CI.
 *
 * Facebook och de flesta andra kräver PNG eller JPEG; SVG fungerar inte
 * tillförlitligt som og:image. Därför rasteriseringen.
 */
import satori from 'satori';
import sharp from 'sharp';
// Typsnitten som base64, bakade in i en committad fil -- se kommentaren i
// fonts-embedded.ts för varför två tidigare försök (runtime-filsökväg via
// import.meta.url, sedan Vites ?arraybuffer-suffix) båda visade sig bero på
// miljön och gick sönder i Cloudflares byggmiljö trots att de fungerade
// lokalt. Base64-konstanter i en vanlig .ts-fil har inget sådant beroende.
import { LORA_BOLD_BASE64, INSTRUMENT_SANS_BOLD_BASE64 } from './fonts-embedded';
import { siteConfig } from './site-config';

const serif = Buffer.from(LORA_BOLD_BASE64, 'base64');
const sans = Buffer.from(INSTRUMENT_SANS_BOLD_BASE64, 'base64');

// Måtten Facebook, LinkedIn och X alla hanterar utan att beskära.
const WIDTH = 1200;
const HEIGHT = 630;

const NAVY = '#0b2e55';
const PAPER = '#f4f6f7';
const ACCENT = '#c2410c';
const ALERT = '#b91c1c';

const KICKERS: Record<string, string> = {
  weekly: 'The week ahead',
  meeting: 'City hall',
  event: 'Events',
  alert: 'Alert',
  culture_essay: 'Culture essay',
  editorial: 'Editorial',
  vetenskap_kronika: 'Science',
  kvick_essa: 'Commentary',
  media_recension: 'Review',
  vardagsmiddag: 'Recipe',
};

/** Rubrikstorleken krymper med längden så långa rubriker inte spränger ytan. */
function headlineSize(text: string): number {
  if (text.length > 110) return 46;
  if (text.length > 75) return 54;
  if (text.length > 45) return 64;
  return 74;
}

export interface OgInput {
  title: string;
  sourceType?: string;
  dateline?: string | null;
}

export async function renderOgImage({ title, sourceType = 'event', dateline }: OgInput): Promise<Buffer> {
  const kicker = KICKERS[sourceType] ?? siteConfig.siteName;
  const accentColour = sourceType === 'alert' ? ALERT : ACCENT;

  const svg = await satori(
    {
      type: 'div',
      props: {
        style: {
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
          backgroundColor: NAVY, padding: '64px 72px', justifyContent: 'space-between',
          fontFamily: 'Lora',
        },
        children: [
          // Kicker -- färgad etikett, samma semantik som på sajten
          {
            type: 'div',
            props: {
              style: {
                display: 'flex', alignItems: 'center', gap: '18px',
                fontFamily: 'Instrument Sans', fontSize: 24, letterSpacing: '0.14em',
                textTransform: 'uppercase', color: accentColour,
              },
              children: [
                { type: 'div', props: { style: { width: 52, height: 6, backgroundColor: accentColour, display: 'flex' } } },
                { type: 'div', props: { children: kicker } },
              ],
            },
          },
          // Rubriken -- själva poängen med bilden
          {
            type: 'div',
            props: {
              style: {
                display: 'flex', fontSize: headlineSize(title), lineHeight: 1.12,
                color: '#ffffff', letterSpacing: '-0.02em', maxWidth: 1000,
              },
              children: title,
            },
          },
          // Avsändarrad
          {
            type: 'div',
            props: {
              style: {
                display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
                borderTop: `2px solid rgba(255,255,255,0.22)`, paddingTop: '26px',
              },
              children: [
                {
                  type: 'div',
                  props: {
                    style: { display: 'flex', fontSize: 36, color: '#ffffff', letterSpacing: '-0.02em' },
                    children: siteConfig.siteName,
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: {
                      display: 'flex', fontFamily: 'Instrument Sans', fontSize: 22,
                      color: 'rgba(255,255,255,0.66)', letterSpacing: '0.06em',
                    },
                    children: dateline ?? `${siteConfig.cityName}, ${siteConfig.stateName}`,
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      width: WIDTH,
      height: HEIGHT,
      fonts: [
        { name: 'Lora', data: serif, weight: 700, style: 'normal' },
        { name: 'Instrument Sans', data: sans, weight: 700, style: 'normal' },
      ],
    },
  );

  return sharp(Buffer.from(svg)).png().toBuffer();
}
