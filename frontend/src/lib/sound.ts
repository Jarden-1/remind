/** Small synthesized chime; no remote assets or audio permission at startup. */
export class Chime {
  private context?: AudioContext
  private nodes: OscillatorNode[] = []
  async play() {
    this.stop()
    this.context ??= new AudioContext()
    await this.context.resume()
    for (const [index, frequency] of [523.25, 659.25, 783.99].entries()) {
      const oscillator = this.context.createOscillator()
      const gain = this.context.createGain()
      const start = this.context.currentTime + index * 0.13
      oscillator.type = 'sine'; oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(0.12, start + 0.025)
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.7)
      oscillator.connect(gain); gain.connect(this.context.destination)
      oscillator.start(start); oscillator.stop(start + 0.8)
      this.nodes.push(oscillator)
    }
  }
  stop() { this.nodes.forEach(node => { try { node.stop() } catch { /* Already ended. */ } }); this.nodes = [] }
}
