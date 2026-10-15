import { execFileSync } from 'node:child_process'
import { mkdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const directory = resolve('desktop/native/bin')
mkdirSync(directory, { recursive: true })
if (process.platform === 'darwin') {
  const sdk = execFileSync('xcrun', ['--show-sdk-path'], { encoding: 'utf8' }).trim()
  const architectures = process.argv.includes('--universal') ? ['arm64', 'x86_64'] : [process.arch === 'arm64' ? 'arm64' : 'x86_64']
  for (const arch of architectures) execFileSync('xcrun', ['swiftc', '-O', '-sdk', sdk, '-target', `${arch}-apple-macos14.0`, '-framework', 'AppKit', '-framework', 'ApplicationServices', 'desktop/native/meetings/MeetingProbe.swift', '-o', join(directory, `meeting-probe-${arch}`)], { stdio: 'inherit' })
  execFileSync('xcrun', ['lipo', '-create', ...architectures.map(arch => join(directory, `meeting-probe-${arch}`)), '-output', join(directory, 'meeting-probe')])
  execFileSync('codesign', ['--sign', '-', '--force', join(directory, 'meeting-probe')])
  execFileSync(join(directory, 'meeting-probe'), ['--self-test'], { stdio: 'inherit' })
} else if (process.platform === 'win32') {
  const framework = join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319')
  const wpf = join(framework, 'WPF')
  const executable = join(directory, 'meeting-probe.exe')
  if (!existsSync(join(framework, 'csc.exe'))) throw new Error('.NET Framework C# compiler is required')
  execFileSync(join(framework, 'csc.exe'), ['/nologo', '/codepage:65001', '/optimize+', '/platform:x64', '/target:exe', `/out:${executable}`, `/reference:${join(wpf, 'UIAutomationClient.dll')}`, `/reference:${join(wpf, 'UIAutomationTypes.dll')}`, `/reference:${join(wpf, 'WindowsBase.dll')}`, `/reference:${join(framework, 'System.Web.Extensions.dll')}`, 'desktop/native/meetings/MeetingProbe.cs'], { stdio: 'inherit' })
  execFileSync(executable, ['--self-test'], { stdio: 'inherit' })
} else {
  console.log('Native meeting probe unsupported on this platform')
}
