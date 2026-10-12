import { crc32, deflateRawSync } from 'node:zlib';

export interface ZipEntry {
  /** Path inside the archive, `/`-separated. */
  name: string;
  data: Buffer;
}

/**
 * A plain zip archive (no zip64, so under 4 GiB and 65 535 entries), each entry deflated unless
 * that does not make it smaller (PDFs and PNGs are compressed already). Names are UTF-8.
 */
export function zip(entries: readonly ZipEntry[], modified: Date): Buffer {
  const { time, date } = dosTime(modified);
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const deflated = deflateRawSync(entry.data);
    const stored = deflated.length >= entry.data.length;
    const body = stored ? entry.data : deflated;
    const crc = crc32(entry.data);

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version needed: 2.0
    header.writeUInt16LE(0x0800, 6); // names are UTF-8
    header.writeUInt16LE(stored ? 0 : 8, 8);
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(entry.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, body);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(0x0314, 4); // made by: Unix, 2.0
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt16LE(stored ? 0 : 8, 10);
    record.writeUInt16LE(time, 12);
    record.writeUInt16LE(date, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(body.length, 20);
    record.writeUInt32LE(entry.data.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE((0o100644 << 16) >>> 0, 38); // a regular file, rw-r--r--
    record.writeUInt32LE(offset, 42);
    central.push(record, name);

    offset += header.length + name.length + body.length;
    if (offset > 0xffffffff || entries.length > 0xffff) throw new Error('The export is too big.');
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

/** MS-DOS date and time fields, in UTC (zip has no time zone). */
function dosTime(d: Date) {
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
    date: ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}
