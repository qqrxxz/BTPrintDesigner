/**
 * A quantity as a print command wrote it, in the form the design keeps.
 *
 * DataMobile's templates put `@Quant@` where the count goes, because that is
 * where the number the user typed arrives; it is kept as written. A plain
 * count is kept too, unless it is one, which is the same as saying nothing.
 */
export function quantityText(raw: string | undefined): string | undefined {
  const text = raw?.trim() ?? '';
  if (text === '') return undefined;
  if (/^\d+$/.test(text)) {
    const count = Math.max(1, Math.round(Number(text)));
    return count === 1 ? undefined : String(count);
  }
  return text;
}
