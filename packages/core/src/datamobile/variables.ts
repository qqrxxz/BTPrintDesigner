/**
 * DataMobile print template variables.
 *
 * A label designed here is a template for DataMobile, which substitutes these
 * names at print time. That changes what "the code that reaches the printer"
 * means: the file exported from this program still says `@Barcode@`, and the
 * printer only ever sees the value DataMobile puts there. The preview therefore
 * fills them in with sample values — a nine-character `@Barcode@` and a
 * thirteen-digit code are not the same width, and the whole point of the
 * preview is answering whether it fits.
 *
 * The catalogue follows the vendor's documentation. Names are reproduced
 * exactly, including their capitalisation, because DataMobile matches them
 * literally.
 */

/** The template kinds DataMobile assigns, by its own directory prefixes. */
export type DataMobileOperation =
  | 'all'
  | 'art'
  | 'art_in_doc'
  | 'promoart'
  | 'km'
  | 'doc'
  | 'upl'
  | 'copybarcode';

export interface OperationInfo {
  readonly id: DataMobileOperation;
  readonly ru: string;
  readonly en: string;
}

export const DATAMOBILE_OPERATIONS: readonly OperationInfo[] = [
  { id: 'all', ru: 'Все операции', en: 'Any operation' },
  { id: 'art', ru: 'Печать товара', en: 'Product label' },
  { id: 'art_in_doc', ru: 'Печать товара в документе', en: 'Product in a document' },
  { id: 'promoart', ru: 'Печать промо-товара', en: 'Promotional product' },
  { id: 'km', ru: 'Печать КМ', en: 'Identification mark' },
  { id: 'doc', ru: 'Печать документа', en: 'Document' },
  { id: 'upl', ru: 'Печать упаковочного листа', en: 'Packing sheet' },
  { id: 'copybarcode', ru: 'Печать копии ШК', en: 'Barcode copy' },
];

/** The operation's name, as the DataMobile settings screen spells it. */
export function operationName(id: DataMobileOperation, language: 'ru' | 'en' = 'en'): string {
  const entry = DATAMOBILE_OPERATIONS.find((item) => item.id === id);
  if (entry === undefined) return id;
  return language === 'ru' ? entry.ru : entry.en;
}

export type VariableGroup =
  | 'product'
  | 'price'
  | 'quantity'
  | 'document'
  | 'mark'
  | 'gs1'
  | 'packing';

/** The groups, in the order the picker should show them. */
export const DATAMOBILE_GROUPS: readonly { id: VariableGroup; ru: string; en: string }[] = [
  { id: 'product', ru: 'Товар', en: 'Product' },
  { id: 'price', ru: 'Цены', en: 'Prices' },
  { id: 'quantity', ru: 'Количество', en: 'Quantity' },
  { id: 'document', ru: 'Документ', en: 'Document' },
  { id: 'mark', ru: 'Маркировка', en: 'Identification mark' },
  { id: 'gs1', ru: 'GS1', en: 'GS1' },
  { id: 'packing', ru: 'Упаковка', en: 'Packing' },
];

export interface DataMobileVariable {
  /** Exactly as DataMobile spells it, including the surrounding at signs. */
  readonly name: string;
  readonly group: VariableGroup;
  /** Operations this variable is available in. */
  readonly operations: readonly Exclude<DataMobileOperation, 'all'>[];
  /** A value of realistic length, so the preview shows a realistic label. */
  readonly sample: string;
  readonly ru: string;
  readonly en: string;
  /**
   * Set when the name carries a number the designer fills in, as
   * `@RowAttribute1Title@` does. The placeholder in `name` is the vendor's own.
   */
  readonly pattern?: { readonly token: string; readonly meaning: { ru: string; en: string } };
}

/** The three operations that print a product and share its whole field set. */
const PRODUCT_OPERATIONS = ['art', 'art_in_doc', 'promoart', 'km'] as const;
const ALL_BUT_NONE = [
  'art',
  'art_in_doc',
  'promoart',
  'km',
  'doc',
  'upl',
  'copybarcode',
] as const;

function variable(
  name: string,
  group: VariableGroup,
  operations: readonly Exclude<DataMobileOperation, 'all'>[],
  sample: string,
  ru: string,
  en: string,
  pattern?: DataMobileVariable['pattern'],
): DataMobileVariable {
  return { name, group, operations, sample, ru, en, ...(pattern ? { pattern } : {}) };
}

const NUMBERED = {
  token: '%d',
  meaning: { ru: 'порядковый номер', en: 'a sequence number' },
} as const;

export const DATAMOBILE_VARIABLES: readonly DataMobileVariable[] = [
  // --- the product itself ---------------------------------------------------
  variable('@Barcode@', 'product', ALL_BUT_NONE, '4006381333931', 'Штрихкод', 'Barcode'),
  variable(
    '@BarcodeFull@',
    'product',
    PRODUCT_OPERATIONS,
    '0104006381333931215x8',
    'Штрихкод целиком',
    'Barcode in full',
  ),
  variable('@Name1@', 'product', PRODUCT_OPERATIONS, 'Кабель USB-C 2 м', 'Наименование 1', 'Name 1'),
  variable('@Name2@', 'product', PRODUCT_OPERATIONS, 'Braided, 100 W PD', 'Наименование 2', 'Name 2'),
  variable('@Name3@', 'product', PRODUCT_OPERATIONS, 'Чёрный', 'Наименование 3', 'Name 3'),
  variable('@Measure@', 'product', PRODUCT_OPERATIONS, 'шт', 'Единица измерения', 'Unit'),
  variable('@SN@', 'product', PRODUCT_OPERATIONS, 'SN-4820117', 'Серийный номер', 'Serial number'),
  ...Array.from({ length: 10 }, (_unused, index) =>
    variable(
      `@Attr${index + 1}@`,
      'product',
      PRODUCT_OPERATIONS,
      `Свойство ${index + 1}`,
      `Свойство товара ${index + 1}`,
      `Product attribute ${index + 1}`,
    ),
  ),

  // --- prices ---------------------------------------------------------------
  variable('@Price@', 'price', PRODUCT_OPERATIONS, '1 299.00', 'Цена', 'Price'),
  variable('@Price1@', 'price', PRODUCT_OPERATIONS, '1 299.00', 'Цена 1', 'Price 1'),
  variable('@Price2@', 'price', PRODUCT_OPERATIONS, '1 199.00', 'Цена 2', 'Price 2'),
  variable('@Price3@', 'price', PRODUCT_OPERATIONS, '1 099.00', 'Цена 3', 'Price 3'),
  variable('@PriceDiscount@', 'price', PRODUCT_OPERATIONS, '999.00', 'Цена со скидкой', 'Discounted price'),
  variable('@PriceWhole@', 'price', PRODUCT_OPERATIONS, '1 299', 'Цена, рубли', 'Price, whole part'),
  variable('@Price1Whole@', 'price', PRODUCT_OPERATIONS, '1 299', 'Цена 1, рубли', 'Price 1, whole part'),
  variable('@Price2Whole@', 'price', PRODUCT_OPERATIONS, '1 199', 'Цена 2, рубли', 'Price 2, whole part'),
  variable('@Price3Whole@', 'price', PRODUCT_OPERATIONS, '1 099', 'Цена 3, рубли', 'Price 3, whole part'),
  variable('@PriceDiscountWhole@', 'price', PRODUCT_OPERATIONS, '999', 'Цена со скидкой, рубли', 'Discounted price, whole part'),
  variable('@PriceFraction@', 'price', PRODUCT_OPERATIONS, '00', 'Цена, копейки', 'Price, fraction'),
  variable('@Price1Fraction@', 'price', PRODUCT_OPERATIONS, '00', 'Цена 1, копейки', 'Price 1, fraction'),
  variable('@Price2Fraction@', 'price', PRODUCT_OPERATIONS, '00', 'Цена 2, копейки', 'Price 2, fraction'),
  variable('@Price3Fraction@', 'price', PRODUCT_OPERATIONS, '00', 'Цена 3, копейки', 'Price 3, fraction'),
  variable('@PriceInteger@', 'price', PRODUCT_OPERATIONS, '1299', 'Цена целым числом', 'Price as an integer'),
  variable('@Price1Integer@', 'price', PRODUCT_OPERATIONS, '1299', 'Цена 1 целым числом', 'Price 1 as an integer'),
  variable('@Price2Integer@', 'price', PRODUCT_OPERATIONS, '1199', 'Цена 2 целым числом', 'Price 2 as an integer'),
  variable('@Price3Integer@', 'price', PRODUCT_OPERATIONS, '1099', 'Цена 3 целым числом', 'Price 3 as an integer'),

  // --- quantity -------------------------------------------------------------
  variable('@Quant@', 'quantity', ALL_BUT_NONE, '12', 'Количество', 'Quantity'),
  variable('@Coef@', 'quantity', PRODUCT_OPERATIONS, '1', 'Коэффициент', 'Coefficient'),
  variable('@QtyInt@', 'quantity', PRODUCT_OPERATIONS, '12', 'Количество целым', 'Quantity, integer'),
  variable('@QtyWholeInt@', 'quantity', PRODUCT_OPERATIONS, '12', 'Количество, целая часть', 'Quantity, whole part'),
  variable('@QtyFrac@', 'quantity', PRODUCT_OPERATIONS, '500', 'Количество, дробная часть', 'Quantity, fraction'),
  variable('@Kf@', 'quantity', PRODUCT_OPERATIONS, '1', 'Коэффициент упаковки', 'Pack coefficient'),
  variable('@Kf1@', 'quantity', PRODUCT_OPERATIONS, '10', 'Коэффициент упаковки 1', 'Pack coefficient 1'),
  variable('@Kf2@', 'quantity', PRODUCT_OPERATIONS, '100', 'Коэффициент упаковки 2', 'Pack coefficient 2'),
  variable(
    '@Qty_310%s_GS1@',
    'quantity',
    PRODUCT_OPERATIONS,
    '001250',
    'Количество в формате GS1, тег 310y. Вместо %s — число знаков после запятой, от 1 до 5; значение всегда шесть символов',
    'Quantity in GS1 form, tag 310y. Replace %s with the number of decimals, 1 to 5; the value is always six characters',
    { token: '%s', meaning: { ru: 'знаков после запятой, 1–5', en: 'decimals, 1 to 5' } },
  ),

  // --- dates and the document around the product -----------------------------
  variable('@Date-@', 'document', ALL_BUT_NONE, '07-09-2026', 'Дата, дд-ММ-гггг', 'Date, dd-MM-yyyy'),
  variable('@Date.@', 'document', ALL_BUT_NONE, '07.09.2026', 'Дата, дд.ММ.гггг', 'Date, dd.MM.yyyy'),
  variable('@Date@', 'document', ALL_BUT_NONE, '2026-09-07 14:20:00', 'Дата и время', 'Date and time'),
  variable('@DocNumber@', 'document', PRODUCT_OPERATIONS, 'ПР-000123', 'Номер документа', 'Document number'),
  variable('@DocDate@', 'document', PRODUCT_OPERATIONS, '07.09.2026', 'Дата документа', 'Document date'),
  variable('@Client@', 'document', [...PRODUCT_OPERATIONS, 'doc', 'upl'], 'ООО «Ромашка»', 'Контрагент', 'Client'),
  variable('@Warehouse@', 'document', PRODUCT_OPERATIONS, 'Основной склад', 'Склад', 'Warehouse'),
  variable('@Warehouse2@', 'document', PRODUCT_OPERATIONS, 'Склад приёмки', 'Склад 2', 'Warehouse 2'),
  variable('@Comment@', 'document', [...PRODUCT_OPERATIONS, 'doc', 'upl'], 'Хранить в сухом месте', 'Комментарий', 'Comment'),
  variable(
    '@RowAttribute%dTitle@',
    'document',
    PRODUCT_OPERATIONS,
    'Партия',
    'Заголовок дополнительного поля. Вместо %d — порядковый номер формы',
    'Title of an additional form field. Replace %d with the form order',
    NUMBERED,
  ),
  variable(
    '@RowAttribute%dValue@',
    'document',
    PRODUCT_OPERATIONS,
    '2026-09',
    'Значение дополнительного поля. Вместо %d — порядковый номер формы',
    'Value of an additional form field. Replace %d with the form order',
    NUMBERED,
  ),

  // --- identification marks --------------------------------------------------
  variable('@gtin@', 'mark', ['km'], '04006381333931', 'GTIN из кода маркировки', 'GTIN from the mark'),
  variable('@sn@', 'mark', ['km'], 'Zq7Kd0Lm', 'Серийный номер из кода маркировки', 'Serial from the mark'),
  variable('@dmx91@', 'mark', ['km'], 'EE06', 'Группа 91 кода маркировки', 'Group 91 of the mark'),
  variable('@dmx92@', 'mark', ['km'], 'JhVFbW1kZ', 'Группа 92 кода маркировки', 'Group 92 of the mark'),
  variable(
    '@SN_TYPE_%value%@',
    'mark',
    PRODUCT_OPERATIONS,
    'Zq7Kd0Lm',
    'Серия по типу AI. Вместо %value% — код AI',
    'Series by AI type. Replace %value% with the AI code',
    { token: '%value%', meaning: { ru: 'код AI', en: 'the AI code' } },
  ),
  variable(
    '@sn_type_%value%_gs1@',
    'mark',
    PRODUCT_OPERATIONS,
    'Zq7Kd0Lm',
    'Серия по типу AI в формате GS1 DataMatrix',
    'Series by AI type, in GS1 DataMatrix form',
    { token: '%value%', meaning: { ru: 'код AI', en: 'the AI code' } },
  ),

  // --- barcode copies and GS1 ------------------------------------------------
  variable('@barcodetype@', 'gs1', ['copybarcode'], 'EAN13', 'Тип штрихкода', 'Barcode type'),
  variable('@gs1barcode@', 'gs1', ['copybarcode'], '0104006381333931', 'Штрихкод, собранный из кодов AI', 'Barcode rebuilt from the AI codes'),
  variable('@BarcodeMarkingKi@', 'gs1', ['copybarcode'], '0104006381333931215x8', 'Код идентификации', 'Identification code'),
  variable(
    '@tag%dname@',
    'gs1',
    ['copybarcode'],
    '01',
    'Код AI. Вместо %d — номер тега',
    'The AI code. Replace %d with the tag number',
    NUMBERED,
  ),
  variable(
    '@tag%dvalue@',
    'gs1',
    ['copybarcode'],
    '04006381333931',
    'Значение тега. Вместо %d — номер тега',
    'The tag value. Replace %d with the tag number',
    NUMBERED,
  ),

  // --- documents and packing sheets ------------------------------------------
  variable('@Now@', 'document', ['doc', 'upl'], '07.09.2026 14:20', 'Текущие дата и время', 'Now'),
  variable('@Number@', 'document', ['doc', 'upl'], 'ПР-000123', 'Номер', 'Number'),
  variable('@Name@', 'document', ['doc'], 'Приёмка товара', 'Наименование', 'Name'),
  variable('@DocBarcode@', 'document', ['doc'], 'ПР-000123', 'Штрихкод документа', 'Document barcode'),
  variable('@QRData@', 'document', ['doc'], '4006381333931\n4006381333948', 'Журнал сканирований', 'Scanning log'),
  variable('@PlaceQtySelect@', 'document', ['doc'], '12', 'Мест по плану', 'Places planned'),
  variable('@PlaceQtyInsert@', 'document', ['doc'], '12', 'Мест по факту', 'Places counted'),
  variable('@SumOfDetailsSelect@', 'document', ['doc'], '480', 'Сумма по плану', 'Sum planned'),
  variable('@SumOfDetailsInsert@', 'document', ['doc'], '478', 'Сумма по факту', 'Sum counted'),
  variable('@Pack@', 'packing', ['upl'], '00104006381333931', 'Упаковка, SSCC без скобок', 'Pack, SSCC without brackets'),
];

/** Matches a DataMobile variable in text, including the patterned ones. */
export const DATAMOBILE_PATTERN = /@[A-Za-z][A-Za-z0-9_%.-]*@/g;

const BY_NAME = new Map(DATAMOBILE_VARIABLES.map((entry) => [entry.name.toLowerCase(), entry]));

/**
 * Looks a name up, allowing for the numbers a patterned name carries.
 *
 * `@RowAttribute2Title@` is the catalogue's `@RowAttribute%dTitle@` with the
 * number filled in, and a designer writes the filled-in form.
 */
export function findVariable(name: string): DataMobileVariable | undefined {
  const direct = BY_NAME.get(name.toLowerCase());
  if (direct) return direct;

  for (const entry of DATAMOBILE_VARIABLES) {
    if (!entry.pattern) continue;
    const expression = new RegExp(
      `^${escapeRegExp(entry.name).replace(escapeRegExp(entry.pattern.token), '(.+)')}$`,
      'i',
    );
    if (expression.test(name)) return entry;
  }
  return undefined;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Every variable a template for this operation may use. */
export function variablesFor(operation: DataMobileOperation): DataMobileVariable[] {
  if (operation === 'all') return [...DATAMOBILE_VARIABLES];
  return DATAMOBILE_VARIABLES.filter((entry) => entry.operations.includes(operation));
}

export function isAvailable(name: string, operation: DataMobileOperation): boolean {
  if (operation === 'all') return findVariable(name) !== undefined;
  const entry = findVariable(name);
  return entry !== undefined && entry.operations.includes(operation);
}

/** The sample value the preview stands in for a variable. */
export function sampleFor(name: string): string | undefined {
  const entry = findVariable(name);
  if (!entry) return undefined;
  return entry.sample;
}

/** Every DataMobile variable used in a piece of text, in order of appearance. */
export function findVariablesIn(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(DATAMOBILE_PATTERN)) {
    if (!found.includes(match[0])) found.push(match[0]);
  }
  return found;
}

/**
 * What a newly added element should say on a template for this operation.
 *
 * A barcode on a product label is nearly always the product's own barcode, and
 * a designer who has to type `@Barcode@` by hand will eventually type
 * `@Bracode@` instead. The defaults are the obvious choice for each operation;
 * anything else is a variable away in the picker.
 *
 * Returns nothing when the operation has no obvious default — for a template
 * that is not tied to an operation there is nothing to guess from.
 */
export function defaultContent(
  kind: 'text' | 'barcode' | 'matrix',
  operation: DataMobileOperation | undefined,
): string | undefined {
  switch (operation) {
    case 'art':
    case 'art_in_doc':
    case 'promoart':
      return { text: '@Name1@', barcode: '@Barcode@', matrix: '@BarcodeFull@' }[kind];
    case 'km':
      // A mark is printed as a Data Matrix; its two groups make up the payload.
      return { text: '@Name1@', barcode: '@Barcode@', matrix: '@BarcodeFull@' }[kind];
    case 'doc':
      return { text: '@Name@', barcode: '@DocBarcode@', matrix: '@QRData@' }[kind];
    case 'upl':
      return { text: '@Number@', barcode: '@Pack@', matrix: '@Pack@' }[kind];
    case 'copybarcode':
      return { text: '@barcodetype@', barcode: '@Barcode@', matrix: '@BarcodeMarkingKi@' }[kind];
    default:
      return undefined;
  }
}
