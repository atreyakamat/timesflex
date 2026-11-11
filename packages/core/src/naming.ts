/** "SE-A" -> "SE-B", "Room 101" -> "Room 102", "Lab 1" -> "Lab 2"; null when there is no obvious next one. */
export const nextName = (name: string) => {
  const trimmed = name.trim();
  const number = /^(.*?)(\d+)$/.exec(trimmed);
  if (number) return `${number[1]}${String(Number(number[2]) + 1).padStart(number[2].length, '0')}`;
  const letter = /^(.*[\s-])([A-Ya-y])$/.exec(trimmed);
  if (letter) return `${letter[1]}${String.fromCharCode(letter[2].charCodeAt(0) + 1)}`;
  return null;
};

/** Lab batch names from the class name: "SE-A" with 2 batches -> A1, A2; "FY" -> FY1, FY2. */
export const batchNames = (className: string, count: number) => {
  const suffix = className.trim().split(/[\s-]+/).pop()?.replace(/[^\w]/g, '') || 'B';
  const base = suffix.length <= 2 ? suffix.toUpperCase() : 'B';
  return Array.from({ length: count }, (_, i) => `${base}${i + 1}`);
};
