import { operationName, type DataMobileOperation } from '@btpd/core';
import type { Language } from './i18n.js';

/**
 * Translations for the engine's diagnostics.
 *
 * The engine emits English wording plus a stable code, so the interface can say
 * the same thing in the reader's language and still work when a code has no
 * translation yet — the English simply shows through.
 *
 * Two things stay in English on purpose. Argument names quoted inside a message
 * are the printer manual's own terms, and translating "narrow bar width" would
 * make it harder, not easier, to find in the documentation. And the encoders'
 * own failures — why a payload will not fit a symbology — keep their exact
 * wording, because a translated generic would drop the one detail that says
 * what to change.
 */

type Template = string;

const RU: Readonly<Record<string, Template>> = {
  'parse.expected-command': 'Ожидалась команда, а найдено «{text}»',
  'parse.unterminated-string': 'Незакрытая строка',

  'tspl.missing-argument': 'Команде {command} не хватает аргумента: {argument}',
  'tspl.not-a-number': 'Аргумент {argument} должен быть числом, а найдено «{found}»',
  'tspl.not-a-measurement': 'Аргумент {argument} должен быть размером, а найдено «{found}»',
  'tspl.bad-rotation': 'Поворот бывает 0, 90, 180 или 270; {found} считается нулём',
  'tspl.label-too-large':
    'Размер этикетки {width} × {height} точек превышает предел в {limit} точек',
  'tspl.image-not-drawn':
    '{command} размещает изображение, которое эта версия не рисует. ' +
    'На остальную этикетку это не влияет.',
  'tspl.unknown-command': 'Неизвестная команда «{command}»',
  'tspl.symbology-unsupported': 'Штрихкод «{symbology}» пока не поддерживается',
  'tspl.block-overflow': 'Текст выше рамки BLOCK; то, что не влезло, не печатается',
  'tspl.qr-model-1': 'QR модели 1 не поддерживается; символ нарисован как модель 2',
  'tspl.pdf417-option': 'Неизвестная опция PDF417 «{option}»',
  'tspl.font-substituted':
    'Шрифт «{font}» не входит в число резидентных шрифтов принтера. ' +
    'Он нарисован подменным шрифтом нужной высоты; настоящие ширины будут другими.',

  'generate.snapped':
    '{what}: заказано {requested} мм, это {exact} точки на этом принтере, ' +
    'печатается {dots} — то есть {actual} мм.',
  'generate.placeholder-missing':
    'Для плейсхолдера {{{name}}} нет значения; он печатается как есть.',
  'generate.line-break-flattened':
    'Команда {language} заканчивается вместе со строкой, поэтому переносы строк ' +
    'в этом значении заменены пробелами.',
  'generate.variable-unknown':
    'В DataMobile нет переменной {name}; она напечатается как есть. ' +
    'Проверьте написание, включая заглавные буквы.',
  'generate.variable-unavailable':
    'Переменная {name} не предлагается шаблону операции «{operation}», ' +
    'поэтому DataMobile оставит её как есть.',
  'generate.variable-symbol-size':
    'В этом символе {symbology} стоит переменная DataMobile, а команда обязана ' +
    'указать размер символа. Записан размер, который нужен образцу значения; ' +
    'более длинному значению потребуется больше места.',
  'generate.diagonal-line':
    'В TSPL нет команды для диагональной линии, поэтому эта линия не напечатается. ' +
    'Сделайте её горизонтальной или вертикальной либо перенесите в задание ZPL.',

  'import.multiple-labels':
    'Это задание печатает больше одной этикетки; холст держит один дизайн.',
  'import.image': 'Изображения пока не входят в модель документа.',
  'import.unknown-command': 'На холсте нет ничего, что соответствует команде {command}.',
  'import.incomplete': 'Команда {command} неполная.',
  'import.symbology': 'Холст не предлагает штрихкод «{symbology}».',
  'import.qr-model-1': 'Холст рисует QR только модели 2.',
  'import.encode-failed': 'Эти данные не кодируются в {symbology}.',
  'import.pdf417-option': 'Холст не хранит опцию PDF417 «{option}».',
  'import.pdf417-rows': 'Фиксированное число строк PDF417 не входит в модель документа.',
};

const TABLES: Readonly<Record<Language, Readonly<Record<string, Template>>>> = {
  ru: RU,
  en: {},
};

function fill(template: Template, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = values[name];
    return value === undefined ? whole : String(value);
  });
}

/**
 * The message in the reader's language, or the engine's English if there is no
 * translation for that code.
 */
export function translate(
  language: Language,
  message: string,
  code?: string,
  values?: Readonly<Record<string, string | number>>,
): string {
  if (code === undefined) return message;
  const template = TABLES[language][code];
  if (template === undefined) return message;
  // An operation arrives as DataMobile's own identifier; the reader knows it by
  // the name on the settings screen.
  const named =
    values?.operation === undefined
      ? values
      : { ...values, operation: operationName(values.operation as DataMobileOperation, language) };
  return fill(template, named ?? {});
}
