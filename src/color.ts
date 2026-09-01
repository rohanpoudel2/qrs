export type RGB = [red: number, green: number, blue: number]

export function parseHexColor(value: string, name: string): RGB {
  if (!/^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(value))
    throw new TypeError(`${name} must be a three- or six-digit hex color`)

  const hex = value.length === 4
    ? [...value.slice(1)].map(char => char + char).join('')
    : value.slice(1)
  return [0, 2, 4].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16)) as RGB
}

