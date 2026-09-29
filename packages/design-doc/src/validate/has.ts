export const has = (obj: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(obj, key);
