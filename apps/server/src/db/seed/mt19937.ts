const N = 624;
const M = 397;

/**
 * The Mersenne Twister PHP's `Random\Engine\Mt19937` implements, with `getInt` matching
 * `Random\Randomizer::getInt`, so a seed yields the same sequence as the original PHP seeder.
 */
export class Mt19937 {
  private readonly state = new Uint32Array(N);
  private index = N;

  constructor(seed: number) {
    this.state[0] = seed >>> 0;
    for (let i = 1; i < N; i++) {
      const previous = this.state[i - 1] as number;
      this.state[i] = (Math.imul(1812433253, previous ^ (previous >>> 30)) + i) >>> 0;
    }
  }

  private reload() {
    const s = this.state;
    for (let i = 0; i < N; i++) {
      const y = ((s[i] as number) & 0x80000000) | ((s[(i + 1) % N] as number) & 0x7fffffff);
      s[i] = ((s[(i + M) % N] as number) ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0)) >>> 0;
    }
    this.index = 0;
  }

  /** The next 32 random bits. */
  next32(): number {
    if (this.index >= N) this.reload();
    let y = this.state[this.index++] as number;
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  /** A uniform integer in [min, max], using the same rejection rule as PHP. */
  getInt(min: number, max: number): number {
    const range = max - min;
    let result = this.next32();
    if (range === 0xffffffff) return min + result;
    const size = range + 1;
    if ((size & (size - 1)) === 0) return min + (result & (size - 1));
    const ceiling = 0xffffffff - (0xffffffff % size) - 1;
    while (result > ceiling) result = this.next32();
    return min + (result % size);
  }
}
