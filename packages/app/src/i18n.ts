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
  readonly kindText: string;
  readonly kindRectangle: string;
  readonly kindLine: string;
  readonly kindBarcode: string;
  readonly kindMatrix: string;
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
  readonly howItIsWritten: string;
  readonly problems: string;
  readonly noProblems: string;
  readonly tooWide: string;
  readonly unsaved: string;
  readonly line: string;
  readonly operation: string;
  readonly operationHint: string;
  readonly variables: string;
  readonly variablesHint: string;
  readonly insertVariable: string;
  readonly noVariables: string;
  readonly notForOperation: string;
  readonly unknownVariable: string;
  readonly values: string;
  readonly dragHint: string;
  readonly replaceWithVariable: string;
  readonly gs1Separator: string;
  readonly gs1SeparatorNone: string;
  readonly gs1SeparatorHint: string;
  readonly unsavedTitle: string;
  readonly unsavedDetail: string;
  readonly discard: string;
  readonly cancel: string;
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
  kindText: 'Text',
  kindRectangle: 'Rectangle',
  kindLine: 'Line',
  kindBarcode: 'Barcode',
  kindMatrix: '2D code',
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
  detachedTitle: 'The element panel is switched off',
  detachedBody:
    'Some lines below were not understood as elements, so from here the code is what counts: ' +
    'the preview is drawn from it, and the panel on the left no longer changes it. ' +
    'Put those lines right and the elements come back on their own.',
  detachedList: 'Lines that were not understood:',
  backToCanvas: 'Discard code edits',
  backToCanvasHint: 'Goes back to the last design the element panel was driving.',
  howItIsWritten: 'This program writes it like this:',
  problems: 'Problems',
  noProblems: 'Nothing to report.',
  tooWide: 'The label is wider than this printer can print, by',
  unsaved: 'unsaved',
  line: 'line',
  operation: 'DataMobile operation',
  operationHint:
    'Decides which variables this template may use. Leave it on any operation to be offered all of them.',
  variables: 'DataMobile variables',
  variablesHint:
    'Written as @Name@. DataMobile fills them in at print time; the preview shows a sample so the width is realistic.',
  insertVariable: 'Insert a variable…',
  noVariables: 'This label uses none.',
  notForOperation: 'not offered on this operation',
  unknownVariable: 'unknown to DataMobile',
  values: 'Values',
  dragHint: 'Drag to move. Arrow keys nudge by 0.1\u00a0mm, with Shift by 1\u00a0mm.',
  replaceWithVariable: 'Replace with a variable…',
  gs1Separator: 'GS1 separator',
  gs1SeparatorNone: 'Do not use',
  gs1SeparatorHint:
    'The token in the data that stands for the separator between two application ' +
    'identifiers. It goes to the printer as written; the preview reads it as the ' +
    'character it stands for. Which token to use is decided by the printer and by ' +
    'DataMobile, not here.',
  unsavedTitle: 'Save this label first?',
  unsavedDetail: 'It has not been saved anywhere yet.',
  discard: 'Do not save',
  cancel: 'Cancel',
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
  kindText: 'Текст',
  kindRectangle: 'Прямоугольник',
  kindLine: 'Линия',
  kindBarcode: 'Штрихкод',
  kindMatrix: '2D-код',
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
  detachedTitle: 'Панель элементов отключена',
  detachedBody:
    'Строки ниже не разобрались в элементы, поэтому дальше главным считается код: ' +
    'превью рисуется из него, а панель слева его больше не меняет. ' +
    'Исправьте эти строки — и элементы включатся сами.',
  detachedList: 'Строки, которые не разобрались:',
  backToCanvas: 'Отменить правки кода',
  backToCanvasHint: 'Возврат к последнему дизайну, которым управляла панель элементов.',
  howItIsWritten: 'Эта программа пишет её так:',
  problems: 'Проблемы',
  noProblems: 'Сообщать не о чем.',
  tooWide: 'Этикетка шире, чем печатает этот принтер, на',
  unsaved: 'не сохранено',
  line: 'строка',
  operation: 'Операция DataMobile',
  operationHint:
    'Определяет, какие переменные доступны шаблону. Оставьте «Все операции», чтобы предлагались любые.',
  variables: 'Переменные DataMobile',
  variablesHint:
    'Пишутся как @Имя@. DataMobile подставляет их при печати; в превью показан образец, чтобы ширина была настоящей.',
  insertVariable: 'Вставить переменную…',
  noVariables: 'На этой этикетке их нет.',
  notForOperation: 'недоступна для этой операции',
  unknownVariable: 'DataMobile такой не знает',
  values: 'Значения',
  dragHint: 'Перетаскивайте мышью. Стрелки сдвигают на 0,1\u00a0мм, с Shift — на 1\u00a0мм.',
  replaceWithVariable: 'Заменить переменной…',
  gs1Separator: 'Разделитель GS1',
  gs1SeparatorNone: 'Не использовать',
  gs1SeparatorHint:
    'Обозначение в данных, которое заменяет разделитель между двумя идентификаторами ' +
    'применения. В принтер оно уходит как написано, а превью читает его как символ, ' +
    'который оно обозначает. Какое обозначение нужно, решают принтер и DataMobile, ' +
    'а не эта программа.',
  unsavedTitle: 'Сохранить текущую этикетку?',
  unsavedDetail: 'Она ещё нигде не сохранена.',
  discard: 'Не сохранять',
  cancel: 'Отмена',
};

const DICTIONARIES: Record<Language, Strings> = { en, ru };

export function strings(language: Language): Strings {
  return DICTIONARIES[language];
}

export const LANGUAGES: readonly Language[] = ['ru', 'en'];
