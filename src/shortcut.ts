/**
 * Windows shortcuts store their target in the LinkInfo structure: an ANSI path and, when the
 * writer emitted Unicode offsets, a UTF-16 path. Portable apps such as Ryujinx are often only
 * registered through a Start menu shortcut, so the target is the sole pointer to the install.
 */

const LINK_HEADER_SIZE = 0x4c
const HAS_LINK_TARGET_ID_LIST = 0x1
const HAS_LINK_INFO = 0x2
const UNICODE_LINK_INFO_HEADER = 0x24

function readUtf16(data: Buffer, offset: number): string {
  let end = offset
  while (end + 1 < data.length && data.readUInt16LE(end) !== 0) end += 2
  return end > offset ? data.toString("utf16le", offset, end) : ""
}

function readAnsi(data: Buffer, offset: number, encoding: string): string {
  let end = offset
  while (end < data.length && data[end] !== 0) end += 1
  if (end === offset) return ""
  try {
    return new TextDecoder(encoding).decode(data.subarray(offset, end))
  } catch {
    return data.toString("latin1", offset, end)
  }
}

function looksLikeTarget(value: string): boolean {
  return /^[a-z]:\\/i.test(value) && value.length < 1024 && /\.(exe|com|bat|cmd)$/i.test(value)
}

/** Locates the LinkInfo block after the optional LinkTargetIDList. */
function linkInfoOffset(data: Buffer): number {
  if (data.length < LINK_HEADER_SIZE || data.readUInt32LE(0) !== LINK_HEADER_SIZE) return -1
  const flags = data.readUInt32LE(0x14)
  let offset = LINK_HEADER_SIZE
  if (flags & HAS_LINK_TARGET_ID_LIST) {
    if (offset + 2 > data.length) return -1
    offset += 2 + data.readUInt16LE(offset)
  }
  if (!(flags & HAS_LINK_INFO) || offset + 0x1c > data.length) return -1
  return offset
}

/**
 * Candidate executables from a .lnk file, most reliable form first.
 * The ANSI path uses the system code page, so it is decoded as both GBK and Latin-1 and the
 * caller keeps the first candidate that actually exists.
 */
export function shortcutTargets(data: Buffer): string[] {
  if (!data || data.length < LINK_HEADER_SIZE) return []
  const targets: string[] = []
  const add = (value: string) => {
    const cleaned = String(value || "").trim()
    if (looksLikeTarget(cleaned) && !targets.includes(cleaned)) targets.push(cleaned)
  }
  const start = linkInfoOffset(data)
  if (start >= 0) {
    const headerSize = data.readUInt32LE(start + 4)
    const unicodeOffsets = headerSize >= UNICODE_LINK_INFO_HEADER
    const localBase = data.readUInt32LE(start + 0x10)
    const localBaseUnicode = unicodeOffsets ? data.readUInt32LE(start + 0x1c) : 0
    if (localBaseUnicode && start + localBaseUnicode < data.length) add(readUtf16(data, start + localBaseUnicode))
    if (localBase && start + localBase < data.length) {
      add(readAnsi(data, start + localBase, "gbk"))
      add(readAnsi(data, start + localBase, "utf-8"))
    }
  }
  // A malformed or unusual shortcut can still carry the path as a UTF-16 string.
  if (!targets.length) {
    // Shortcut strings are length-prefixed, so the decoded text has to be cut at control characters.
    // eslint-disable-next-line no-control-regex
    const printable = data.toString("utf16le").replace(/[\u0000-\u001f]+/g, "\n")
    for (const match of printable.matchAll(/[a-z]:\\[^<>:"|?*\r\n]{1,1024}?\.(?:exe|com|bat|cmd)/gi)) add(match[0])
  }
  return targets
}
