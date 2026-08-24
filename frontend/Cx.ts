export type ClassValue = string | false | null | undefined;

export const cx = (...values: ClassValue[]) => values.filter(Boolean).join(" ");
