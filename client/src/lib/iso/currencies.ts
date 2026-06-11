/**
 * ISO 4217 active currency codes. Used by the CurrencyPicker to enforce
 * a controlled vocabulary on every currency field — vendor.currency_code,
 * po.currency_code, lot.unit_cost currency, etc. Free-text 3-char input
 * accepts typos and dead codes; this is the canonical active list.
 *
 * "Popular" ordering surfaces the codes a UK food manufacturer reaches
 * for daily; the rest follow alphabetically.
 */

export interface Currency {
  /** ISO 4217 code. Uppercase. */
  code: string;
  /** Common English short name. */
  name: string;
  /** Symbol (best effort — falls back to code if no canonical glyph). */
  symbol: string;
  /** Minor-unit precision (cents vs fils vs none). */
  precision: number;
}

const POPULAR_CODES = [
  "GBP",
  "EUR",
  "USD",
  "CAD",
  "AUD",
  "NZD",
  "CHF",
  "SEK",
  "NOK",
  "DKK",
  "JPY",
  "CNY",
  "INR",
  "ZAR",
  "BRL",
];

const ALL_CURRENCIES: ReadonlyArray<Currency> = [
  { code: "AED", name: "UAE Dirham", symbol: "د.إ", precision: 2 },
  { code: "AFN", name: "Afghan Afghani", symbol: "؋", precision: 2 },
  { code: "ALL", name: "Albanian Lek", symbol: "L", precision: 2 },
  { code: "AMD", name: "Armenian Dram", symbol: "֏", precision: 2 },
  { code: "ANG", name: "Netherlands Antillean Guilder", symbol: "ƒ", precision: 2 },
  { code: "AOA", name: "Angolan Kwanza", symbol: "Kz", precision: 2 },
  { code: "ARS", name: "Argentine Peso", symbol: "$", precision: 2 },
  { code: "AUD", name: "Australian Dollar", symbol: "A$", precision: 2 },
  { code: "AWG", name: "Aruban Florin", symbol: "ƒ", precision: 2 },
  { code: "AZN", name: "Azerbaijani Manat", symbol: "₼", precision: 2 },
  { code: "BAM", name: "Bosnia-Herzegovina Mark", symbol: "KM", precision: 2 },
  { code: "BBD", name: "Barbadian Dollar", symbol: "$", precision: 2 },
  { code: "BDT", name: "Bangladeshi Taka", symbol: "৳", precision: 2 },
  { code: "BGN", name: "Bulgarian Lev", symbol: "лв", precision: 2 },
  { code: "BHD", name: "Bahraini Dinar", symbol: ".د.ب", precision: 3 },
  { code: "BIF", name: "Burundian Franc", symbol: "FBu", precision: 0 },
  { code: "BMD", name: "Bermudan Dollar", symbol: "$", precision: 2 },
  { code: "BND", name: "Brunei Dollar", symbol: "$", precision: 2 },
  { code: "BOB", name: "Bolivian Boliviano", symbol: "Bs.", precision: 2 },
  { code: "BRL", name: "Brazilian Real", symbol: "R$", precision: 2 },
  { code: "BSD", name: "Bahamian Dollar", symbol: "$", precision: 2 },
  { code: "BTN", name: "Bhutanese Ngultrum", symbol: "Nu.", precision: 2 },
  { code: "BWP", name: "Botswanan Pula", symbol: "P", precision: 2 },
  { code: "BYN", name: "Belarusian Ruble", symbol: "Br", precision: 2 },
  { code: "BZD", name: "Belize Dollar", symbol: "BZ$", precision: 2 },
  { code: "CAD", name: "Canadian Dollar", symbol: "C$", precision: 2 },
  { code: "CDF", name: "Congolese Franc", symbol: "FC", precision: 2 },
  { code: "CHF", name: "Swiss Franc", symbol: "CHF", precision: 2 },
  { code: "CLP", name: "Chilean Peso", symbol: "$", precision: 0 },
  { code: "CNY", name: "Chinese Yuan", symbol: "¥", precision: 2 },
  { code: "COP", name: "Colombian Peso", symbol: "$", precision: 2 },
  { code: "CRC", name: "Costa Rican Colón", symbol: "₡", precision: 2 },
  { code: "CUP", name: "Cuban Peso", symbol: "$", precision: 2 },
  { code: "CVE", name: "Cape Verdean Escudo", symbol: "$", precision: 2 },
  { code: "CZK", name: "Czech Koruna", symbol: "Kč", precision: 2 },
  { code: "DJF", name: "Djiboutian Franc", symbol: "Fdj", precision: 0 },
  { code: "DKK", name: "Danish Krone", symbol: "kr", precision: 2 },
  { code: "DOP", name: "Dominican Peso", symbol: "RD$", precision: 2 },
  { code: "DZD", name: "Algerian Dinar", symbol: "د.ج", precision: 2 },
  { code: "EGP", name: "Egyptian Pound", symbol: "£", precision: 2 },
  { code: "ERN", name: "Eritrean Nakfa", symbol: "Nfk", precision: 2 },
  { code: "ETB", name: "Ethiopian Birr", symbol: "Br", precision: 2 },
  { code: "EUR", name: "Euro", symbol: "€", precision: 2 },
  { code: "FJD", name: "Fijian Dollar", symbol: "$", precision: 2 },
  { code: "FKP", name: "Falkland Islands Pound", symbol: "£", precision: 2 },
  { code: "GBP", name: "British Pound", symbol: "£", precision: 2 },
  { code: "GEL", name: "Georgian Lari", symbol: "₾", precision: 2 },
  { code: "GHS", name: "Ghanaian Cedi", symbol: "₵", precision: 2 },
  { code: "GIP", name: "Gibraltar Pound", symbol: "£", precision: 2 },
  { code: "GMD", name: "Gambian Dalasi", symbol: "D", precision: 2 },
  { code: "GNF", name: "Guinean Franc", symbol: "FG", precision: 0 },
  { code: "GTQ", name: "Guatemalan Quetzal", symbol: "Q", precision: 2 },
  { code: "GYD", name: "Guyanaese Dollar", symbol: "$", precision: 2 },
  { code: "HKD", name: "Hong Kong Dollar", symbol: "HK$", precision: 2 },
  { code: "HNL", name: "Honduran Lempira", symbol: "L", precision: 2 },
  { code: "HRK", name: "Croatian Kuna", symbol: "kn", precision: 2 },
  { code: "HTG", name: "Haitian Gourde", symbol: "G", precision: 2 },
  { code: "HUF", name: "Hungarian Forint", symbol: "Ft", precision: 2 },
  { code: "IDR", name: "Indonesian Rupiah", symbol: "Rp", precision: 2 },
  { code: "ILS", name: "Israeli Shekel", symbol: "₪", precision: 2 },
  { code: "INR", name: "Indian Rupee", symbol: "₹", precision: 2 },
  { code: "IQD", name: "Iraqi Dinar", symbol: "ع.د", precision: 3 },
  { code: "IRR", name: "Iranian Rial", symbol: "﷼", precision: 2 },
  { code: "ISK", name: "Icelandic Króna", symbol: "kr", precision: 0 },
  { code: "JMD", name: "Jamaican Dollar", symbol: "J$", precision: 2 },
  { code: "JOD", name: "Jordanian Dinar", symbol: "د.ا", precision: 3 },
  { code: "JPY", name: "Japanese Yen", symbol: "¥", precision: 0 },
  { code: "KES", name: "Kenyan Shilling", symbol: "KSh", precision: 2 },
  { code: "KGS", name: "Kyrgystani Som", symbol: "лв", precision: 2 },
  { code: "KHR", name: "Cambodian Riel", symbol: "៛", precision: 2 },
  { code: "KMF", name: "Comorian Franc", symbol: "CF", precision: 0 },
  { code: "KPW", name: "North Korean Won", symbol: "₩", precision: 2 },
  { code: "KRW", name: "South Korean Won", symbol: "₩", precision: 0 },
  { code: "KWD", name: "Kuwaiti Dinar", symbol: "د.ك", precision: 3 },
  { code: "KYD", name: "Cayman Islands Dollar", symbol: "$", precision: 2 },
  { code: "KZT", name: "Kazakhstani Tenge", symbol: "₸", precision: 2 },
  { code: "LAK", name: "Laotian Kip", symbol: "₭", precision: 2 },
  { code: "LBP", name: "Lebanese Pound", symbol: "£", precision: 2 },
  { code: "LKR", name: "Sri Lankan Rupee", symbol: "₨", precision: 2 },
  { code: "LRD", name: "Liberian Dollar", symbol: "$", precision: 2 },
  { code: "LSL", name: "Lesotho Loti", symbol: "L", precision: 2 },
  { code: "LYD", name: "Libyan Dinar", symbol: "ل.د", precision: 3 },
  { code: "MAD", name: "Moroccan Dirham", symbol: "د.م.", precision: 2 },
  { code: "MDL", name: "Moldovan Leu", symbol: "L", precision: 2 },
  { code: "MGA", name: "Malagasy Ariary", symbol: "Ar", precision: 2 },
  { code: "MKD", name: "Macedonian Denar", symbol: "ден", precision: 2 },
  { code: "MMK", name: "Myanmar Kyat", symbol: "K", precision: 2 },
  { code: "MNT", name: "Mongolian Tugrik", symbol: "₮", precision: 2 },
  { code: "MOP", name: "Macanese Pataca", symbol: "MOP$", precision: 2 },
  { code: "MRU", name: "Mauritanian Ouguiya", symbol: "UM", precision: 2 },
  { code: "MUR", name: "Mauritian Rupee", symbol: "₨", precision: 2 },
  { code: "MVR", name: "Maldivian Rufiyaa", symbol: "Rf", precision: 2 },
  { code: "MWK", name: "Malawian Kwacha", symbol: "MK", precision: 2 },
  { code: "MXN", name: "Mexican Peso", symbol: "$", precision: 2 },
  { code: "MYR", name: "Malaysian Ringgit", symbol: "RM", precision: 2 },
  { code: "MZN", name: "Mozambican Metical", symbol: "MT", precision: 2 },
  { code: "NAD", name: "Namibian Dollar", symbol: "$", precision: 2 },
  { code: "NGN", name: "Nigerian Naira", symbol: "₦", precision: 2 },
  { code: "NIO", name: "Nicaraguan Córdoba", symbol: "C$", precision: 2 },
  { code: "NOK", name: "Norwegian Krone", symbol: "kr", precision: 2 },
  { code: "NPR", name: "Nepalese Rupee", symbol: "₨", precision: 2 },
  { code: "NZD", name: "New Zealand Dollar", symbol: "NZ$", precision: 2 },
  { code: "OMR", name: "Omani Rial", symbol: "ر.ع.", precision: 3 },
  { code: "PAB", name: "Panamanian Balboa", symbol: "B/.", precision: 2 },
  { code: "PEN", name: "Peruvian Nuevo Sol", symbol: "S/.", precision: 2 },
  { code: "PGK", name: "Papua New Guinean Kina", symbol: "K", precision: 2 },
  { code: "PHP", name: "Philippine Peso", symbol: "₱", precision: 2 },
  { code: "PKR", name: "Pakistani Rupee", symbol: "₨", precision: 2 },
  { code: "PLN", name: "Polish Zloty", symbol: "zł", precision: 2 },
  { code: "PYG", name: "Paraguayan Guarani", symbol: "₲", precision: 0 },
  { code: "QAR", name: "Qatari Rial", symbol: "ر.ق", precision: 2 },
  { code: "RON", name: "Romanian Leu", symbol: "lei", precision: 2 },
  { code: "RSD", name: "Serbian Dinar", symbol: "дин", precision: 2 },
  { code: "RUB", name: "Russian Ruble", symbol: "₽", precision: 2 },
  { code: "RWF", name: "Rwandan Franc", symbol: "FRw", precision: 0 },
  { code: "SAR", name: "Saudi Riyal", symbol: "ر.س", precision: 2 },
  { code: "SBD", name: "Solomon Islands Dollar", symbol: "$", precision: 2 },
  { code: "SCR", name: "Seychellois Rupee", symbol: "₨", precision: 2 },
  { code: "SDG", name: "Sudanese Pound", symbol: "ج.س.", precision: 2 },
  { code: "SEK", name: "Swedish Krona", symbol: "kr", precision: 2 },
  { code: "SGD", name: "Singapore Dollar", symbol: "S$", precision: 2 },
  { code: "SHP", name: "Saint Helena Pound", symbol: "£", precision: 2 },
  { code: "SLL", name: "Sierra Leonean Leone", symbol: "Le", precision: 2 },
  { code: "SOS", name: "Somali Shilling", symbol: "S", precision: 2 },
  { code: "SRD", name: "Surinamese Dollar", symbol: "$", precision: 2 },
  { code: "SSP", name: "South Sudanese Pound", symbol: "£", precision: 2 },
  { code: "STN", name: "São Tomé Dobra", symbol: "Db", precision: 2 },
  { code: "SVC", name: "Salvadoran Colón", symbol: "$", precision: 2 },
  { code: "SYP", name: "Syrian Pound", symbol: "£", precision: 2 },
  { code: "SZL", name: "Swazi Lilangeni", symbol: "L", precision: 2 },
  { code: "THB", name: "Thai Baht", symbol: "฿", precision: 2 },
  { code: "TJS", name: "Tajikistani Somoni", symbol: "ЅМ", precision: 2 },
  { code: "TMT", name: "Turkmenistani Manat", symbol: "T", precision: 2 },
  { code: "TND", name: "Tunisian Dinar", symbol: "د.ت", precision: 3 },
  { code: "TOP", name: "Tongan Pa'anga", symbol: "T$", precision: 2 },
  { code: "TRY", name: "Turkish Lira", symbol: "₺", precision: 2 },
  { code: "TTD", name: "Trinidad and Tobago Dollar", symbol: "TT$", precision: 2 },
  { code: "TWD", name: "New Taiwan Dollar", symbol: "NT$", precision: 2 },
  { code: "TZS", name: "Tanzanian Shilling", symbol: "TSh", precision: 2 },
  { code: "UAH", name: "Ukrainian Hryvnia", symbol: "₴", precision: 2 },
  { code: "UGX", name: "Ugandan Shilling", symbol: "USh", precision: 0 },
  { code: "USD", name: "US Dollar", symbol: "$", precision: 2 },
  { code: "UYU", name: "Uruguayan Peso", symbol: "$U", precision: 2 },
  { code: "UZS", name: "Uzbekistan Som", symbol: "лв", precision: 2 },
  { code: "VES", name: "Venezuelan Bolívar Soberano", symbol: "Bs.S", precision: 2 },
  { code: "VND", name: "Vietnamese Dong", symbol: "₫", precision: 0 },
  { code: "VUV", name: "Vanuatu Vatu", symbol: "VT", precision: 0 },
  { code: "WST", name: "Samoan Tala", symbol: "WS$", precision: 2 },
  { code: "XAF", name: "CFA Franc BEAC", symbol: "FCFA", precision: 0 },
  { code: "XCD", name: "East Caribbean Dollar", symbol: "$", precision: 2 },
  { code: "XOF", name: "CFA Franc BCEAO", symbol: "CFA", precision: 0 },
  { code: "XPF", name: "CFP Franc", symbol: "₣", precision: 0 },
  { code: "YER", name: "Yemeni Rial", symbol: "﷼", precision: 2 },
  { code: "ZAR", name: "South African Rand", symbol: "R", precision: 2 },
  { code: "ZMW", name: "Zambian Kwacha", symbol: "ZK", precision: 2 },
];

const BY_CODE = new Map(ALL_CURRENCIES.map((c) => [c.code, c]));

export const CURRENCIES: ReadonlyArray<Currency> = (() => {
  const popular = POPULAR_CODES.map((code) => BY_CODE.get(code)!).filter(
    Boolean,
  );
  const rest = ALL_CURRENCIES.filter((c) => !POPULAR_CODES.includes(c.code));
  return [...popular, ...rest];
})();

export function findCurrency(code: string | null | undefined): Currency | null {
  if (!code) return null;
  return BY_CODE.get(code.toUpperCase()) ?? null;
}

export function isValidCurrencyCode(code: string | null | undefined): boolean {
  if (!code) return false;
  return BY_CODE.has(code.toUpperCase());
}
