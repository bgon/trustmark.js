// Copyright 2023 Adobe
// All Rights Reserved.

// NOTICE: Adobe permits you to use, modify, and distribute this file in
// accordance with the terms of the Adobe license agreement accompanying
// it.

// Copyright (C) 2024 Bertrand Gondouin
// Additional changes made by Bertrand Gondouin to port the original
// MIT-licensed Python code to TypeScript are licensed under GPLv3.

/**
 * BCH (Bose-Chaudhuri-Hocquenghem) Error Correction Code class.
 */
export class BCH {
  ECCstate: any;

  /**
   * Initializes the ECC state with given parameters.
   * @param {number} t - Number of error correctable bits, max number of bit flips we can account for, increasing this increase the ecc length
   * @param {number} poly - The polynomial used for ECC.
   */
  constructor(t: number, poly: number) {
    let tmp = poly;
    let m = 0;

    // Calculate the degree of the polynomial.
    while (tmp >> 1) {
      tmp = tmp >> 1;
      m += 1;
    }

    this.ECCstate = {
      m: m,
      t: t,
      poly: poly,
    };

    // Set the maximum code length.
    this.ECCstate.n = Math.pow(2, m) - 1;
    const words = Math.ceil((m * t) / 32);
    this.ECCstate.ecc_bytes = Math.ceil((m * t) / 8);
    this.ECCstate.cyclic_tab = new Array(words * 1024).fill(BigInt(0));
    this.ECCstate.syn = new Array(2 * t).fill(0);
    this.ECCstate.elp = new Array(t + 1).fill(0);
    this.ECCstate.errloc = new Array(t).fill(0);

    let x = 1;
    const k = Math.pow(2, this.deg(poly));
    if (k !== Math.pow(2, this.ECCstate.m)) {
      return;
    }
    this.ECCstate.exponents = new Array(1 + this.ECCstate.n).fill(0);
    this.ECCstate.logarithms = new Array(1 + this.ECCstate.n).fill(0);
    this.ECCstate.elp_pre = new Array(1 + this.ECCstate.m).fill(0);

    // Generate the exponent and logarithm tables.
    for (let i = 0; i < this.ECCstate.n; i++) {
      this.ECCstate.exponents[i] = x;
      this.ECCstate.logarithms[x] = i;
      if (i && x === 1) {
        return;
      }
      x *= 2;
      if (x & k) {
        x ^= poly;
      }
    }

    this.ECCstate.logarithms[0] = 0;
    this.ECCstate.exponents[this.ECCstate.n] = 1;

    let n = 0;
    const g = { deg: 0, c: new Array(m * t + 1).fill(BigInt(0)) };
    const roots = new Array(this.ECCstate.n + 1).fill(0);
    const genpoly = new Array(Math.ceil(m * t + 1 / 32)).fill(BigInt(0));

    // Enumerate all roots.
    for (let i = 0; i < t; i++) {
      let r = 2 * i + 1;
      for (let j = 0; j < m; j++) {
        roots[r] = 1;
        r = this.mod(this, 2 * r);
      }
    }

    // Build the generator polynomial g(x).
    g.deg = 0;
    g.c[0] = BigInt(1);

    for (let i = 0; i < this.ECCstate.n; i++) {
      if (roots[i]) {
        const r = this.ECCstate.exponents[i];
        g.c[g.deg + 1] = BigInt(1);
        for (let j = g.deg; j > 0; j--) {
          g.c[j] = this.g_mul(this, g.c[j], r) ^ g.c[j - 1];
        }
        g.c[0] = this.g_mul(this, g.c[0], r);
        g.deg += 1;
      }
    }

    // Store the polynomial coefficients.
    n = g.deg + 1;
    let i = 0;

    while (n > 0) {
      const nbits = n > 32 ? 32 : n;
      let word = BigInt(0);
      for (let j = 0; j < nbits; j++) {
        if (g.c[n - 1 - j]) {
          word |= BigInt(Math.pow(2, 31 - j));
        }
      }
      genpoly[i] = word;
      i += 1;
      n -= nbits;
    }

    // Set ECC bits.
    this.ECCstate.ecc_bits = g.deg;
    this.buildCyclic(genpoly);

    // Initialize sum and aexp.
    let sum = 0;
    let aexp = 0;

    for (let i = 0; i < m; i++) {
      for (let j = 0; j < m; j++) {
        sum ^= this.g_pow(this, i * Math.pow(2, j));
      }
      if (sum) {
        aexp = this.ECCstate.exponents[i];
        break;
      }
    }

    x = 0;
    const precomp = new Array(31).fill(0);
    let remaining = m;

    // Precompute values.
    while (x <= this.ECCstate.n && remaining) {
      let y = this.g_sqrt(this, x) ^ x;
      for (let i = 0; i < 2; i++) {
        const r = this.g_log(this, y);
        if (y && r < m && !precomp[r]) {
          this.ECCstate.elp_pre[r] = x;
          precomp[r] = 1;
          remaining -= 1;
          break;
        }
        y ^= aexp;
      }
      x += 1;
    }
  }

  /**
   * Encodes the data and generates ECC bytes.
   * @param {number[]} data - The input data array.
   * @returns {Uint8Array} - The generated ECC bytes.
   */
  encode(data: number[]): Uint8Array {
    // Convert the input data to BigInt format.
    let bigIntData = this.convertAllBitsToBigInts(data, 8);

    const datalen = bigIntData.length;
    const l = this.ceilop(this.ECCstate.m * this.ECCstate.t, 32) - 1;
    let ecc = new Array(this.getEccBytes()).fill(0);

    const ecc_max_words = this.ceilop(31 * 64, 32);
    const r = new Array(ecc_max_words).fill(BigInt(0));

    const tab0idx = 0;
    const tab1idx = tab0idx + 256 * (l + 1);
    const tab2idx = tab1idx + 256 * (l + 1);
    const tab3idx = tab2idx + 256 * (l + 1);

    let mlen = Math.floor(datalen / 4); // how many whole words
    let offset = 0;

    // Process each word of data.
    while (mlen > 0) {
      let w = this.convertBytesToBigInt(bigIntData.slice(offset, offset + 4));
      w ^= r[0];
      const p0 = tab0idx + (l + 1) * Number((w >> BigInt(0)) & BigInt(0xff));
      const p1 = tab1idx + (l + 1) * Number((w >> BigInt(8)) & BigInt(0xff));
      const p2 = tab2idx + (l + 1) * Number((w >> BigInt(16)) & BigInt(0xff));
      const p3 = tab3idx + (l + 1) * Number((w >> BigInt(24)) & BigInt(0xff));

      // Update the remainder using cyclic table.
      for (let i = 0; i < l; i++) {
        r[i] =
          r[i + 1] ^
          this.ECCstate.cyclic_tab[Number(p0) + i] ^
          this.ECCstate.cyclic_tab[Number(p1) + i] ^
          this.ECCstate.cyclic_tab[Number(p2) + i] ^
          this.ECCstate.cyclic_tab[Number(p3) + i];
      }

      r[l] =
        this.ECCstate.cyclic_tab[Number(p0) + l] ^
        this.ECCstate.cyclic_tab[Number(p1) + l] ^
        this.ECCstate.cyclic_tab[Number(p2) + l] ^
        this.ECCstate.cyclic_tab[Number(p3) + l];
      mlen--;
      offset += 4;
    }

    bigIntData = bigIntData.slice(offset);

    let leftdata = bigIntData.length;
    ecc = r;
    let posn = 0;

    // Process remaining data bits.
    while (leftdata) {
      const tmp = bigIntData[posn];
      posn++;
      let pidx = (l + 1) * Number((ecc[0] >> BigInt(24)) ^ (tmp & BigInt(0xff)));

      for (let i = 0; i < l; i++) {
        ecc[i] =
          (((ecc[i] << BigInt(8)) & BigInt(0xffffffff)) | (ecc[i + 1] >> BigInt(24))) ^
          this.ECCstate.cyclic_tab[Number(pidx)];
        pidx++;
      }

      ecc[l] = ((ecc[l] << BigInt(8)) & BigInt(0xffffffff)) ^ this.ECCstate.cyclic_tab[Number(pidx)];
      leftdata--;
    }

    // Store the generated ECC bytes in the ECC buffer.
    this.ECCstate.ecc_buf = ecc;
    let eccout: number[] = [];

    for (const e of r) {
      eccout.push(Number(e >> BigInt(24)) & 0xff);
      eccout.push(Number(e >> BigInt(16)) & 0xff);
      eccout.push(Number(e >> BigInt(8)) & 0xff);
      eccout.push(Number(e >> BigInt(0)) & 0xff);
    }

    eccout = eccout.slice(0, this.getEccBytes());
    const eccbytes = new Uint8Array(eccout); // Convert back to Uint8Array
    return eccbytes;
  }

  /**
   * Decodes the data and corrects errors using ECC.
   * @param {number[]} data - The input data array.
   * @param {Uint8Array} recvecc - The received ECC data.
   * @returns {any} - The corrected data and status.
   */
  decode(data: number[], recvecc: number[]): any {
    // Encode the data to generate the ECC bits.
    this.encode(data);

    // Convert the received ECC data to BigInt format.
    const eccbuf = this.convertAllBitsToBigInts(Array.from(recvecc), 32);

    // Calculate the number of ECC words.
    const eccwords = this.ceilop(this.ECCstate.m * this.ECCstate.t, 32);

    let sum = BigInt(0);

    // Calculate the syndrome by XOR-ing the ECC buffers.
    for (let i = 0; i < eccwords; i++) {
      this.ECCstate.ecc_buf[i] = this.ECCstate.ecc_buf[i] ^ eccbuf[i];
      sum = sum | this.ECCstate.ecc_buf[i];
    }

    // Convert the input data to BigInt format.
    const dataout = this.convertAllBitsToBigInts(data, 8);

    // If the syndrome is zero, no bit flips occurred.
    if (sum === BigInt(0)) {
      return {
        bitflips: 0,
        valid: true,
        binary: this.toBinString(dataout, data.length),
        hex: this.toHexString(dataout, data.length),
        ascii: this.toAsciiString(dataout),
      };
    }

    // Initialize variables for error correction.
    let s = this.ECCstate.ecc_bits;
    let t = this.ECCstate.t;
    const syn = new Array(2 * t).fill(0);

    const m = s & 31;
    const synbuf = this.ECCstate.ecc_buf;

    // Mask the syndrome bits if necessary.
    if (m) {
      synbuf[Math.floor(s / 32)] = synbuf[Math.floor(s / 32)] & ~BigInt(Math.pow(2, Number(32 - m)) - 1);
    }

    // Calculate the error locator polynomial.
    let synptr = 0;
    while (s > 0 || synptr === 0) {
      let poly = synbuf[synptr];
      synptr += 1;
      s -= 32;

      while (poly) {
        const i = this.degBigInt(poly);

        for (let j = 0; j < 2 * t; j += 2) {
          syn[j] = syn[j] ^ this.g_pow(this, (j + 1) * (i + s));
        }

        poly = poly ^ BigInt(Math.pow(2, i));
      }
    }

    // Calculate the square roots of the syndromes.
    for (let i = 0; i < t; i++) {
      syn[2 * i + 1] = this.g_sqrt(this, syn[i]);
    }

    // Initialize variables for the Berlekamp-Massey algorithm.
    const n = this.ECCstate.n;
    t = this.ECCstate.t;
    let pp = -1;
    let pd = 1;

    let pelp = { deg: 0, c: new Array(2 * t).fill(0) };
    pelp.c[0] = 1;

    const elp = { deg: 0, c: new Array(2 * t).fill(0) };
    elp.c[0] = 1;

    let d = syn[0];
    let elp_copy;

    // Perform the Berlekamp-Massey algorithm to find the error locator polynomial.
    for (let i = 0; i < t; i++) {
      if (elp.deg > t) {
        break;
      }

      if (d) {
        const k = 2 * i - pp;
        elp_copy = JSON.parse(JSON.stringify(elp));
        let tmp = this.g_log(this, d) + n - this.g_log(this, pd);

        for (let j = 0; j <= pelp.deg; j++) {
          if (pelp.c[j] !== BigInt(0)) {
            const l = this.g_log(this, pelp.c[j]);
            elp.c[j + k] = elp.c[j + k] ^ this.g_pow(this, tmp + l);
          }
        }

        tmp = pelp.deg + k;

        if (tmp > elp.deg) {
          elp.deg = tmp;
          pelp = JSON.parse(JSON.stringify(elp_copy));
          pd = d;
          pp = 2 * i;
        }
      }

      if (i < t - 1) {
        d = syn[2 * i + 2];

        for (let j = 1; j <= elp.deg; j++) {
          d = d ^ this.g_mul(this, elp.c[j], syn[2 * i + 2 - j]);
        }
      }
    }

    // Set the error locator polynomial in the ECC state.
    this.ECCstate.elp = elp;

    // Find the roots of the error locator polynomial.
    const nroots = this.getRoots(this, dataout.length, this.ECCstate.elp);
    const datalen = dataout.length;
    const nbits = datalen * 8 + this.ECCstate.ecc_bits;

    if (nroots === -1) {
      return { valid: false };
    }

    // Correct the errors in the data.
    for (let i = 0; i < nroots; i++) {
      if (this.ECCstate.errloc[i] >= nbits) {
        return -1;
      }

      this.ECCstate.errloc[i] = nbits - 1 - this.ECCstate.errloc[i];
      this.ECCstate.errloc[i] = (this.ECCstate.errloc[i] & ~7) | (7 - (this.ECCstate.errloc[i] & 7));
    }

    for (const bitflip of this.ECCstate.errloc) {
      const byte = Math.floor(bitflip / 8);
      const bit = Math.pow(2, bitflip & 7);

      if (bitflip < (dataout.length + recvecc.length) * 8) {
        if (byte < dataout.length) {
          dataout[byte] = dataout[byte] ^ BigInt(bit);
        } else {
          recvecc[byte - dataout.length] = recvecc[byte - dataout.length] ^ bit;
        }
      }
    }

    // Generate the final corrected data.
    return {
      bitflips: nroots,
      valid: true,
      binary: this.toBinString(dataout, data.length),
      hex: this.toHexString(dataout, data.length),
      ascii: this.toAsciiString(dataout),
    };
  }

  /**
   * Finds the roots of a polynomial.
   * @param {any} instance - The instance of the ECC state.
   * @param {number} k - The degree of the polynomial.
   * @param {any} poly - The polynomial.
   * @returns {number} - The number of roots found.
   */
  getRoots(instance: any, k: number, poly: any): number {
    const roots: number[] = [];

    if (poly.deg > 2) {
      k = k * 8 + instance.ECCstate.ecc_bits;
      const rep = new Array(instance.ECCstate.t * 2).fill(0);
      const d = poly.deg;
      const l = instance.ECCstate.n - this.g_log(instance, poly.c[poly.deg]);

      // Prepare the syndrome array
      for (let i = 0; i < d; i++) {
        if (poly.c[i]) {
          rep[i] = this.mod(instance, this.g_log(instance, poly.c[i]) + l);
        } else {
          rep[i] = -1;
        }
      }

      rep[poly.deg] = 0;
      const syn0 = this.g_div(instance, poly.c[0], poly.c[poly.deg]);

      // Evaluate the polynomial
      for (let i = instance.ECCstate.n - k + 1; i < instance.ECCstate.n + 1; i++) {
        let syn = syn0;
        for (let j = 1; j < poly.deg + 1; j++) {
          const m = rep[j];
          if (m >= 0) {
            syn = syn ^ this.g_pow(instance, m + j * i);
          }
        }
        if (syn === 0) {
          roots.push(instance.ECCstate.n - i);
          if (roots.length === poly.deg) {
            break;
          }
        }
      }

      // Check if the number of roots is sufficient for correction
      if (roots.length < poly.deg) {
        instance.ECCstate.errloc = [];
        return -1;
      }
    }

    // Handle special cases for polynomials of degree 1 and 2
    if (poly.deg === 1) {
      if (poly.c[0]) {
        roots.push(
          this.mod(
            instance,
            instance.ECCstate.n - instance.ECCstate.logarithms[poly.c[0]] + instance.ECCstate.logarithms[poly.c[1]],
          ),
        );
      }
    }

    if (poly.deg === 2) {
      if (poly.c[0] && poly.c[1]) {
        const l0: any = instance.ECCstate.logarithms[poly.c[0]];
        const l1: any = instance.ECCstate.logarithms[poly.c[1]];
        const l2: any = instance.ECCstate.logarithms[poly.c[2]];
        const u: number = this.g_pow(instance, l0 + l2 + 2 * (instance.ECCstate.n - l1));
        let r = 0;
        let v: number = u;

        // Find the roots using the Berlekamp-Massey algorithm
        while (v) {
          const i = this.deg(v);
          r = r ^ instance.ECCstate.elp_pre[i];
          v = v ^ Math.pow(2, i);
        }

        if (this.g_sqrt(instance, r) ^ Number(r === u)) {
          roots.push(this.modn(instance, 2 * instance.ECCstate.n - l1 - instance.ECCstate.logarithms[r] + l2));
          roots.push(this.modn(instance, 2 * instance.ECCstate.n - l1 - instance.ECCstate.logarithms[r ^ 1] + l2));
        }
      }
    }

    instance.ECCstate.errloc = roots;
    return roots.length;
  }

  /**
   * Gets the number of ECC bits.
   * @returns {number} - The number of ECC bits.
   */
  getEccBits(): number {
    return this.ECCstate.ecc_bits;
  }

  /**
   * Gets the number of ECC bytes.
   * @returns {number} - The number of ECC bytes.
   */
  getEccBytes(): number {
    return Math.ceil((this.ECCstate.m * this.ECCstate.t) / 8);
  }

  /**
   * Builds a cyclic table for error correction.
   * @param {bigint[]} g - The generator polynomial.
   */
  buildCyclic(g: bigint[]): void {
    // Calculate the length of the table entries based on ECC parameters.
    const l = Math.ceil((this.ECCstate.m * this.ECCstate.t) / 32);
    const plen = Math.ceil((this.ECCstate.ecc_bits + 1) / 32);
    const ecclen = Math.ceil(this.ECCstate.ecc_bits / 32);
    this.ECCstate.cyclic_tab = new Array(4 * 256 * l).fill(BigInt(0));

    // Iterate through each possible byte value (0-255).
    for (let i = 0; i < 256; i++) {
      for (let b = 0; b < 4; b++) {
        // Calculate the offset for the current byte and position.
        const offset = (b * 256 + i) * l;
        let data = BigInt(i) << BigInt(8 * b);

        // Process each bit in the byte.
        while (data) {
          const d = this.degBigInt(data);
          data ^= g[0] >> BigInt(31 - d);

          // Update the cyclic table entries.
          for (let j = 0; j < ecclen; j++) {
            let hi, lo;

            // Compute the high part of the data.
            if (d < 31) {
              hi = BigInt(g[j] << BigInt(d + 1)) & BigInt(0xffffffff);
            } else {
              hi = BigInt(0);
            }

            // Compute the low part of the data.
            if (j + 1 < plen) {
              lo = g[j + 1] >> BigInt(31 - d);
            } else {
              lo = BigInt(0);
            }

            if (this.ECCstate.cyclic_tab[j + offset] === BigInt(0)) {
              this.ECCstate.cyclic_tab[j + offset] = BigInt(0);
            }

            // XOR the high and low parts into the cyclic table entry.
            this.ECCstate.cyclic_tab[j + offset] ^= hi | lo;
          }
        }
      }
    }
  }

  /** GALOIS OPERATIONS */

  /**
   * Computes the power of a value in a Galois field.
   * @param instance - The current context containing Galois field parameters.
   * @param i - The exponent value.
   * @returns The result of raising a value to the power i in the Galois field.
   */
  g_pow(instance: any, i: number): number {
    return instance.ECCstate.exponents[this.modn(instance, i)];
  }

  /**
   * Computes the square root of a value in a Galois field.
   * @param instance - The current context containing Galois field parameters.
   * @param a - The value whose square root is to be computed.
   * @returns The square root of the value in the Galois field.
   */
  g_sqrt(instance: any, a: number): number {
    if (a) {
      return instance.ECCstate.exponents[this.mod(instance, 2 * instance.ECCstate.logarithms[a])];
    } else {
      return 0;
    }
  }

  /**
   * Computes the logarithm of a value in a Galois field.
   * @param instance - The current context containing Galois field parameters.
   * @param x - The value whose logarithm is to be computed.
   * @returns The logarithm of the value in the Galois field.
   */
  g_log(instance: any, x: number): number {
    return instance.ECCstate.logarithms[x];
  }

  /**
   * Multiplies two values in a Galois field.
   * @param instance - The current context containing Galois field parameters.
   * @param a - The first value to be multiplied.
   * @param b - The second value to be multiplied.
   * @returns The product of the two values in the Galois field.
   */
  g_mul(instance: any, a: number, b: number): number {
    if (a > 0 && b > 0) {
      const res = this.mod(instance, instance.ECCstate.logarithms[a] + instance.ECCstate.logarithms[b]);
      return instance.ECCstate.exponents[res];
    } else {
      return 0;
    }
  }

  /**
   * Divides two values in a Galois field.
   * @param instance - The current context containing Galois field parameters.
   * @param a - The dividend.
   * @param b - The divisor.
   * @returns The quotient of the division in the Galois field.
   */
  g_div(instance: any, a: number, b: number): number {
    if (a) {
      return instance.ECCstate.exponents[
        this.mod(instance, instance.ECCstate.logarithms[a] + instance.ECCstate.n - instance.ECCstate.logarithms[b])
      ];
    } else {
      return 0;
    }
  }

  /**
   * Reduces a value modulo the Galois field size.
   * @param instance - The current context containing Galois field parameters.
   * @param v - The value to be reduced.
   * @returns The value reduced modulo the Galois field size.
   */
  mod(instance: any, v: number): number {
    if (v < instance.ECCstate.n) {
      return v;
    } else {
      return v - instance.ECCstate.n;
    }
  }

  /**
   * Reduces a value modulo the Galois field size.
   * @param instance - The current context containing Galois field parameters.
   * @param v - The value to be reduced.
   * @returns The value reduced modulo the Galois field size.
   */
  modn(instance: any, v: number): number {
    const n = instance.ECCstate.n;
    while (v >= n) {
      v -= n;
      v = (v & n) + (v >> instance.ECCstate.m);
    }
    return v;
  }

  /**
   * Computes the degree of a polynomial represented as an integer.
   * @param x - The polynomial represented as an integer.
   * @returns The degree of the polynomial.
   */
  deg(x: number): number {
    let count = 0;
    while (x >> 1) {
      x = x >> 1;
      count += 1;
    }
    return count;
  }

  /**
   * Computes the ceiling of the division of two integers.
   * @param a - The dividend.
   * @param b - The divisor.
   * @returns The ceiling of the division of a by b.
   */
  ceilop(a: number, b: number): number {
    return Math.floor((a + b - 1) / b);
  }

  /**
   * Computes the degree of a polynomial represented as a BigInt.
   * @param x - The polynomial represented as a BigInt.
   * @returns The degree of the polynomial.
   */
  degBigInt(x: bigint): number {
    let count = 0;
    while (x >> BigInt(1)) {
      x = x >> BigInt(1);
      count += 1;
    }
    return count;
  }

  /**
   * Converts an array of bits into a single BigInt value.
   * @param {number[]} bitArray - The array of bits to convert.
   * @param {number} bitLimit - The maximum number of bits to process.
   * @returns {BigInt} - The combined value of all bits in the array.
   */
  convertBitsToBigInt(bitArray: number[], bitLimit: number): bigint {
    let result = BigInt(0);
    if (bitLimit < bitArray.length) {
      bitLimit = bitArray.length;
    }
    let pos = bitLimit - 1;
    for (let b = 0; b < bitLimit; b++) {
      if (bitArray[b]) {
        result += BigInt(1) << BigInt(pos);
      }
      pos--;
    }
    return result;
  }

  /**
   * Processes an array of bits in chunks, converting each chunk into a BigInt.
   * @param {number[]} bitArray - The array of bits to process.
   * @param {number} chunkSize - The size of each chunk of bits to process.
   * @returns {BigInt[]} - An array of BigInt values representing chunks of the original bit array.
   */
  convertAllBitsToBigInts(bitArray: number[], chunkSize: number): bigint[] {
    const dataLength = bitArray.length;
    let numChunks = Math.floor(dataLength / chunkSize);
    const resultArray: bigint[] = [];
    let offset = 0;

    while (numChunks > 0) {
      const chunk = bitArray.slice(offset, offset + chunkSize);
      const bigInt = this.convertBitsToBigInt(chunk, chunkSize);
      resultArray.push(bigInt);
      offset += chunkSize;
      numChunks--;
    }

    const remainingBitsArray = bitArray.slice(offset);
    if (remainingBitsArray.length > 0) {
      const bigInt = this.convertBitsToBigInt(remainingBitsArray, chunkSize);
      resultArray.push(bigInt);
    }

    return resultArray;
  }

  /**
   * Converts an array of up to 4 bytes into a single BigInt value.
   * @param {bigint[]} byteArray - The array of bytes to convert.
   * @returns {BigInt} - The combined value of the bytes as a BigInt.
   */
  convertBytesToBigInt(byteArray: bigint[]): bigint {
    let result = BigInt(0);

    // Process each byte and shift its position accordingly
    if (byteArray.length > 0) result += byteArray[0] << BigInt(24);
    if (byteArray.length > 1) result += byteArray[1] << BigInt(16);
    if (byteArray.length > 2) result += byteArray[2] << BigInt(8);
    if (byteArray.length > 3) result += byteArray[3];

    return result;
  }

  /**
   * Generates a binary string from data.
   * @param {any[]} dataout - The data output array.
   * @param {number} datalen - The desired length of the binary string.
   * @returns {string} - The binary string representation of the data.
   */
  toBinString(dataout: any[], datalen: number): string {
    let out = '';
    for (const byte of dataout) {
      out += this.numberToBinaryString(byte, 8);
    }
    out = out.slice(0, datalen);
    return out;
  }

  /**
   * Converts a number to a binary string of a given length.
   * @param {number} num - The number to convert.
   * @param {number} length - The desired length of the binary string.
   * @returns {string} - The binary string representation of the number.
   */
  numberToBinaryString(num: number, length: number): string {
    let binaryString = num.toString(2);
    while (binaryString.length < length) {
      binaryString = '0' + binaryString;
    }
    return binaryString;
  }

  /**
   * Decodes a Uint8Array to a string using 7-bit ASCII encoding.
   * @param {Uint8Array} data - The input byte array.
   * @returns {string} - The decoded string.
   */
  toAsciiString(data: any[]): string {
    // Convert byte array to a bit string
    const textBitStr = data.map((byte) => byte.toString(2).padStart(8, '0')).join('');

    // Extract 7-bit ASCII values and convert them to characters
    const textInt7: number[] = [];
    for (let i = 0; i < textBitStr.length; i += 7) {
      const bitSegment = textBitStr.slice(i, i + 7);
      textInt7.push(parseInt(bitSegment, 2));
    }

    // Convert ASCII values to string
    const textBytes = new Uint8Array(textInt7);
    const decodedText = new TextDecoder('utf-8').decode(textBytes).replace(/\0/g, '');

    return decodedText;
  }

  /**
   * Converts an array of numbers to a hexadecimal string.
   * @param {any[]} data - The array of numbers to convert.
   * @returns {string} - The hexadecimal string representation of the numbers.
   */
  toHexString(data: any[], datalen: number): string {
    if (data.length > datalen / 8) {
      data.pop();
    }
    return data
      .map(function (byte) {
        byte = Number(byte);
        if (byte > 15) return (byte & 0xff).toString(16);
        else return '0' + (byte & 0xff).toString(16);
      })
      .join('');
  }
}
