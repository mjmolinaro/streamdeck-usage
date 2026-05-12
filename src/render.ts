const BG = "#141413";
const FG = "#faf9f5";
const CORAL = "#d97757";

const STARBURST = `<symbol id="sb" viewBox="0 0 20 20"><path d="M10 0 L11.5 8.5 L20 10 L11.5 11.5 L10 20 L8.5 11.5 L0 10 L8.5 8.5 Z"/></symbol>`;

function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function fontSize(text: string): number {
  if (text.length <= 3) return 36;
  if (text.length <= 4) return 32;
  if (text.length <= 6) return 26;
  return 22;
}

export function renderKey(opts: {
  big: string;
  label: string;
  subtitle?: string;
  accent?: boolean;
}): string {
  const numColor = opts.accent ? CORAL : FG;
  const size = fontSize(opts.big);
  const subSize = opts.subtitle && opts.subtitle.length > 11 ? 15 : 17;
  const sub = opts.subtitle
    ? `<text x="72" y="102" text-anchor="middle" font-family="Inter,'Segoe UI',Arial,sans-serif"
         font-weight="500" font-size="${subSize}" fill="${FG}" opacity="0.9">${escapeXml(opts.subtitle)}</text>`
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">
    <rect width="144" height="144" fill="${BG}"/>
    <use href="#sb" x="118" y="10" width="18" height="18" fill="${CORAL}"/>
    <text x="72" y="66" text-anchor="middle" font-family="Inter,'Segoe UI',Arial,sans-serif"
          font-weight="700" font-size="${size}" fill="${numColor}">${escapeXml(opts.big)}</text>
    ${sub}
    <text x="72" y="130" text-anchor="middle" font-family="Inter,'Segoe UI',Arial,sans-serif"
          font-weight="600" font-size="13" letter-spacing="2" fill="${CORAL}">${escapeXml(opts.label)}</text>
    <defs>${STARBURST}</defs>
  </svg>`;
  return svgToDataUrl(svg);
}

export function renderError(label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">
    <rect width="144" height="144" fill="${CORAL}"/>
    <text x="72" y="92" text-anchor="middle" font-family="Inter,'Segoe UI',Arial,sans-serif"
          font-weight="800" font-size="80" fill="${BG}">!</text>
    <text x="72" y="124" text-anchor="middle" font-family="Inter,'Segoe UI',Arial,sans-serif"
          font-weight="600" font-size="11" letter-spacing="2" fill="${BG}">${escapeXml(label)}</text>
  </svg>`;
  return svgToDataUrl(svg);
}

export function renderLoading(label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">
    <rect width="144" height="144" fill="${BG}"/>
    <use href="#sb" x="62" y="48" width="20" height="20" fill="${CORAL}"/>
    <text x="72" y="100" text-anchor="middle" font-family="Inter,'Segoe UI',Arial,sans-serif"
          font-weight="500" font-size="13" letter-spacing="1" fill="${FG}" opacity="0.55">loading</text>
    <text x="72" y="124" text-anchor="middle" font-family="Inter,'Segoe UI',Arial,sans-serif"
          font-weight="600" font-size="11" letter-spacing="2" fill="${CORAL}">${escapeXml(label)}</text>
    <defs>${STARBURST}</defs>
  </svg>`;
  return svgToDataUrl(svg);
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function formatPercent(n: number): string {
  return `${Math.round(n)}%`;
}

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: "$",
  GBP: "£",
  EUR: "€",
  CAD: "CA$",
  AUD: "A$",
  JPY: "¥",
};

const ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "KRW", "VND"]);

function symbol(code: string): string {
  return CURRENCY_SYMBOL[code] ?? `${code} `;
}

function major(amount: number, code: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(code) ? amount : amount / 100;
}

export function formatCurrencyShort(amount: number, code: string): string {
  const n = major(amount, code);
  const decimals = ZERO_DECIMAL_CURRENCIES.has(code) ? 0 : 2;
  return `${symbol(code)}${n.toFixed(decimals)}`;
}

export function formatUsedOfLimit(used: number, limit: number, code: string): string {
  const u = major(used, code);
  const l = major(limit, code);
  const decimals = ZERO_DECIMAL_CURRENCIES.has(code) ? 0 : 2;
  return `${symbol(code)}${u.toFixed(decimals)}/${symbol(code)}${l.toFixed(decimals)}`;
}

export function formatResetsIn(isoString: string | null | undefined): string | undefined {
  if (!isoString) return undefined;
  const t = Date.parse(isoString);
  if (!Number.isFinite(t)) return undefined;
  const diffMs = t - Date.now();
  if (diffMs <= 0) return "resetting";
  const totalMin = Math.round(diffMs / 60_000);
  if (totalMin < 60) return `in ${totalMin}m`;
  const totalHours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (totalHours < 24) return mins ? `in ${totalHours}h ${mins}m` : `in ${totalHours}h`;
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours ? `in ${days}d ${hours}h` : `in ${days}d`;
}
