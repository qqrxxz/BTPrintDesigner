/**
 * Interface strings in Russian and English.
 *
 * Both languages are first class rather than one being a translation of the
 * other: the printer commands stay English wherever they appear, because that
 * is how they are spelt in every manual, while everything the designer thinks
 * about is in their own words.
 */

export type Language = 'ru' | 'en';

export interface Strings {
  readonly appName: string;
  readonly file: string;
  readonly newLabel: string;
  readonly open: string;
  readonly save: string;
  readonly saveAs: string;
  readonly exportCode: string;
  readonly exportPng: string;
  readonly printer: string;
  readonly language: string;
  readonly add: string;
  readonly addText: string;
  readonly addRectangle: string;
  readonly addLine: string;
  readonly addBarcode: string;
  readonly addMatrix: string;
  readonly duplicate: string;
  readonly remove: string;
  readonly elements: string;
  readonly noElements: string;
  readonly properties: string;
  readonly nothingSelected: string;
  readonly label: string;
  readonly labelName: string;
  readonly width: string;
  readonly height: string;
  readonly position: string;
  readonly size: string;
  readonly rotation: string;
  readonly content: string;
  readonly textHeight: string;
  readonly widthScale: string;
  readonly alignment: string;
  readonly alignLeft: string;
  readonly alignCenter: string;
  readonly alignRight: string;
  readonly wrapInBox: string;
  readonly fill: string;
  readonly fillSolid: string;
  readonly fillOutline: string;
  readonly fillInvert: string;
  readonly fillErase: string;
  readonly lineWidth: string;
  readonly cornerRadius: string;
  readonly thickness: string;
  readonly symbology: string;
  readonly data: string;
  readonly moduleWidth: string;
  readonly barHeight: string;
  readonly humanReadable: string;
  readonly checkDigit: string;
  readonly errorCorrection: string;
  readonly columns: string;
  readonly code: string;
  readonly preview: string;
  readonly zoom: string;
  readonly fit: string;
  readonly sampleData: string;
  readonly sampleDataHint: string;
  readonly placeholderMissing: string;
  readonly detachedTitle: string;
  readonly detachedBody: string;
  readonly detachedList: string;
  readonly backToCanvas: string;
  readonly backToCanvasHint: string;
  readonly problems: string;
  readonly noProblems: string;
  readonly tooWide: string;
  readonly unsaved: string;
  readonly line: string;
}

const en: Strings = {
  appName: 'BTPrintDesigner',
  file: 'File',
  newLabel: 'New',
  open: 'Open',
  save: 'Save',
  saveAs: 'Save as',
  exportCode: 'Export code',
  exportPng: 'Export PNG',
  printer: 'Printer',
  language: 'Language',
  add: 'Add',
  addText: 'Text',
  addRectangle: 'Rectangle',
  addLine: 'Line',
  addBarcode: 'Barcode',
  addMatrix: '2D code',
  duplicate: 'Duplicate',
  remove: 'Delete',
  elements: 'Elements',
  noElements: 'The label is empty. Add something from the toolbar.',
  properties: 'Properties',
  nothingSelected: 'Select an element to edit it.',
  label: 'Label',
  labelName: 'Name',
  width: 'Width',
  height: 'Height',
  position: 'Position',
  size: 'Size',
  rotation: 'Rotation',
  content: 'Content',
  textHeight: 'Character height',
  widthScale: 'Width scale',
  alignment: 'Alignment',
  alignLeft: 'Left',
  alignCenter: 'Centre',
  alignRight: 'Right',
  wrapInBox: 'Wrap in a box',
  fill: 'Fill',
  fillSolid: 'Solid',
  fillOutline: 'Outline',
  fillInvert: 'Invert',
  fillErase: 'Erase',
  lineWidth: 'Border width',
  cornerRadius: 'Corner radius',
  thickness: 'Thickness',
  symbology: 'Symbology',
  data: 'Data',
  moduleWidth: 'Module width',
  barHeight: 'Bar height',
  humanReadable: 'Print the value below',
  checkDigit: 'Add a check digit',
  errorCorrection: 'Error correction',
  columns: 'Columns',
  code: 'Printer code',
  preview: 'Preview',
  zoom: 'Zoom',
  fit: 'Fit',
  sampleData: 'Sample values',
  sampleDataHint: 'Used for the preview. Placeholders are written {{name}}.',
  placeholderMissing: 'No value',
  detachedTitle: 'The canvas is standing aside',
  detachedBody:
    'This code contains something the canvas cannot hold, so the code is the source of truth. ' +
    'The preview still renders from it.',
  detachedList: 'What the canvas cannot hold:',
  backToCanvas: 'Discard code edits',
  backToCanvasHint: 'Goes back to the last design the canvas was driving.',
  problems: 'Problems',
  noProblems: 'Nothing to report.',
  tooWide: 'The label is wider than this printer can print, by',
  unsaved: 'unsaved',
  line: 'line',
};

const ru: Strings = {
  appName: 'BTPrintDesigner',
  file: 'Файл',
  newLabel: 'Новая',
  open: 'Открыть',
  save: 'Сохранить',
  saveAs: 'Сохранить как',
  exportCode: 'Экспорт кода',
  exportPng: 'Экспорт PNG',
  printer: 'Принтер',
  language: 'Язык',
  add: 'Добавить',
  addText: 'Текст',
  addRectangle: 'Прямоугольник',
  addLine: 'Линия',
  addBarcode: 'Штрихкод',
  addMatrix: '2D-код',
  duplicate: 'Дублировать',
  remove: 'Удалить',
  elements: 'Элементы',
  noElements: 'Этикетка пуста. Добавьте элемент с панели сверху.',
  properties: 'Свойства',
  nothingSelected: 'Выберите элемент, чтобы его править.',
  label: 'Этикетка',
  labelName: 'Название',
  width: 'Ширина',
  height: 'Высота',
  position: 'Положение',
  size: 'Размер',
  rotation: 'Поворот',
  content: 'Текст',
  textHeight: 'Высота символа',
  widthScale: 'Растяжение по ширине',
  alignment: 'Выравнивание',
  alignLeft: 'По левому краю',
  alignCenter: 'По центру',
  alignRight: 'По правому краю',
  wrapInBox: 'Переносить в рамке',
  fill: 'Заливка',
  fillSolid: 'Сплошная',
  fillOutline: 'Контур',
  fillInvert: 'Инверсия',
  fillErase: 'Стирание',
  lineWidth: 'Толщина рамки',
  cornerRadius: 'Радиус скругления',
  thickness: 'Толщина',
  symbology: 'Символика',
  data: 'Данные',
  moduleWidth: 'Ширина модуля',
  barHeight: 'Высота штрихов',
  humanReadable: 'Печатать значение под кодом',
  checkDigit: 'Добавить контрольную цифру',
  errorCorrection: 'Коррекция ошибок',
  columns: 'Столбцов',
  code: 'Код принтера',
  preview: 'Превью',
  zoom: 'Масштаб',
  fit: 'Вписать',
  sampleData: 'Тестовые значения',
  sampleDataHint: 'Подставляются в превью. Плейсхолдер пишется как {{имя}}.',
  placeholderMissing: 'Нет значения',
  detachedTitle: 'Холст отошёл в сторону',
  detachedBody:
    'В коде есть то, чего холст не удержит, поэтому источник истины — код. ' +
    'Превью продолжает рисоваться из него.',
  detachedList: 'Чего холст не удержит:',
  backToCanvas: 'Отменить правки кода',
  backToCanvasHint: 'Возврат к последнему дизайну, которым управлял холст.',
  problems: 'Проблемы',
  noProblems: 'Сообщать не о чем.',
  tooWide: 'Этикетка шире, чем печатает этот принтер, на',
  unsaved: 'не сохранено',
  line: 'строка',
};

const DICTIONARIES: Record<Language, Strings> = { en, ru };

export function strings(language: Language): Strings {
  return DICTIONARIES[language];
}

export const LANGUAGES: readonly Language[] = ['ru', 'en'];
