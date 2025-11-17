import { toHiragana } from "wanakana";

export const normalizeKana = (input: string) => {
  if (!input) return "";
  return toHiragana(input);
};
