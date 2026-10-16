import { describe, expect, it } from 'vitest'
import { shouldHidePanel } from './panel-window'

describe('panel conceal', () => {
  it('hides a macOS panel even when minimize reports success', () => {
    expect(shouldHidePanel('darwin', true)).toBe(true)
    expect(shouldHidePanel('darwin', false)).toBe(true)
  })
  it('hides a Windows panel only when minimize left it visible', () => {
    expect(shouldHidePanel('win32', true)).toBe(true)
    expect(shouldHidePanel('win32', false)).toBe(false)
  })
})

import { panelBounds, fitPanelHeight } from './panel-window'
it('fits a short display and respects negative screen coordinates', () => {
  const area = { x: -600, y: -200, width: 500, height: 400 }
  const bounds = panelBounds(area, { x: -200, y: -100 }, 'darwin', true)
  expect(bounds.height).toBe(384)
  expect(bounds.x).toBeGreaterThanOrEqual(area.x)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(area.x + area.width)
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(area.y + area.height)
})
it('places a Windows tray panel above the taskbar within its work area', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 }
  const bounds = panelBounds(area, { x: 1900, y: 1040 }, 'win32', false)
  expect(bounds.y + bounds.height).toBe(1032)
  expect(bounds.x + bounds.width).toBe(1912)
})

it('uses the actual content height and keeps the larger settings size independent', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 }
  expect(panelBounds(area, { x: 100, y: 0 }, 'darwin', false, 394).height).toBe(394)
  expect(panelBounds(area, { x: 100, y: 0 }, 'darwin', false, 432).height).toBe(432)
  expect(panelBounds(area, { x: 100, y: 0 }, 'darwin', true, 394).height).toBe(740)
})
it('preserves the top on Mac and the bottom on Windows when content expands', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 }
  const bounds = { x: 100, y: 100, width: 368, height: 394 }
  expect(fitPanelHeight(bounds, area, 432, 'darwin').y).toBe(100)
  const windows = fitPanelHeight(bounds, area, 432, 'win32')
  expect(windows.y + windows.height).toBe(bounds.y + bounds.height)
})
it('clamps expanded content to a short display without moving off a negative-origin screen', () => {
  const area = { x: -600, y: -200, width: 500, height: 400 }
  const bounds = fitPanelHeight({ x: -500, y: -160, width: 368, height: 300 }, area, 700, 'darwin')
  expect(bounds.height).toBe(384)
  expect(bounds.y).toBe(-192)
  expect(bounds.y + bounds.height).toBe(area.y + area.height - 8)
})
