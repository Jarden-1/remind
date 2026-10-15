import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stringify } from 'yaml'
import { verifyArtifacts } from './verify-artifacts.mjs'

const directories: string[] = []
const version = '0.1.5'
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'remind-artifacts-')); directories.push(dir)
  const entry = (suffix: string) => {
    const url = `remind-${version}-${suffix}`, bytes = Buffer.from(`installer-${suffix}`)
    writeFileSync(join(dir, url), bytes); writeFileSync(join(dir, `${url}.blockmap`), 'map')
    return { url, size: bytes.length, sha512: createHash('sha512').update(bytes).digest('base64') }
  }
  const mac = ['mac-arm64.dmg', 'mac-arm64.zip', 'mac-x64.dmg', 'mac-x64.zip'].map(entry), win = [entry('win-x64.exe')]
  const manifest = (files: typeof mac) => ({ version, files, path: files[0].url, sha512: files[0].sha512 })
  const write = () => { writeFileSync(join(dir, 'latest-mac.yml'), stringify(manifest(mac))); writeFileSync(join(dir, 'latest.yml'), stringify(manifest(win))) }
  write(); return { dir, mac, win, write }
}
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }) })
describe('release artifact integrity', () => {
  it('accepts a complete Mac/Windows release with verified payloads', async () => {
    expect(await verifyArtifacts(fixture().dir, version)).toHaveLength(5)
  })
  it('rejects modified installer bytes even when file size is unchanged', async () => {
    const { dir, mac } = fixture(); const file = join(dir, mac[0].url), bytes = readFileSync(file); bytes[0] ^= 1; writeFileSync(file, bytes)
    await expect(verifyArtifacts(dir, version)).rejects.toThrow('checksum mismatch')
  })
  it('rejects an incomplete platform and mismatched release version', async () => {
    const { dir, win } = fixture(); unlinkSync(join(dir, win[0].url))
    await expect(verifyArtifacts(dir, version)).rejects.toThrow('Missing installer')
    await expect(verifyArtifacts(dir, '0.2.0')).rejects.toThrow('Invalid version')
  })
  it('does not read manifest paths outside the artifact directory', async () => {
    const { dir, mac, write } = fixture(); mac[0].url = '../external.dmg'; write()
    await expect(verifyArtifacts(dir, version)).rejects.toThrow('Unsafe')
  })
})
