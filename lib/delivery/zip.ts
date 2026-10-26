// Un .zip sin comprimir (metodo store), sin dependencias. Brevo no admite adjuntos .cerebro-licencia
// (solo una lista cerrada de extensiones), asi que la licencia viaja dentro de un .zip; dentro va
// el fichero tal cual, byte a byte.

import { crc32 } from 'node:zlib'

function dosDateTime(date: Date): { time: number; date: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

export function zip(entries: { name: string; content: Buffer }[], when = new Date()): Buffer {
  const { time, date } = dosDateTime(when)
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf-8')
    const checksum = crc32(entry.content) >>> 0
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version para extraer
    local.writeUInt16LE(0x0800, 6) // nombre en UTF-8
    local.writeUInt16LE(0, 8) // store
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(entry.content.length, 18)
    local.writeUInt32LE(entry.content.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, entry.content)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(entry.content.length, 20)
    central.writeUInt32LE(entry.content.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += local.length + name.length + entry.content.length
  }
  const centralSize = centrals.reduce((sum, b) => sum + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, ...centrals, end])
}

/** Lee un .zip de zip() (solo store): para las pruebas. */
export function unzip(data: Buffer): { name: string; content: Buffer }[] {
  const entries: { name: string; content: Buffer }[] = []
  let at = 0
  while (data.readUInt32LE(at) === 0x04034b50) {
    const size = data.readUInt32LE(at + 18)
    const nameLength = data.readUInt16LE(at + 26)
    const extra = data.readUInt16LE(at + 28)
    const name = data.subarray(at + 30, at + 30 + nameLength).toString('utf-8')
    const start = at + 30 + nameLength + extra
    const content = data.subarray(start, start + size)
    if ((crc32(content) >>> 0) !== data.readUInt32LE(at + 14)) throw new Error(`${name}: CRC32 no cuadra`)
    entries.push({ name, content })
    at = start + size
  }
  return entries
}
